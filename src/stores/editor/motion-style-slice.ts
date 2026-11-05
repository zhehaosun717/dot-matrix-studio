/** Motion, colours, glow, cell shape, grid size and layout of the selected artboard. */
import { normalizeCellShape } from "@/core/cell-shapes";
import { MAX_GRID_SIZE, MIN_SLIDER_GRID_SIZE } from "@/lib/grid-limits";
import { getDefaultMotionConfig } from "@/lib/motion-presets";
import { saveProject } from "@/lib/persistence";
import * as layerOps from "@/core/layer-ops";
import type { EditorState, EditorSet } from "./types";
import { clamp, cloneGrid, sanitizeGrid, sanitizeActiveCells, normalizeAnimation } from "./normalize";
import { updateSelectedLoader } from "./project-helpers";

export type MotionStyleSlice = Pick<EditorState, "setAnimationMode" | "setMotionPreset" | "setMotionOrigin" | "setDirection" | "setFps" | "setScaleIntensity" | "setSpeed" | "setAnimationStyle" | "setInactiveStyle" | "setPrimaryColor" | "applyBaseColorEverywhere" | "setPrimaryAlpha" | "setGlowEnabled" | "setGlowSize" | "setBackgroundColor" | "setBackgroundAlpha" | "setCellShape" | "setGridSize" | "setGridGap" | "setLayoutType" | "setLabel">;

export function createMotionStyleSlice(set: EditorSet): MotionStyleSlice {
  return {
    setAnimationMode: () => undefined,
    setMotionPreset: (presetId) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => {
          const defaults = getDefaultMotionConfig(presetId);
          const grid = loader.pattern.grid;

          return {
            ...loader,
            animation: normalizeAnimation(
              {
                ...loader.animation,
                ...defaults,
                fps: loader.animation.fps,
                inactiveStyle: loader.animation.inactiveStyle,
                originX: clamp(loader.animation.originX || Math.ceil(grid.cols / 2), 1, grid.cols),
                originY: clamp(loader.animation.originY || Math.ceil(grid.rows / 2), 1, grid.rows)
              },
              grid,
              presetId
            )
          };
        });

        saveProject(project);
        return { project };
      }),
    setMotionOrigin: (axis, value) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          animation: {
            ...loader.animation,
            originX: axis === "x" ? clamp(Math.round(value), 1, loader.pattern.grid.cols) : loader.animation.originX,
            originY: axis === "y" ? clamp(Math.round(value), 1, loader.pattern.grid.rows) : loader.animation.originY
          }
        }));

        saveProject(project);
        return { project };
      }),
    setDirection: (direction) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          animation: {
            ...loader.animation,
            direction
          }
        }));

        saveProject(project);
        return { project };
      }),
    setFps: (value) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          animation: {
            ...loader.animation,
            fps: clamp(Math.round(value), 1, 30)
          }
        }), { updateSequence: true });

        saveProject(project);
        return { project };
      }),
    setScaleIntensity: (value) => set((state) => {
      const project = updateSelectedLoader(state.project, state.selectedLoaderId, loader => ({...loader, animation: {...loader.animation, scaleIntensity: clamp(value, 0, 1)}}));
      saveProject(project); return {project};
    }),
    setSpeed: (value) => set((state) => {
      const project = updateSelectedLoader(state.project, state.selectedLoaderId, loader => ({...loader, animation: {...loader.animation, speed: clamp(value, .25, 3)}}));
      saveProject(project); return {project};
    }),
    setAnimationStyle: (value) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          animation: {
            ...loader.animation,
            style: value
          }
        }));

        saveProject(project);
        return { project };
      }),
    setInactiveStyle: (value) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          animation: {
            ...loader.animation,
            inactiveStyle: value
          }
        }), { updateSequence: true });

        saveProject(project);
        return { project };
      }),
    setPrimaryColor: (value) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          style: {
            ...loader.style,
            primaryColor: value
          }
        }), { updateSequence: true });

        saveProject(project);
        return { project };
      }),
    applyBaseColorEverywhere: () =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => layerOps.applyBaseColorEverywhere(loader), { updateSequence: true });
        saveProject(project);
        return { project };
      }),
    setPrimaryAlpha: (value) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          style: {
            ...loader.style,
            primaryAlpha: clamp(value, 0, 1)
          }
        }), { updateSequence: true });

        saveProject(project);
        return { project };
      }),
    setGlowEnabled: (value) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          style: {
            ...loader.style,
            shadow: value
          }
        }), { updateSequence: true });

        saveProject(project);
        return { project };
      }),
    setGlowSize: (value) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          style: {
            ...loader.style,
            glow: clamp(value, 0, 48)
          }
        }), { updateSequence: true });

        saveProject(project);
        return { project };
      }),
    setBackgroundColor: (value) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          style: {
            ...loader.style,
            backgroundColor: value
          }
        }), { updateSequence: true });

        saveProject(project);
        return { project };
      }),
    setBackgroundAlpha: (value) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          style: {
            ...loader.style,
            backgroundAlpha: clamp(value, 0, 1)
          }
        }), { updateSequence: true });

        saveProject(project);
        return { project };
      }),
    setCellShape: (value) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          style: {
            ...loader.style,
            cellShape: normalizeCellShape(value)
          }
        }), { updateSequence: true });

        saveProject(project);
        return { project };
      }),
    setGridSize: (size) =>
      set((state) => {
        const nextSize = clamp(Math.round(size), MIN_SLIDER_GRID_SIZE, MAX_GRID_SIZE);
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => {
          const nextGrid = sanitizeGrid({
            ...loader.pattern.grid,
            rows: nextSize,
            cols: nextSize
          });

          return {
            ...loader,
            pattern: {
              ...loader.pattern,
              grid: cloneGrid(nextGrid),
              activeCells: sanitizeActiveCells(loader.pattern.activeCells, nextGrid)
            },
            animation: normalizeAnimation(
              {
                ...loader.animation,
                originX: clamp(loader.animation.originX, 1, nextGrid.cols),
                originY: clamp(loader.animation.originY, 1, nextGrid.rows)
              },
              nextGrid,
              loader.animation.presetId
            ),
            style: {
              ...loader.style,
              radius: clamp(loader.style.radius, 0, nextGrid.cellSize / 2)
            }
          };
        }, { updateSequence: true });

        saveProject(project);
        return { project };
      }),
    setGridGap: (value) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => {
          const nextGrid = sanitizeGrid({
            ...loader.pattern.grid,
            gap: value
          });

          return {
            ...loader,
            pattern: {
              ...loader.pattern,
              grid: cloneGrid(nextGrid)
            }
          };
        }, { updateSequence: true });

        saveProject(project);
        return { project };
      }),
    setLayoutType: (type) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          layout: {
            ...loader.layout,
            type
          }
        }));

        saveProject(project);
        return { project };
      }),
    setLabel: (value) =>
      set((state) => {
        const project = updateSelectedLoader(state.project, state.selectedLoaderId, (loader) => ({
          ...loader,
          text: {
            ...(loader.text ?? {
              enabled: true,
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: 0.04,
              color: "rgba(255,255,255,0.92)"
            }),
            content: value,
            enabled: true
          }
        }));

        saveProject(project);
        return { project };
      }),
  };
}
