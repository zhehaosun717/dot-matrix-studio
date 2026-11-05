"use client";

import { useMemo } from "react";
import { LoaderComponent } from "@/types/dot-motion";

export type PreviewScope = "none" | "selected" | "all";

/** Canvas size and the frame sequences on it: groups, the selected sequence's outline, what is previewed. */
export function useCanvasLayout(loaders: LoaderComponent[], selectedSequenceId: string | undefined, previewScope: PreviewScope) {
  const canvasBounds = useMemo(() => {
    const right = Math.max(...loaders.map((item) => item.artboard.x + item.artboard.width), 1800);
    const bottom = Math.max(...loaders.map((item) => item.artboard.y + item.artboard.height), 1200);

    return {
      width: right + 420,
      height: bottom + 360
    };
  }, [loaders]);

  const sequenceGroups = useMemo(() => {
    const groups = new Map<string, LoaderComponent[]>();
    loaders.forEach((loader) => {
      if (!loader.sequenceId) {
        return;
      }
      const frames = groups.get(loader.sequenceId) ?? [];
      frames.push(loader);
      groups.set(loader.sequenceId, frames);
    });
    groups.forEach((frames) => {
      frames.sort((left, right) => (left.sequenceIndex ?? 0) - (right.sequenceIndex ?? 0));
    });
    return groups;
  }, [loaders]);
  const sequenceFrameCount = selectedSequenceId ? sequenceGroups.get(selectedSequenceId)?.length ?? 0 : 0;
  const previewingSequenceIds = useMemo(() => {
    if (previewScope === "all") {
      return new Set(sequenceGroups.keys());
    }
    if (previewScope === "selected" && selectedSequenceId) {
      return new Set([selectedSequenceId]);
    }
    return new Set<string>();
  }, [previewScope, selectedSequenceId, sequenceGroups]);
  const selectedSequenceBounds = useMemo(() => {
    if (!selectedSequenceId) {
      return null;
    }

    const frames = sequenceGroups.get(selectedSequenceId) ?? [];
    if (!frames.length) {
      return null;
    }

    const boundsFrames = previewingSequenceIds.has(selectedSequenceId) ? [frames[0]] : frames;
    const padding = 8;
    const left = Math.min(...boundsFrames.map((loader) => loader.artboard.x)) - padding;
    const top = Math.min(...boundsFrames.map((loader) => loader.artboard.y)) - padding;
    const right = Math.max(...boundsFrames.map((loader) => loader.artboard.x + loader.artboard.width)) + padding;
    const bottom = Math.max(...boundsFrames.map((loader) => loader.artboard.y + loader.artboard.height)) + padding;

    return {
      left,
      top,
      width: right - left,
      height: bottom - top
    };
  }, [previewingSequenceIds, selectedSequenceId, sequenceGroups]);
  const visibleLoaders = useMemo(
    () => loaders.filter((loader) => !loader.sequenceId || !previewingSequenceIds.has(loader.sequenceId)),
    [previewingSequenceIds, loaders]
  );
  const sequencePreviewGroups = useMemo(
    () => [...previewingSequenceIds].map((sequenceId) => sequenceGroups.get(sequenceId) ?? []).filter((frames) => frames.length > 0),
    [previewingSequenceIds, sequenceGroups]
  );

  return { canvasBounds, sequenceGroups, sequenceFrameCount, selectedSequenceBounds, visibleLoaders, sequencePreviewGroups };
}

export type CanvasLayout = ReturnType<typeof useCanvasLayout>;
