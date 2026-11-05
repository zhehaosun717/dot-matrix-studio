// Project files on disk (desktop/src/project-files.ts): atomic saves and backups, failures that leave the old
// file alone, size limits, the recent-files list, autosave and legacy backups. Runs on Linux and Windows CI.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText, filename);

const P = require('../desktop/src/project-files.ts');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dms-files-'));
const leftovers = (folder) => fs.readdirSync(folder).filter((name) => name.endsWith('.tmp'));

try {
  // Atomic save: new file, then an update that keeps the previous version as .bak; no temporary files left.
  const file = path.join(dir, 'nested', 'My work.dms');
  P.writeFileAtomic(file, 'version 1');
  assert.equal(fs.readFileSync(file, 'utf8'), 'version 1', 'creates the folder and the file');
  assert(!fs.existsSync(`${file}.bak`), 'nothing to back up the first time');
  P.writeFileAtomic(file, 'version 2 — 中文 ✓');
  assert.equal(fs.readFileSync(file, 'utf8'), 'version 2 — 中文 ✓', 'replaces the file (UTF-8)');
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), 'version 1', 'the previous version is kept');
  P.writeFileAtomic(file, 'version 3', {keepBackup: false});
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), 'version 1', 'keepBackup: false leaves the backup alone');
  assert.deepEqual(leftovers(path.dirname(file)), [], 'no temporary files left');

  // A failed save leaves the old file untouched and cleans up.
  const folderTarget = path.join(dir, 'a-folder.dms');
  fs.mkdirSync(folderTarget);
  fs.writeFileSync(path.join(folderTarget, 'inside.txt'), 'keep me');
  assert.throws(() => P.writeFileAtomic(folderTarget, 'oops'));
  assert.equal(fs.readFileSync(path.join(folderTarget, 'inside.txt'), 'utf8'), 'keep me', 'the target is untouched');
  assert.deepEqual(leftovers(dir), [], 'the temporary file is removed after a failure');

  // Reading: text back, folders and oversized files refused before reading them.
  assert.equal(P.readProjectFile(file), 'version 3');
  assert.throws(() => P.readProjectFile(folderTarget), /is not a file/);
  const big = path.join(dir, 'big.dms');
  fs.writeFileSync(big, '');
  fs.truncateSync(big, 2048);
  assert.throws(() => P.readProjectFile(big, 1024), /larger than 1024 bytes/);
  assert.equal(P.MAX_PROJECT_BYTES, 64 * 1024 * 1024);
  assert.throws(() => P.readProjectFile(path.join(dir, 'missing.dms')), /ENOENT/);

  // File names.
  assert.equal(P.withProjectExtension('a/b/pixel'), 'a/b/pixel.dms');
  assert.equal(P.withProjectExtension('a/b/PIXEL.DMS'), 'a/b/PIXEL.DMS');
  assert.equal(P.defaultProjectsDir('/home/me/Documents'), path.join('/home/me/Documents', 'Dot Matrix Studio'));

  // Recent files: newest first, no duplicates (Windows ignores case and slash direction), at most 10.
  let recent = [];
  for (let i = 0; i < 12; i++) recent = P.addRecentFile(recent, {path: `/p/${i}.dms`, name: `${i}`, openedAt: `t${i}`}, 'linux');
  assert.equal(recent.length, P.MAX_RECENT_FILES);
  assert.deepEqual(recent.slice(0, 2).map((r) => r.name), ['11', '10']);
  recent = P.addRecentFile(recent, {path: '/p/5.dms', name: 'five again', openedAt: 'later'}, 'linux');
  assert.equal(recent[0].name, 'five again');
  assert.equal(recent.filter((r) => r.path === '/p/5.dms').length, 1, 'moved to the top, not duplicated');
  const win = P.addRecentFile([{path: 'C:\\Art\\Face.dms', name: 'face', openedAt: 't'}], {path: 'c:/art/face.DMS', name: 'face', openedAt: 'u'}, 'win32');
  assert.equal(win.length, 1, 'Windows paths compare without case or slash direction');
  assert.equal(P.samePath('/A/b.dms', '/a/b.dms', 'linux'), false, 'other systems compare exactly');
  assert.deepEqual(P.existingRecentFiles(recent, (p) => p !== '/p/11.dms').map((r) => r.path).includes('/p/11.dms'), false, 'missing files drop out');

  // Autosave: separate from the user's file, written atomically, cleared after a normal save or close.
  const dataDir = path.join(dir, 'appdata');
  assert.equal(P.readAutosave(dataDir), null, 'nothing autosaved yet');
  P.writeAutosave(dataDir, '{"autosave":1}');
  P.writeAutosave(dataDir, '{"autosave":2}');
  assert.equal(P.readAutosave(dataDir), '{"autosave":2}');
  assert(!fs.existsSync(`${P.autosaveFile(dataDir)}.bak`), 'autosave keeps no .bak');
  P.clearAutosave(dataDir);
  assert.equal(P.readAutosave(dataDir), null);
  P.clearAutosave(dataDir);

  // Legacy backups: kept unchanged, never overwritten, even within the same second.
  const now = new Date('2026-11-05T01:02:03Z');
  const first = P.backupLegacyProject(dataDir, '{"version":"0.17.0"}', now);
  const second = P.backupLegacyProject(dataDir, '{"other":true}', now);
  assert.notEqual(first, second);
  assert.match(path.basename(first), /^legacy-localstorage-20261105-010203\.json$/);
  assert.match(path.basename(second), /^legacy-localstorage-20261105-010203-1\.json$/);
  assert.equal(fs.readFileSync(first, 'utf8'), '{"version":"0.17.0"}');
  assert.equal(fs.readFileSync(second, 'utf8'), '{"other":true}');
} finally {
  fs.rmSync(dir, {recursive: true, force: true});
}

console.log('PASS: project files — atomic saves with .bak, failures leave the old file, size limits, recent files (Windows paths), autosave, legacy backups.');
