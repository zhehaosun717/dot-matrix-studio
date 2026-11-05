"use client";

import { Language, uiCopy } from "@/lib/ui-copy";

/** Frame and sequence actions above a selected frame sequence. */
type SequenceGroupChromeProps = {
  bounds: { left: number; top: number; width: number; height: number };
  frameCount: number;
  canDelete: boolean;
  onAddFrame: () => void;
  onRemoveFrame: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  copy: typeof uiCopy[Language];
};

export function SequenceGroupChrome({
  bounds,
  frameCount,
  canDelete,
  onAddFrame,
  onRemoveFrame,
  onDuplicate,
  onDelete,
  copy
}: SequenceGroupChromeProps) {
  return (
    <div
      className="sequence-group-chrome"
      style={{
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height
      }}
    >
      <div className="canvas-artboard__actions sequence-group-chrome__actions" aria-label="Sequence actions">
        <button
          type="button"
          data-artboard-action="true"
          className="canvas-artboard__action canvas-artboard__action--text"
          disabled={frameCount >= 10}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onAddFrame();
          }}
          aria-label={copy.addFrame}
          title={copy.addFrame}
        >
          <span>{copy.addFrame}</span>
        </button>
        {frameCount > 1 ? (
          <button
            type="button"
            data-artboard-action="true"
            className="canvas-artboard__action canvas-artboard__action--text"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onRemoveFrame();
            }}
            aria-label={copy.removeFrame}
            title={copy.removeFrame}
          >
            <span>{copy.removeFrame}</span>
          </button>
        ) : null}
        <button
          type="button"
          data-artboard-action="true"
          className="canvas-artboard__action"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onDuplicate();
          }}
          aria-label="Duplicate sequence"
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
          aria-label="Delete sequence"
          title="Delete"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M7.2 3.5h5.6l.6 1.5H17v1.6H3V5h3.6l.6-1.5Z" />
            <path d="M5.1 8h9.8l-.6 7a2 2 0 0 1-2 1.8H7.7a2 2 0 0 1-2-1.8L5.1 8Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
