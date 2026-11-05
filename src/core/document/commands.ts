/**
 * Undoable changes to a Workspace, for src/core/history.ts. A few generic commands cover every editor
 * action (docs/refactor-plan.md, section 7): pixel edits are ReplaceCel, structural edits insert / remove /
 * move layers, frames and documents, settings edits set properties. Builders that remove something
 * capture what they remove from the workspace they are given, so revert can put it back.
 */
import type { Command } from "@/core/history";
import { Cel, CelKey, celKey, Document, Frame, Layer, Workspace } from "@/core/document/types";

type WorkspaceCommand = Command<Workspace>;

const CEL_OVERHEAD = 64;
const celSize = (cel: Cel | undefined) => (cel ? cel.pixels.byteLength + CEL_OVERHEAD : 0);
const celsSize = (cels: Record<string, Cel>) => Object.values(cels).reduce((sum, cel) => sum + celSize(cel), 0);
const SMALL = 256;

function updateDocument(ws: Workspace, docId: string, update: (doc: Document) => Document): Workspace {
  return { ...ws, documents: ws.documents.map((doc) => (doc.id === docId ? update(doc) : doc)) };
}

function findDocument(ws: Workspace, docId: string): Document {
  const doc = ws.documents.find((item) => item.id === docId);
  if (!doc) throw new Error(`no document ${docId}`);
  return doc;
}

function withCel(cels: Record<CelKey, Cel>, key: CelKey, cel: Cel | undefined): Record<CelKey, Cel> {
  const next = { ...cels };
  if (cel) next[key] = cel;
  else delete next[key];
  return next;
}

const move = <T>(items: readonly T[], from: number, to: number): T[] => {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

/** Pixel edits of one layer in one frame: brush, erase, fill, shapes, text, paste, image import, moving a layer. */
export function replaceCel(docId: string, key: CelKey, before: Cel | undefined, after: Cel | undefined, label = "Draw", mergeKey?: string): WorkspaceCommand {
  return {
    label,
    mergeKey,
    size: celSize(before) + celSize(after),
    apply: (ws) => updateDocument(ws, docId, (doc) => ({ ...doc, cels: withCel(doc.cels, key, after) })),
    revert: (ws) => updateDocument(ws, docId, (doc) => ({ ...doc, cels: withCel(doc.cels, key, before) }))
  };
}

/** Rename, show / hide a layer. */
export function setLayerProps(docId: string, layerId: string, before: Partial<Layer>, after: Partial<Layer>, label = "Layer"): WorkspaceCommand {
  const set = (props: Partial<Layer>) => (ws: Workspace) =>
    updateDocument(ws, docId, (doc) => ({ ...doc, layers: doc.layers.map((layer) => (layer.id === layerId ? { ...layer, ...props } : layer)) }));
  return { label, mergeKey: `layer:${docId}:${layerId}`, size: SMALL, apply: set(after), revert: set(before) };
}

/** Adds a layer (with its cels, e.g. a duplicate) at index (bottom = 0). */
export function insertLayer(docId: string, index: number, layer: Layer, cels: Record<CelKey, Cel> = {}, label = "New layer"): WorkspaceCommand {
  const add = (ws: Workspace) =>
    updateDocument(ws, docId, (doc) => ({
      ...doc,
      layers: [...doc.layers.slice(0, index), layer, ...doc.layers.slice(index)],
      cels: { ...doc.cels, ...cels }
    }));
  const remove = (ws: Workspace) =>
    updateDocument(ws, docId, (doc) => ({
      ...doc,
      layers: doc.layers.filter((item) => item.id !== layer.id),
      cels: Object.fromEntries(Object.entries(doc.cels).filter(([key]) => !(key in cels))) as Record<CelKey, Cel>
    }));
  return { label, size: SMALL + celsSize(cels), apply: add, revert: remove };
}

/** Removes a layer and its cels in every frame; revert puts them back at the same index. */
export function removeLayer(ws: Workspace, docId: string, layerId: string, label = "Delete layer"): WorkspaceCommand {
  const doc = findDocument(ws, docId);
  const index = doc.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) throw new Error(`no layer ${layerId}`);
  const cels = Object.fromEntries(doc.frames.map((frame) => celKey(frame.id, layerId)).filter((key) => doc.cels[key]).map((key) => [key, doc.cels[key]]));
  const inverse = insertLayer(docId, index, doc.layers[index], cels, label);
  return { label, size: inverse.size, apply: inverse.revert, revert: inverse.apply };
}

/** Moves a layer from one index to another (reordering). */
export function moveLayer(docId: string, from: number, to: number, label = "Move layer"): WorkspaceCommand {
  return {
    label,
    size: SMALL,
    apply: (ws) => updateDocument(ws, docId, (doc) => ({ ...doc, layers: move(doc.layers, from, to) })),
    revert: (ws) => updateDocument(ws, docId, (doc) => ({ ...doc, layers: move(doc.layers, to, from) }))
  };
}

/** Adds a frame (with its cels) at index. */
export function insertFrame(docId: string, index: number, frame: Frame, cels: Record<CelKey, Cel> = {}, label = "New frame"): WorkspaceCommand {
  const add = (ws: Workspace) =>
    updateDocument(ws, docId, (doc) => ({ ...doc, frames: [...doc.frames.slice(0, index), frame, ...doc.frames.slice(index)], cels: { ...doc.cels, ...cels } }));
  const remove = (ws: Workspace) =>
    updateDocument(ws, docId, (doc) => ({
      ...doc,
      frames: doc.frames.filter((item) => item.id !== frame.id),
      cels: Object.fromEntries(Object.entries(doc.cels).filter(([key]) => !(key in cels))) as Record<CelKey, Cel>
    }));
  return { label, size: SMALL + celsSize(cels), apply: add, revert: remove };
}

/** Removes a frame and its cels; revert puts them back. */
export function removeFrame(ws: Workspace, docId: string, frameId: string, label = "Delete frame"): WorkspaceCommand {
  const doc = findDocument(ws, docId);
  const index = doc.frames.findIndex((frame) => frame.id === frameId);
  if (index < 0) throw new Error(`no frame ${frameId}`);
  const cels = Object.fromEntries(doc.layers.map((layer) => celKey(frameId, layer.id)).filter((key) => doc.cels[key]).map((key) => [key, doc.cels[key]]));
  const inverse = insertFrame(docId, index, doc.frames[index], cels, label);
  return { label, size: inverse.size, apply: inverse.revert, revert: inverse.apply };
}

export function setFrameDuration(docId: string, frameId: string, before: number, after: number, label = "Frame duration"): WorkspaceCommand {
  const set = (durationMs: number) => (ws: Workspace) =>
    updateDocument(ws, docId, (doc) => ({ ...doc, frames: doc.frames.map((frame) => (frame.id === frameId ? { ...frame, durationMs } : frame)) }));
  return { label, mergeKey: `duration:${docId}:${frameId}`, size: SMALL, apply: set(after), revert: set(before) };
}

type DocumentProps = Partial<Pick<Document, "name" | "position" | "render" | "motion" | "playback" | "activeLayerId" | "activeFrameId">>;

/** Settings of a document: name, position, colours / glow / shape, motion, the active layer or frame. */
export function setDocumentProps(docId: string, before: DocumentProps, after: DocumentProps, label = "Settings", mergeKey?: string): WorkspaceCommand {
  const set = (props: DocumentProps) => (ws: Workspace) => updateDocument(ws, docId, (doc) => ({ ...doc, ...props }));
  return { label, mergeKey, size: SMALL, apply: set(after), revert: set(before) };
}

/** Replaces a whole document: changes that are hard to express as smaller steps (grid size). */
export function replaceDocument(before: Document, after: Document, label = "Change document"): WorkspaceCommand {
  const set = (doc: Document) => (ws: Workspace) => updateDocument(ws, doc.id, () => doc);
  return { label, size: celsSize(before.cels) + celsSize(after.cels), apply: set(after), revert: set(before) };
}

/** Adds a document (new, duplicated, pasted or imported artboard) at index. */
export function insertDocument(index: number, doc: Document, label = "New artboard"): WorkspaceCommand {
  return {
    label,
    size: SMALL + celsSize(doc.cels),
    apply: (ws) => ({ ...ws, documents: [...ws.documents.slice(0, index), doc, ...ws.documents.slice(index)] }),
    revert: (ws) => ({ ...ws, documents: ws.documents.filter((item) => item.id !== doc.id) })
  };
}

/** Removes a document; revert puts it back at the same index. */
export function removeDocument(ws: Workspace, docId: string, label = "Delete artboard"): WorkspaceCommand {
  const index = ws.documents.findIndex((doc) => doc.id === docId);
  if (index < 0) throw new Error(`no document ${docId}`);
  const inverse = insertDocument(index, ws.documents[index], label);
  return { label, size: inverse.size, apply: inverse.revert, revert: inverse.apply };
}
