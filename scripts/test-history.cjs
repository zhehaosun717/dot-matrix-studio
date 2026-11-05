// Command-based undo / redo (src/core/history.ts) and the workspace commands (src/core/document/commands.ts):
// steps, merging, gestures, limits, exact round trips, and a long random edit sequence that undoes back to
// the start and redoes to the end. Inputs are frozen, so any change made in place fails the test.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);

const H = require('../src/core/history.ts');
const C = require('../src/core/document/commands.ts');
const T = require('../src/core/document/types.ts');
const {celFromPixels, compositeFrame} = require('../src/core/document/pixels.ts');
const {migrateProject} = require('../src/core/document/migrate.ts');

function deepFreeze(value) {
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value) && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

// ---- The history itself, on a string state: appending letters, so the order of reverts matters.
const append = (letter, mergeKey, size = 1) => ({
  label: `add ${letter}`,
  mergeKey,
  size,
  apply: (s) => s + letter,
  revert: (s) => {
    assert.equal(s.at(-1), letter, 'reverted in reverse order');
    return s.slice(0, -1);
  }
});
function run(history, state, steps) {
  let h = history, s = state;
  for (const step of steps) {
    deepFreeze(h);
    const out = step(h, s);
    h = out.history ?? out;
    if (out.state !== undefined) s = out.state;
  }
  return {h, s};
}
const at = (now, command, options = {}) => (h, s) => H.commit(h, s, command, {now, ...options});
const undo = (h, s) => H.undo(h, s);
const redo = (h, s) => H.redo(h, s);

{
  // Separate commits are separate steps; undo and redo walk them; labels follow.
  let {h, s} = run(H.createHistory(), '', [at(0, append('a')), at(1000, append('b'))]);
  assert.equal(s, 'ab');
  assert.equal(H.undoLabel(h), 'add b');
  ({h, s} = run(h, s, [undo]));
  assert.equal(s, 'a');
  assert.equal(H.redoLabel(h), 'add b');
  ({h, s} = run(h, s, [undo, undo]));
  assert.equal(s, '', 'undo with nothing left does nothing');
  assert.equal(H.canUndo(h), false);
  ({h, s} = run(h, s, [redo, redo, redo]));
  assert.equal(s, 'ab');
  assert.equal(H.canRedo(h), false);

  // A commit clears redo.
  ({h, s} = run(h, s, [undo, at(2000, append('c'))]));
  assert.equal(s, 'ac');
  assert.equal(H.canRedo(h), false);
}

{
  // Same mergeKey within the window: one step. Outside the window, another key, or another source: new steps.
  const {h, s} = run(H.createHistory(), '', [
    at(0, append('a', 'k')), at(300, append('b', 'k')), at(700, append('c', 'k')),
    at(2000, append('d', 'k')), at(2100, append('e', 'other')), at(2200, append('f', 'other'), {source: 'agent'}),
    at(2300, append('g'))
  ]);
  assert.equal(s, 'abcdefg');
  assert.deepEqual(h.past.map((step) => step.commands.length), [3, 1, 1, 1, 1], 'the window counts from the last merged commit');
  let state = s, history = h;
  const sizes = [];
  while (H.canUndo(history)) ({history, state} = H.undo(history, state)), sizes.push(state.length);
  assert.deepEqual(sizes, [6, 5, 4, 3, 0]);
  // Commands without a mergeKey never merge.
  const plain = run(H.createHistory(), '', [at(0, append('a')), at(1, append('b'))]).h;
  assert.equal(plain.past.length, 2);
}

{
  // A gesture is one step whatever keys and times; it ends at endGesture.
  let {h, s} = run(H.createHistory(), '', [
    at(0, append('x', 'k')),
    (h) => H.beginGesture(h),
    at(10, append('a', 'k')), at(5000, append('b')), at(9000, append('c', 'z'), {source: 'user'}),
    (h) => H.endGesture(h),
    at(9001, append('d', 'z'))
  ]);
  assert.equal(s, 'xabcd');
  assert.deepEqual(h.past.map((step) => step.commands.length), [1, 3, 1], 'the gesture did not join the step before it, nor the one after');
  ({h, s} = run(h, s, [undo, undo]));
  assert.equal(s, 'x');
  // An empty gesture records nothing.
  const empty = run(H.createHistory(), '', [(h) => H.beginGesture(h), (h) => H.endGesture(h)]).h;
  assert.equal(H.canUndo(empty), false);
}

{
  // A redone step is closed: the next commit does not merge into it.
  const {h} = run(H.createHistory(), '', [at(0, append('a', 'k')), undo, redo, at(10, append('b', 'k'))]);
  assert.equal(h.past.length, 2);
}

{
  // Several commands in one commit are one step, reverted in reverse order.
  let {h, s} = run(H.createHistory(), '', [at(0, [append('a'), append('b'), append('c')], {label: 'Paste'})]);
  assert.equal(H.undoLabel(h), 'Paste');
  ({h, s} = run(h, s, [undo]));
  assert.equal(s, '');
  assert.equal(H.commit(h, s, [], {now: 1}).history, h, 'committing nothing changes nothing');
}

{
  // Limits: at most maxSteps steps; the byte budget drops the oldest steps but never the newest.
  const steps = Array.from({length: 7}, (_, i) => at(i * 1000, append(String(i))));
  assert.equal(run(H.createHistory({maxSteps: 5}), '', steps).h.past.length, 5);
  const bytes = run(H.createHistory({maxBytes: 25}), '', [at(0, append('a', undefined, 10)), at(1000, append('b', undefined, 10)), at(2000, append('c', undefined, 10))]).h;
  assert.deepEqual(bytes.past.map((step) => step.label), ['add b', 'add c']);
  const huge = run(H.createHistory({maxBytes: 5}), '', [at(0, append('a', undefined, 10))]).h;
  assert.equal(huge.past.length, 1, 'a step bigger than the budget is still kept');
  assert.deepEqual(H.DEFAULT_LIMITS, {maxSteps: 100, maxBytes: 32 * 1024 * 1024, mergeWindowMs: 500});
}

// ---- Workspace commands, on a migrated project with two artboards and a sequence.
globalThis.window = undefined;
const {useEditorStore} = require('../src/stores/use-editor-store.ts');
const s = () => useEditorStore.getState();
s().hydrate();
const first = s().selectedLoaderId;
s().setCellsActiveForLoader(first, [0, 1, 7], true, '#FF0000');
s().addLayer(first, 'two');
s().setCellsActiveForLoader(first, [14], true);
s().addLoader('sequence');
const seqLoader = s().selectedLoaderId;
const seqId = s().project.loaders.find((l) => l.id === seqLoader).sequenceId;
s().setCellsActiveForLoader(seqLoader, [3], true, '#00FF00');
s().addSequenceFrame(seqId);
s().addSequenceFrame(seqId);
const start = deepFreeze(migrateProject(structuredClone(s().project)).workspace);
const doc = start.documents[0];
const seq = start.documents.find((d) => d.id === seqId);

function roundTrip(command, check) {
  const after = deepFreeze(command.apply(start));
  assert.notDeepEqual(after, start, `${command.label} changes something`);
  assert.deepEqual(command.revert(after), start, `${command.label}: revert(apply(ws)) is ws`);
  assert.deepEqual(command.apply(command.revert(after)), after, `${command.label}: apply again gives the same`);
  assert(command.size > 0, `${command.label}: has a size`);
  if (check) check(after);
}

const frame0 = doc.frames[0].id;
const key = T.celKey(frame0, doc.layers[0].id);
const painted = celFromPixels([{x: 4, y: 4, index: 2}, {x: -1, y: 0, index: 1}]);
roundTrip(C.replaceCel(doc.id, key, doc.cels[key], painted), (ws) => {
  assert.equal(compositeFrame(ws.documents[0], 0)[4 * doc.size.width + 4], 2, 'the new pixels show');
});
roundTrip(C.replaceCel(doc.id, key, doc.cels[key], undefined, 'Clear'), (ws) => assert.equal(ws.documents[0].cels[key], undefined));
roundTrip(C.setLayerProps(doc.id, doc.layers[0].id, {visible: true, name: doc.layers[0].name}, {visible: false, name: 'renamed'}), (ws) => {
  assert.deepEqual(ws.documents[0].layers[0], {...doc.layers[0], visible: false, name: 'renamed'});
});
const extra = {id: 'extra', name: 'extra', visible: true};
roundTrip(C.insertLayer(doc.id, 1, extra, {[T.celKey(frame0, 'extra')]: painted}), (ws) => {
  assert.deepEqual(ws.documents[0].layers.map((l) => l.id), [doc.layers[0].id, 'extra', doc.layers[1].id]);
});
roundTrip(C.removeLayer(start, doc.id, doc.layers[0].id), (ws) => {
  assert.equal(ws.documents[0].layers.length, 1);
  assert(!Object.keys(ws.documents[0].cels).some((k) => k.endsWith(`:${doc.layers[0].id}`)), 'its cels go too');
});
roundTrip(C.moveLayer(doc.id, 0, 1), (ws) => assert.deepEqual(ws.documents[0].layers.map((l) => l.id), [doc.layers[1].id, doc.layers[0].id]));
const seqIndex = start.documents.indexOf(seq);
roundTrip(C.insertFrame(seq.id, 1, {id: 'new-frame', durationMs: 100}), (ws) => {
  assert.deepEqual(ws.documents[seqIndex].frames.map((f) => f.id), [seq.frames[0].id, 'new-frame', ...seq.frames.slice(1).map((f) => f.id)]);
});
roundTrip(C.removeFrame(start, seq.id, seq.frames[0].id), (ws) => {
  assert.equal(ws.documents[seqIndex].frames.length, 2);
  assert(!Object.keys(ws.documents[seqIndex].cels).some((k) => k.startsWith(`${seq.frames[0].id}:`)), 'its cels go too');
});
roundTrip(C.setFrameDuration(seq.id, seq.frames[1].id, seq.frames[1].durationMs, 250), (ws) => assert.equal(ws.documents[seqIndex].frames[1].durationMs, 250));
roundTrip(C.setDocumentProps(doc.id, {render: doc.render, name: doc.name}, {render: {...doc.render, baseColor: '#123456'}, name: 'Renamed'}), (ws) => {
  assert.equal(ws.documents[0].render.baseColor, '#123456');
});
roundTrip(C.replaceDocument(doc, {...doc, size: {width: 12, height: 12}, cels: {}}), (ws) => assert.deepEqual(ws.documents[0].size, {width: 12, height: 12}));
roundTrip(C.insertDocument(1, {...doc, id: 'copy'}), (ws) => assert.deepEqual(ws.documents.map((d) => d.id), [doc.id, 'copy', ...start.documents.slice(1).map((d) => d.id)]));
roundTrip(C.removeDocument(start, seq.id), (ws) => assert(!ws.documents.some((d) => d.id === seq.id)));
assert.throws(() => C.removeLayer(start, doc.id, 'missing'), /no layer/);
assert.throws(() => C.removeDocument(start, 'missing'), /no document/);

// ---- A long random edit sequence through the history: undo everything, then redo everything.
let seed = 12345;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (items) => items[Math.floor(random() * items.length)];
let counter = 0;
function randomCommand(ws) {
  const target = pick(ws.documents);
  const kind = pick(['cel', 'cel', 'cel', 'layerProps', 'insertLayer', 'removeLayer', 'moveLayer', 'insertFrame', 'removeFrame', 'duration', 'props', 'insertDoc', 'removeDoc']);
  const layer = pick(target.layers);
  const frame = pick(target.frames);
  switch (kind) {
    case 'cel': {
      const celKeyNow = T.celKey(frame.id, layer.id);
      const pixels = Array.from({length: 1 + Math.floor(random() * 6)}, () => ({x: Math.floor(random() * 10) - 2, y: Math.floor(random() * 10) - 2, index: Math.floor(random() * target.palette.length)}));
      return C.replaceCel(target.id, celKeyNow, target.cels[celKeyNow], celFromPixels(pixels) ?? undefined, 'Draw', random() < 0.3 ? 'brush' : undefined);
    }
    case 'layerProps': return C.setLayerProps(target.id, layer.id, {visible: layer.visible, name: layer.name}, {visible: !layer.visible, name: `n${counter++}`});
    case 'insertLayer': return C.insertLayer(target.id, Math.floor(random() * (target.layers.length + 1)), {id: `L${counter++}`, name: '', visible: true});
    case 'removeLayer': return target.layers.length > 1 ? C.removeLayer(ws, target.id, layer.id) : null;
    case 'moveLayer': return target.layers.length > 1 ? C.moveLayer(target.id, Math.floor(random() * target.layers.length), Math.floor(random() * target.layers.length)) : null;
    case 'insertFrame': return C.insertFrame(target.id, Math.floor(random() * (target.frames.length + 1)), {id: `F${counter++}`, durationMs: 100});
    case 'removeFrame': return target.frames.length > 1 ? C.removeFrame(ws, target.id, frame.id) : null;
    case 'duration': return C.setFrameDuration(target.id, frame.id, frame.durationMs, 50 + Math.floor(random() * 200));
    case 'props': return C.setDocumentProps(target.id, {render: target.render}, {render: {...target.render, glow: {enabled: random() < 0.5, size: Math.floor(random() * 40)}}}, 'Glow', 'glow');
    case 'insertDoc': return C.insertDocument(Math.floor(random() * (ws.documents.length + 1)), {...target, id: `D${counter++}`});
    case 'removeDoc': return ws.documents.length > 1 ? C.removeDocument(ws, target.id) : null;
  }
  return null;
}

let history = H.createHistory({maxSteps: Infinity, maxBytes: Infinity});
let ws = start;
let now = 0;
let commits = 0;
while (commits < 300) {
  if (random() < 0.08) history = history.inGesture ? H.endGesture(history) : H.beginGesture(history);
  const command = randomCommand(ws);
  if (!command) continue;
  now += Math.floor(random() * 900);
  ({history, state: ws} = H.commit(deepFreeze(history), deepFreeze(ws), command, {now, source: random() < 0.1 ? 'agent' : 'user'}));
  commits++;
  // Now and then step back and forth in the middle.
  if (random() < 0.1) {
    const before = ws;
    ({history, state: ws} = H.undo(history, ws));
    ({history, state: ws} = H.redo(history, ws));
    assert.deepEqual(ws, before, 'undo then redo returns to the same state');
  }
}
const end = ws;
const steps = history.past.length;
assert(steps > 50 && steps < 300, `merging and gestures grouped the commits (${steps} steps)`);
while (H.canUndo(history)) ({history, state: ws} = H.undo(deepFreeze(history), deepFreeze(ws)));
assert.deepEqual(ws, start, 'undoing every step returns to the start');
while (H.canRedo(history)) ({history, state: ws} = H.redo(deepFreeze(history), deepFreeze(ws)));
assert.deepEqual(ws, end, 'redoing every step returns to the end');

console.log(`PASS: history — steps, merging, gestures, closed steps, multi-command steps, step and byte limits; 12 workspace commands round-trip exactly; 300 random commits in ${steps} steps undo to the start and redo to the end.`);
