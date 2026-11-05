/**
 * The document model from docs/refactor-plan.md (section 2): a Document has a size and a palette, and
 * frames x layers -> cels of palette-indexed pixels. The composited image is derived, never stored.
 * Not used by the editor yet: src/core/document/migrate.ts converts today's Project into it and
 * src/core/document/to-legacy.ts projects it back for the renderers.
 */
import type { AnimationStyle, CellShape, Direction, InactiveStyle, MotionPresetId } from "@/types/dot-motion";

export const WORKSPACE_FORMAT = "dot-matrix-studio";
export const WORKSPACE_FORMAT_VERSION = 1;

/** Palette index of an unlit pixel. */
export const TRANSPARENT = 0;
/** Palette index of a pixel in the document's base colour (follows render.baseColor). */
export const BASE_COLOR = 1;
/** Index of the first concrete "#RRGGBB" colour in a palette. */
export const FIRST_COLOR = 2;

/** A .dms file: the documents on the canvas, the library and the view. */
export type Workspace = {
  format: typeof WORKSPACE_FORMAT;
  formatVersion: typeof WORKSPACE_FORMAT_VERSION;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  documents: Document[];
  library: LibraryItem[];
  view: { zoom: number; panX: number; panY: number };
};

/**
 * Palette: index 0 is transparent, 1 the base colour, 2.. concrete colours. Entries 0 and 1 are
 * placeholders ("") so that a pixel value is always its index into this array.
 */
export type Palette = readonly string[];

export type Layer = {
  id: string;
  /** Empty: shown as "Layer n" in the interface language. */
  name: string;
  visible: boolean;
};

export type Frame = {
  id: string;
  /** Only when this frame has its own name (imported GIF frames are "GIF 1", "GIF 2", ...). */
  name?: string;
  /** How long the frame shows, in milliseconds (frame-by-frame playback). */
  durationMs: number;
};

export type CelKey = `${string}:${string}`;
export const celKey = (frameId: string, layerId: string): CelKey => `${frameId}:${layerId}`;

/**
 * The pixels of one layer in one frame. (x, y) is where the buffer's top-left sits on the grid and may be
 * negative: moving a layer only changes x / y, so pixels outside the grid are kept.
 */
export type Cel = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** width x height palette indices, row by row. */
  pixels: Uint16Array;
  /** false: this layer is hidden in this frame only (sequences migrated from per-frame layers). */
  visible?: false;
};

/** How the document's cells are drawn (editor, previews and the panel). */
export type RenderStyle = {
  baseColor: string;
  baseAlpha: number;
  background: { color: string; alpha: number };
  glow: { enabled: boolean; size: number };
  /** Gap between cells and cell size in the editor (pixels). */
  gap: number;
  cellSize: number;
  cellShape: CellShape;
  innerRadius: number;
};

/** The procedural motion played over frame 0 when playback is "motion". */
export type MotionSettings = {
  presetId: MotionPresetId;
  durationMs: number;
  speed: number;
  direction: Direction;
  origin: { x: number; y: number };
  style: AnimationStyle;
  inactiveStyle: InactiveStyle;
  scaleIntensity: number;
  /** Sampling rate for the panel and GIFs. */
  fps: number;
};

export type Document = {
  id: string;
  name: string;
  /** 3..32 cells each way. */
  size: { width: number; height: number };
  palette: Palette;
  /** Bottom first. */
  layers: Layer[];
  /** At least one. */
  frames: Frame[];
  /** Missing key: that layer is empty in that frame. */
  cels: Record<CelKey, Cel>;
  activeLayerId: string;
  activeFrameId: string;
  /** Top-left of the document on the canvas. */
  position: { x: number; y: number };
  render: RenderStyle;
  /** "frames": frame-by-frame animation; "motion": frame 0 with the procedural motion. */
  playback: "frames" | "motion";
  motion: MotionSettings;
};

/** A saved drawing; colours are concrete so it looks the same on any document. */
export type LibraryItem = {
  id: string;
  name: string;
  size: { width: number; height: number };
  palette: Palette;
  /** width x height palette indices; BASE_COLOR is the base colour of the document it is placed on. */
  pixels: Uint16Array;
};
