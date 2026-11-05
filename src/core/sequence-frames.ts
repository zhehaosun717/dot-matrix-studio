/** Frames of a sequence around the selected one: stepping through them and the onion-skin ghosts. */
import type { LoaderComponent } from "@/types/dot-motion";

/** Where a frame sits in its sequence, and the frames before and after it (no wrap-around). */
export function frameNeighbours(frames: readonly LoaderComponent[], frameId: string) {
  const index = frames.findIndex((frame) => frame.id === frameId);
  return {
    index,
    previous: index > 0 ? frames[index - 1] : null,
    next: index >= 0 && index < frames.length - 1 ? frames[index + 1] : null
  };
}

/** The frame `step` places away from the given one, or null at either end. */
export function steppedFrame(frames: readonly LoaderComponent[], frameId: string, step: number): LoaderComponent | null {
  const index = frames.findIndex((frame) => frame.id === frameId);
  if (index < 0) return null;
  return frames[index + step] ?? null;
}

/** Which neighbour lights a cell: the previous frame, the next one, or both. */
export type OnionGhost = "previous" | "next" | "both";

/** Cells lit in the previous and / or next frame, for drawing them faintly under the current one. */
export function onionGhosts(previous: readonly number[] | null, next: readonly number[] | null): Map<number, OnionGhost> {
  const ghosts = new Map<number, OnionGhost>();
  for (const cell of previous ?? []) ghosts.set(cell, "previous");
  for (const cell of next ?? []) ghosts.set(cell, ghosts.has(cell) ? "both" : "next");
  return ghosts;
}
