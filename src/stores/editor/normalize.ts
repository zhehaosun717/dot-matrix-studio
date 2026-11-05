/** Sanitising and migrating stored projects and loaders (stored data is untrusted). */
import { normalizeCellShape } from "@/core/cell-shapes";
import { MAX_GRID_SIZE, MIN_GRID_SIZE } from "@/lib/grid-limits";
import { PROJECT_VERSION } from "@/lib/mock-project";
import { getDefaultMotionConfig } from "@/lib/motion-presets";
import * as layerOps from "@/core/layer-ops";
import type { AnimationConfig, Direction, GridConfig, LoaderComponent, MotionPresetId, Project } from "@/types/dot-motion";
import { getArtboardPosition, reindexSequenceLoaders } from "./artboards";

export const DEFAULT_DRAWN_GRID: GridConfig = {
  rows: 6,
  cols: 6,
  cellSize: 16,
  gap: 6
};

export const DEFAULT_BACKGROUND_COLOR = "#2D3743";

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function cloneGrid(grid: GridConfig): GridConfig {
  return { ...grid };
}

export function sanitizeGrid(grid?: GridConfig): GridConfig {
  const source = grid ?? DEFAULT_DRAWN_GRID;

  return {
    rows: clamp(Math.round(source.rows ?? DEFAULT_DRAWN_GRID.rows), MIN_GRID_SIZE, MAX_GRID_SIZE),
    cols: clamp(Math.round(source.cols ?? DEFAULT_DRAWN_GRID.cols), MIN_GRID_SIZE, MAX_GRID_SIZE),
    cellSize: source.cellSize ?? DEFAULT_DRAWN_GRID.cellSize,
    gap: clamp(Math.round(source.gap ?? DEFAULT_DRAWN_GRID.gap), 0, 20),
    symmetryX: source.symmetryX,
    symmetryY: source.symmetryY
  };
}

export const HEX_COLOR = /^#[0-9A-F]{6}$/;

/** Keeps colours only for lit cells inside the grid; an empty map is dropped. */
export function sanitizeCellColors(colors: Record<string, string> | undefined, activeCells: number[]) {
  if (!colors) return undefined;
  const active = new Set(activeCells);
  const kept = Object.entries(colors)
    .map(([key, hex]) => [Number(key), String(hex).toUpperCase()] as const)
    .filter(([cell, hex]) => active.has(cell) && HEX_COLOR.test(hex));
  return kept.length ? Object.fromEntries(kept) : undefined;
}

/** Every lit cell's actual colour, so a saved drawing does not depend on the artboard's base colour. */
export function bakeCellColors(loader: LoaderComponent): Record<string, string> {
  const base = loader.style.primaryColor.toUpperCase();
  return Object.fromEntries(loader.pattern.activeCells.map((cell) => [cell, loader.pattern.cellColors?.[cell] ?? base]));
}

export function sanitizeActiveCells(cells: number[] | undefined, grid: GridConfig) {
  const maxIndex = grid.rows * grid.cols;
  return [...new Set((cells ?? []).filter((cellIndex) => Number.isInteger(cellIndex) && cellIndex >= 0 && cellIndex < maxIndex))].sort(
    (left, right) => left - right
  );
}

export function normalizeDirection(direction: unknown): Direction {
  switch (direction) {
    case "up":
    case "down":
    case "left":
    case "right":
    case "up-left":
    case "up-right":
    case "down-left":
    case "down-right":
      return direction;
    case "diag-up":
      return "up-right";
    case "diag-down":
      return "down-right";
    default:
      return "right";
  }
}

export function normalizeMotionPresetId(value: unknown, fallbackPresetId: MotionPresetId = "wave"): MotionPresetId {
  switch (value) {
    case "wave":
    case "sweep":
    case "bloom":
    case "fish-eye":
    case "checkerboard":
    case "pinwheel":
    case "burst":
    case "random":
    case "diamond-wave":
    case "radar":
    case "heartbeat":
    case "breathing":
    case "static":
      return value;
    case "blink":
    case "zigzag":
      return "wave";
    case "ripple":
      return "fish-eye";
    case "pulse":
    case "cross-wave":
    case "heart-wave":
    case "letter-t":
    case "letter-x":
    case "letter-o":
    case "thinking-dots":
    case "success":
    case "error":
    case "hourglass":
      return "breathing";
    case "center-out":
    case "converge":
    case "collapse":
    case "corners":
    case "sparkle":
    case "neural-network":
    case "connecting":
      return "bloom";
    case "spinner":
    case "orbit":
    case "spiral":
    case "snake":
    case "box-trace":
      return "radar";
    case "typewriter":
    case "row-scan":
    case "column-scan":
    case "searching":
    case "progress-bar":
    case "arrow-right":
    case "arrow-left":
      return "sweep";
    case "matrix":
    case "rain":
      return "random";
    case "glitch":
      return "random";
    case "equalizer":
    case "dna":
    case "sine":
      return "wave";
    case "cross":
      return "checkerboard";
    default:
      return fallbackPresetId;
  }
}

export function normalizeAnimation(
  animation: Partial<AnimationConfig> | undefined,
  grid: GridConfig,
  fallbackPresetId: MotionPresetId = "wave"
): AnimationConfig {
  const presetId = normalizeMotionPresetId(animation?.presetId, fallbackPresetId);
  const defaults = getDefaultMotionConfig(presetId);
  const merged = {
    presetId,
    mode: "wave" as const,
    direction: "right" as const,
    originX: Math.ceil(grid.cols / 2),
    originY: Math.ceil(grid.rows / 2),
    fps: 18,
    loop: true,
    durationMs: 1200,
    staggerMs: 120,
    segment: 4,
    easing: "ease-in-out" as const,
    style: "pulse-size" as const,
    inactiveStyle: "breathe" as const,
    scaleIntensity: 0.24,
    ...defaults,
    ...animation
  };

  return {
    ...merged,
    presetId,
    direction: normalizeDirection(merged.direction),
    originX: clamp(Math.round(merged.originX ?? Math.ceil(grid.cols / 2)), 1, grid.cols),
    originY: clamp(Math.round(merged.originY ?? Math.ceil(grid.rows / 2)), 1, grid.rows),
    fps: clamp(Math.round(merged.fps ?? 30), 1, 60),
    speed: clamp(Number(merged.speed ?? 1), .25, 3),
    durationMs: clamp(Math.round(merged.durationMs ?? 1200), 520, 4800),
    staggerMs: Math.max(0, Math.round(merged.staggerMs ?? 0)),
    scaleIntensity: clamp(Number(merged.scaleIntensity ?? 0.24), 0, 1)
  };
}

export function normalizeLoader(loader: LoaderComponent, index: number): LoaderComponent {
  const grid = sanitizeGrid(loader.pattern.grid);
  const animation = normalizeAnimation(loader.animation, grid, loader.animation.presetId ?? "wave");
  const activeCells = sanitizeActiveCells(loader.pattern.activeCells, grid);

  // With layers, the flat cells are re-derived from them (the layers are the source of truth).
  return layerOps.syncLayers({
    ...loader,
    id: loader.id ?? crypto.randomUUID(),
    name: loader.name || `Loader ${index + 1}`,
    kind: loader.sequenceId ? "sequence" : loader.kind ?? "custom",
    sequenceId: loader.sequenceId,
    sequenceIndex: loader.sequenceIndex,
    visible: loader.visible ?? true,
    artboard: {
      ...getArtboardPosition(index),
      ...(loader.artboard ?? {})
    },
    layout: {
      type: loader.layout?.type ?? "status-pill",
      width: loader.layout?.width ?? 220,
      height: loader.layout?.height ?? 56,
      paddingX: loader.layout?.paddingX ?? 18,
      paddingY: loader.layout?.paddingY ?? 14,
      gap: loader.layout?.gap ?? 12,
      align: loader.layout?.align ?? "left"
    },
    pattern: {
      ...loader.pattern,
      grid: cloneGrid(grid),
      activeCells,
      cellColors: sanitizeCellColors(loader.pattern.cellColors, activeCells),
      snapshots: (loader.pattern.snapshots ?? []).map((snapshot) => ({
        ...snapshot,
        rows: snapshot.rows ?? grid.rows,
        cols: snapshot.cols ?? grid.cols,
        presetId: snapshot.presetId ?? "custom"
      })),
      sourceType: "drawn",
      presetId: "custom",
      templateId: undefined
    },
    animation,
    style: {
      cellShape: normalizeCellShape(loader.style?.cellShape),
      radius: clamp(loader.style?.radius ?? 8, 0, grid.cellSize / 2),
      innerRadius: clamp(Number(loader.style?.innerRadius ?? 0.48), 0.2, 0.8),
      primaryColor: loader.style?.primaryColor ?? "#66BDFF",
      primaryAlpha: clamp(loader.style?.primaryAlpha ?? 1, 0, 1),
      secondaryColor: loader.style?.secondaryColor ?? "#B9E3FF",
      backgroundColor: loader.style?.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
      backgroundAlpha: clamp(loader.style?.backgroundAlpha ?? 1, 0, 1),
      glow: clamp(loader.style?.glow ?? 16, 0, 48),
      glowColor: loader.style?.glowColor,
      glowAlpha: clamp(loader.style?.glowAlpha ?? 1, 0, 1),
      shadow: loader.style?.shadow ?? true,
      backgroundStyle: loader.style?.backgroundStyle ?? "glass",
      containerRadius: loader.style?.containerRadius ?? 42
    },
    text: loader.text
      ? {
          ...loader.text,
          content: loader.text.content || loader.name || `Loader ${index + 1}`
        }
      : {
          content: loader.name || `Loader ${index + 1}`,
          enabled: false,
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: 0.04,
          color: "rgba(255,255,255,0.92)"
        },
    effects: {
      shimmer: loader.effects?.shimmer ?? false
    }
  });
}

export function normalizeProject(project: Project): Project {
  return {
    ...project,
    canvas: {
      zoom: project.canvas?.zoom ?? 1,
      panX: project.canvas?.panX ?? 0,
      panY: project.canvas?.panY ?? 0,
      background: project.canvas?.background ?? "dark-grid",
      previewMode: project.canvas?.previewMode ?? "split"
    },
    assets: {
      ...project.assets,
      patterns: (project.assets.patterns ?? []).map((pattern) => ({
        ...pattern,
        rows: clamp(Math.round(pattern.rows ?? DEFAULT_DRAWN_GRID.rows), MIN_GRID_SIZE, MAX_GRID_SIZE),
        cols: clamp(Math.round(pattern.cols ?? DEFAULT_DRAWN_GRID.cols), MIN_GRID_SIZE, MAX_GRID_SIZE),
        presetId: pattern.presetId ?? "custom",
        cellColors: sanitizeCellColors(pattern.cellColors, pattern.activeCells ?? [])
      })),
      templates: []
    },
    loaders: reindexSequenceLoaders(project.loaders.map((loader, index) => normalizeLoader(layerOps.sanitiseStoredLayers(loader), index)))
  };
}

/**
 * Brings a project stored by another version up to this one, or null when nothing usable is in it.
 * Artboards that cannot be read are left out (the caller keeps a backup of the stored text).
 */
export function migrateStoredProject(stored: Partial<Project>): Project | null {
  if (!Array.isArray(stored.loaders)) return null;
  const readable = stored.loaders.filter((loader, index) => {
    try {
      normalizeLoader(layerOps.sanitiseStoredLayers(loader), index);
      return true;
    } catch {
      return false;
    }
  });
  if (!readable.length) return null;
  try {
    return normalizeProject({
      ...(stored as Project),
      version: PROJECT_VERSION,
      assets: { patterns: Array.isArray(stored.assets?.patterns) ? stored.assets.patterns : [], templates: [] },
      loaders: readable
    });
  } catch {
    return null;
  }
}
