// Editor store: the public surface (state fields and action names) stays fixed, and every slice works through the store.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);

const {useEditorStore, useSelectedLoader} = require('../src/stores/use-editor-store.ts');
const s = () => useEditorStore.getState();

const STATE = ['hydrated', 'project', 'selectedLoaderId', 'focusModeLoaderId', 'clipboardLoader', 'exportFormat', 'isPreviewing'];
const ACTIONS = [
  'hydrate', 'selectLoader', 'clearSelection', 'setCellsActiveForLoader', 'importCellsForLoader', 'importCellsForLoaders',
  'transformLoaderCells', 'importSequence', 'deleteSavedPattern', 'addLayer', 'duplicateLayer', 'deleteLayer', 'selectLayer',
  'setLayerVisible', 'renameLayer', 'reorderLayer', 'mergeLayerDown', 'moveLayerBy', 'liftToLayer', 'addLayerFromPixels',
  'setPatternSourceType', 'addLoader', 'addSequenceFrame', 'removeSequenceFrame', 'copySelectedLoader', 'pasteLoader',
  'duplicateSelectedLoader', 'deleteSelectedLoader', 'moveLoader', 'moveLoaders', 'renameLoader', 'setAnimationMode',
  'setMotionPreset', 'setMotionOrigin', 'setDirection', 'setFps', 'setScaleIntensity', 'setSpeed', 'fillGrid',
  'setAnimationStyle', 'setInactiveStyle', 'setPrimaryColor', 'setPrimaryAlpha', 'applyBaseColorEverywhere', 'setGlowEnabled',
  'setGlowSize', 'setBackgroundColor', 'setBackgroundAlpha', 'setCellShape', 'setGridSize', 'setGridGap', 'setLayoutType',
  'setLabel', 'setExportFormat', 'togglePreview', 'enterFocusMode', 'exitFocusMode', 'applyLoaderTemplate', 'applyPatternPreset',
  'applySavedPattern', 'captureSnapshot', 'clearSnapshots', 'savePatternToLibrary', 'setCanvasView', 'resetCanvasView'
];
assert.deepEqual(Object.keys(s()).sort(), [...STATE, ...ACTIONS].sort(), 'the store exposes exactly these fields and actions');
for (const name of ACTIONS) assert.equal(typeof s()[name], 'function', `${name} is an action`);
assert.equal(typeof useSelectedLoader, 'function');

// Initial state, before hydration (Node has no localStorage, so nothing is loaded or saved).
assert.equal(s().hydrated, false);
assert.equal(s().exportFormat, 'web');
assert.equal(s().selectedLoaderId, s().project.loaders[0].id, 'the first artboard starts selected');
s().hydrate();
assert.equal(s().hydrated, true);
const first = s().selectedLoaderId;
const loader = (id = s().selectedLoaderId) => s().project.loaders.find((l) => l.id === id);

// Project slice: add, copy / paste, move, rename, delete.
const before = s().project.loaders.length;
s().addLoader();
assert.equal(s().project.loaders.length, before + 1);
assert.notEqual(s().selectedLoaderId, first, 'a new artboard is selected');
s().copySelectedLoader();
s().pasteLoader();
assert.equal(s().project.loaders.length, before + 2);
assert(loader().name.endsWith(' Copy'));
s().moveLoader(first, {x: 11, y: 22});
assert.deepEqual([loader(first).artboard.x, loader(first).artboard.y], [11, 22]);
s().selectLoader(first);
s().renameLoader('Main');
assert.equal(loader(first).name, 'Main');
s().setCanvasView({zoom: 2, panX: 1, panY: 1});
s().resetCanvasView();
assert.deepEqual([s().project.canvas.zoom, s().project.canvas.panX], [1, 0]);

// Drawing and layer slices.
s().setGridSize(8);
s().setCellsActiveForLoader(first, [0], true, '#FF0000');
s().transformLoaderCells(first, 'right');
assert.deepEqual(loader(first).pattern.activeCells, [1]);
const layerId = s().importCellsForLoader(first, [9], {9: '#00FF00'}, {name: 'img'});
assert.equal(loader(first).pattern.layers.length, 2);
assert.equal(loader(first).pattern.activeLayerId, layerId);
s().moveLayerBy(first, layerId, 1, 0);
assert.deepEqual(loader(first).pattern.activeCells, [1, 10]);
s().savePatternToLibrary();
assert.equal(s().project.assets.patterns.length, 1);
s().deleteSavedPattern(s().project.assets.patterns[0].id);
assert.equal(s().project.assets.patterns.length, 0);

// Motion and style slice.
s().setMotionPreset('radar');
s().setFps(99);
s().setPrimaryColor('#123456');
assert.equal(loader(first).animation.presetId, 'radar');
assert.equal(loader(first).animation.fps, 30, 'fps is clamped');
assert.equal(loader(first).style.primaryColor, '#123456');

// Sequence slice.
s().addLoader('sequence');
const sequenceId = loader().sequenceId;
assert(sequenceId, 'a sequence artboard has a sequence id');
s().addSequenceFrame(sequenceId);
assert.equal(s().project.loaders.filter((l) => l.sequenceId === sequenceId).length, 2);
s().removeSequenceFrame(sequenceId);
assert.equal(s().project.loaders.filter((l) => l.sequenceId === sequenceId).length, 1);
const frames = s().importSequence(first, [{cells: [0], colors: {}}, {cells: [1], colors: {}}], 12);
assert.equal(frames.length, 2);
assert.equal(s().selectedLoaderId, frames[0].loaderId, 'the first imported frame is selected');

console.log('PASS: editor store — public surface (7 fields, 65 actions), project, drawing, layers, motion/style and sequence slices.');
