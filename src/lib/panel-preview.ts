/**
 * The always-on 32x32 panel preview: which frame it shows, and its remembered layout. Frames come from the
 * same renderer as live sync and saving to the panel, as plain sRGB (what a calibrated panel shows).
 */
import { renderMatrixAt, renderMatrixStill } from "@/lib/idotmatrix/render-frames";
import { LoaderComponent, Project } from "@/types/dot-motion";

export const PANEL_PREVIEW_STORAGE_KEY = "dot-matrix-panel-preview";

export type PanelPreviewPrefs = { collapsed: boolean };
const DEFAULT_PREFS: PanelPreviewPrefs = { collapsed: false };

type PreviewOptions = { showInactive: boolean; gaps: boolean };

/** The picture the panel would show: the drawing as it is, or the animation elapsedMs after it started. */
export function panelPreviewFrame(project: Project, loader: LoaderComponent, elapsedMs: number | null, options: PreviewOptions): Uint8Array {
  const frameOptions = { ...options, encoded: true };
  return elapsedMs === null ? renderMatrixStill(loader, frameOptions) : renderMatrixAt(project, loader, elapsedMs, frameOptions);
}

export function loadPanelPreviewPrefs(): PanelPreviewPrefs {
  try {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem(PANEL_PREVIEW_STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    const collapsed = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).collapsed : undefined;
    return { collapsed: typeof collapsed === "boolean" ? collapsed : DEFAULT_PREFS.collapsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePanelPreviewPrefs(prefs: PanelPreviewPrefs) {
  try {
    window.localStorage.setItem(PANEL_PREVIEW_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // A full or blocked storage only means the layout is not remembered.
  }
}
