// Loading saved projects: a project from another version, or text that is not a project, is never overwritten
// before an unchanged copy of it is kept; usable projects from other versions are carried over.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);

/** localStorage with a size limit (characters of keys and values), like the browser's ~5 MB quota. */
function makeStorage(entries = {}, capacity = Infinity) {
  const map = new Map(Object.entries(entries));
  const used = () => [...map].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    map,
    capacity,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem(key, value) {
      const text = String(value);
      const previous = map.has(key) ? key.length + map.get(key).length : 0;
      if (used() - previous + key.length + text.length > this.capacity) {
        const error = new Error('The quota has been exceeded.');
        error.name = 'QuotaExceededError';
        throw error;
      }
      map.set(key, text);
    },
    removeItem: (key) => map.delete(key)
  };
}

/** A fresh editor (store and persistence modules) running against the given storage. */
function openEditor(storage) {
  globalThis.window = {localStorage: storage};
  for (const key of Object.keys(require.cache)) if (key.startsWith(path.join(root, 'src'))) delete require.cache[key];
  const persistence = require('../src/lib/persistence.ts');
  const {useEditorStore} = require('../src/stores/use-editor-store.ts');
  const saves = [];
  persistence.onSaveResult((ok) => saves.push(ok));
  useEditorStore.getState().hydrate();
  return {persistence, store: useEditorStore, saves, state: () => useEditorStore.getState()};
}

const {STORAGE_KEY, BACKUP_KEY_PREFIX} = require('../src/lib/persistence.ts');
const {PROJECT_VERSION, createMockProject} = require('../src/lib/mock-project.ts');
const backups = (storage) => [...storage.map.keys()].filter((key) => key.startsWith(BACKUP_KEY_PREFIX));
const stored = (storage) => JSON.parse(storage.getItem(STORAGE_KEY));
const warn = console.warn;
console.warn = () => {};

function myProject(version) {
  const project = createMockProject();
  project.version = version;
  project.loaders[0].name = 'Mine';
  project.loaders[0].pattern.activeCells = [1, 2, 3];
  return project;
}

// Nothing stored: the sample project is created and saved, nothing is backed up.
{
  const storage = makeStorage();
  const editor = openEditor(storage);
  assert.equal(editor.state().hydrated, true);
  assert.equal(stored(storage).version, PROJECT_VERSION);
  assert.deepEqual(backups(storage), []);
}

// The current version loads as it is, without a backup.
{
  const raw = JSON.stringify(myProject(PROJECT_VERSION));
  const storage = makeStorage({[STORAGE_KEY]: raw});
  const editor = openEditor(storage);
  assert.equal(editor.state().project.loaders[0].name, 'Mine');
  assert.deepEqual(backups(storage), []);
  assert.equal(storage.getItem(STORAGE_KEY), raw, 'loading alone does not rewrite the stored project');
}

// Another version: the drawing is carried over, and the original text is kept unchanged under a backup key.
{
  const raw = JSON.stringify(myProject('0.16.0'));
  const storage = makeStorage({[STORAGE_KEY]: raw});
  const editor = openEditor(storage);
  assert.equal(editor.state().project.loaders[0].name, 'Mine', 'the stored project is kept, not replaced by the sample');
  assert.deepEqual(editor.state().project.loaders[0].pattern.activeCells, [1, 2, 3]);
  assert.equal(stored(storage).version, PROJECT_VERSION, 'saved again in the current version');
  const [backup] = backups(storage);
  assert(backup && backup.startsWith(`${BACKUP_KEY_PREFIX}v0.16.0.`), 'the backup key names the old version');
  assert.equal(storage.getItem(backup), raw, 'the backup is the original text');
  // The next start finds the current version and backs up nothing more.
  openEditor(storage);
  assert.equal(backups(storage).length, 1);
}

// Unreadable artboards are left out; the readable ones are carried over.
{
  const project = myProject('0.12.0');
  project.loaders.push({id: 'broken'});
  const storage = makeStorage({[STORAGE_KEY]: JSON.stringify(project)});
  const editor = openEditor(storage);
  assert.deepEqual(editor.state().project.loaders.map((loader) => loader.name), ['Mine']);
  assert.equal(backups(storage).length, 1);
}

// Nothing usable (no readable artboard, or not even JSON): start from the sample, the stored text is backed up first.
for (const raw of ['{"version":"0.1.0","loaders":[{}]}', '{not json', 'null']) {
  const storage = makeStorage({[STORAGE_KEY]: raw});
  const editor = openEditor(storage);
  assert.equal(editor.state().project.version, PROJECT_VERSION);
  const [backup] = backups(storage);
  assert(backup, `${raw}: backed up`);
  assert.equal(storage.getItem(backup), raw, `${raw}: the backup is the original text`);
  assert.equal(stored(storage).version, PROJECT_VERSION, `${raw}: then replaced`);
}

// Storage too full for the backup: the stored text is not overwritten, saving reports failure (the save
// banner) on every edit, and goes through once there is room for the backup again.
{
  const raw = '{not json but a lot of work'.padEnd(4000, '.');
  const storage = makeStorage({[STORAGE_KEY]: raw}, STORAGE_KEY.length + raw.length + 100);
  const editor = openEditor(storage);
  assert.equal(storage.getItem(STORAGE_KEY), raw, 'not overwritten without a backup');
  assert.deepEqual(backups(storage), []);
  assert.equal(editor.saves.at(-1), false, 'the save banner shows');
  editor.state().addLoader();
  assert.equal(storage.getItem(STORAGE_KEY), raw, 'edits do not overwrite it either');
  assert.equal(editor.saves.at(-1), false);
  storage.capacity = Infinity;
  editor.state().addLoader();
  assert.equal(editor.saves.at(-1), true, 'saving resumes');
  const [backup] = backups(storage);
  assert.equal(storage.getItem(backup), raw, 'after the backup was made');
  assert.equal(stored(storage).loaders.length, editor.state().project.loaders.length, 'and the current project is saved');
}

console.warn = warn;
delete globalThis.window;
console.log('PASS: persistence — current version loads unchanged, other versions migrate, unusable data and full storage never lose the stored project.');
