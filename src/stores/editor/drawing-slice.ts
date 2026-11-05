/** Pixels: painting, importing cells, filling, pattern presets, snapshots and the pattern library. */
import { createLayer } from "@/core/layers";
import { buildPatternCells } from "@/lib/pattern-presets";
import { saveProject } from "@/lib/persistence";
import * as layerOps from "@/core/layer-ops";
import type { PatternSnapshot } from "@/types/dot-motion";
import type { EditorState, EditorSet } from "./types";
import { DEFAULT_DRAWN_GRID, bakeCellColors, sanitizeActiveCells, normalizeLoader } from "./normalize";
import { updateSelectedLoader, createEditLoader } from "./project-helpers";

export type DrawingSlice = Pick<EditorState, "setCellsActiveForLoader" | "transformLoaderCells" | "importCellsForLoaders" | "importCellsForLoader" | "setPatternSourceType" | "fillGrid" | "applyPatternPreset" | "applySavedPattern" | "captureSnapshot" | "clearSnapshots" | "savePatternToLibrary" | "deleteSavedPattern">;

export function createDrawingSlice(set: EditorSet): DrawingSlice {
  const editLoader = createEditLoader(set);
  return {
    setCellsActiveForLoader: (loaderId, cells, active, color) =>
      editLoader(loaderId, (loader) => layerOps.paintCells(loader, cells, active, color)),
    transformLoaderCells: (loaderId, op) => editLoader(loaderId, (loader) => layerOps.transformActiveLayer(loader, op)),
    importCellsForLoaders: (entries) =>
      set((state) => {
        const byId = new Map(entries.map((entry) => [entry.loaderId, entry]));
        const project = {
          ...state.project,
          updatedAt: new Date().toISOString(),
          loaders: state.project.loaders.map((loader, index) => {
            const entry = byId.get(loader.id);
            if (!entry) return loader;
            const cells = sanitizeActiveCells(entry.cells, loader.pattern.grid);
            return normalizeLoader(layerOps.putCellsOnLayer(loader, cells, entry.colors, { layerId: entry.layerId, name: "" }).loader, index);
          })
        };

        saveProject(project);
        return { project };
      }),
    importCellsForLoader: (loaderId, cells, colors, target) => {
      let layerId: string | null = null;
      editLoader(loaderId, (loader) => {
        const result = layerOps.putCellsOnLayer(loader, sanitizeActiveCells(cells, loader.pattern.grid), colors, target);
        layerId = result.layerId;
        return result.loader;
      });
      return layerId;
    },
    setPatternSourceType: () => undefined,
    fillGrid: (filled) => set((state) => {
      const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => layerOps.fillActiveLayer(loader, filled));
      saveProject(project); return {project};
    }),
    applyPatternPreset: (presetId) =>
      set((state) => {
        // A new pattern replaces the drawing (all layers), including its colours.
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) =>
          layerOps.replaceDrawing(loader, buildPatternCells(presetId, loader.pattern.grid.rows, loader.pattern.grid.cols))
        );

        saveProject(project);
        return { project };
      }),
    applySavedPattern: (patternId) =>
      set((state) => {
        const savedPattern = state.project.assets.patterns.find((pattern) => pattern.id === patternId);
        if (!savedPattern) {
          return {};
        }

        const savedCols = savedPattern.cols ?? DEFAULT_DRAWN_GRID.cols;
        const savedRows = savedPattern.rows ?? DEFAULT_DRAWN_GRID.rows;
        const pixels = Object.fromEntries(savedPattern.activeCells.map((cell) => [`${cell % savedCols},${Math.floor(cell / savedCols)}`, savedPattern.cellColors?.[cell] ?? ""]));
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => {
          const { rows, cols } = loader.pattern.grid;
          const { layers } = layerOps.layersOf(loader);
          if (layers.length >= layerOps.MAX_LAYERS) return loader;
          // Loaded as its own layer, centred: nothing already drawn is replaced, and it can be moved.
          const layer = { ...createLayer(savedPattern.name ?? "", pixels), offsetX: Math.floor((cols - savedCols) / 2), offsetY: Math.floor((rows - savedRows) / 2) };
          return layerOps.withLayers(loader, [...layers, layer], layer.id);
        });

        saveProject(project);
        return { project };
      }),
    captureSnapshot: () =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          pattern: {
            ...loader.pattern,
            snapshots: [
              ...loader.pattern.snapshots,
              {
                id: crypto.randomUUID(),
                name: `Frame ${loader.pattern.snapshots.length + 1}`,
                activeCells: [...loader.pattern.activeCells],
                rows: loader.pattern.grid.rows,
                cols: loader.pattern.grid.cols,
                presetId: "custom",
                cellColors: bakeCellColors(loader)
              }
            ]
          }
        }));

        saveProject(project);
        return { project };
      }),
    clearSnapshots: () =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          pattern: {
            ...loader.pattern,
            snapshots: []
          }
        }));

        saveProject(project);
        return { project };
      }),
    savePatternToLibrary: () =>
      set((state) => {
        const loader = state.project.loaders.find((item) => item.id === state.selectedLoaderId) ?? state.project.loaders[0];
        if (!loader) {
          return {};
        }

        const nextPattern: PatternSnapshot = {
          id: crypto.randomUUID(),
          name: `${loader.name} Pattern ${state.project.assets.patterns.length + 1}`,
          activeCells: [...loader.pattern.activeCells],
          rows: loader.pattern.grid.rows,
          cols: loader.pattern.grid.cols,
          presetId: "custom",
          cellColors: bakeCellColors(loader)
        };
        const project = {
          ...state.project,
          updatedAt: new Date().toISOString(),
          assets: {
            ...state.project.assets,
            patterns: [nextPattern, ...state.project.assets.patterns]
          }
        };

        saveProject(project);
        return { project };
      }),
    deleteSavedPattern: (patternId) =>
      set((state) => {
        const project = {
          ...state.project,
          updatedAt: new Date().toISOString(),
          assets: {
            ...state.project.assets,
            patterns: state.project.assets.patterns.filter((pattern) => pattern.id !== patternId)
          }
        };

        saveProject(project);
        return { project };
      }),
  };
}
