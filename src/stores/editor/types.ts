/** The editor store's state and actions; the store is assembled in src/stores/use-editor-store.ts. */
import type { StoreApi } from "zustand";
import type { GridTransform } from "@/core/grid-transforms";
import type { AnimationMode, AnimationStyle, CellShape, Direction, ExportTarget, LayoutType, LoaderKind, LoaderComponent, MotionPresetId, PatternPresetId, Project } from "@/types/dot-motion";

export type EditorState = {
  hydrated: boolean;
  project: Project;
  selectedLoaderId: string;
  focusModeLoaderId: string | null;
  clipboardLoader: LoaderComponent | null;
  exportFormat: ExportTarget;
  isPreviewing: boolean;
  hydrate: () => void;
  selectLoader: (loaderId: string) => void;
  clearSelection: () => void;
  /** Lights (optionally with a colour) or clears many cells on the active layer. */
  setCellsActiveForLoader: (loaderId: string, cells: number[], active: boolean, color?: string) => void;
  /**
   * Puts cells (e.g. an imported image) on a layer: replaces layerId's pixels when that layer exists,
   * otherwise adds a new layer on top. Returns the layer that received them.
   */
  importCellsForLoader: (loaderId: string, cells: number[], colors: Record<string, string>, target: { layerId?: string; name: string }) => string | null;
  /** Replaces several layers' pixels in one update and one save (re-applying a GIF import). */
  importCellsForLoaders: (entries: Array<{ loaderId: string; layerId: string; cells: number[]; colors: Record<string, string> }>) => void;
  /** Moves (losslessly), mirrors or rotates the active layer. */
  transformLoaderCells: (loaderId: string, op: GridTransform) => void;
  /**
   * Creates a new frame sequence (e.g. from an animated GIF) next to the given artboard, one frame per
   * entry, and selects its first frame. Returns each new frame and the layer holding its picture.
   */
  importSequence: (baseLoaderId: string, frames: Array<{ cells: number[]; colors: Record<string, string> }>, fps: number) => Array<{ loaderId: string; layerId: string }>;
  deleteSavedPattern: (patternId: string) => void;
  addLayer: (loaderId: string, name: string) => void;
  duplicateLayer: (loaderId: string, layerId: string, name: string) => void;
  deleteLayer: (loaderId: string, layerId: string) => void;
  selectLayer: (loaderId: string, layerId: string) => void;
  setLayerVisible: (loaderId: string, layerId: string, visible: boolean) => void;
  renameLayer: (loaderId: string, layerId: string, name: string) => void;
  reorderLayer: (loaderId: string, layerId: string, direction: 1 | -1) => void;
  mergeLayerDown: (loaderId: string, layerId: string) => void;
  moveLayerBy: (loaderId: string, layerId: string, dx: number, dy: number) => void;
  /** Moves the active layer's pixels under the cells to a new layer above it; returns its id, or null. */
  liftToLayer: (loaderId: string, cells: number[], name: string) => string | null;
  /** Adds a layer from pixels keyed "x,y" in grid coordinates (#RRGGBB); returns its id, or null when full. */
  addLayerFromPixels: (loaderId: string, name: string, pixels: Record<string, string>) => string | null;
  setPatternSourceType: (sourceType: "template" | "drawn") => void;
  addLoader: (kind?: LoaderKind) => void;
  addSequenceFrame: (sequenceId: string) => void;
  removeSequenceFrame: (sequenceId: string, loaderId?: string) => void;
  copySelectedLoader: () => void;
  pasteLoader: () => void;
  duplicateSelectedLoader: () => void;
  deleteSelectedLoader: () => void;
  moveLoader: (loaderId: string, position: { x: number; y: number }) => void;
  moveLoaders: (positions: Array<{ id: string; x: number; y: number }>) => void;
  renameLoader: (name: string) => void;
  setAnimationMode: (mode: AnimationMode) => void;
  setMotionPreset: (presetId: MotionPresetId) => void;
  setMotionOrigin: (axis: "x" | "y", value: number) => void;
  setDirection: (direction: Direction) => void;
  setFps: (value: number) => void;
  setScaleIntensity: (value: number) => void;
  setSpeed: (value: number) => void;
  fillGrid: (filled: boolean) => void;
  setAnimationStyle: (value: AnimationStyle) => void;
  setInactiveStyle: (value: "none" | "static-dim" | "breathe" | "ghost") => void;
  setPrimaryColor: (value: string) => void;
  setPrimaryAlpha: (value: number) => void;
  /** Clears all per-cell colours of the selected artboard (and its sequence) so everything uses the base colour. */
  applyBaseColorEverywhere: () => void;
  setGlowEnabled: (value: boolean) => void;
  setGlowSize: (value: number) => void;
  setBackgroundColor: (value: string) => void;
  setBackgroundAlpha: (value: number) => void;
  setCellShape: (value: CellShape) => void;
  setGridSize: (size: number) => void;
  setGridGap: (value: number) => void;
  setLayoutType: (type: LayoutType) => void;
  setLabel: (value: string) => void;
  setExportFormat: (format: ExportTarget) => void;
  togglePreview: () => void;
  enterFocusMode: (loaderId?: string) => void;
  exitFocusMode: () => void;
  applyLoaderTemplate: (templateId: string) => void;
  applyPatternPreset: (presetId: PatternPresetId) => void;
  applySavedPattern: (patternId: string) => void;
  captureSnapshot: () => void;
  clearSnapshots: () => void;
  savePatternToLibrary: () => void;
  setCanvasView: (view: { zoom: number; panX: number; panY: number }) => void;
  resetCanvasView: () => void;
};

export type EditorSet = StoreApi<EditorState>["setState"];
export type EditorGet = StoreApi<EditorState>["getState"];
