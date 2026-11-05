"use client";

import { useMemo } from "react";
import { CanvasArtboard } from "@/components/editor/canvas-artboard";
import { FrameStrip } from "@/components/editor/frame-strip";
import { PanelPreview } from "@/components/editor/panel-preview";
import { SequencePreviewStage } from "@/components/editor/preview-stage";
import { SequenceGroupChrome } from "@/components/editor/sequence-group-chrome";
import type { CanvasLayout, PreviewScope } from "@/components/editor/use-canvas-layout";
import type { CanvasViewport } from "@/components/editor/use-canvas-viewport";
import { frameNeighbours, onionGhosts } from "@/core/sequence-frames";
import { Language, uiCopy } from "@/lib/ui-copy";
import { useDrawStore } from "@/stores/use-draw-store";
import { useEditorStore } from "@/stores/use-editor-store";
import { LoaderComponent, Project } from "@/types/dot-motion";

type EditorCanvasProps = {
  language: Language;
  project: Project;
  selectedLoaderId: string;
  selectedSequenceId: string | undefined;
  previewScope: PreviewScope;
  setPreviewScope: (scope: PreviewScope) => void;
  selectCanvasLoader: (loaderId: string) => void;
  layout: CanvasLayout;
  viewport: CanvasViewport;
};

/** The pannable, zoomable canvas with every artboard and frame sequence, and the fit-to-content button. */
export function EditorCanvas({
  language,
  project,
  selectedLoaderId,
  selectedSequenceId,
  previewScope,
  setPreviewScope,
  selectCanvasLoader,
  layout,
  viewport
}: EditorCanvasProps) {
  const setCellsActiveForLoader = useEditorStore((state) => state.setCellsActiveForLoader);
  const addSequenceFrame = useEditorStore((state) => state.addSequenceFrame);
  const removeSequenceFrame = useEditorStore((state) => state.removeSequenceFrame);
  const duplicateSelectedLoader = useEditorStore((state) => state.duplicateSelectedLoader);
  const deleteSelectedLoader = useEditorStore((state) => state.deleteSelectedLoader);
  const onionSkin = useDrawStore((state) => state.onionSkin);
  const canvas = project.canvas;
  const t = uiCopy[language];
  const { canvasBounds, sequenceGroups, sequenceFrameCount, selectedSequenceBounds, visibleLoaders, sequencePreviewGroups } = layout;
  const { viewportRef, isPanning, handleCanvasWheel, handleViewportPointerDown, handleViewportPointerMove, endPan, centerCanvasContent, revealBounds } = viewport;
  const selectedFrames = selectedSequenceId ? sequenceGroups.get(selectedSequenceId) : undefined;
  const { previous, next } = frameNeighbours(selectedFrames ?? [], selectedLoaderId);
  const selectedCols = selectedFrames?.find((frame) => frame.id === selectedLoaderId)?.pattern.grid.cols;
  // Neighbours on a different grid would not line up cell for cell; they are left out.
  const previousCells = previous && previous.pattern.grid.cols === selectedCols ? previous.pattern.activeCells : null;
  const nextCells = next && next.pattern.grid.cols === selectedCols ? next.pattern.activeCells : null;
  const ghosts = useMemo(
    () => (onionSkin && (previousCells || nextCells) ? onionGhosts(previousCells, nextCells) : null),
    [nextCells, onionSkin, previousCells]
  );

  const editingLoader = project.loaders.find((loader) => loader.id === selectedLoaderId) ?? project.loaders[0];

  function selectFrame(frameId: string) {
    selectCanvasLoader(frameId);
    const frame = project.loaders.find((loader) => loader.id === frameId);
    if (frame) revealBounds({ left: frame.artboard.x, top: frame.artboard.y, width: frame.artboard.width, height: frame.artboard.height });
  }

  return (
    <div className="builder-canvas-shell">
      <div
        className={`builder-canvas${isPanning ? " is-panning" : ""}`}
        ref={viewportRef}
        onWheel={handleCanvasWheel}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div
          className={`builder-canvas__surface${previewScope !== "none" ? " is-previewing" : ""}`}
          style={{
            width: canvasBounds.width,
            height: canvasBounds.height,
            transform: `translate(${canvas.panX}px, ${canvas.panY}px) scale(${canvas.zoom})`,
            ["--canvas-zoom" as string]: canvas.zoom,
            ["--inverse-canvas-zoom" as string]: Number((1 / canvas.zoom).toFixed(4))
          }}
        >
          {selectedSequenceBounds ? (
            <div
              className="sequence-selection-outline"
              style={{
                left: selectedSequenceBounds.left,
                top: selectedSequenceBounds.top,
                width: selectedSequenceBounds.width,
                height: selectedSequenceBounds.height
              }}
            />
          ) : null}
          {selectedSequenceId && selectedSequenceBounds ? (
            <SequenceGroupChrome
              bounds={selectedSequenceBounds}
              frameCount={sequenceFrameCount}
              canDelete={project.loaders.some((loader) => loader.sequenceId !== selectedSequenceId)}
              onAddFrame={() => {
                setPreviewScope("none");
                addSequenceFrame(selectedSequenceId, selectedLoaderId);
              }}
              onRemoveFrame={() => {
                setPreviewScope("none");
                removeSequenceFrame(selectedSequenceId, selectedLoaderId);
              }}
              onDuplicate={duplicateSelectedLoader}
              onDelete={deleteSelectedLoader}
              copy={t}
            />
          ) : null}
          {sequencePreviewGroups.map((frames) => {
            const first = frames[0];
            const sequenceSelected = Boolean(selectedSequenceId && first.sequenceId === selectedSequenceId);
            return (
              <div
                key={`sequence-preview-${first.sequenceId}`}
                role="button"
                tabIndex={0}
                data-artboard-interactive="true"
                data-artboard-id={first.id}
                aria-label={first.name}
                className={`canvas-artboard canvas-artboard--sequence-preview${sequenceSelected ? " is-selected is-sequence-selected" : ""}`}
                style={{
                  left: first.artboard.x,
                  top: first.artboard.y,
                  width: first.artboard.width,
                  height: first.artboard.height,
                  zIndex: sequenceSelected ? 4 : 1
                }}
                onClick={() => selectCanvasLoader(first.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectCanvasLoader(first.id);
                  }
                }}
              >
                <div className="canvas-artboard__frame">
                  <SequencePreviewStage
                    frames={frames}
                    showHint={false}
                    isAnimated={previewScope !== "none"}
                    variant="canvas"
                  />
                </div>
              </div>
            );
          })}
          {visibleLoaders.map((item) => (
            <CanvasArtboard
              key={item.id}
              loader={item}
              selected={item.id === selectedLoaderId}
              sequenceSelected={Boolean(selectedSequenceId && item.sequenceId === selectedSequenceId)}
              dimmed={false}
              previewMode={previewScope}
              editable={previewScope === "none" && (item.id === selectedLoaderId || Boolean(selectedSequenceId && item.sequenceId === selectedSequenceId))}
              onSelect={() => selectCanvasLoader(item.id)}
              onApplyCells={(cells, active, color) => setCellsActiveForLoader(item.id, cells, active, color)}
              onDuplicate={duplicateSelectedLoader}
              onDelete={deleteSelectedLoader}
              canDelete={
                item.sequenceId
                  ? project.loaders.some((loader) => loader.sequenceId !== item.sequenceId)
                  : project.loaders.length > 1
              }
              hideChrome={Boolean(item.sequenceId)}
              ghosts={item.id === selectedLoaderId ? ghosts : null}
            />
          ))}
        </div>
      </div>

      {editingLoader ? (
        <PanelPreview language={language} project={project} loader={editingLoader} canvasPlaying={previewScope !== "none"} />
      ) : null}

      {selectedFrames && previewScope === "none" ? (
        <FrameStrip language={language} frames={selectedFrames} selectedId={selectedLoaderId} onSelectFrame={selectFrame} />
      ) : null}

      <button
        type="button"
        className="canvas-center-button"
        onClick={centerCanvasContent}
        aria-label={t.centerCanvas}
        title={t.centerCanvas}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 4H6a2 2 0 0 0-2 2v3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3" />
          <circle cx="12" cy="12" r="2.25" />
        </svg>
      </button>

    </div>
  );
}
