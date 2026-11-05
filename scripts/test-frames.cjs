// Frame sequences: duplicating and deleting any frame (store), stepping between frames and the onion-skin
// ghosts (src/core/sequence-frames.ts).
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);

const storage = new Map();
globalThis.window = {localStorage: {getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k)}};
const {frameNeighbours, steppedFrame, onionGhosts} = require('../src/core/sequence-frames.ts');
const {MAX_SEQUENCE_FRAMES} = require('../src/stores/editor/sequence-slice.ts');
const {ARTBOARD_SIZE, SEQUENCE_FRAME_GAP} = require('../src/stores/editor/artboards.ts');
const {useEditorStore} = require('../src/stores/use-editor-store.ts');
const {STORAGE_KEY} = require('../src/lib/persistence.ts');

// ---------------------------------------------------------------------------------------------------
// Pure helpers.
{
  const frames = ['a', 'b', 'c'].map((id) => ({id}));
  assert.deepEqual(frameNeighbours(frames, 'a'), {index: 0, previous: null, next: frames[1]}, 'the first frame has no previous one (no wrap-around)');
  assert.deepEqual(frameNeighbours(frames, 'b'), {index: 1, previous: frames[0], next: frames[2]});
  assert.deepEqual(frameNeighbours(frames, 'c'), {index: 2, previous: frames[1], next: null});
  assert.deepEqual(frameNeighbours(frames, 'x'), {index: -1, previous: null, next: null}, 'a frame from elsewhere has no neighbours');
  assert.deepEqual(frameNeighbours([], 'a'), {index: -1, previous: null, next: null});

  assert.equal(steppedFrame(frames, 'b', -1), frames[0]);
  assert.equal(steppedFrame(frames, 'b', 1), frames[2]);
  assert.equal(steppedFrame(frames, 'a', -1), null, 'stepping stops at the ends');
  assert.equal(steppedFrame(frames, 'c', 1), null);
  assert.equal(steppedFrame(frames, 'x', 1), null);

  assert.deepEqual([...onionGhosts([1, 2], [2, 3])].sort((x, y) => x[0] - y[0]), [[1, 'previous'], [2, 'both'], [3, 'next']]);
  assert.deepEqual([...onionGhosts(null, [5])], [[5, 'next']], 'only a next frame (the first frame)');
  assert.deepEqual([...onionGhosts([5], null)], [[5, 'previous']], 'only a previous frame (the last frame)');
  assert.equal(onionGhosts(null, null).size, 0);
}

// ---------------------------------------------------------------------------------------------------
// The store, on a four-frame sequence whose frames each light one different cell.
const s = () => useEditorStore.getState();
s().hydrate();
const base = s().selectedLoaderId;
s().importSequence(base, [0, 1, 2, 3].map((cell) => ({cells: [cell], colors: {}})), 8);
const sequenceId = s().project.loaders.find((loader) => loader.id === s().selectedLoaderId).sequenceId;
const frames = () => s().project.loaders.filter((loader) => loader.sequenceId === sequenceId).sort((a, b) => a.sequenceIndex - b.sequenceIndex);
const cellsOf = () => frames().map((frame) => frame.pattern.activeCells.join(','));
const ids = () => frames().map((frame) => frame.id);
const selected = () => s().selectedLoaderId;
assert.deepEqual(cellsOf(), ['0', '1', '2', '3']);

/** Frames sit in a row, one artboard plus a gap apart, numbered 0, 1, 2, ... */
function assertLaidOut(message) {
  const list = frames();
  list.forEach((frame, index) => {
    assert.equal(frame.sequenceIndex, index, `${message}: whole positions`);
    assert.equal(frame.artboard.x, list[0].artboard.x + index * (ARTBOARD_SIZE + SEQUENCE_FRAME_GAP), `${message}: in a row`);
    assert.equal(frame.artboard.y, list[0].artboard.y);
  });
}

// Duplicating a frame in the middle puts the copy right after it, selected; the rest move along.
{
  const [, second, third] = ids();
  s().addSequenceFrame(sequenceId, second);
  assert.deepEqual(cellsOf(), ['0', '1', '1', '2', '3']);
  assert.equal(ids()[1], second, 'the original stays where it was');
  assert.equal(ids()[3], third);
  assert.equal(selected(), ids()[2], 'the copy is selected');
  assert.notEqual(ids()[2], second, 'the copy is a new frame');
  assertLaidOut('after duplicating');
  // The copy is independent: drawing on it leaves the original alone.
  s().setCellsActiveForLoader(ids()[2], [9], true);
  assert.deepEqual(cellsOf(), ['0', '1', '1,9', '2', '3']);
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)).loaders.filter((l) => l.sequenceId === sequenceId).length, 5, 'saved');
}

// Without a frame id, a copy of the last frame goes at the end (as the + Frame button always did).
{
  s().addSequenceFrame(sequenceId);
  assert.deepEqual(cellsOf(), ['0', '1', '1,9', '2', '3', '3']);
  assert.equal(selected(), ids()[5]);
  assertLaidOut('after adding at the end');
}

// Deleting a frame in the middle selects the frame that takes its place.
{
  const before = ids();
  s().removeSequenceFrame(sequenceId, before[2]);
  assert.deepEqual(cellsOf(), ['0', '1', '2', '3', '3']);
  assert.equal(selected(), before[3], 'the next frame moves into the gap and is selected');
  assertLaidOut('after deleting from the middle');
}

// Deleting the first frame selects the new first frame; the sequence keeps its place on the canvas.
{
  const before = ids();
  const x = frames()[0].artboard.x;
  s().removeSequenceFrame(sequenceId, before[0]);
  assert.deepEqual(cellsOf(), ['1', '2', '3', '3']);
  assert.equal(selected(), before[1]);
  assert.equal(frames()[0].artboard.x, x, 'the remaining frames take the first one\'s place');
  assertLaidOut('after deleting the first frame');
}

// Deleting the last frame (explicitly or by default) selects the one before it.
{
  const before = ids();
  s().removeSequenceFrame(sequenceId, before[3]);
  assert.deepEqual(cellsOf(), ['1', '2', '3']);
  assert.equal(selected(), before[2]);
  s().removeSequenceFrame(sequenceId);
  assert.deepEqual(cellsOf(), ['1', '2']);
  assert.equal(selected(), before[1]);
}

// A frame id from outside the sequence changes nothing.
{
  const project = s().project;
  s().removeSequenceFrame(sequenceId, base);
  s().addSequenceFrame(sequenceId, 'no-such-frame');
  assert.equal(s().project, project);
}

// The last frame cannot be deleted; a sequence holds at most ten frames.
{
  s().removeSequenceFrame(sequenceId, ids()[0]);
  assert.deepEqual(cellsOf(), ['2']);
  const project = s().project;
  s().removeSequenceFrame(sequenceId, ids()[0]);
  assert.equal(s().project, project, 'one frame stays');
  while (frames().length < MAX_SEQUENCE_FRAMES) s().addSequenceFrame(sequenceId, ids()[0]);
  assert.equal(MAX_SEQUENCE_FRAMES, 10);
  const full = s().project;
  s().addSequenceFrame(sequenceId, ids()[0]);
  assert.equal(s().project, full, 'no eleventh frame');
  assertLaidOut('when full');
}

console.log('PASS: frames — neighbours, stepping, onion-skin ghosts; duplicate and delete any frame with the right selection, layout and limits.');
