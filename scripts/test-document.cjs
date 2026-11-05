// Document model (src/core/document): pixels and palettes, compositing, and migrating today's projects.
// The migration must not change anything visible: every artboard renders to the panel byte for byte the
// same before and after, and migrating the result again gives the same workspace.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);

const T = require('../src/core/document/types.ts');
const P = require('../src/core/document/pixels.ts');
const {migrateProject, frameDurationMs, libraryItemFromPattern} = require('../src/core/document/migrate.ts');
const {documentFps, documentToLoaders, libraryItemToPattern, workspaceToProject} = require('../src/core/document/to-legacy.ts');
const {flattenLayers} = require('../src/core/layers.ts');
const {renderMatrixFrames, renderMatrixStill, renderMatrixAt} = require('../src/lib/idotmatrix/render-frames.ts');
const {PROJECT_VERSION} = require('../src/lib/mock-project.ts');

// Palettes: 0 transparent, 1 base colour, then concrete colours; case-insensitive, stored upper-case.
{
  const builder = P.createPaletteBuilder();
  assert.equal(builder.indexOf(''), T.BASE_COLOR);
  assert.equal(builder.indexOf('#ff0000'), 2);
  assert.equal(builder.indexOf('#FF0000'), 2, 'same colour, same index');
  assert.equal(builder.indexOf('#00FF00'), 3);
  assert.deepEqual(builder.palette(), ['', '', '#FF0000', '#00FF00']);
  assert.equal(P.colorOf(builder.palette(), 0), null);
  assert.equal(P.colorOf(builder.palette(), 1), '');
  assert.equal(P.colorOf(builder.palette(), 3), '#00FF00');
  assert.equal(P.colorOf(builder.palette(), 9), null, 'unknown indices are unlit');
}

// Cels: the smallest box around the lit pixels, which may lie outside the grid, and back.
{
  const pixels = [{x: -2, y: 1, index: 2}, {x: 3, y: 4, index: 1}, {x: 0, y: 0, index: 0}];
  const cel = P.celFromPixels(pixels);
  assert.deepEqual([cel.x, cel.y, cel.width, cel.height], [-2, 1, 6, 4]);
  assert(cel.pixels instanceof Uint16Array, '16-bit indices: a photo can have more than 254 colours');
  assert.deepEqual(P.celPixels(cel), [{x: -2, y: 1, index: 2}, {x: 3, y: 4, index: 1}], 'transparent pixels are not stored');
  assert.equal(P.celFromPixels([{x: 1, y: 1, index: 0}]), null);
}

// Compositing: visible layers bottom to top, upper lit pixels win (base colour too), off-grid pixels cut,
// a cel hidden in one frame does not show in that frame.
{
  const cel = (pixels) => P.celFromPixels(pixels);
  const doc = {
    id: 'd', name: '', size: {width: 3, height: 2}, palette: ['', '', '#AA0000', '#00BB00'],
    layers: [{id: 'a', name: '', visible: true}, {id: 'b', name: '', visible: true}, {id: 'c', name: '', visible: false}],
    frames: [{id: 'f0', durationMs: 100}, {id: 'f1', durationMs: 100}],
    cels: {
      [T.celKey('f0', 'a')]: cel([{x: 0, y: 0, index: 2}, {x: 1, y: 0, index: 2}]),
      [T.celKey('f0', 'b')]: cel([{x: 1, y: 0, index: 1}, {x: 5, y: 5, index: 3}]),
      [T.celKey('f0', 'c')]: cel([{x: 2, y: 1, index: 3}]),
      [T.celKey('f1', 'a')]: cel([{x: 2, y: 1, index: 3}]),
      [T.celKey('f1', 'b')]: {...cel([{x: 0, y: 1, index: 2}]), visible: false}
    },
    activeLayerId: 'a', activeFrameId: 'f0', position: {x: 0, y: 0}, playback: 'frames'
  };
  assert.deepEqual([...P.compositeFrame(doc, 0)], [2, 1, 0, 0, 0, 0], 'upper base colour wins; hidden layer and off-grid pixels do not show');
  assert.deepEqual(P.frameCells(doc, 0), {activeCells: [0, 1], cellColors: {0: '#AA0000'}});
  assert.deepEqual([...P.compositeFrame(doc, 1)], [0, 0, 0, 0, 0, 3], 'a cel hidden in this frame does not show');
  assert.deepEqual([...P.compositeFrame(doc, 7)], [0, 0, 0, 0, 0, 0], 'a missing frame is empty');
}

// Frame durations and fps convert back exactly for every rate the editor allows.
for (let fps = 1; fps <= 60; fps++) {
  assert.equal(documentFps({playback: 'frames', frames: [{durationMs: frameDurationMs(fps)}]}), fps, `${fps} fps`);
}

// Library items keep cells, sizes and baked colours.
{
  const pattern = {id: 'p', name: 'Heart', activeCells: [0, 4, 8], rows: 3, cols: 3, presetId: 'custom', cellColors: {0: '#123456', 4: '#ABCDEF', 8: '#123456'}};
  const item = libraryItemFromPattern(pattern);
  assert.deepEqual(item.palette, ['', '', '#123456', '#ABCDEF']);
  assert.deepEqual(libraryItemToPattern(item), pattern);
}

// A realistic project, built with the editor store itself.
globalThis.window = undefined;
const {useEditorStore} = require('../src/stores/use-editor-store.ts');
const s = () => useEditorStore.getState();
const loader = (id) => s().project.loaders.find((l) => l.id === id);
const layerIds = (id) => loader(id).pattern.layers.map((l) => l.id);
s().hydrate();

// 1. Layers: colours, base colour, a layer moved off the grid and partly back, a hidden layer, a lifted selection.
const a = s().selectedLoaderId;
s().setGridSize(8);
s().setCellsActiveForLoader(a, [0, 1, 2, 9, 18], true, '#FF0000');
s().setCellsActiveForLoader(a, [27, 36], true);
s().addLayer(a, 'top');
const top = layerIds(a)[1];
s().setCellsActiveForLoader(a, [1, 2, 3, 63], true, '#00FF00');
s().moveLayerBy(a, top, -3, 2);
s().moveLayerBy(a, top, 1, 0);
s().addLayer(a, 'hidden');
s().setCellsActiveForLoader(a, [40, 41], true, '#0000FF');
s().setLayerVisible(a, layerIds(a)[2], false);
s().selectLayer(a, layerIds(a)[0]);
s().liftToLayer(a, [0, 9], 'lifted');
s().setMotionPreset('radar');
s().setPrimaryColor('#FFAA00');
s().setGlowSize(30);
s().savePatternToLibrary();

// 2. A small grid with a star shape (the panel masks each cell) and motion settings.
s().addLoader();
const b = s().selectedLoaderId;
s().setGridSize(5);
s().setCellShape('star');
s().setCellsActiveForLoader(b, [0, 6, 12, 18, 24], true);
s().setMotionPreset('bloom');
s().setMotionOrigin('x', 2);
s().setSpeed(1.5);
s().setInactiveStyle('ghost');
s().setBackgroundColor('#101820');
s().setBackgroundAlpha(0.6);
s().setPrimaryAlpha(0.8);

// 3. A 32x32 artboard (one cell per LED) with a gap and glow off.
s().addLoader();
const c = s().selectedLoaderId;
s().setGridSize(32);
s().setGridGap(2);
s().setGlowEnabled(false);
s().setCellsActiveForLoader(c, Array.from({length: 200}, (_, i) => i * 5), true, '#33CCFF');
s().setMotionPreset('static');

// 4. A frame sequence with a layer hidden in one frame only.
s().addLoader('sequence');
const seq = s().selectedLoaderId;
const seqId = loader(seq).sequenceId;
s().setCellsActiveForLoader(seq, [0, 7, 14], true, '#AA00AA');
s().addSequenceFrame(seqId);
const seq2 = s().selectedLoaderId;
s().setCellsActiveForLoader(seq2, [5], true);
s().addLayer(seq2, 'only in frame 2');
s().setCellsActiveForLoader(seq2, [20, 21], true, '#00AAAA');
s().addSequenceFrame(seqId);
const seq3 = s().selectedLoaderId;
s().setLayerVisible(seq3, layerIds(seq3)[0], false);
s().setFps(12);

// 5. An imported animation (one layer per frame, many colours).
const frames = Array.from({length: 4}, (_, f) => ({
  cells: Array.from({length: 12}, (_, i) => (i * 3 + f) % 36),
  colors: Object.fromEntries(Array.from({length: 12}, (_, i) => [(i * 3 + f) % 36, `#${(f * 40 + i * 7).toString(16).padStart(2, '0').toUpperCase()}8040`]))
}));
s().importSequence(a, frames, 8);
s().setCanvasView({zoom: 1.25, panX: -40, panY: 12});

const project = structuredClone(s().project);
const {workspace, report} = migrateProject(project);

// Shape of the result.
assert.equal(workspace.format, 'dot-matrix-studio');
assert.equal(workspace.formatVersion, 1);
assert.equal(report.documents, 5, 'three artboards and two sequences');
assert.equal(report.sequences, 2);
assert.equal(report.frames, project.loaders.length);
assert.deepEqual(report.inconsistencies, [], 'the editor keeps shared settings equal across frames');
assert.deepEqual(workspace.view, {zoom: 1.25, panX: -40, panY: 12});
const docOf = (id) => workspace.documents.find((d) => d.id === id);
assert.equal(docOf(a).layers.length, 4);
assert.deepEqual(docOf(a).layers.map((l) => [l.name, l.visible]), [['', true], ['lifted', true], ['top', true], ['hidden', false]], 'layer order and the hidden layer are kept');
assert.equal(docOf(a).playback, 'motion');
assert.equal(docOf(seqId).playback, 'frames');
assert.equal(docOf(seqId).frames.length, 3);
assert.equal(docOf(seqId).layers.length, 2, 'layers line up by position across frames');
assert.equal(docOf(seqId).frames[0].durationMs, frameDurationMs(12));
const hiddenInFrame3 = docOf(seqId).cels[T.celKey(seq3, docOf(seqId).layers[0].id)];
assert.equal(hiddenInFrame3.visible, false, 'a layer hidden in one frame is hidden only in that frame');
assert.equal(docOf(seqId).cels[T.celKey(seq, docOf(seqId).layers[0].id)].visible, undefined);
const moved = docOf(a).cels[T.celKey(docOf(a).frames[0].id, top)];
assert(moved.x < 0, 'pixels moved off the grid are kept');

// Every artboard: the same flat drawing, and the same panel output in every render mode.
const projected = workspaceToProject(workspace, PROJECT_VERSION);
assert.equal(projected.loaders.length, project.loaders.length);
const upper = (colors) => Object.fromEntries(Object.entries(colors ?? {}).map(([k, v]) => [k, v.toUpperCase()]));
let renders = 0;
for (const before of project.loaders) {
  const after = projected.loaders.find((l) => l.id === before.id);
  assert(after, `${before.id} keeps its id`);
  for (const key of ['name', 'kind', 'sequenceId', 'sequenceIndex']) assert.equal(after[key], before[key], `${before.id}: ${key}`);
  assert.deepEqual(after.artboard, before.artboard, `${before.id}: position`);
  assert.deepEqual({...after.pattern.grid}, {rows: before.pattern.grid.rows, cols: before.pattern.grid.cols, cellSize: before.pattern.grid.cellSize, gap: before.pattern.grid.gap}, `${before.id}: grid`);
  const flatBefore = flattenLayers(before.pattern.layers, before.pattern.grid.rows, before.pattern.grid.cols);
  assert.deepEqual(after.pattern.activeCells, flatBefore.activeCells, `${before.id}: lit cells`);
  assert.deepEqual(upper(after.pattern.cellColors), upper(flatBefore.cellColors), `${before.id}: cell colours`);
  assert.deepEqual(flattenLayers(after.pattern.layers, after.pattern.grid.rows, after.pattern.grid.cols), {activeCells: after.pattern.activeCells, cellColors: after.pattern.cellColors}, `${before.id}: projected layers flatten to the same drawing`);
  for (const showInactive of [true, false]) for (const gaps of [false, true]) for (const encoded of [false, true]) {
    const options = {showInactive, gaps, encoded};
    assert.deepEqual(renderMatrixFrames(projected, after, options), renderMatrixFrames(project, before, options), `${before.id}: panel frames ${JSON.stringify(options)}`);
    assert.deepEqual(renderMatrixStill(after, options), renderMatrixStill(before, options), `${before.id}: still`);
    for (const ms of [0, 137, 999, 2600]) assert.deepEqual(renderMatrixAt(projected, after, ms, options), renderMatrixAt(project, before, ms, options), `${before.id}: live frame at ${ms} ms`);
    renders++;
  }
}
assert.deepEqual(projected.assets.patterns, project.assets.patterns.map((p) => ({...p, cellColors: upper(p.cellColors)})), 'library');

// Migrating the projection again gives the same workspace (nothing is lost on the way back).
assert.deepEqual(migrateProject(projected).workspace, workspace);

// The input project is not modified.
assert.deepEqual(project, structuredClone(s().project));

// The documents round-trip one by one too.
for (const doc of workspace.documents) assert.equal(documentToLoaders(doc).length, doc.frames.length);

console.log(`PASS: document model — palettes, cels, compositing, fps, library; ${project.loaders.length} artboards in ${report.documents} documents migrate with identical drawings and ${renders * 6} identical panel renders, and migrate again unchanged.`);
