/** Creating, cloning and updating loaders inside a project. */
import { normalizeCellShape } from "@/core/cell-shapes";
import { getDefaultMotionConfig } from "@/lib/motion-presets";
import { saveProject } from "@/lib/persistence";
import type { LoaderKind, LoaderComponent, Project } from "@/types/dot-motion";
import type { EditorSet } from "./types";
import { DEFAULT_DRAWN_GRID, DEFAULT_BACKGROUND_COLOR, clamp, sanitizeGrid, normalizeAnimation, normalizeLoader } from "./normalize";
import { getArtboardPosition } from "./artboards";

export function shouldUpdateWithSelected(loader: LoaderComponent, selectedLoader: LoaderComponent | undefined, updateSequence = false) {
  if (!selectedLoader) {
    return false;
  }

  return loader.id === selectedLoader.id || Boolean(updateSequence && selectedLoader.sequenceId && loader.sequenceId === selectedLoader.sequenceId);
}

export function createBlankCustomLoader(index: number, baseLoader?: LoaderComponent, kind: LoaderKind = "custom", sequenceId?: string): LoaderComponent {
  const grid = sanitizeGrid(baseLoader?.pattern.grid ?? DEFAULT_DRAWN_GRID);
  const animation = normalizeAnimation(
    {
      ...(baseLoader?.animation ?? getDefaultMotionConfig("wave")),
      presetId: baseLoader?.animation.presetId ?? "wave",
      originX: Math.ceil(grid.cols / 2),
      originY: Math.ceil(grid.rows / 2)
    },
    grid,
    baseLoader?.animation.presetId ?? "wave"
  );

  return normalizeLoader(
    {
      id: crypto.randomUUID(),
      name: `Loader ${index + 1}`,
      kind,
      sequenceId,
      sequenceIndex: kind === "sequence" ? 0 : undefined,
      visible: true,
      artboard: getArtboardPosition(index),
      layout: baseLoader?.layout ?? {
        type: "status-pill",
        width: 220,
        height: 56,
        paddingX: 18,
        paddingY: 14,
        gap: 12,
        align: "left"
      },
      pattern: {
        grid,
        activeCells: [],
        snapshots: [],
        sourceType: "drawn",
        presetId: "custom"
      },
      animation,
      style: {
        cellShape: normalizeCellShape(baseLoader?.style.cellShape),
        radius: clamp(baseLoader?.style.radius ?? 8, 0, grid.cellSize / 2),
        innerRadius: clamp(Number(baseLoader?.style.innerRadius ?? 0.48), 0.2, 0.8),
        primaryColor: baseLoader?.style.primaryColor ?? "#66BDFF",
        primaryAlpha: clamp(baseLoader?.style.primaryAlpha ?? 1, 0, 1),
        secondaryColor: baseLoader?.style.secondaryColor ?? "#B9E3FF",
        backgroundColor: baseLoader?.style.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
        backgroundAlpha: clamp(baseLoader?.style.backgroundAlpha ?? 1, 0, 1),
        glow: clamp(baseLoader?.style.glow ?? 16, 0, 48),
        glowColor: baseLoader?.style.glowColor,
        glowAlpha: clamp(baseLoader?.style.glowAlpha ?? 1, 0, 1),
        shadow: baseLoader?.style.shadow ?? true,
        backgroundStyle: baseLoader?.style.backgroundStyle ?? "glass",
        containerRadius: baseLoader?.style.containerRadius ?? 42
      },
      text: {
        content: `Loader ${index + 1}`,
        enabled: false,
        fontSize: 14,
        fontWeight: 600,
        letterSpacing: 0.04,
        color: "rgba(255,255,255,0.92)"
      },
      effects: {
        shimmer: false
      }
    },
    index
  );
}

export function cloneLoader(loader: LoaderComponent, index: number): LoaderComponent {
  return normalizeLoader(
    {
      ...loader,
      id: crypto.randomUUID(),
      name: `${loader.name} Copy`,
      kind: "custom",
      sequenceId: undefined,
      sequenceIndex: undefined,
      artboard: {
        ...loader.artboard,
        x: loader.artboard.x + 56,
        y: loader.artboard.y + 56
      },
      pattern: {
        ...loader.pattern,
        activeCells: [...loader.pattern.activeCells],
        snapshots: [...loader.pattern.snapshots]
      },
      animation: {
        ...loader.animation
      },
      style: {
        ...loader.style
      }
    },
    index
  );
}

export function updateSelectedLoader(
  project: Project,
  selectedLoaderId: string,
  update: (loader: LoaderComponent) => LoaderComponent,
  options: { updateSequence?: boolean } = {}
) {
  const selectedLoader = project.loaders.find((loader) => loader.id === selectedLoaderId);

  return {
    ...project,
    updatedAt: new Date().toISOString(),
    loaders: project.loaders.map((loader, index) => {
      if (!shouldUpdateWithSelected(loader, selectedLoader, options.updateSequence)) {
        return loader;
      }

      return normalizeLoader(update(loader), index);
    })
  };
}

export function updateLoaderById(
  project: Project,
  loaderId: string,
  update: (loader: LoaderComponent) => LoaderComponent
) {
  return {
    ...project,
    updatedAt: new Date().toISOString(),
    loaders: project.loaders.map((loader, index) => (
      loader.id === loaderId ? normalizeLoader(update(loader), index) : loader
    ))
  };
}

/** Applies one edit to one loader, normalises it and saves; returns nothing. */
export const createEditLoader = (set: EditorSet) => (loaderId: string, edit: (loader: LoaderComponent) => LoaderComponent) =>
  set((state) => {
    const project = updateLoaderById(state.project, loaderId, edit);
    saveProject(project);
    return { project };
  });
