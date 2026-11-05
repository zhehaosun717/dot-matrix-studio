/** Frame sequences: importing an animation and adding / removing frames. */
import { saveProject } from "@/lib/persistence";
import * as layerOps from "@/core/layer-ops";
import type { EditorState, EditorSet, EditorGet } from "./types";
import { clamp, cloneGrid, sanitizeActiveCells, normalizeLoader } from "./normalize";
import { ARTBOARD_SIZE, SEQUENCE_FRAME_GAP, findNearbyArtboardPosition, sortSequenceFrames, reindexSequenceLoaders } from "./artboards";
import { createBlankCustomLoader } from "./project-helpers";

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
    addSequenceFrame: (sequenceId) =>
      set((state) => {
        const frames = sortSequenceFrames(state.project.loaders, sequenceId);
        if (!frames.length || frames.length >= 10) {
          return {};
        }

        const base = frames[frames.length - 1];
        const nextLoader = {
          ...createBlankCustomLoader(state.project.loaders.length, base, "sequence", sequenceId),
          name: base.name,
          sequenceIndex: frames.length,
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
    removeSequenceFrame: (sequenceId) =>
      set((state) => {
        const frames = sortSequenceFrames(state.project.loaders, sequenceId);
        if (frames.length <= 1) {
          return {};
        }

        const target = frames[frames.length - 1];
        const loaders = reindexSequenceLoaders(state.project.loaders.filter((loader) => loader.id !== target.id));
        const remainingFrames = sortSequenceFrames(loaders, sequenceId);
        const fallback = remainingFrames[remainingFrames.length - 1] ?? loaders[0];
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
