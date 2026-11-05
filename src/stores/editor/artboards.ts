/** Artboard placement on the canvas and sequence frame ordering. */
import type { LoaderComponent } from "@/types/dot-motion";

export const ARTBOARD_SIZE = 420;
export const SEQUENCE_FRAME_GAP = 28;

export function getArtboardPosition(index: number) {
  const columns = 3;
  const baseX = 120;
  const baseY = 140;
  const gapX = 460;
  const gapY = 520;
  const col = index % columns;
  const row = Math.floor(index / columns);

  return {
    x: baseX + col * gapX,
    y: baseY + row * gapY,
    width: ARTBOARD_SIZE,
    height: ARTBOARD_SIZE
  };
}

export function artboardsOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
  margin = 44
) {
  return !(
    left.x + left.width + margin <= right.x ||
    right.x + right.width + margin <= left.x ||
    left.y + left.height + margin <= right.y ||
    right.y + right.height + margin <= left.y
  );
}

export function findNearbyArtboardPosition(loaders: LoaderComponent[], baseLoader?: LoaderComponent) {
  const base = baseLoader?.artboard ?? loaders[loaders.length - 1]?.artboard ?? getArtboardPosition(0);
  const step = ARTBOARD_SIZE + 72;
  const candidates: Array<{ x: number; y: number; width: number; height: number }> = [
    { x: base.x + step, y: base.y, width: ARTBOARD_SIZE, height: ARTBOARD_SIZE },
    { x: base.x, y: base.y + step, width: ARTBOARD_SIZE, height: ARTBOARD_SIZE },
    { x: base.x - step, y: base.y, width: ARTBOARD_SIZE, height: ARTBOARD_SIZE },
    { x: base.x, y: base.y - step, width: ARTBOARD_SIZE, height: ARTBOARD_SIZE },
    { x: base.x + step, y: base.y + step, width: ARTBOARD_SIZE, height: ARTBOARD_SIZE },
    { x: base.x + step, y: base.y - step, width: ARTBOARD_SIZE, height: ARTBOARD_SIZE },
    { x: base.x - step, y: base.y + step, width: ARTBOARD_SIZE, height: ARTBOARD_SIZE },
    { x: base.x - step, y: base.y - step, width: ARTBOARD_SIZE, height: ARTBOARD_SIZE }
  ];

  for (let ring = 2; ring <= 6; ring += 1) {
    candidates.push(
      { x: base.x + step * ring, y: base.y, width: ARTBOARD_SIZE, height: ARTBOARD_SIZE },
      { x: base.x, y: base.y + step * ring, width: ARTBOARD_SIZE, height: ARTBOARD_SIZE },
      { x: base.x + step * ring, y: base.y + step, width: ARTBOARD_SIZE, height: ARTBOARD_SIZE },
      { x: base.x + step, y: base.y + step * ring, width: ARTBOARD_SIZE, height: ARTBOARD_SIZE }
    );
  }

  return candidates.find((candidate) => loaders.every((loader) => !artboardsOverlap(candidate, loader.artboard))) ?? getArtboardPosition(loaders.length);
}

export function sortSequenceFrames(loaders: LoaderComponent[], sequenceId: string) {
  return loaders
    .filter((loader) => loader.sequenceId === sequenceId)
    .sort((left, right) => (left.sequenceIndex ?? 0) - (right.sequenceIndex ?? 0));
}

export function reindexSequenceLoaders(loaders: LoaderComponent[]) {
  const sequenceIds = [...new Set(loaders.map((loader) => loader.sequenceId).filter(Boolean))] as string[];
  let nextLoaders = loaders;

  sequenceIds.forEach((sequenceId) => {
    const frames = sortSequenceFrames(nextLoaders, sequenceId);
    const firstFrame = frames[0];
    nextLoaders = nextLoaders.map((loader) => {
      if (loader.sequenceId !== sequenceId) {
        return loader;
      }

      const sequenceIndex = frames.findIndex((frame) => frame.id === loader.id);
      const safeIndex = Math.max(0, sequenceIndex);
      return {
        ...loader,
        kind: "sequence",
        sequenceIndex: safeIndex,
        artboard: firstFrame
          ? {
              ...loader.artboard,
              x: firstFrame.artboard.x + safeIndex * (ARTBOARD_SIZE + SEQUENCE_FRAME_GAP),
              y: firstFrame.artboard.y,
              width: ARTBOARD_SIZE,
              height: ARTBOARD_SIZE
            }
          : loader.artboard
      };
    });
  });

  return nextLoaders;
}
