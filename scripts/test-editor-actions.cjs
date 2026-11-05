// Editor actions that sit outside the store slices: the selection box (copy, cut, paste, delete, move,
// nudge), the two preferences kept in localStorage (panel colour tuning, recent colours) and what agents
// get back when an editor request is wrong. Runs against the real stores.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);

const warnings = [];
console.warn = (...args) => warnings.push(args.map(String).join(' '));

/** localStorage over a Map; writes and reads can be made to fail like a full or blocked store. */
function makeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  const storage = {
    map,
    writes: 0,
    failWrites: false,
    failReads: false,
    getItem(key) {
      if (storage.failReads) throw new Error('The operation is insecure.');
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (storage.failWrites) {
        const error = new Error('The quota has been exceeded.');
        error.name = 'QuotaExceededError';
        throw error;
      }
      storage.writes++;
      map.set(key, String(value));
    },
    removeItem: (key) => map.delete(key)
  };
  return storage;
}

/** Fresh copies of every src module, running against the given storage (none: no window, as on the server). */
function load(storage, modules) {
  if (storage) globalThis.window = {localStorage: storage};
  else delete globalThis.window;
  for (const key of Object.keys(require.cache)) if (key.startsWith(path.join(root, 'src'))) delete require.cache[key];
  return modules.map((file) => require(path.join(root, 'src', file)));
}

/** A fresh editor on the sample project, with the selection actions and handy readers. */
function openEditor() {
  const [{useEditorStore}, {useDrawStore}, actions, {handleEditorRequest}, layerOps] = load(makeStorage(), [
    'stores/use-editor-store.ts', 'stores/use-draw-store.ts', 'components/editor/selection-actions.ts',
    'components/editor/agent-editor-handler.ts', 'core/layer-ops.ts'
  ]);
  const s = () => useEditorStore.getState();
  s().hydrate();
  const id = s().selectedLoaderId;
  const loaderOf = (loaderId) => s().project.loaders.find((loader) => loader.id === loaderId);
  const loader = () => loaderOf(s().selectedLoaderId);
  const {cols} = loader().pattern.grid;
  const at = (x, y) => y * cols + x;
  const lit = (loaderId = s().selectedLoaderId) => [...loaderOf(loaderId).pattern.activeCells].sort((a, b) => a - b);
  /** What the cell shows: its own colour or the artboard's base colour. */
  const colorAt = (cell, loaderId = s().selectedLoaderId) => {
    const target = loaderOf(loaderId);
    return (target.pattern.cellColors?.[cell] ?? target.style.primaryColor).toUpperCase();
  };
  const paint = (cells, color) => s().setCellsActiveForLoader(s().selectedLoaderId, cells, true, color);
  const box = (x0, y0, x1, y1, loaderId = s().selectedLoaderId) => useDrawStore.getState().setSelection({loaderId, x0, y0, x1, y1});
  const draw = () => useDrawStore.getState();
  const layers = (loaderId = s().selectedLoaderId) => loaderOf(loaderId).pattern.layers ?? [];
  return {useEditorStore, useDrawStore, actions, handleEditorRequest, layerOps, s, id, loader, loaderOf, cols, at, lit, colorAt, paint, box, draw, layers};
}

const byPosition = (pixels) => [...pixels].sort((a, b) => a.y - b.y || a.x - b.x);
const sorted = (cells) => [...cells].sort((a, b) => a - b);

// ---------------------------------------------------------------------------------------------------
// The selection box.

// The sample artboard is the 6 x 6 grid with the light blue base colour these cases are written for.
{
  const e = openEditor();
  assert.equal(e.loader().pattern.grid.rows, 6);
  assert.equal(e.cols, 6);
  assert.equal(e.loader().style.primaryColor.toUpperCase(), '#66BDFF');
}

// Only a box on the selected artboard counts.
{
  const e = openEditor();
  assert.equal(e.actions.activePixelSelection(), null, 'no box yet');
  e.box(0, 0, 1, 1, 'another-artboard');
  assert.equal(e.actions.activePixelSelection(), null, 'a box on another artboard is not the active one');
  e.box(0, 0, 1, 1);
  assert.deepEqual(e.actions.activePixelSelection(), {loaderId: e.id, x0: 0, y0: 0, x1: 1, y1: 1});
}

// Without a box, copy, cut, delete, move and paste do nothing and say so.
{
  const e = openEditor();
  e.paint([e.at(0, 0)], '#FF0000');
  const before = e.s().project;
  assert.equal(e.actions.copySelection(), false);
  assert.equal(e.actions.cutSelection(), false);
  assert.equal(e.actions.deleteSelection(), false);
  assert.equal(e.actions.moveSelection(1, 0, 'Moved'), false);
  assert.equal(e.actions.pasteSelection('Pasted'), false, 'nothing copied yet');
  assert.equal(e.draw().pixelClipboard, null);
  assert.equal(e.s().project, before, 'the drawing is untouched');
}

// Copy takes the active layer's pixels inside the box, by position in the box, with base-coloured pixels
// as the real colour; cut removes exactly those; paste puts them back as a new layer, selected.
{
  const e = openEditor();
  e.paint([e.at(1, 1), e.at(2, 1)], '#FF0000');
  e.paint([e.at(1, 2)]); // the base colour
  e.paint([e.at(4, 4)], '#00FF00'); // outside the box
  e.box(1, 1, 2, 2);
  assert.equal(e.actions.copySelection(), true);
  assert.deepEqual(byPosition(e.draw().pixelClipboard.pixels), [
    {x: 0, y: 0, color: '#FF0000'},
    {x: 1, y: 0, color: '#FF0000'},
    {x: 0, y: 1, color: '#66BDFF'}
  ], 'the empty corner is not copied');
  assert.equal(e.draw().pixelClipboard.x0, 1);
  assert.equal(e.draw().pixelClipboard.y0, 1);
  assert.equal(e.draw().lastCopy, 'pixels', 'Ctrl+V pastes these pixels, not an artboard');
  assert.deepEqual(e.lit(), sorted([e.at(1, 1), e.at(2, 1), e.at(1, 2), e.at(4, 4)]), 'copy leaves the drawing alone');

  const layersBeforeCut = e.layers().length;
  assert.equal(e.actions.cutSelection(), true);
  assert.deepEqual(e.lit(), [e.at(4, 4)], 'cut clears the box and nothing else');
  assert.equal(e.layers().length, layersBeforeCut, 'cut does not add a layer');

  assert.equal(e.actions.pasteSelection('Pasted'), true);
  assert.deepEqual(e.lit(), sorted([e.at(1, 1), e.at(2, 1), e.at(1, 2), e.at(4, 4)]), 'pasted back where it was copied from');
  assert.deepEqual([e.at(1, 1), e.at(2, 1), e.at(1, 2), e.at(4, 4)].map((cell) => e.colorAt(cell)), ['#FF0000', '#FF0000', '#66BDFF', '#00FF00'], 'with the same colours');
  const pasted = e.layers()[e.layers().length - 1];
  assert.equal(pasted.name, 'Pasted', 'as a new top layer');
  assert.equal(e.loader().pattern.activeLayerId, pasted.id, 'which becomes the active layer');
  assert.deepEqual(e.draw().selection, {loaderId: e.id, x0: 1, y0: 1, x1: 2, y1: 2}, 'the box hugs the pasted pixels');
  assert.equal(e.draw().floatingLayerId, pasted.id, 'and moving it moves the pasted layer');

  // Moving the pasted pixels shifts that layer; nothing is lifted again.
  const layerCount = e.layers().length;
  assert.equal(e.actions.moveSelection(1, 0, 'Lifted'), true);
  assert.equal(e.layers().length, layerCount, 'no second layer');
  assert.deepEqual(e.lit(), sorted([e.at(2, 1), e.at(3, 1), e.at(2, 2), e.at(4, 4)]));
  assert.deepEqual(e.draw().selection, {loaderId: e.id, x0: 2, y0: 1, x1: 3, y1: 2}, 'the box moves with them');

  // Past the grid edge and back: nothing is lost.
  assert.equal(e.actions.moveSelection(5, 0, ''), true);
  assert.deepEqual(e.lit(), [e.at(4, 4)], 'off the grid, out of sight');
  assert.equal(e.actions.moveSelection(-5, 0, ''), true);
  assert.deepEqual(e.lit(), sorted([e.at(2, 1), e.at(3, 1), e.at(2, 2), e.at(4, 4)]), 'back again, whole');
  assert.equal(e.colorAt(e.at(2, 2)), '#66BDFF');
  assert.equal(e.actions.moveSelection(0, 0, ''), false, 'a move by nothing is not a move');
}

// Cut on its own fills the clipboard; the pasted box hugs the pixels, not the box they were cut from.
{
  const e = openEditor();
  e.paint([e.at(1, 1), e.at(2, 2)], '#FF0000');
  e.box(0, 0, 3, 3);
  assert.equal(e.actions.cutSelection(), true);
  assert.deepEqual(e.lit(), []);
  assert.deepEqual(byPosition(e.draw().pixelClipboard.pixels), [{x: 1, y: 1, color: '#FF0000'}, {x: 2, y: 2, color: '#FF0000'}]);
  assert.equal(e.actions.pasteSelection('Pasted'), true);
  assert.deepEqual(e.lit(), sorted([e.at(1, 1), e.at(2, 2)]));
  assert.deepEqual(e.draw().selection, {loaderId: e.id, x0: 1, y0: 1, x1: 2, y1: 2});
}

// The first move lifts what is under the box into its own layer; later moves only shift that layer.
{
  const e = openEditor();
  e.paint([e.at(0, 0), e.at(1, 0)], '#FF0000');
  e.box(0, 0, 0, 0);
  const layerCount = e.layers().length;
  assert.equal(layerCount, 1, 'one layer to start with');
  assert.equal(e.actions.moveSelection(0, 1, 'Moved'), true);
  assert.equal(e.layers().length, layerCount + 1, 'lifted into one new layer');
  const lifted = e.layers().find((layer) => layer.name === 'Moved');
  assert.ok(lifted, 'named as asked');
  assert.equal(e.draw().floatingLayerId, lifted.id);
  assert.deepEqual(e.lit(), sorted([e.at(1, 0), e.at(0, 1)]), 'only the boxed pixel moved');
  assert.equal(e.colorAt(e.at(0, 1)), '#FF0000');
  assert.deepEqual(e.draw().selection, {loaderId: e.id, x0: 0, y0: 1, x1: 0, y1: 1});

  assert.equal(e.actions.moveSelection(1, 0, 'Moved'), true);
  assert.equal(e.layers().length, layerCount + 1, 'the second move lifts nothing new');
  assert.deepEqual(e.lit(), sorted([e.at(1, 0), e.at(1, 1)]));

  // A new box is not the lifted one: over empty cells a move just moves the box.
  e.box(4, 4, 5, 5);
  assert.equal(e.draw().floatingLayerId, null, 'a new box forgets the lifted layer');
  assert.equal(e.actions.moveSelection(-1, -1, 'Empty'), true);
  assert.equal(e.layers().length, layerCount + 1, 'nothing under the box, nothing lifted');
  assert.deepEqual(e.draw().selection, {loaderId: e.id, x0: 3, y0: 3, x1: 4, y1: 4});
  assert.equal(e.draw().floatingLayerId, null);
  assert.deepEqual(e.lit(), sorted([e.at(1, 0), e.at(1, 1)]), 'the drawing did not move');
}

// Delete clears the boxed cells of the active layer.
{
  const e = openEditor();
  e.paint([e.at(0, 0), e.at(1, 0), e.at(3, 3)], '#FF0000');
  e.box(0, 0, 1, 1);
  assert.equal(e.actions.deleteSelection(), true);
  assert.deepEqual(e.lit(), [e.at(3, 3)]);
  assert.equal(e.draw().pixelClipboard, null, 'delete copies nothing');
}

// Paste needs room for a layer: on a full artboard it is refused and the box stays.
{
  const e = openEditor();
  e.paint([e.at(0, 0)], '#FF0000');
  e.box(0, 0, 0, 0);
  assert.equal(e.actions.copySelection(), true);
  while (e.layers().length < e.layerOps.MAX_LAYERS) e.s().addLayer(e.id, 'Layer');
  e.box(2, 2, 3, 3);
  assert.equal(e.actions.pasteSelection('Pasted'), false);
  assert.equal(e.layers().length, e.layerOps.MAX_LAYERS);
  assert.deepEqual(e.draw().selection, {loaderId: e.id, x0: 2, y0: 2, x1: 3, y1: 3});
  assert.equal(e.layers().some((layer) => layer.name === 'Pasted'), false);
}

// The arrow keys and move buttons: without a box they move, flip or turn the active layer.
{
  const e = openEditor();
  e.paint([e.at(0, 0)], '#FF0000');
  e.actions.nudgeDrawing(e.id, 'right');
  assert.deepEqual(e.lit(), [e.at(1, 0)]);
  e.actions.nudgeDrawing(e.id, 'down');
  assert.deepEqual(e.lit(), [e.at(1, 1)]);
  e.actions.nudgeDrawing(e.id, 'flip-h');
  assert.deepEqual(e.lit(), [e.at(4, 1)], 'mirrored across the 6-wide grid');
  e.actions.nudgeDrawing(e.id, 'rotate-cw');
  assert.deepEqual(e.lit(), [e.at(4, 4)]);
}

// With a box, arrows move only what is in it; a flip or turn drops the box and acts on the active layer
// (after a move that is the lifted layer).
{
  const e = openEditor();
  e.paint([e.at(0, 0), e.at(5, 5)], '#FF0000');
  e.box(0, 0, 0, 0);
  e.actions.nudgeDrawing(e.id, 'down');
  assert.deepEqual(e.lit(), sorted([e.at(0, 1), e.at(5, 5)]), 'the pixel outside the box stays');
  assert.deepEqual(e.draw().selection, {loaderId: e.id, x0: 0, y0: 1, x1: 0, y1: 1});
  e.actions.nudgeDrawing(e.id, 'rotate-cw');
  assert.equal(e.draw().selection, null, 'the box no longer matches what it covered');
  assert.deepEqual(e.lit(), sorted([e.at(4, 0), e.at(5, 5)]), 'the lifted pixel turned, the rest did not');
}

// A box left on another artboard does not capture the keys of the selected one.
{
  const e = openEditor();
  const first = e.id;
  e.paint([e.at(0, 0)], '#FF0000');
  e.s().addLoader('custom');
  const second = e.s().selectedLoaderId;
  assert.notEqual(second, first);
  e.paint([e.at(2, 2)], '#00FF00');
  e.box(0, 0, 0, 0, first);
  assert.equal(e.actions.copySelection(), false);
  assert.equal(e.actions.deleteSelection(), false);
  assert.equal(e.actions.moveSelection(1, 0, 'Moved'), false);
  e.actions.nudgeDrawing(second, 'right');
  assert.deepEqual(e.lit(second), [e.at(3, 2)], 'the selected artboard moved as a whole');
  assert.deepEqual(e.lit(first), [e.at(0, 0)], 'the other artboard did not');
  assert.deepEqual(e.draw().selection, {loaderId: first, x0: 0, y0: 0, x1: 0, y1: 0}, 'and its box is left alone');
}

// ---------------------------------------------------------------------------------------------------
// Preferences kept in localStorage.

const TUNING_KEY = 'dot-matrix-panel-tuning';
const RECENT_KEY = 'dot-matrix-recent-colors';
const {DEFAULT_PANEL_TUNING, PANEL_TUNING_KEYS} = require('../src/lib/idotmatrix/panel-tuning.ts');
const openMatrix = (storage) => load(storage, ['stores/use-matrix-store.ts'])[0].useMatrixStore;
const openDraw = (storage) => load(storage, ['stores/use-draw-store.ts'])[0].useDrawStore;

// Panel tuning: what is stored is read back sanitised; unreadable or missing input gives the defaults.
{
  const empty = makeStorage();
  assert.deepEqual(openMatrix(empty).getState().tuning, DEFAULT_PANEL_TUNING, 'nothing stored: the defaults');
  assert.equal(empty.writes, 0, 'opening writes nothing');

  warnings.length = 0;
  assert.deepEqual(openMatrix(makeStorage({[TUNING_KEY]: '{not json'})).getState().tuning, DEFAULT_PANEL_TUNING);
  assert.equal(warnings.some((line) => line.includes('panel tuning')), true, 'unreadable tuning is reported, not thrown');

  const odd = openMatrix(makeStorage({[TUNING_KEY]: JSON.stringify({brightness: 999, gamma: 1.2000000000000002, warmth: 'x', extra: 1})})).getState().tuning;
  assert.deepEqual(odd, {...DEFAULT_PANEL_TUNING, brightness: 200, gamma: 1.2}, 'clamped, rounded, unknown keys dropped');

  const mine = {...DEFAULT_PANEL_TUNING, calibration: 60, warmth: -20, blueGain: 80};
  assert.deepEqual(openMatrix(makeStorage({[TUNING_KEY]: JSON.stringify(mine)})).getState().tuning, mine, 'valid tuning loads as stored');

  const blocked = makeStorage({[TUNING_KEY]: JSON.stringify(mine)});
  blocked.failReads = true;
  assert.deepEqual(openMatrix(blocked).getState().tuning, DEFAULT_PANEL_TUNING, 'blocked storage: the defaults');

  assert.deepEqual(openMatrix(null).getState().tuning, DEFAULT_PANEL_TUNING, 'no window (server render): the defaults');
}

// Panel tuning: every change is sanitised, kept and saved whole, and comes back after a restart.
{
  const storage = makeStorage();
  const matrix = openMatrix(storage);
  matrix.getState().setTuning({warmth: 30});
  assert.deepEqual(matrix.getState().tuning, {...DEFAULT_PANEL_TUNING, warmth: 30});
  assert.deepEqual(JSON.parse(storage.getItem(TUNING_KEY)), matrix.getState().tuning, 'saved as the whole tuning');
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(TUNING_KEY))).sort(), [...PANEL_TUNING_KEYS].sort());

  matrix.getState().setTuning({brightness: 5, floor: 81, gamma: 1.1 + 0.1});
  assert.deepEqual(matrix.getState().tuning, {...DEFAULT_PANEL_TUNING, warmth: 30, brightness: 10, floor: 80, gamma: 1.2}, 'clamped to the slider ranges');
  assert.deepEqual(JSON.parse(storage.getItem(TUNING_KEY)), matrix.getState().tuning, 'and saved the same way');
  matrix.getState().setTuning({redGain: 120});
  assert.equal(matrix.getState().tuning.redGain, 120);
  matrix.getState().setTuning({redGain: Number.NaN});
  assert.equal(matrix.getState().tuning.redGain, 100, 'not a number: back to the default');

  assert.deepEqual(openMatrix(storage).getState().tuning, matrix.getState().tuning, 'a restart brings it back');

  storage.failWrites = true;
  warnings.length = 0;
  matrix.getState().setTuning({contrast: 120});
  assert.equal(matrix.getState().tuning.contrast, 120, 'a full storage does not stop the change');
  assert.equal(warnings.some((line) => line.includes('could not save panel tuning')), true);
}

// Recent colours: only well-formed colours are read back, at most twelve.
{
  assert.deepEqual(openDraw(makeStorage()).getState().recentColors, []);
  assert.deepEqual(openDraw(makeStorage({[RECENT_KEY]: '"#FF0000"'})).getState().recentColors, [], 'not a list');
  assert.deepEqual(openDraw(makeStorage({[RECENT_KEY]: '{}'})).getState().recentColors, []);
  warnings.length = 0;
  assert.deepEqual(openDraw(makeStorage({[RECENT_KEY]: '[oops'})).getState().recentColors, []);
  assert.equal(warnings.some((line) => line.includes('recent colours')), true, 'unreadable colours are reported, not thrown');
  const mixed = ['#FF0000', 'red', 42, null, '#00FF00', '#12345', {hex: '#0000FF'}];
  assert.deepEqual(openDraw(makeStorage({[RECENT_KEY]: JSON.stringify(mixed)})).getState().recentColors, ['#FF0000', '#00FF00']);
  const many = Array.from({length: 15}, (_, i) => `#0000${(i + 16).toString(16).toUpperCase()}`);
  assert.deepEqual(openDraw(makeStorage({[RECENT_KEY]: JSON.stringify(many)})).getState().recentColors, many.slice(0, 12));
  const blocked = makeStorage({[RECENT_KEY]: JSON.stringify(['#FF0000'])});
  blocked.failReads = true;
  assert.deepEqual(openDraw(blocked).getState().recentColors, []);
  assert.deepEqual(openDraw(null).getState().recentColors, [], 'no window (server render): none');
}

// Recent colours: the newest first, no repeats, twelve at most, saved and read back after a restart.
{
  const storage = makeStorage();
  const drawStore = openDraw(storage);
  const remember = (hex) => drawStore.getState().rememberColor(hex);
  remember('#ff0000');
  assert.deepEqual(drawStore.getState().recentColors, ['#FF0000'], 'stored in the editor\'s own form');
  remember('0f0');
  assert.deepEqual(drawStore.getState().recentColors, ['#00FF00', '#FF0000']);
  remember('#FF0000');
  assert.deepEqual(drawStore.getState().recentColors, ['#FF0000', '#00FF00'], 'used again: moved to the front, not repeated');
  assert.deepEqual(JSON.parse(storage.getItem(RECENT_KEY)), ['#FF0000', '#00FF00']);
  const writes = storage.writes;
  remember('#ff0000');
  assert.equal(storage.writes, writes, 'the colour already in front changes nothing');
  for (let i = 0; i < 12; i++) remember(`#1000${i.toString(16).padStart(2, '0')}`);
  assert.equal(drawStore.getState().recentColors.length, 12);
  assert.equal(drawStore.getState().recentColors.includes('#00FF00'), false, 'the oldest drop off');
  assert.equal(drawStore.getState().recentColors[0], '#10000B');
  assert.deepEqual(openDraw(storage).getState().recentColors, drawStore.getState().recentColors, 'a restart brings them back');

  storage.failWrites = true;
  warnings.length = 0;
  remember('#ABCDEF');
  assert.equal(drawStore.getState().recentColors[0], '#ABCDEF', 'a full storage does not stop the swatch');
  assert.equal(warnings.some((line) => line.includes('could not save recent colours')), true);
}

// ---------------------------------------------------------------------------------------------------
// Editor requests from agents (the desktop app relays the error message to the API caller).

const pathOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.issues ? error.issues.map((issue) => issue.path.join('.')) : error.message;
  }
  return 'did not throw';
};

// Unknown actions name themselves; nothing is edited.
{
  const e = openEditor();
  const before = e.s().project;
  for (const action of ['', 'Draw', 'get_drawing', 'erase-everything']) {
    assert.throws(() => e.handleEditorRequest({action}), new RegExp(`^Error: unknown editor action "${action}"$`));
  }
  assert.equal(e.s().project, before);
}

// A draw request that breaks the format is refused before anything is drawn, naming the bad field.
{
  const e = openEditor();
  const before = e.s().project;
  const ok = {frames: [['r']], palette: {r: '#FF0000'}};
  const refused = (payload) => pathOf(() => e.handleEditorRequest({action: 'draw', payload}));
  const cases = [
    [undefined, ['']],
    ['rr', ['']],
    [{palette: {}}, ['frames']],
    [{...ok, frames: []}, ['frames']],
    [{...ok, frames: Array.from({length: 25}, () => ['r'])}, ['frames']],
    [{...ok, frames: [['r'.repeat(33)]]}, ['frames.0.0']],
    [{...ok, frames: [Array.from({length: 33}, () => 'r')]}, ['frames.0']],
    [{...ok, frames: [[7]]}, ['frames.0.0']],
    [{frames: [['r']]}, ['palette']],
    [{...ok, palette: {ab: '#FF0000'}}, ['palette.ab']],
    [{...ok, palette: {r: 'red'}}, ['palette.r']],
    [{...ok, palette: {r: '#FF00'}}, ['palette.r']],
    [{...ok, target: 'everything'}, ['target']],
    [{...ok, name: 'n'.repeat(41)}, ['name']],
    [{...ok, x: 33}, ['x']],
    [{...ok, y: -33}, ['y']],
    [{...ok, x: 1.5}, ['x']],
    [{...ok, fps: 0}, ['fps']],
    [{...ok, fps: 21}, ['fps']]
  ];
  for (const [payload, expected] of cases) assert.deepEqual(refused(payload), expected, JSON.stringify(payload)?.slice(0, 80));
  const palette = Object.fromEntries(Array.from({length: 65}, (_, i) => [String.fromCharCode(0x4e00 + i), '#FF0000']));
  assert.throws(() => e.handleEditorRequest({action: 'draw', payload: {...ok, palette}}), /at most 64 palette entries/);
  assert.equal(e.s().project, before, 'nothing was drawn');
}

// The limits themselves are allowed.
{
  const e = openEditor();
  const palette64 = Object.fromEntries(Array.from({length: 64}, (_, i) => [String.fromCharCode(0x4e00 + i), '#00FF00']));
  const allowed = [
    {frames: [Array.from({length: 32}, () => 'r'.repeat(32))], palette: {r: '#FF0000'}, target: 'artboard'},
    {frames: [['一']], palette: palette64, target: 'artboard'},
    {frames: [['r']], palette: {r: 'ff0000'}, x: 32, y: -32, name: 'n'.repeat(40), target: 'artboard'},
    {frames: Array.from({length: 24}, () => ['r']), palette: {r: '#FF0000'}, fps: 1},
    {frames: [['r'], ['r']], palette: {r: '#FF0000'}, fps: 20}
  ];
  for (const payload of allowed) assert.doesNotThrow(() => e.handleEditorRequest({action: 'draw', payload}), JSON.stringify(payload).slice(0, 80));
}

// With no artboard left there is nothing to read or draw on.
{
  const e = openEditor();
  e.useEditorStore.setState({project: {...e.s().project, loaders: []}});
  const before = e.s().project;
  assert.throws(() => e.handleEditorRequest({action: 'get-drawing'}), /^Error: There is no artboard in the editor\.$/);
  assert.throws(() => e.handleEditorRequest({action: 'draw', payload: {frames: [['r']], palette: {r: '#FF0000'}}}), /^Error: There is no artboard in the editor\.$/);
  assert.equal(e.s().project, before);
}

// A full artboard takes no new layer (the drawing is unchanged); a new artboard still works.
{
  const e = openEditor();
  e.paint([e.at(0, 0)], '#FF0000');
  while (e.layers().length < e.layerOps.MAX_LAYERS) e.s().addLayer(e.id, 'Layer');
  const cells = e.lit();
  assert.throws(() => e.handleEditorRequest({action: 'draw', payload: {frames: [['g']], palette: {g: '#00FF00'}}}), /maximum number of layers/);
  assert.equal(e.layers().length, e.layerOps.MAX_LAYERS);
  assert.deepEqual(e.lit(), cells);
  const loaders = e.s().project.loaders.length;
  const made = e.handleEditorRequest({action: 'draw', payload: {frames: [['g']], palette: {g: '#00FF00'}, target: 'artboard'}});
  assert.equal(made.created, 'artboard');
  assert.equal(e.s().project.loaders.length, loaders + 1);
}

// Names: blank means "AI", surrounding spaces are trimmed.
{
  const e = openEditor();
  assert.equal(e.handleEditorRequest({action: 'draw', payload: {frames: [['r']], palette: {r: '#FF0000'}, name: '   '}}).layer, 'AI');
  assert.equal(e.layers()[e.layers().length - 1].name, 'AI');
  assert.equal(e.handleEditorRequest({action: 'draw', payload: {frames: [['r']], palette: {r: '#FF0000'}, name: '  cat  '}}).layer, 'cat');
  assert.equal(e.layers()[e.layers().length - 1].name, 'cat');
}

// Sequence frames are placed by x and y and clipped to the grid.
{
  const e = openEditor();
  const result = e.handleEditorRequest({action: 'draw', payload: {frames: [['rr'], ['.r', 'r.']], palette: {r: '#FF0000'}, x: 5, y: 4}});
  assert.deepEqual(result, {created: 'sequence', frames: 2, grid: '6x6'});
  const first = e.s().selectedLoaderId;
  const frames = e.s().project.loaders.filter((loader) => loader.sequenceId && loader.sequenceId === e.loaderOf(first).sequenceId)
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  assert.equal(frames.length, 2);
  assert.deepEqual(e.lit(frames[0].id), [e.at(5, 4)], 'the pixel past the right edge is dropped');
  assert.deepEqual(e.lit(frames[1].id), [e.at(5, 5)], 'in every frame');
  assert.equal(e.colorAt(e.at(5, 4), frames[0].id), '#FF0000');
}

console.log('PASS: editor actions — selection copy, cut, paste, delete, move and nudge; panel tuning and recent colours kept in storage; agent request errors.');
