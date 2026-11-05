/**
 * Workspace / Document -> today's Project and LoaderComponents, so the existing renderers (editor,
 * previews, src/lib/idotmatrix) can draw a document unchanged. Fields the document model does not keep
 * (layout, text, effects, easing, ...) get the values every current project has (see normalizeLoader).
 */
import { celPixels, colorOf, frameCells } from "@/core/document/pixels";
import { celKey, Document, LibraryItem, Workspace } from "@/core/document/types";
import type { LoaderComponent, PatternLayer, PatternSnapshot, Project } from "@/types/dot-motion";

/** Artboards are this big on the canvas; frames of a sequence sit side by side with this gap. */
const ARTBOARD_SIZE = 420;
const SEQUENCE_FRAME_GAP = 28;

/** The playback rate today's renderers use for a document. */
export function documentFps(doc: Document): number {
  return doc.playback === "frames" ? Math.round(1000 / Math.max(1, doc.frames[0].durationMs)) : doc.motion.fps;
}

function layersOfFrame(doc: Document, frameId: string): PatternLayer[] {
  return doc.layers.map((layer) => {
    const cel = doc.cels[celKey(frameId, layer.id)];
    const pixels: Record<string, string> = {};
    if (cel) {
      for (const pixel of celPixels(cel)) {
        const color = colorOf(doc.palette, pixel.index);
        if (color !== null) pixels[`${pixel.x - cel.x},${pixel.y - cel.y}`] = color;
      }
    }
    return {
      id: layer.id,
      name: layer.name,
      visible: layer.visible && cel?.visible !== false,
      offsetX: cel?.x ?? 0,
      offsetY: cel?.y ?? 0,
      pixels
    };
  });
}

/** One LoaderComponent per frame: a sequence for "frames" playback, a single artboard for "motion". */
export function documentToLoaders(doc: Document): LoaderComponent[] {
  const sequence = doc.playback === "frames";
  const { render, motion } = doc;
  return doc.frames.map((frame, index) => {
    const { activeCells, cellColors } = frameCells(doc, index);
    return {
      id: sequence ? frame.id : doc.id,
      name: frame.name ?? doc.name,
      kind: sequence ? "sequence" : "custom",
      sequenceId: sequence ? doc.id : undefined,
      sequenceIndex: sequence ? index : undefined,
      visible: true,
      artboard: {
        x: doc.position.x + (sequence ? index * (ARTBOARD_SIZE + SEQUENCE_FRAME_GAP) : 0),
        y: doc.position.y,
        width: ARTBOARD_SIZE,
        height: ARTBOARD_SIZE
      },
      layout: { type: "status-pill", width: 220, height: 56, paddingX: 18, paddingY: 14, gap: 12, align: "left" },
      pattern: {
        grid: { rows: doc.size.height, cols: doc.size.width, cellSize: render.cellSize, gap: render.gap },
        activeCells,
        cellColors,
        layers: layersOfFrame(doc, frame.id),
        activeLayerId: doc.activeLayerId,
        snapshots: [],
        sourceType: "drawn",
        presetId: "custom"
      },
      animation: {
        presetId: motion.presetId,
        mode: "wave",
        direction: motion.direction,
        originX: motion.origin.x,
        originY: motion.origin.y,
        fps: documentFps(doc),
        loop: true,
        durationMs: motion.durationMs,
        staggerMs: 0,
        segment: 4,
        easing: "ease-in-out",
        style: motion.style,
        inactiveStyle: motion.inactiveStyle,
        scaleIntensity: motion.scaleIntensity,
        speed: motion.speed
      },
      style: {
        cellShape: render.cellShape,
        radius: Math.min(8, render.cellSize / 2),
        innerRadius: render.innerRadius,
        primaryColor: render.baseColor,
        primaryAlpha: render.baseAlpha,
        secondaryColor: "#B9E3FF",
        backgroundColor: render.background.color,
        backgroundAlpha: render.background.alpha,
        glow: render.glow.size,
        glowAlpha: 1,
        shadow: render.glow.enabled,
        backgroundStyle: "glass",
        containerRadius: 42
      },
      text: { content: frame.name ?? doc.name, enabled: false, fontSize: 14, fontWeight: 600, letterSpacing: 0.04, color: "rgba(255,255,255,0.92)" },
      effects: { shimmer: false }
    };
  });
}

/** A library item as today's saved pattern (every lit cell with its colour baked in, as the editor saves them). */
export function libraryItemToPattern(item: LibraryItem): PatternSnapshot {
  const activeCells: number[] = [];
  const cellColors: Record<string, string> = {};
  item.pixels.forEach((index, cell) => {
    const color = colorOf(item.palette, index);
    if (color === null) return;
    activeCells.push(cell);
    if (color) cellColors[cell] = color;
  });
  return { id: item.id, name: item.name, activeCells, rows: item.size.height, cols: item.size.width, presetId: "custom", cellColors };
}

export function workspaceToProject(workspace: Workspace, version: string): Project {
  return {
    id: workspace.id,
    name: workspace.name,
    version,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    canvas: { ...workspace.view, background: "dark-grid", previewMode: "split" },
    loaders: workspace.documents.flatMap(documentToLoaders),
    assets: { patterns: workspace.library.map(libraryItemToPattern), templates: [] },
    settings: { autosave: true, theme: "dark" }
  };
}
