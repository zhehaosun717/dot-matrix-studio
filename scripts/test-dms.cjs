// .dms project files (src/core/document/dms-format.ts): base64, exact round trips of a realistic workspace,
// a table of malformed files that must be rejected with the right path, random corruption that must never
// throw, and the format-version upgrade chain.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);

const F = require('../src/core/document/dms-format.ts');
const {migrateProject} = require('../src/core/document/migrate.ts');
const {celKey} = require('../src/core/document/types.ts');

let seed = 20261105;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

// Base64 matches Node's for every length and padding, and rejects what is not base64.
for (let length = 0; length < 70; length++) {
  const bytes = Uint8Array.from({length}, () => Math.floor(random() * 256));
  const encoded = F.encodeBase64(bytes);
  assert.equal(encoded, Buffer.from(bytes).toString('base64'), `encode ${length} bytes`);
  assert.deepEqual(F.decodeBase64(encoded), bytes, `decode ${length} bytes`);
}
for (const bad of ['A', 'AB=', 'A===', '****', 'AB=C', '=AAA', 'AAA-']) assert.equal(F.decodeBase64(bad), null, `"${bad}" is not base64`);

// A realistic workspace, built with the editor store and migrated.
globalThis.window = undefined;
const {useEditorStore} = require('../src/stores/use-editor-store.ts');
const s = () => useEditorStore.getState();
const layerIds = (id) => s().project.loaders.find((l) => l.id === id).pattern.layers.map((l) => l.id);
s().hydrate();
const a = s().selectedLoaderId;
s().setGridSize(16);
s().setCellsActiveForLoader(a, [0, 1, 17, 34, 255], true, '#ff0000');
s().setCellsActiveForLoader(a, [100, 101], true);
s().addLayer(a, 'moved');
s().setCellsActiveForLoader(a, [5, 6, 7], true, '#00ff00');
s().moveLayerBy(a, layerIds(a)[1], -4, 3);
s().addLayer(a, 'hidden');
s().setCellsActiveForLoader(a, [200], true, '#0000ff');
s().setLayerVisible(a, layerIds(a)[2], false);
s().savePatternToLibrary();
s().addLoader('sequence');
const seq = s().selectedLoaderId;
const seqId = s().project.loaders.find((l) => l.id === seq).sequenceId;
s().setCellsActiveForLoader(seq, [3, 4], true, '#123456');
s().addSequenceFrame(seqId);
s().addSequenceFrame(seqId);
const last = s().selectedLoaderId;
s().setLayerVisible(last, layerIds(last)[0], false);
// An imported animation with more colours than fit in 8 bits.
const frames = Array.from({length: 3}, (_, f) => ({
  cells: Array.from({length: 256}, (_, i) => i),
  colors: Object.fromEntries(Array.from({length: 256}, (_, i) => [i, `#${f.toString(16).padStart(2, '0')}${i.toString(16).padStart(2, '0')}80`.toUpperCase()]))
}));
s().importSequence(a, frames, 6);
const {workspace} = migrateProject(structuredClone(s().project));
const gif = workspace.documents.find((d) => d.frames.length === 3 && d.palette.length > 700);
assert(gif, 'the imported animation has 768 colours in one palette');
assert(Object.values(gif.cels).some((cel) => cel.pixels.some((index) => index > 255)), 'indices above 255 are exercised');

// Round trip: exactly the same workspace, and the same text again.
const text = F.serializeWorkspace(workspace);
const parsed = F.parseWorkspace(text);
assert(parsed.ok, parsed.error);
assert.deepEqual(parsed.workspace, workspace, 'parse(serialize(ws)) is ws');
assert.equal(F.serializeWorkspace(parsed.workspace), text, 'serialising is stable');
assert(parsed.workspace.documents.every((d) => Object.values(d.cels).every((c) => c.pixels instanceof Uint16Array)), 'pixels come back as 16-bit indices');
const json = JSON.parse(text);
assert(Array.isArray(json.documents[0].cels), 'cels are written as explicit (frame, layer) pairs');
assert(json.documents.some((d) => d.cels.some((c) => c.visible === false)), 'a cel hidden in one frame is written');
assert(workspace.documents.some((d) => d.frames.some((f) => f.id.includes(':'))) || workspace.documents.some((d) => d.layers.some((l) => l.id.includes(':'))), 'ids containing ":" are covered');

// Lenient where it is safe: colour case and a missing active layer / frame.
{
  const raw = JSON.parse(text);
  raw.documents[0].render.baseColor = '#abcdef';
  raw.documents[0].activeLayerId = 'gone';
  delete raw.documents[0].activeFrameId;
  const result = F.parseWorkspace(JSON.stringify(raw));
  assert(result.ok, result.error);
  assert.equal(result.workspace.documents[0].render.baseColor, '#ABCDEF');
  assert.equal(result.workspace.documents[0].activeLayerId, result.workspace.documents[0].layers.at(-1).id, 'falls back to the top layer');
  assert.equal(result.workspace.documents[0].activeFrameId, result.workspace.documents[0].frames[0].id);
}

// Malformed files: each is rejected and the error names where.
const base = JSON.parse(text);
const firstCel = base.documents[0].cels[0];
const cases = [
  ['not JSON', () => '{', /not valid JSON/],
  ['empty', () => '', /not valid JSON/],
  ['a list', () => '[]', /\(file\)/],
  ['wrong format', (r) => { r.format = 'other'; }, /format is missing or wrong/],
  ['newer format', (r) => { r.formatVersion = 2; }, /newer version/],
  ['format 0', (r) => { r.formatVersion = 0; }, /^formatVersion/],
  ['format as text', (r) => { r.formatVersion = '1'; }, /^formatVersion/],
  ['documents missing', (r) => { delete r.documents; }, /^documents: expected a list/],
  ['duplicate document', (r) => { r.documents.push(structuredClone(r.documents[0])); }, /documents\[\d+\]\.id: duplicate/],
  ['size 0', (r) => { r.documents[0].size.width = 0; }, /documents\[0\]\.size\.width/],
  ['size too big', (r) => { r.documents[0].size.height = 1000; }, /documents\[0\]\.size\.height/],
  ['palette colour', (r) => { r.documents[0].palette[2] = 'red'; }, /documents\[0\]\.palette\[2\]/],
  ['palette too short', (r) => { r.documents[0].palette = ['']; }, /documents\[0\]\.palette: needs/],
  ['no layers', (r) => { r.documents[0].layers = []; }, /documents\[0\]\.layers: needs at least one/],
  ['duplicate layer', (r) => { r.documents[0].layers.push(structuredClone(r.documents[0].layers[0])); }, /documents\[0\]\.layers\[\d+\]\.id: duplicate/],
  ['layer visible as text', (r) => { r.documents[0].layers[0].visible = 'yes'; }, /layers\[0\]\.visible/],
  ['no frames', (r) => { r.documents[0].frames = []; }, /documents\[0\]\.frames: needs at least one/],
  ['negative duration', (r) => { r.documents[0].frames[0].durationMs = -1; }, /frames\[0\]\.durationMs/],
  ['unknown frame', (r) => { r.documents[0].cels[0].frame = 'nope'; }, /cels\[0\]\.frame: no frame/],
  ['unknown layer', (r) => { r.documents[0].cels[0].layer = 'nope'; }, /cels\[0\]\.layer: no layer/],
  ['cel twice', (r) => { r.documents[0].cels.push(structuredClone(firstCel)); }, /cels\[\d+\]: a second cel/],
  ['pixels too short', (r) => { r.documents[0].cels[0].pixels = 'AAAA'; }, /cels\[0\]\.pixels: expected \d+ pixels/],
  ['pixels not base64', (r) => { const c = r.documents[0].cels[0]; c.pixels = '!'.repeat(c.pixels.length); }, /cels\[0\]\.pixels: not valid base64/],
  ['pixel beyond palette', (r) => { const d = r.documents[0]; d.palette = d.palette.slice(0, 2); }, /cels\[\d+\]\.pixels: pixel \d+ uses colour/],
  ['huge cel', (r) => { r.documents[0].cels[0].width = 5000; }, /cels\[0\]\.width/],
  ['visible true', (r) => { r.documents[0].cels[0].visible = true; }, /cels\[0\]\.visible: may only be false/],
  ['cell shape', (r) => { r.documents[0].render.cellShape = 'blob'; }, /render\.cellShape/],
  ['motion preset', (r) => { r.documents[0].motion.presetId = 'zigzag'; }, /motion\.presetId/],
  ['playback', (r) => { r.documents[0].playback = 'loop'; }, /playback/],
  ['alpha above 1', (r) => { r.documents[0].render.baseAlpha = 2; }, /render\.baseAlpha/],
  ['library pixels', (r) => { r.library[0].pixels = ''; }, /library\[0\]\.pixels/],
  ['view zoom as text', (r) => { r.view.zoom = 'x'; }, /^view\.zoom/],
  ['long name', (r) => { r.name = 'x'.repeat(500); }, /^name: longer than/]
];
for (const [label, mutate, expected] of cases) {
  let input;
  const raw = structuredClone(base);
  const result = mutate(raw);
  input = typeof result === 'string' ? result : JSON.stringify(raw);
  const outcome = F.parseWorkspace(input);
  assert.equal(outcome.ok, false, `${label}: rejected`);
  assert.match(outcome.error, expected, `${label}: ${outcome.error}`);
}

// Random corruption never throws; whatever is accepted is a consistent workspace.
function paths(value, prefix = []) {
  if (!value || typeof value !== 'object') return [prefix];
  return [prefix, ...Object.keys(value).flatMap((key) => paths(value[key], [...prefix, key]))];
}
const allPaths = paths(base).filter((p) => p.length);
const replacements = [null, '', 'x', -1, 0, 1, 1e9, 0.5, [], {}, true, false, '#FFFFFF', 'AAAA'];
let accepted = 0;
for (let i = 0; i < 2000; i++) {
  const raw = structuredClone(base);
  const target = allPaths[Math.floor(random() * allPaths.length)];
  let parent = raw;
  for (const key of target.slice(0, -1)) parent = parent?.[key];
  if (!parent || typeof parent !== 'object') continue;
  const key = target.at(-1);
  if (random() < 0.25) delete parent[key];
  else parent[key] = replacements[Math.floor(random() * replacements.length)];
  let outcome;
  assert.doesNotThrow(() => { outcome = F.parseWorkspace(JSON.stringify(raw)); }, `mutation at ${target.join('.')}`);
  if (!outcome.ok) continue;
  accepted++;
  for (const doc of outcome.workspace.documents) {
    for (const [k, cel] of Object.entries(doc.cels)) {
      assert(cel.pixels.length === cel.width * cel.height, 'cel size matches its pixels');
      assert(cel.pixels.every((index) => index < doc.palette.length), 'indices stay inside the palette');
      assert(doc.frames.some((f) => doc.layers.some((l) => celKey(f.id, l.id) === k)), 'cels belong to a frame and a layer');
    }
  }
  const again = F.parseWorkspace(F.serializeWorkspace(outcome.workspace));
  assert(again.ok && JSON.stringify(F.serializeWorkspace(again.workspace)) === JSON.stringify(F.serializeWorkspace(outcome.workspace)), 'accepted files round-trip');
}
assert(accepted > 50 && accepted < 2000, `some mutations are harmless, most are not (${accepted} accepted)`);
for (let i = 0; i < 300; i++) {
  const garbage = Array.from({length: Math.floor(random() * 80)}, () => String.fromCharCode(32 + Math.floor(random() * 95))).join('');
  assert.doesNotThrow(() => F.parseWorkspace(garbage));
  assert.equal(F.parseWorkspace(garbage).ok, false);
}

// Format upgrades run one version at a time; a missing step or a step that forgets the version is an error.
{
  const v1 = structuredClone(base);
  const upgraded = F.upgradeFormat(v1, {1: (raw) => ({...raw, formatVersion: 2, added: true})}, 2);
  assert.equal(upgraded.formatVersion, 2);
  assert.equal(upgraded.added, true);
  assert.throws(() => F.upgradeFormat(v1, {}, 2), /no upgrade from format 1/);
  assert.throws(() => F.upgradeFormat(v1, {1: (raw) => raw}, 2), /did not set formatVersion/);
  assert.deepEqual(F.FORMAT_UPGRADES, {}, 'format 1 is the only format so far');
}

console.log(`PASS: .dms format — base64, exact round trip of ${workspace.documents.length} documents, ${cases.length} malformed files rejected with their path, 2000 random corruptions (${accepted} harmless) and 300 garbage inputs never throw, format upgrades.`);
