/** Project and artboards: loading, selection, adding / copying / deleting / moving artboards, view and export settings. */
import { createMockProject, PROJECT_VERSION } from "@/lib/mock-project";
import { loadProject, saveProject } from "@/lib/persistence";
import type { EditorState, EditorSet, EditorGet } from "./types";
import { normalizeProject } from "./normalize";
import { findNearbyArtboardPosition, reindexSequenceLoaders } from "./artboards";
import { createBlankCustomLoader, cloneLoader, updateSelectedLoader } from "./project-helpers";

export const initialProject = normalizeProject(createMockProject());

export type ProjectSlice = Pick<EditorState, "hydrate" | "selectLoader" | "clearSelection" | "addLoader" | "copySelectedLoader" | "pasteLoader" | "duplicateSelectedLoader" | "deleteSelectedLoader" | "moveLoader" | "moveLoaders" | "renameLoader" | "setExportFormat" | "togglePreview" | "enterFocusMode" | "exitFocusMode" | "applyLoaderTemplate" | "setCanvasView" | "resetCanvasView">;

export function createProjectSlice(set: EditorSet, get: EditorGet): ProjectSlice {
  return {
    hydrate: () => {
      const persisted = loadProject();
      if (persisted && persisted.version === PROJECT_VERSION) {
        const normalized = normalizeProject(persisted);
        set({
          hydrated: true,
          project: normalized,
          selectedLoaderId: normalized.loaders[0]?.id ?? "",
          focusModeLoaderId: null
        });
        return;
      }

      saveProject(initialProject);
      set({
        hydrated: true,
        project: initialProject,
        selectedLoaderId: initialProject.loaders[0]?.id ?? "",
        focusModeLoaderId: null
      });
    },
    selectLoader: (loaderId) => set({ selectedLoaderId: loaderId }),
    clearSelection: () => set({ selectedLoaderId: "", focusModeLoaderId: null }),
    addLoader: (kind = "custom") =>
      set((state) => {
        const base =
          state.project.loaders.find((loader) => loader.id === state.selectedLoaderId) ??
          state.project.loaders[state.project.loaders.length - 1];
        const sequenceId = kind === "sequence" ? crypto.randomUUID() : undefined;
        const loader = createBlankCustomLoader(state.project.loaders.length, base, kind, sequenceId);
        const nextLoader = {
          ...loader,
          animation: kind === "sequence"
            ? { ...loader.animation, fps: 6 }
            : loader.animation,
          artboard: findNearbyArtboardPosition(state.project.loaders, base)
        };
        const project = {
          ...state.project,
          updatedAt: new Date().toISOString(),
          loaders: [...state.project.loaders, nextLoader]
        };

        saveProject(project);
        return {
          project,
          selectedLoaderId: nextLoader.id
        };
      }),
    copySelectedLoader: () =>
      set((state) => ({
        clipboardLoader: state.project.loaders.find((loader) => loader.id === state.selectedLoaderId) ?? null
      })),
    pasteLoader: () =>
      set((state) => {
        const source =
          state.clipboardLoader ??
          state.project.loaders.find((loader) => loader.id === state.selectedLoaderId) ??
          state.project.loaders[0];
        if (!source) {
          return {};
        }

        const nextLoader = {
          ...cloneLoader(source, state.project.loaders.length),
          artboard: findNearbyArtboardPosition(state.project.loaders, source)
        };
        const project = {
          ...state.project,
          updatedAt: new Date().toISOString(),
          loaders: [...state.project.loaders, nextLoader]
        };

        saveProject(project);
        return {
          project,
          selectedLoaderId: nextLoader.id
        };
      }),
    duplicateSelectedLoader: () => {
      get().copySelectedLoader();
      get().pasteLoader();
    },
    deleteSelectedLoader: () =>
      set((state) => {
        if (state.project.loaders.length <= 1) {
          return {};
        }

        const currentIndex = state.project.loaders.findIndex((loader) => loader.id === state.selectedLoaderId);
        if (currentIndex === -1) {
          return {};
        }

        const currentLoader = state.project.loaders[currentIndex];
        const loaders = currentLoader.sequenceId
          ? state.project.loaders.filter((loader) => loader.sequenceId !== currentLoader.sequenceId)
          : state.project.loaders.filter((loader) => loader.id !== state.selectedLoaderId);
        if (!loaders.length) {
          return {};
        }
        const fallback = loaders[Math.max(0, currentIndex - 1)] ?? loaders[0];
        const project = {
          ...state.project,
          updatedAt: new Date().toISOString(),
          loaders: reindexSequenceLoaders(loaders)
        };

        saveProject(project);
        return {
          project,
          selectedLoaderId: fallback?.id ?? ""
        };
      }),
    moveLoader: (loaderId, position) =>
      set((state) => {
        const project = {
          ...state.project,
          updatedAt: new Date().toISOString(),
          loaders: state.project.loaders.map((loader) =>
            loader.id === loaderId
              ? {
                  ...loader,
                  artboard: {
                    ...loader.artboard,
                    x: position.x,
                    y: position.y
                  }
                }
              : loader
          )
        };

        saveProject(project);
        return { project };
      }),
    moveLoaders: (positions) =>
      set((state) => {
        const updates = new Map(positions.map((position) => [position.id, position]));
        if (!updates.size) {
          return {};
        }

        let changed = false;
        const loaders = state.project.loaders.map((loader) => {
          const nextPosition = updates.get(loader.id);
          if (!nextPosition) {
            return loader;
          }

          changed = true;
          return {
            ...loader,
            artboard: {
              ...loader.artboard,
              x: nextPosition.x,
              y: nextPosition.y
            }
          };
        });

        if (!changed) {
          return {};
        }

        const project = {
          ...state.project,
          updatedAt: new Date().toISOString(),
          loaders
        };

        saveProject(project);
        return { project };
      }),
    renameLoader: (name) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          name,
          text: loader.text
            ? {
                ...loader.text,
                content: name
              }
            : loader.text
        }), { updateSequence: true });

        saveProject(project);
        return { project };
      }),
    setExportFormat: (format) => set({ exportFormat: format }),
    togglePreview: () => set((state) => ({ isPreviewing: !state.isPreviewing })),
    enterFocusMode: (loaderId) => set((state) => ({ focusModeLoaderId: loaderId ?? state.selectedLoaderId })),
    exitFocusMode: () => set({ focusModeLoaderId: null }),
    applyLoaderTemplate: () => undefined,
    setCanvasView: (view) =>
      set((state) => {
        const project = {
          ...state.project,
          canvas: {
            ...state.project.canvas,
            ...view
          }
        };

        saveProject(project);
        return { project };
      }),
    resetCanvasView: () =>
      set((state) => {
        const project = {
          ...state.project,
          canvas: {
            ...state.project.canvas,
            zoom: 1,
            panX: 0,
            panY: 0
          }
        };

        saveProject(project);
        return { project };
      })
  };
}
