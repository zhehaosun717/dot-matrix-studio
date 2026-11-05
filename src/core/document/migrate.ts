/**
 * Today's Project (artboards, sequences of artboards, per-artboard layers) -> Workspace / Document.
 * Expects a normalised project (what the editor store holds). Deterministic: the same project always
 * gives the same workspace. See docs/refactor-plan.md, section 3.
 */
import { layersOf } from "@/core/layer-ops";
import { celFromPixels, createPaletteBuilder } from "@/core/document/pixels";
import {
  Cel,
  celKey,
  CelKey,
  Document,
  Frame,
  Layer,
  LibraryItem,
  WORKSPACE_FORMAT,
  WORKSPACE_FORMAT_VERSION,
  Workspace
} from "@/core/document/types";
import type { LoaderComponent, PatternLayer, PatternSnapshot, Project } from "@/types/dot-motion";

export type MigrationReport = {
  documents: number;
  /** Documents that came from a frame sequence. */
  sequences: number;
  frames: number;
  /** Settings that differed between frames of one sequence (the first frame's value was kept). */
  inconsistencies: string[];
};

/**
 * fps -> frame duration. Not rounded to whole milliseconds: 1000 / 35 would round to 29 ms and come back as
 * 34 fps; the exact value turns back into the same fps for every rate.
 */
export const frameDurationMs = (fps: number) => 1000 / Math.max(1, fps);

/** Settings every frame of a sequence shares; differences are reported. */
const SHARED_SETTINGS: Array<[string, (loader: LoaderComponent) => unknown]> = [
  ["grid size", (l) => `${l.pattern.grid.rows}x${l.pattern.grid.cols}`],
  ["gap", (l) => l.pattern.grid.gap],
  ["cell size", (l) => l.pattern.grid.cellSize],
  ["base colour", (l) => l.style.primaryColor],
  ["base alpha", (l) => l.style.primaryAlpha],
  ["background", (l) => `${l.style.backgroundColor}/${l.style.backgroundAlpha}`],
  ["cell shape", (l) => `${l.style.cellShape}/${l.style.innerRadius}`],
  ["glow", (l) => `${l.style.shadow}/${l.style.glow}`],
  ["fps", (l) => l.animation.fps],
  ["inactive style", (l) => l.animation.inactiveStyle]
];

/** A palette of the given colours in sorted order, so the same colours always get the same indices. */
function sortedPalette(colors: readonly string[]) {
  const unique = [...new Set(colors.filter(Boolean).map((color) => color.toUpperCase()))].sort();
  return createPaletteBuilder(["", "", ...unique]);
}

/** Artboards in canvas order; the frames of a sequence form one group, ordered by sequenceIndex. */
function groupLoaders(loaders: readonly LoaderComponent[]): LoaderComponent[][] {
  const groups: LoaderComponent[][] = [];
  const seen = new Set<string>();
  for (const loader of loaders) {
    if (!loader.sequenceId) {
      groups.push([loader]);
      continue;
    }
    if (seen.has(loader.sequenceId)) continue;
    seen.add(loader.sequenceId);
    groups.push(
      loaders.filter((item) => item.sequenceId === loader.sequenceId).sort((a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0))
    );
  }
  return groups;
}

function layerPixels(layer: PatternLayer, indexOf: (color: string) => number) {
  return Object.entries(layer.pixels).map(([key, color]) => {
    const [x, y] = key.split(",").map(Number);
    return { x: x + layer.offsetX, y: y + layer.offsetY, index: indexOf(color) };
  });
}

function migrateGroup(frames: LoaderComponent[], report: MigrationReport): Document {
  const first = frames[0];
  const isSequence = Boolean(first.sequenceId);
  const docId = isSequence ? (first.sequenceId as string) : first.id;
  const states = frames.map((frame) => layersOf(frame));
  const palette = sortedPalette(states.flatMap((state) => state.layers.flatMap((layer) => Object.values(layer.pixels))));
  const layerCount = Math.max(...states.map((state) => state.layers.length));

  // Layers line up by position; the name comes from the first frame that has the layer.
  const usedIds = new Set<string>();
  const layers: Layer[] = Array.from({ length: layerCount }, (_, i) => {
    const source = states.find((state) => state.layers[i])?.layers[i] as PatternLayer;
    const id = source.id && !usedIds.has(source.id) ? source.id : `${docId}:layer-${i}`;
    usedIds.add(id);
    return { id, name: source.name, visible: states.some((state) => state.layers[i]?.visible) };
  });

  const docFrames: Frame[] = frames.map((frame) => ({
    id: isSequence ? frame.id : `${frame.id}:frame`,
    ...(frame.name !== first.name ? { name: frame.name } : {}),
    durationMs: frameDurationMs(first.animation.fps)
  }));

  const cels: Record<CelKey, Cel> = {};
  states.forEach((state, k) => {
    state.layers.forEach((layer, i) => {
      const cel = celFromPixels(layerPixels(layer, palette.indexOf));
      if (!cel) return;
      // Hidden in this frame only: the layer itself is visible because some other frame shows it.
      cels[celKey(docFrames[k].id, layers[i].id)] = layers[i].visible && !layer.visible ? { ...cel, visible: false } : cel;
    });
  });

  if (isSequence) {
    report.sequences++;
    frames.slice(1).forEach((frame, k) => {
      for (const [label, read] of SHARED_SETTINGS) {
        if (read(frame) !== read(first)) report.inconsistencies.push(`${first.name || docId}: frame ${k + 2} has a different ${label}`);
      }
    });
  }
  report.documents++;
  report.frames += frames.length;

  const activeIndex = states[0].layers.findIndex((layer) => layer.id === states[0].activeId);
  const { grid } = first.pattern;
  const { style, animation } = first;
  return {
    id: docId,
    name: first.name,
    size: { width: grid.cols, height: grid.rows },
    palette: palette.palette(),
    layers,
    frames: docFrames,
    cels,
    activeLayerId: layers[activeIndex >= 0 ? activeIndex : layers.length - 1].id,
    activeFrameId: docFrames[0].id,
    position: { x: first.artboard.x, y: first.artboard.y },
    render: {
      baseColor: style.primaryColor,
      baseAlpha: style.primaryAlpha ?? 1,
      background: { color: style.backgroundColor ?? "#2D3743", alpha: style.backgroundAlpha ?? 1 },
      glow: { enabled: style.shadow, size: style.glow },
      gap: grid.gap,
      cellSize: grid.cellSize,
      cellShape: style.cellShape,
      innerRadius: style.innerRadius ?? 0.48
    },
    playback: isSequence ? "frames" : "motion",
    motion: {
      presetId: animation.presetId,
      durationMs: animation.durationMs,
      speed: animation.speed ?? 1,
      direction: animation.direction,
      origin: { x: animation.originX, y: animation.originY },
      style: animation.style,
      inactiveStyle: animation.inactiveStyle,
      scaleIntensity: animation.scaleIntensity ?? 0,
      fps: animation.fps
    }
  };
}

/** A saved drawing; a cell without a colour of its own takes the base colour of where it is placed. */
export function libraryItemFromPattern(pattern: PatternSnapshot): LibraryItem {
  const width = pattern.cols ?? 6;
  const height = pattern.rows ?? 6;
  const palette = sortedPalette(Object.values(pattern.cellColors ?? {}));
  const pixels = new Uint16Array(width * height);
  for (const cell of pattern.activeCells) {
    if (Number.isInteger(cell) && cell >= 0 && cell < pixels.length) pixels[cell] = palette.indexOf(pattern.cellColors?.[cell] ?? "");
  }
  return { id: pattern.id, name: pattern.name ?? "", size: { width, height }, palette: palette.palette(), pixels };
}

export function migrateProject(project: Project): { workspace: Workspace; report: MigrationReport } {
  const report: MigrationReport = { documents: 0, sequences: 0, frames: 0, inconsistencies: [] };
  const documents = groupLoaders(project.loaders).map((group) => migrateGroup(group, report));
  const workspace: Workspace = {
    format: WORKSPACE_FORMAT,
    formatVersion: WORKSPACE_FORMAT_VERSION,
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    documents,
    library: (project.assets?.patterns ?? []).map(libraryItemFromPattern),
    view: { zoom: project.canvas.zoom, panX: project.canvas.panX, panY: project.canvas.panY }
  };
  return { workspace, report };
}
