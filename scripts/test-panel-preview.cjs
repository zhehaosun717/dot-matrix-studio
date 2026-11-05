// The always-on panel preview: it shows exactly the renderer's frames (as plain sRGB), draws them as LEDs,
// and remembers whether it is collapsed.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
const compile = (filename) => ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
require.extensions['.ts'] = (mod, filename) => mod._compile(compile(filename), filename);
require.extensions['.tsx'] = require.extensions['.ts'];

const storage = new Map();
const store = {getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k)};
globalThis.window = {localStorage: store};
const P = require('../src/lib/panel-preview.ts');
const R = require('../src/lib/idotmatrix/render-frames.ts');
const {MATRIX_SIZE} = require('../src/lib/idotmatrix/constants.ts');
const {useEditorStore} = require('../src/stores/use-editor-store.ts');

// The frames are the renderer's own, rendered as plain sRGB, for the still drawing and over time.
const s = () => useEditorStore.getState();
s().hydrate();
const id = s().selectedLoaderId;
s().setCellsActiveForLoader(id, [0, 7], true, '#FF0000');
const loader = s().project.loaders.find((l) => l.id === id);
for (const options of [{showInactive: false, gaps: false}, {showInactive: true, gaps: true}]) {
  const still = P.panelPreviewFrame(s().project, loader, null, options);
  assert.equal(still.length, MATRIX_SIZE * MATRIX_SIZE * 3);
  assert.deepEqual(still, R.renderMatrixStill(loader, {...options, encoded: true}), 'the still frame is the renderer\'s');
  for (const t of [0, 250, 1000, 4321]) {
    assert.deepEqual(P.panelPreviewFrame(s().project, loader, t, options), R.renderMatrixAt(s().project, loader, t, {...options, encoded: true}), `the frame at ${t} ms is the renderer's`);
  }
}
const still = P.panelPreviewFrame(s().project, loader, null, {showInactive: false, gaps: false});
// Cell 0 of the 6 x 6 grid lands where the layout puts it on the 32 x 32 panel.
const layout = R.getMatrixLayout(6, 6, {gaps: false});
const at = ((layout.offsetY + 1) * MATRIX_SIZE + layout.offsetX + 1) * 3;
assert.deepEqual([...still.slice(at, at + 3)], [255, 0, 0], 'the red cell shows pure red: sRGB, not LED drive values');
assert.deepEqual([...still.slice(0, 3)], [0, 0, 0], 'outside the scaled grid the panel stays dark');
// A sequence plays its frames.
s().importSequence(id, [{cells: [0], colors: {}}, {cells: [35], colors: {}}], 2);
const frame0 = s().project.loaders.find((l) => l.id === s().selectedLoaderId);
const early = P.panelPreviewFrame(s().project, frame0, 100, {showInactive: false, gaps: false});
const late = P.panelPreviewFrame(s().project, frame0, 600, {showInactive: false, gaps: false});
assert.notDeepEqual(early, late, 'a 2 fps sequence shows another frame half a second later');

// The layout preference: only a boolean "collapsed" is read back; anything else gives the default.
{
  assert.deepEqual(P.loadPanelPreviewPrefs(), {collapsed: false}, 'nothing stored');
  P.savePanelPreviewPrefs({collapsed: true});
  assert.deepEqual(JSON.parse(storage.get(P.PANEL_PREVIEW_STORAGE_KEY)), {collapsed: true});
  assert.deepEqual(P.loadPanelPreviewPrefs(), {collapsed: true}, 'read back');
  for (const raw of ['{oops', '"yes"', '{"collapsed":"true"}', 'null', '[]']) {
    storage.set(P.PANEL_PREVIEW_STORAGE_KEY, raw);
    assert.deepEqual(P.loadPanelPreviewPrefs(), {collapsed: false}, raw);
  }
  globalThis.window = {localStorage: {getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }}};
  assert.deepEqual(P.loadPanelPreviewPrefs(), {collapsed: false}, 'blocked storage');
  assert.doesNotThrow(() => P.savePanelPreviewPrefs({collapsed: true}), 'a full storage is not an error');
  globalThis.window = {localStorage: store};
}

// Drawing: one round LED per panel pixel; LED drive values are converted to sRGB, sRGB frames are not.
{
  const {drawMatrixFrame} = require('../src/components/editor/matrix-preview.tsx');
  const fake = () => {
    const calls = {fills: [], arcs: [], rects: []};
    return {calls, set fillStyle(v) { calls.style = v; }, get fillStyle() { return calls.style; },
      fillRect: (...a) => calls.rects.push([calls.style, ...a]), beginPath() {}, arc: (x, y, r) => calls.arcs.push([x, y, r]), fill: () => calls.fills.push(calls.style)};
  };
  const frame = new Uint8Array(MATRIX_SIZE * MATRIX_SIZE * 3);
  frame.set([64, 0, 0], 0);
  const plain = fake();
  drawMatrixFrame(plain, frame, {pitch: 5, radius: 2, linear: false});
  assert.equal(plain.calls.arcs.length, MATRIX_SIZE * MATRIX_SIZE);
  assert.deepEqual(plain.calls.arcs[0], [2.5, 2.5, 2]);
  assert.deepEqual(plain.calls.arcs[MATRIX_SIZE * MATRIX_SIZE - 1], [157.5, 157.5, 2]);
  assert.deepEqual(plain.calls.rects[0], ['#050607', 0, 0, 160, 160]);
  assert.equal(plain.calls.fills[0], 'rgb(64, 0, 0)', 'sRGB frames are drawn as they are');
  assert.equal(plain.calls.fills[1], 'rgb(24, 26, 30)', 'unlit LEDs');
  const led = fake();
  drawMatrixFrame(led, frame);
  assert.deepEqual(led.calls.arcs[0], [4, 4, 3.1], 'the export preview keeps its size');
  assert.equal(led.calls.fills[0], `rgb(${Math.round(255 * (64 / 255) ** (1 / 2.2))}, 0, 0)`, 'LED drive values are converted to sRGB');
}

console.log('PASS: panel preview — the renderer\'s still and animated frames as sRGB, sequences play, LED drawing, remembered layout.');
