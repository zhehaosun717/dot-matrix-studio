"use client";

import { create } from "zustand";
import { createDrawingSlice } from "@/stores/editor/drawing-slice";
import { createLayerSlice } from "@/stores/editor/layer-slice";
import { createMotionStyleSlice } from "@/stores/editor/motion-style-slice";
import { createProjectSlice, initialProject } from "@/stores/editor/project-slice";
import { createSequenceSlice } from "@/stores/editor/sequence-slice";
import type { EditorState } from "@/stores/editor/types";

/** The editor store, assembled from one slice per area (src/stores/editor/*). */
export const useEditorStore = create<EditorState>((set, get) => ({
  hydrated: false,
  project: initialProject,
  selectedLoaderId: initialProject.loaders[0]?.id ?? "",
  focusModeLoaderId: null,
  clipboardLoader: null,
  exportFormat: "web",
  isPreviewing: false,
  ...createProjectSlice(set, get),
  ...createDrawingSlice(set),
  ...createLayerSlice(set),
  ...createSequenceSlice(set, get),
  ...createMotionStyleSlice(set)
}));

export function useSelectedLoader() {
  return useEditorStore((state) =>
    state.project.loaders.find((loader) => loader.id === state.selectedLoaderId) ?? state.project.loaders[0]
  );
}
