// Pure core (src/core): no React or browser APIs, forwarders at the old paths, and the functions no other suite covers directly.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);

const coreDir = path.join(root, 'src/core');
const coreFiles = fs.readdirSync(coreDir, {recursive: true}).filter((f) => f.endsWith('.ts')).map((f) => path.join(coreDir, f));
assert(coreFiles.some((f) => f.includes(`${path.sep}document${path.sep}`)), 'subfolders of src/core are checked too');

// Purity: core and everything it imports, transitively, stay free of React, zustand and browser APIs.
const FORBIDDEN_MODULES = /^(react|react-dom|zustand|next)(\/|$)/;
const FORBIDDEN_GLOBALS = /\b(window|document|localStorage|sessionStorage|navigator|HTMLElement|HTMLCanvasElement|OffscreenCanvas|createImageBitmap|ImageDecoder|requestAnimationFrame)\b/;
function resolveLocal(from, spec) {
  const base = spec.startsWith('@/') ? path.join(root, 'src', spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  return ['.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find((p) => fs.existsSync(p)) ?? null;
}
const seen = new Set();
const queue = [...coreFiles];
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const source = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  assert(!file.endsWith('.tsx'), `${rel}: core must not depend on JSX`);
  for (const {fileName} of ts.preProcessFile(source, true, true).importedFiles) {
    assert(!FORBIDDEN_MODULES.test(fileName), `${rel} imports ${fileName}`);
    assert(!fileName.startsWith('@/stores') && !fileName.startsWith('@/components') && !fileName.startsWith('@/app'), `${rel} imports UI code ${fileName}`);
    const local = resolveLocal(file, fileName);
    if (local) queue.push(local);
  }
  // Comments and types are stripped first, so prose mentioning "the canvas" or a DOM type in a comment is fine.
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: true}}).outputText;
  // String contents (module paths such as "@/core/document/...", messages) are not code.
  const hit = code.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""').match(FORBIDDEN_GLOBALS);
  assert(!hit, `${rel} uses the browser API ${hit && hit[0]}`);
}
assert(seen.size > coreFiles.length, 'the dependency walk followed core imports');

// The old module paths are one-line forwarders to the very same functions.
const forwarders = {
  'src/lib/layers.ts': 'layers.ts',
  'src/stores/layer-ops.ts': 'layer-ops.ts',
  'src/lib/grid-tools.ts': 'grid-tools.ts',
  'src/lib/grid-transforms.ts': 'grid-transforms.ts',
  'src/lib/cell-shapes.ts': 'cell-shapes.ts',
  'src/lib/text-cells.ts': 'text-cells.ts',
  'src/lib/core/motion-sampler.ts': 'motion-sampler.ts',
  'src/lib/core/timeline.ts': 'timeline.ts',
  'src/lib/image-import.ts': 'image-pixels.ts'
};
for (const [oldPath, coreName] of Object.entries(forwarders)) {
  const before = require(path.join(root, oldPath));
  const core = require(path.join(coreDir, coreName));
  assert(Object.keys(core).length > 0, `${coreName} exports something`);
  for (const [name, value] of Object.entries(core)) assert.equal(before[name], value, `${oldPath} forwards ${name}`);
}
assert.equal(typeof require('../src/lib/image-import.ts').rasterizeImageFile, 'function', 'the browser decoder stays in lib');
assert.equal(require('../src/core/image-pixels.ts').rasterizeImageFile, undefined, 'and is not part of core');

// Cell shapes.
const S = require('../src/core/cell-shapes.ts');
assert.equal(S.normalizeCellShape('star'), 'star');
assert.equal(S.normalizeCellShape('blob'), 'rectangle', 'unknown shapes fall back to rectangle');
assert.equal(S.normalizeCellShape(undefined), 'rectangle');
assert.deepEqual(S.shapeOptions.map((o) => o.value), ['rectangle', 'square', 'circle', 'diamond', 'hexagon', 'star']);
assert.equal(S.getCellClipPath('rectangle'), undefined);
assert.equal(S.getCellClipPath('circle'), undefined, 'circles use a border radius, not a clip path');
assert.equal(S.getCellClipPath('diamond'), 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)');
const star = S.getCellClipPath('star', 0);
assert(star.startsWith('polygon(50% 3%, '), 'the star starts at its top point');
assert.equal(star.split(',').length, 10, 'a star has ten points');
assert.notEqual(S.getCellClipPath('star', 0.7), star, 'the inner radius shapes the star');
const shaped = (cellShape, innerRadius) => ({style: {cellShape, innerRadius}});
assert.equal(S.getCellShapeClassName(shaped('hexagon')), 'cell-shape cell-shape--hexagon');
assert.equal(S.getCellShapeClassName(shaped('nope')), 'cell-shape cell-shape--rectangle');
assert.deepEqual(S.getCellShapeStyle(shaped('circle'), 20), {borderRadius: 10, clipPath: undefined, '--cell-clip-path': undefined});
assert.equal(S.getCellShapeStyle(shaped('rectangle'), 20).borderRadius, 20 * 0.22);
const diamond = S.getCellShapeStyle(shaped('diamond'), 20);
assert.equal(diamond.borderRadius, 0);
assert.equal(diamond.clipPath, diamond['--cell-clip-path']);

// Grid transforms on the flat drawing.
const G = require('../src/core/grid-transforms.ts');
assert.deepEqual([...G.GRID_TRANSFORMS].sort(), ['down', 'flip-h', 'flip-v', 'left', 'right', 'rotate-ccw', 'rotate-cw', 'up']);
const red = {0: '#FF0000'};
const expected = {left: [], up: [], right: [1], down: [3], 'flip-h': [2], 'flip-v': [6], 'rotate-cw': [2], 'rotate-ccw': [6]};
for (const [op, cells] of Object.entries(expected)) {
  const moved = G.transformPattern([0], red, 3, 3, op);
  assert.deepEqual(moved.activeCells, cells, `${op} moves the corner cell`);
  assert.deepEqual(moved.cellColors, Object.fromEntries(cells.map((c) => [c, '#FF0000'])), `${op} keeps its colour`);
}
assert.deepEqual(G.transformPattern([4, 3], undefined, 3, 3, 'right'), {activeCells: [4, 5], cellColors: {}}, 'sorted, and no colours invented');
assert.deepEqual(G.transformPattern([2], undefined, 2, 3, 'rotate-cw').activeCells, [], 'a non-square grid drops what does not fit');

// Layers.
const L = require('../src/core/layers.ts');
assert.deepEqual(L.createLayer('a', undefined, 'id-1'), {id: 'id-1', name: 'a', visible: true, offsetX: 0, offsetY: 0, pixels: {}});
assert.notEqual(L.createLayer('a').id, L.createLayer('a').id, 'new layers get distinct ids');
const hidden = {...L.layerFromCells('x', [0, 4], {0: '#FF0000'}, 3, 'x'), visible: false};
assert.deepEqual(L.flattenLayers([hidden], 3, 3).activeCells, [], 'a hidden layer does not show');
assert.deepEqual(L.layerCells(hidden, 3, 3), {activeCells: [0, 4], cellColors: {0: '#FF0000'}}, 'but its own cells are still readable');
assert.equal(L.BASE_COLOR, '');

// Loader-level layer operations.
const ops = require('../src/core/layer-ops.ts');
const {createMockProject} = require('../src/lib/mock-project.ts');
const cols = 8;
const at = (r, c) => r * cols + c;
const loader = structuredClone(createMockProject().loaders[0]);
loader.pattern.grid = {...loader.pattern.grid, rows: 8, cols};
loader.pattern.activeCells = [at(0, 0)];
loader.pattern.cellColors = {};
loader.style.primaryColor = '#66BDFF';
delete loader.pattern.layers;
delete loader.pattern.activeLayerId;

assert.equal(ops.baseLayerId({id: 'abc'}), 'abc:base');
assert.equal(ops.storedColor(loader, undefined), undefined, 'no colour keeps an existing one');
assert.equal(ops.storedColor(loader, '#66bdff'), '', 'the base colour is stored as no override');
assert.equal(ops.storedColor(loader, '#ff0000'), '#FF0000');

const lower = L.layerFromCells('lower', [0, 1], {0: '#FF0000'}, cols, 'lower');
const upper = L.layerFromCells('upper', [0], {0: '#00FF00'}, cols, 'upper');
const layered = ops.withLayers(loader, [lower, upper], 'missing');
assert.equal(layered.pattern.activeLayerId, 'upper', 'an unknown active layer falls back to the top one');
assert.deepEqual(layered.pattern.activeCells, [0, 1]);
assert.deepEqual(layered.pattern.cellColors, {0: '#00FF00'}, 'the top layer wins');
assert.equal(loader.pattern.layers, undefined, 'the input loader is not modified');

const nudged = ops.transformActiveLayer(loader, 'right');
assert.equal(nudged.pattern.layers.length, 1, 'a legacy drawing becomes a layer');
assert.deepEqual(nudged.pattern.activeCells, [at(0, 1)]);
assert.deepEqual(ops.transformActiveLayer(nudged, 'left').pattern.activeCells, [at(0, 0)]);

const replaced = ops.replaceDrawing(layered, [5, 6], {5: '#ABCDEF'});
assert.equal(replaced.pattern.layers.length, 1, 'a preset replaces every layer');
assert.equal(replaced.pattern.activeLayerId, replaced.pattern.layers[0].id);
assert.deepEqual(replaced.pattern.activeCells, [5, 6]);
assert.deepEqual(replaced.pattern.cellColors, {5: '#ABCDEF'});

const added = ops.addLayerWithPixels(loader, 'pic', {'-1,0': '#ff0000', '2,0': '#66BDFF', '3,0': ''});
assert(added.layerId, 'a layer was added');
assert.equal(added.loader.pattern.activeLayerId, added.layerId, 'and is active');
assert.equal(added.loader.pattern.layers.length, 2);
assert.deepEqual(added.loader.pattern.layers[1].pixels, {'-1,0': '#FF0000', '2,0': '', '3,0': ''}, 'base colour and empty colours are stored as base');
assert.deepEqual(added.loader.pattern.activeCells, [at(0, 0), at(0, 2), at(0, 3)], 'off-grid pixels are kept but not shown');
const full = ops.withLayers(loader, Array.from({length: ops.MAX_LAYERS}, (_, i) => L.createLayer(`l${i}`, {}, `l${i}`)), 'l0');
const refused = ops.addLayerWithPixels(full, 'one too many', {'0,0': ''});
assert.equal(refused.layerId, null, 'nothing is added at the layer limit');
assert.equal(refused.loader, full);

// Motion sampling helpers no other suite reaches directly.
const {sampleBackground} = require('../src/core/motion-sampler.ts');
const {getAnimationSummary, compileTimeline} = require('../src/core/timeline.ts');
const styled = (inactiveStyle) => ({...loader, animation: {...loader.animation, inactiveStyle}});
assert.equal(sampleBackground(styled('none'), 3, 0.4), 1);
assert.equal(sampleBackground(styled('static-dim'), 3, 0.4), 0.62);
for (let p = 0; p <= 1; p += 0.125) {
  const breathe = sampleBackground(styled('breathe'), at(2, 5), p);
  const ghost = sampleBackground(styled('ghost'), at(2, 5), p);
  assert(breathe >= 0.58 - 1e-9 && breathe <= 0.9 + 1e-9, `breathe stays in range at ${p}`);
  assert(ghost >= 0.34 - 1e-9 && ghost <= 0.58 + 1e-9, `ghost stays in range at ${p}`);
}
assert.equal(sampleBackground(styled('breathe'), 9, 0.25), sampleBackground(styled('breathe'), 9, 1.25), 'it loops every cycle');
for (const mode of ['blink', 'linear', 'directional', 'wave', 'pulse']) assert.equal(typeof getAnimationSummary(mode), 'string');
assert.equal(compileTimeline(loader).tracks.length, loader.pattern.activeCells.length, 'one track per lit cell');

console.log(`PASS: core — purity of ${seen.size} modules, ${Object.keys(forwarders).length} forwarders, cell shapes, grid transforms, layers, layer ops, background motion.`);
