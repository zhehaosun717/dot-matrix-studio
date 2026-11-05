"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDownIcon, CaretUpIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { drawMatrixFrame } from "@/components/editor/matrix-preview";
import { MATRIX_SIZE } from "@/lib/idotmatrix/constants";
import { loadPanelPreviewPrefs, panelPreviewFrame, savePanelPreviewPrefs } from "@/lib/panel-preview";
import { Language, uiCopy } from "@/lib/ui-copy";
import { useMatrixStore } from "@/stores/use-matrix-store";
import { LoaderComponent, Project } from "@/types/dot-motion";

const PITCH = 5;
const LED_RADIUS = 2;
/** The animation is redrawn at most this often (the panel itself streams 40-50 fps at best). */
const FRAME_INTERVAL_MS = 33;

type PanelPreviewProps = {
  language: Language;
  project: Project;
  /** The artboard being edited: what live sync would send. */
  loader: LoaderComponent;
  /** The canvas is playing its preview, so this plays too. */
  canvasPlaying: boolean;
};

/** Always-on 32x32 preview of the panel, drawn as round LEDs, next to the canvas. */
export function PanelPreview({ language, project, loader, canvasPlaying }: PanelPreviewProps) {
  const t = uiCopy[language];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [prefs, setPrefs] = useState(loadPanelPreviewPrefs);
  const [playing, setPlaying] = useState(false);
  const showInactive = useMatrixStore((state) => state.showInactive);
  const gaps = useMatrixStore((state) => state.pixelGaps);
  const live = useMatrixStore((state) => state.live);
  const animate = playing || canvasPlaying;
  const collapsed = prefs.collapsed;

  // The drawing as it is: redrawn after every edit.
  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (collapsed || animate || !context) return;
    drawMatrixFrame(context, panelPreviewFrame(project, loader, null, { showInactive, gaps }), { pitch: PITCH, radius: LED_RADIUS, linear: false });
  }, [animate, collapsed, gaps, loader, project, showInactive]);

  // The animation clock starts when playing starts, not again after every edit.
  const startedAt = useRef(0);
  useEffect(() => {
    if (animate) startedAt.current = performance.now();
  }, [animate]);

  // The animation, sampled from when it started playing.
  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (collapsed || !animate || !context) return;
    let lastDraw = -Infinity;
    let request = 0;
    const tick = (now: number) => {
      if (now - lastDraw >= FRAME_INTERVAL_MS) {
        lastDraw = now;
        drawMatrixFrame(context, panelPreviewFrame(project, loader, now - startedAt.current, { showInactive, gaps }), { pitch: PITCH, radius: LED_RADIUS, linear: false });
      }
      request = window.requestAnimationFrame(tick);
    };
    request = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(request);
  }, [animate, collapsed, gaps, loader, project, showInactive]);

  function setCollapsed(value: boolean) {
    const next = { ...prefs, collapsed: value };
    setPrefs(next);
    savePanelPreviewPrefs(next);
  }

  const elsewhere = live === "screen" ? t.panelShowsMirror : live === "agent" ? t.panelShowsAgent : null;

  return (
    <section className={`panel-preview${collapsed ? " is-collapsed" : ""}`} aria-label={t.panelPreview} data-artboard-interactive="true">
      <div className="panel-preview__header">
        <span className="panel-preview__title">{t.panelPreview}</span>
        {!collapsed ? (
          <button
            type="button"
            className="panel-preview__button"
            aria-pressed={animate}
            disabled={canvasPlaying}
            onClick={() => setPlaying((value) => !value)}
            aria-label={t.playPanelPreview}
            title={animate ? t.pausePanelPreview : t.playPanelPreview}
          >
            {animate ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
          </button>
        ) : null}
        <button
          type="button"
          className="panel-preview__button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? t.expandPanelPreview : t.collapsePanelPreview}
          title={collapsed ? t.expandPanelPreview : t.collapsePanelPreview}
        >
          {collapsed ? <CaretDownIcon aria-hidden="true" /> : <CaretUpIcon aria-hidden="true" />}
        </button>
      </div>
      {!collapsed ? (
        <>
          <canvas
            ref={canvasRef}
            className="panel-preview__canvas"
            width={MATRIX_SIZE * PITCH}
            height={MATRIX_SIZE * PITCH}
            role="img"
            aria-label={`${t.panelPreviewOf} ${loader.name}`}
          />
          {elsewhere ? <p className="panel-preview__note">{elsewhere}</p> : null}
        </>
      ) : null}
    </section>
  );
}
