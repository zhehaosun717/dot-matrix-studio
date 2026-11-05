/** Frame sequences: importing an animation and adding / removing frames. */
import { saveProject } from "@/lib/persistence";
import * as layerOps from "@/core/layer-ops";
import type { EditorState, EditorSet, EditorGet } from "./types";
import { clamp, cloneGrid, sanitizeActiveCells, normalizeLoader } from "./normalize";
import { ARTBOARD_SIZE, SEQUENCE_FRAME_GAP, findNearbyArtboardPosition, sortSequenceFrames, reindexSequenceLoaders } from "./artboards";
import { createBlankCustomLoader } from "./project-helpers";

/** The most frames a sequence can have. */
export const MAX_SEQUENCE_FRAMES = 10;

export type SequenceSlice = Pick<EditorState, "importSequence" | "addSequenceFrame" | "removeSequenceFrame">;

export function createSequenceSlice(set: EditorSet, get: EditorGet): SequenceSlice {
  return {
    importSequence: (baseLoaderId, frames, fps) => {
      const state = get();
      const base = state.project.loaders.find((loader) => loader.id === baseLoaderId) ?? state.project.loaders[0];
      if (!base || !frames.length) return [];
      const sequenceId = crypto.randomUUID();
      const origin = findNearbyArtboardPosition(state.project.loaders, base);
      const grid = cloneGrid(base.pattern.grid);
      const created = frames.map((frame, index) => {
        const blank = createBlankCustomLoader(state.project.loaders.length + index, base, "sequence", sequenceId);
        const framed = {
          ...blank,
          name: `GIF ${index + 1}`,
          sequenceIndex: index,
          artboard: { x: origin.x + index * (ARTBOARD_SIZE + SEQUENCE_FRAME_GAP), y: origin.y, width: ARTBOARD_SIZE, height: ARTBOARD_SIZE },
          pattern: { ...blank.pattern, grid: cloneGrid(grid) },
          animation: { ...blank.animation, fps: clamp(Math.round(fps), 1, 30) }
        };
        return normalizeLoader(layerOps.replaceDrawing(framed, sanitizeActiveCells(frame.cells, grid), frame.colors), state.project.loaders.length + index);
      });
      const loaders = reindexSequenceLoaders([...state.project.loaders, ...created]);
      const project = { ...state.project, updatedAt: new Date().toISOString(), loaders };
      saveProject(project);
      set({ project, selectedLoaderId: created[0].id });
      return created.map((loader) => ({ loaderId: loader.id, layerId: loader.pattern.activeLayerId ?? layerOps.baseLayerId(loader) }));
    },
    addSequenceFrame: (sequenceId, afterLoaderId) =>
      set((state) => {
        const frames = sortSequenceFrames(state.project.loaders, sequenceId);
        if (!frames.length || frames.length >= MAX_SEQUENCE_FRAMES) {
          return {};
        }

        // A copy of the given frame (the last one by default), placed right after it.
        const base = afterLoaderId === undefined ? frames[frames.length - 1] : frames.find((frame) => frame.id === afterLoaderId);
        if (!base) {
          return {};
        }
        const baseIndex = base.sequenceIndex ?? frames.indexOf(base);
        const nextLoader = {
          ...createBlankCustomLoader(state.project.loaders.length, base, "sequence", sequenceId),
          name: base.name,
          // Between the copied frame and the next one; reindexing turns it into a whole position.
          sequenceIndex: baseIndex + 0.5,
          artboard: {
            x: base.artboard.x + ARTBOARD_SIZE + SEQUENCE_FRAME_GAP,
            y: base.artboard.y,
            width: ARTBOARD_SIZE,
            height: ARTBOARD_SIZE
          },
          pattern: {
            ...base.pattern,
            grid: cloneGrid(base.pattern.grid),
            activeCells: [...base.pattern.activeCells],
            snapshots: [...base.pattern.snapshots]
          },
          text: base.text
            ? {
                ...base.text,
                content: base.name
              }
            : base.text
        };
        const project = {
          ...state.project,
          updatedAt: new Date().toISOString(),
          loaders: reindexSequenceLoaders([...state.project.loaders, nextLoader])
        };

        saveProject(project);
        return {
          project,
          selectedLoaderId: nextLoader.id
        };
      }),
    removeSequenceFrame: (sequenceId, loaderId) =>
      set((state) => {
        const frames = sortSequenceFrames(state.project.loaders, sequenceId);
        if (frames.length <= 1) {
          return {};
        }

        // The given frame (the last one by default); its neighbour takes its place in the selection.
        const target = loaderId === undefined ? frames[frames.length - 1] : frames.find((frame) => frame.id === loaderId);
        if (!target) {
          return {};
        }
        const position = frames.indexOf(target);
        // Frames are laid out from the first one: when it goes, the new first frame takes its place.
        const newFirst = position === 0 ? frames[1] : null;
        const loaders = reindexSequenceLoaders(
          state.project.loaders
            .filter((loader) => loader.id !== target.id)
            .map((loader) => (loader.id === newFirst?.id ? { ...loader, artboard: { ...loader.artboard, x: target.artboard.x, y: target.artboard.y } } : loader))
        );
        const remainingFrames = sortSequenceFrames(loaders, sequenceId);
        const fallback = remainingFrames[Math.min(position, remainingFrames.length - 1)] ?? loaders[0];
        const project = {
          ...state.project,
          updatedAt: new Date().toISOString(),
          loaders
        };

        saveProject(project);
        return {
          project,
          selectedLoaderId: fallback?.id ?? ""
        };
      }),
  };
}
