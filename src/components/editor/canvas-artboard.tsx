"use client";

import { DotGridEditor } from "@/components/editor/dot-grid-editor";
import { PreviewStage } from "@/components/editor/preview-stage";
import type { PreviewScope } from "@/components/editor/use-canvas-layout";
import type { OnionGhost } from "@/core/sequence-frames";
import { LoaderComponent } from "@/types/dot-motion";

/** One artboard on the canvas: its grid editor while selected, otherwise a preview. */
type CanvasArtboardProps = {
  loader: LoaderComponent;
  selected: boolean;
  dimmed: boolean;
  previewMode: PreviewScope;
  editable: boolean;
  onSelect: () => void;
  onApplyCells: (cells: number[], active: boolean, color?: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDelete: boolean;
  sequenceSelected: boolean;
  hideChrome?: boolean;
  /** Onion skin of the neighbouring frames, on the selected frame of a sequence. */
  ghosts?: ReadonlyMap<number, OnionGhost> | null;
};

export function CanvasArtboard({
  loader,
  selected,
  dimmed,
  previewMode,
  editable,
  onSelect,
  onApplyCells,
  onDuplicate,
  onDelete,
  canDelete,
  sequenceSelected,
  hideChrome = false,
  ghosts = null
}: CanvasArtboardProps) {
  const previewingThis = previewMode === "all" || (previewMode === "selected" && selected);

  return (
    <div
      role="button"
      tabIndex={0}
      data-artboard-interactive="true"
      data-artboard-id={loader.id}
      aria-label={loader.sequenceId ? `${loader.name} ${(loader.sequenceIndex ?? 0) + 1}` : loader.name}
      aria-current={selected ? "true" : undefined}
      className={`canvas-artboard${selected ? " is-selected" : ""}${sequenceSelected ? " is-sequence-selected" : ""}${dimmed ? " is-dimmed" : ""}`}
      style={{
        left: loader.artboard.x,
        top: loader.artboard.y,
        width: loader.artboard.width,
        height: loader.artboard.height,
        zIndex: selected ? 4 : 1
      }}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {selected && !hideChrome ? (
        <div className="canvas-artboard__actions" aria-label="Artboard actions">
          <button
            type="button"
            data-artboard-action="true"
            className="canvas-artboard__action"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onDuplicate();
            }}
            aria-label="Duplicate artboard"
            title="Duplicate"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M7 4.5a2 2 0 0 1 2-2h5.5a2 2 0 0 1 2 2V10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4.5Z" />
              <path d="M3.5 8a2 2 0 0 1 2-2H7v4a2 2 0 0 0 2 2h4v1.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V8Z" />
            </svg>
          </button>
          <button
            type="button"
            data-artboard-action="true"
            className="canvas-artboard__action canvas-artboard__action--danger"
            disabled={!canDelete}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            aria-label="Delete artboard"
            title="Delete"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M7.2 3.5h5.6l.6 1.5H17v1.6H3V5h3.6l.6-1.5Z" />
              <path d="M5.1 8h9.8l-.6 7a2 2 0 0 1-2 1.8H7.7a2 2 0 0 1-2-1.8L5.1 8Z" />
            </svg>
          </button>
        </div>
      ) : null}
      <div className="canvas-artboard__frame">
        {(selected || sequenceSelected) && editable && !previewingThis ? (
          <DotGridEditor loader={loader} onApplyCells={onApplyCells} variant="canvas" ghosts={ghosts} />
        ) : (
          <PreviewStage
            loader={loader}
            showHint={false}
            isAnimated={previewingThis}
            variant="canvas"
            staticOnly={Boolean(loader.sequenceId)}
          />
        )}
      </div>
    </div>
  );
}
