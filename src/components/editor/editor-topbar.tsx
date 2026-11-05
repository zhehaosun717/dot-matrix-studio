"use client";

import { LiveMatrixControls } from "@/components/editor/live-matrix-controls";
import type { PreviewScope } from "@/components/editor/use-canvas-layout";
import { Language, uiCopy } from "@/lib/ui-copy";
import { Button } from "@/toolcraft/ui/components/primitives/button";

type EditorTopbarProps = {
  language: Language;
  previewScope: PreviewScope;
  isAddMenuOpen: boolean;
  setIsAddMenuOpen: (update: (open: boolean) => boolean) => void;
  createArtboard: (kind: "custom" | "sequence") => void;
  togglePreviewAll: () => void;
  openExport: () => void;
};

/** GitHub link, the add-artboard menu, live sync, preview-all and export. */
export function EditorTopbar({ language, previewScope, isAddMenuOpen, setIsAddMenuOpen, createArtboard, togglePreviewAll, openExport }: EditorTopbarProps) {
  const t = uiCopy[language];

  return (
    <div className="builder-topbar">
      <a
        className="github-entry"
        href="https://github.com/zhehaosun717/dot-matrix-studio"
        target="_blank"
        rel="noreferrer"
        aria-label="Open Dot Matrix Studio on GitHub"
        title="GitHub"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-.88-.02-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.63.07-.62.07-.62 1 .08 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.71a9.3 9.3 0 0 1 2.5.35c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.95.68 1.91 0 1.38-.01 2.49-.01 2.83 0 .27.18.6.69.49A10.27 10.27 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
        </svg>
        <span>GitHub</span>
      </a>
      <div className="builder-topbar__center">
        <Button
          type="button"
          className="toolbar-button"
          variant="default"
          size="default"
          onClick={() => setIsAddMenuOpen((value) => !value)}
          aria-expanded={isAddMenuOpen}
        >
          {t.add}
        </Button>
        {isAddMenuOpen ? (
          <div className="add-artboard-menu">
            <button type="button" className="add-artboard-card" onClick={() => createArtboard("custom")}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v13A2.5 2.5 0 0 1 16.5 21h-9A2.5 2.5 0 0 1 5 18.5v-13Zm4 4.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm3 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm3 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5ZM9 13.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm3 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm3 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5ZM9 16.75a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm3 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm3 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z" />
              </svg>
              <span>{t.customMode}</span>
            </button>
            <button type="button" className="add-artboard-card" onClick={() => createArtboard("sequence")}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.5 6A2.5 2.5 0 0 1 7 3.5h7A2.5 2.5 0 0 1 16.5 6v1H17A2.5 2.5 0 0 1 19.5 9.5v8A2.5 2.5 0 0 1 17 20h-7a2.5 2.5 0 0 1-2.5-2.5V17H7a2.5 2.5 0 0 1-2.5-2.5V6Zm4.6 11.5A.9.9 0 0 0 10 18.4h7a.9.9 0 0 0 .9-.9v-8a.9.9 0 0 0-.9-.9h-.5v5.9A2.5 2.5 0 0 1 14 17H9.1v.5Zm-2-11.2v8.4h7.8V6.3H7.1Z" />
              </svg>
              <span>{t.sequenceMode}</span>
            </button>
          </div>
        ) : null}
      </div>
      <div className="builder-topbar__actions">
        <LiveMatrixControls language={language} />
        <Button type="button" className="toolbar-button" variant="outline" size="default" onClick={togglePreviewAll}>
          {previewScope === "all" ? t.stopPreview : t.previewAll}
        </Button>
        <Button type="button" className="toolbar-button" variant="default" size="default" onClick={openExport}>
          {t.export}
        </Button>
      </div>
    </div>
  );
}
