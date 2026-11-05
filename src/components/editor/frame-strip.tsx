"use client";

import { useEffect, useRef } from "react";
import { CaretLeftIcon, CaretRightIcon, CopySimpleIcon, StackIcon, TrashIcon } from "@phosphor-icons/react";
import { frameNeighbours } from "@/core/sequence-frames";
import { Language, uiCopy } from "@/lib/ui-copy";
import { MAX_SEQUENCE_FRAMES } from "@/stores/editor/sequence-slice";
import { useDrawStore } from "@/stores/use-draw-store";
import { useEditorStore } from "@/stores/use-editor-store";
import { LoaderComponent } from "@/types/dot-motion";

/** A frame drawn one canvas pixel per grid cell (scaled up crisply by CSS). */
function FrameThumbnail({ frame }: { frame: LoaderComponent }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { rows, cols } = frame.pattern.grid;
  const { activeCells, cellColors } = frame.pattern;
  const { primaryColor, backgroundColor } = frame.style;

  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    context.fillStyle = backgroundColor ?? "#2D3743";
    context.fillRect(0, 0, cols, rows);
    for (const cell of activeCells) {
      context.fillStyle = cellColors?.[cell] ?? primaryColor;
      context.fillRect(cell % cols, Math.floor(cell / cols), 1, 1);
    }
  }, [activeCells, backgroundColor, cellColors, cols, primaryColor, rows]);

  return <canvas ref={ref} width={cols} height={rows} className="frame-strip__thumb" aria-hidden="true" />;
}

type FrameStripProps = {
  language: Language;
  /** The selected sequence's frames, in order. */
  frames: LoaderComponent[];
  selectedId: string;
  /** Selects a frame and brings it into view. */
  onSelectFrame: (frameId: string) => void;
};

/** The selected sequence's frames under the canvas: pick, step through, duplicate or delete any frame, onion skin. */
export function FrameStrip({ language, frames, selectedId, onSelectFrame }: FrameStripProps) {
  const t = uiCopy[language];
  const addSequenceFrame = useEditorStore((state) => state.addSequenceFrame);
  const removeSequenceFrame = useEditorStore((state) => state.removeSequenceFrame);
  const onionSkin = useDrawStore((state) => state.onionSkin);
  const setOnionSkin = useDrawStore((state) => state.setOnionSkin);
  const sequenceId = frames[0]?.sequenceId;
  const { index, previous, next } = frameNeighbours(frames, selectedId);
  if (!sequenceId || index < 0) return null;
  const full = frames.length >= MAX_SEQUENCE_FRAMES;

  return (
    <div className="frame-strip">
      <div className="frame-strip__panel" role="toolbar" aria-label={t.frameStrip}>
        <span className="frame-strip__count">
          {t.frameLabel} {index + 1}/{frames.length}
        </span>
        <button
          type="button"
          className="frame-strip__button"
          disabled={!previous}
          onClick={() => previous && onSelectFrame(previous.id)}
          aria-label={t.previousFrame}
          title={t.previousFrame}
        >
          <CaretLeftIcon aria-hidden="true" />
        </button>
        <ol className="frame-strip__frames">
          {frames.map((frame, position) => (
            <li key={frame.id}>
              <button
                type="button"
                className={`frame-strip__frame${frame.id === selectedId ? " is-selected" : ""}`}
                aria-current={frame.id === selectedId ? "true" : undefined}
                aria-label={`${t.frameLabel} ${position + 1}`}
                title={`${t.frameLabel} ${position + 1}`}
                onClick={() => onSelectFrame(frame.id)}
              >
                <FrameThumbnail frame={frame} />
                <span className="frame-strip__number" aria-hidden="true">{position + 1}</span>
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="frame-strip__button"
          disabled={!next}
          onClick={() => next && onSelectFrame(next.id)}
          aria-label={t.nextFrame}
          title={t.nextFrame}
        >
          <CaretRightIcon aria-hidden="true" />
        </button>
        <span className="frame-strip__divider" aria-hidden="true" />
        <button
          type="button"
          className="frame-strip__button"
          disabled={full}
          onClick={() => addSequenceFrame(sequenceId, selectedId)}
          aria-label={t.duplicateFrame}
          title={full ? t.frameLimit : t.duplicateFrame}
        >
          <CopySimpleIcon aria-hidden="true" />
        </button>
        <button
          type="button"
          className="frame-strip__button frame-strip__button--danger"
          disabled={frames.length <= 1}
          onClick={() => removeSequenceFrame(sequenceId, selectedId)}
          aria-label={t.deleteFrame}
          title={t.deleteFrame}
        >
          <TrashIcon aria-hidden="true" />
        </button>
        <button
          type="button"
          className="frame-strip__button frame-strip__button--toggle"
          aria-pressed={onionSkin}
          onClick={() => setOnionSkin(!onionSkin)}
          title={t.onionSkinHint}
        >
          <StackIcon aria-hidden="true" />
          <span>{t.onionSkin}</span>
        </button>
      </div>
    </div>
  );
}
