// Undo / redo (src/stores/editor-history.ts): what counts as one step, what is not recorded, and what a
// restore keeps. Pins the current snapshot-based behaviour before any rewrite.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);

// The history installs itself from a React effect; outside React the effect simply runs at once.
const reactPath = require.resolve('react');
const React = require('react');
require.cache[reactPath].exports = {...React, useEffect: (effect) => { effect(); }};

let now = 1_000_000;
const realNow = Date.now;
Date.now = () => now;
const tick = () => new Promise((done) => setTimeout(done, 0));

/** A fresh editor with history installed, against a fake window that records its event listeners. */
function openEditor() {
  const listeners = {};
  const storage = new Map();
  globalThis.window = {
    addEventListener: (type, listener) => { (listeners[type] ||= []).push(listener); },
    localStorage: {getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k)}
  };
  for (const key of Object.keys(require.cache)) if (key.startsWith(path.join(root, 'src'))) delete require.cache[key];
  const history = require('../src/stores/editor-history.ts');
  const {useEditorStore} = require('../src/stores/use-editor-store.ts');
  const {useDrawStore} = require('../src/stores/use-draw-store.ts');
  const {STORAGE_KEY} = require('../src/lib/persistence.ts');
  history.useEditorHistory();
  const fire = (type, event = {}) => (listeners[type] || []).forEach((listener) => listener(event));
  const s = () => useEditorStore.getState();
  s().hydrate();
  const first = s().selectedLoaderId;
  const cells = () => s().project.loaders.find((l) => l.id === first)?.pattern.activeCells ?? null;
  const paint = (cell) => s().setCellsActiveForLoader(first, [cell], true);
  const flags = () => history.useHistoryStore.getState();
  const stored = () => JSON.parse(storage.get(STORAGE_KEY));
  return {history, s, first, cells, paint, flags, fire, listeners, useDrawStore, stored};
}

(async () => {
  // Loading the project is the starting point, not an edit.
  {
    const e = openEditor();
    assert.deepEqual(e.flags(), {canUndo: false, canRedo: false});
    e.history.undo();
    assert.deepEqual(e.cells(), [], 'nothing to undo after loading');
  }

  // Edits outside a pointer gesture: further apart than 500 ms they are separate steps, closer they are one.
  {
    const e = openEditor();
    e.paint(0);
    now += 600;
    e.paint(1);
    now += 100;
    e.paint(2);
    assert.deepEqual(e.cells(), [0, 1, 2]);
    assert.deepEqual(e.flags(), {canUndo: true, canRedo: false});
    e.history.undo();
    assert.deepEqual(e.cells(), [0], 'the two quick edits were one step');
    e.history.undo();
    assert.deepEqual(e.cells(), [], 'the first edit was its own step');
    assert.deepEqual(e.flags(), {canUndo: false, canRedo: true});
    e.history.redo();
    e.history.redo();
    assert.deepEqual(e.cells(), [0, 1, 2], 'redo walks forward again');
    e.history.redo();
    assert.deepEqual(e.cells(), [0, 1, 2], 'nothing more to redo');
    now += 600;
  }

  // One pointer gesture is one step however long it lasts; it ends after the release has been handled.
  for (const end of ['pointerup', 'pointercancel', 'blur', 'pointermove']) {
    const e = openEditor();
    now += 1000;
    e.fire('pointerdown');
    e.paint(0);
    now += 2000;
    e.paint(1);
    now += 2000;
    e.paint(2);
    if (end === 'pointermove') e.fire('pointermove', {buttons: 1});
    e.paint(3);
    e.fire(end, {buttons: 0});
    e.paint(4); // still part of the gesture: the release's own handlers run before it ends
    await tick();
    e.paint(5); // a new step
    e.history.undo();
    assert.deepEqual(e.cells(), [0, 1, 2, 3, 4], `${end}: the edit after the gesture is its own step`);
    e.history.undo();
    assert.deepEqual(e.cells(), [], `${end}: the whole gesture undoes at once`);
  }

  // A later gesture is not ended by an earlier release's deferred cleanup.
  {
    const e = openEditor();
    e.fire('pointerdown');
    e.paint(0);
    e.fire('pointerup');
    e.fire('pointerdown'); // pressed again before the first release's cleanup ran
    e.paint(1);
    await tick(); // the first release's cleanup runs now, in the middle of the second gesture
    now += 2000;
    e.paint(2);
    e.fire('pointerup');
    await tick();
    e.history.undo();
    assert.deepEqual(e.cells(), [0], 'the second gesture is one step, not cut short by the first release');
    e.history.undo();
    assert.deepEqual(e.cells(), [], 'and the first gesture is its own step');
  }

  // Changing only the view (zoom / pan) is not an edit, and undo keeps the current view.
  {
    const e = openEditor();
    e.s().setCanvasView({zoom: 1.5, panX: 10, panY: 20});
    assert.equal(e.flags().canUndo, false, 'zoom and pan are not recorded');
    e.paint(0);
    now += 600;
    e.s().setCanvasView({zoom: 2, panX: 30, panY: 40});
    e.history.undo();
    assert.deepEqual(e.cells(), []);
    assert.deepEqual(e.s().project.canvas, {...e.s().project.canvas, zoom: 2, panX: 30, panY: 40}, 'the view stays where it is');
    assert.equal(e.stored().loaders.find((l) => l.id === e.first).pattern.activeCells.length, 0, 'the restored project is saved');
  }

  // A new edit after undo drops the redo steps.
  {
    const e = openEditor();
    e.paint(0);
    now += 600;
    e.history.undo();
    assert.equal(e.flags().canRedo, true);
    now += 600;
    e.paint(1);
    assert.equal(e.flags().canRedo, false);
    e.history.redo();
    assert.deepEqual(e.cells(), [1]);
  }

  // Undo restores the selection only if that artboard still exists, and clears a pixel selection box.
  {
    const e = openEditor();
    now += 600;
    e.s().addLoader();
    const added = e.s().selectedLoaderId;
    assert.notEqual(added, e.first);
    e.useDrawStore.getState().setSelection({x0: 0, y0: 0, x1: 1, y1: 1});
    e.history.undo();
    assert(!e.s().project.loaders.some((l) => l.id === added), 'the new artboard is gone');
    assert.equal(e.s().selectedLoaderId, e.s().project.loaders[0].id, 'selection falls back to the first artboard');
    assert.equal(e.useDrawStore.getState().selection, null, 'the selection box is cleared');
    e.history.redo();
    assert.equal(e.s().selectedLoaderId, e.s().project.loaders[0].id, 'redo keeps the current selection when it still exists');
  }

  // At most 100 steps are kept.
  {
    const e = openEditor();
    for (let i = 0; i < 105; i++) {
      now += 600;
      e.s().setGridSize(i % 2 ? 7 : 8);
    }
    let undos = 0;
    while (e.flags().canUndo) {
      e.history.undo();
      undos++;
    }
    assert.equal(undos, 100);
  }

  // Installing twice (the effect re-running) records nothing twice.
  {
    const e = openEditor();
    const before = Object.values(e.listeners).flat().length;
    e.history.useEditorHistory();
    assert.equal(Object.values(e.listeners).flat().length, before, 'listeners are added once');
    e.paint(0);
    now += 600;
    e.history.undo();
    assert.deepEqual(e.cells(), []);
    assert.equal(e.flags().canUndo, false, 'one edit, one step');
  }

  Date.now = realNow;
  delete globalThis.window;
  console.log('PASS: undo history — load is not a step, 500 ms coalescing, pointer gestures (up/cancel/blur/move), view not recorded, redo cleared, selection, 100-step limit.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
