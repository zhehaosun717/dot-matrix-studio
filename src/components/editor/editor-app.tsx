"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorCanvas } from "@/components/editor/editor-canvas";
import { EditorTopbar } from "@/components/editor/editor-topbar";
import { ExportPanel } from "@/components/editor/export-panel";
import { SaveStatusBanner } from "@/components/editor/save-status-banner";
import { DEFAULT_COLLAPSED_SECTIONS, SettingsSidebar } from "@/components/editor/settings-sidebar";
import { PreviewScope, useCanvasLayout } from "@/components/editor/use-canvas-layout";
import { useCanvasViewport } from "@/components/editor/use-canvas-viewport";
import { useDesktopBridge } from "@/components/editor/use-desktop-bridge";
import { useEditorShortcuts } from "@/components/editor/use-editor-shortcuts";
import { useLiveEditorSync } from "@/components/editor/use-live-editor-sync";
import { Language, uiCopy } from "@/lib/ui-copy";
import { useEditorHistory } from "@/stores/editor-history";
import { useEditorStore } from "@/stores/use-editor-store";
import { Sheet, SheetContent } from "@/toolcraft/ui/components/composites/sheet";
import { SegmentedControl } from "@/toolcraft/ui/components/controls/segmented/segmented-control";

/** The editor page: top bar, canvas, settings sidebar and export drawer. */
export function EditorApp() {
  const hydrated = useEditorStore((state) => state.hydrated);
  const project = useEditorStore((state) => state.project);
  const selectedLoaderId = useEditorStore((state) => state.selectedLoaderId);
  const canvas = useEditorStore((state) => state.project.canvas);
  const hydrate = useEditorStore((state) => state.hydrate);
  const selectLoader = useEditorStore((state) => state.selectLoader);
  const addLoader = useEditorStore((state) => state.addLoader);
  const setGridSize = useEditorStore((state) => state.setGridSize);
  const setGridGap = useEditorStore((state) => state.setGridGap);
  const selectedLoader = project.loaders.find((loader) => loader.id === selectedLoaderId) ?? null;
  const editingLoader = selectedLoader ?? project.loaders[0];
  const hasSelection = Boolean(selectedLoader);
  const selectedSequenceId = selectedLoader?.sequenceId;
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false);
  const [previewScope, setPreviewScope] = useState<PreviewScope>("none");
  useLiveEditorSync(project, editingLoader, previewScope !== "none");
  useDesktopBridge();
  useEditorHistory();
  const [language, setLanguage] = useState<Language>("cn");
  const [collapsedSections, setCollapsedSections] = useState(DEFAULT_COLLAPSED_SECTIONS);
  const layout = useCanvasLayout(project.loaders, selectedSequenceId, previewScope);
  const viewport = useCanvasViewport({
    loaders: project.loaders,
    canvas,
    sequenceGroups: layout.sequenceGroups,
    selectedLoaderId,
    previewScope,
    setPreviewScope
  });

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  /** Brings an artboard into view; reads the latest view through a ref so keyboard handlers stay stable. */
  const revealBoundsRef = useRef(viewport.revealBounds);
  revealBoundsRef.current = viewport.revealBounds;
  const revealArtboard = useCallback((loaderId: string) => {
    const target = useEditorStore.getState().project.loaders.find((loader) => loader.id === loaderId);
    if (target) revealBoundsRef.current({ left: target.artboard.x, top: target.artboard.y, width: target.artboard.width, height: target.artboard.height });
  }, []);

  useEditorShortcuts(isExportOpen, language, setPreviewScope, revealArtboard);

  // A new artboard, frame or imported animation is selected but may land under the sidebar or off screen:
  // bring it into view. Loading the saved project (hydration) is not a new artboard.
  const loaderCount = project.loaders.length;
  const seenCount = useRef<number | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const previous = seenCount.current;
    seenCount.current = loaderCount;
    if (previous === null || loaderCount <= previous) return;
    // The selected artboard itself: a new frame at the end of a long sequence must show, not the sequence's middle.
    if (selectedLoader) {
      const { x, y, width, height } = selectedLoader.artboard;
      viewport.revealBounds({ left: x, top: y, width, height });
    }
    // Only a change in the number of artboards should move the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, loaderCount]);

  const t = uiCopy[language];

  function openExport() {
    setIsExportOpen(true);
  }

  function createArtboard(kind: "custom" | "sequence") {
    addLoader(kind);
    setIsAddMenuOpen(false);
    setPreviewScope("none");
  }

  function togglePreviewAll() {
    setPreviewScope((value) => (value === "all" ? "none" : "all"));
  }

  function togglePreviewSelected() {
    if (!hasSelection) {
      return;
    }
    setPreviewScope((value) => (value === "selected" ? "none" : "selected"));
  }

  function changeGridSize(value: number) {
    setPreviewScope("none");
    setGridSize(value);
  }

  function changeGridGap(value: number) {
    setPreviewScope("none");
    setGridGap(value);
  }

  function selectCanvasLoader(loaderId: string) {
    selectLoader(loaderId);
    setPreviewScope("none");
  }

  if (!hydrated) {
    // This lone English line is the whole server-rendered page, so browser translators rewrite it
    // before hydration and React reports a text mismatch. Opt it out of translation.
    return (
      <div className="loading-shell notranslate" translate="no" suppressHydrationWarning>
        Loading editor...
      </div>
    );
  }

  return (
    <main className="builder-shell">
      <EditorTopbar
        language={language}
        previewScope={previewScope}
        isAddMenuOpen={isAddMenuOpen}
        setIsAddMenuOpen={setIsAddMenuOpen}
        createArtboard={createArtboard}
        togglePreviewAll={togglePreviewAll}
        openExport={openExport}
      />

      <SaveStatusBanner language={language} />
      <div className={`zoom-hud${viewport.showZoomHud ? " is-visible" : ""}`}>{Math.round(canvas.zoom * 100)}%</div>
      {!hasSelection && previewScope === "none" ? <p className="canvas-hint">{t.selectArtboardHint}</p> : null}
      <div className="language-switch" aria-label="Language switch">
        <SegmentedControl
          ariaLabel="Language switch"
          name="Language"
          value={language}
          options={[{ value: "cn", label: "中文" }, { value: "en", label: "EN" }]}
          onValueChange={(value) => {
            if (value === "cn" || value === "en") setLanguage(value);
          }}
        />
      </div>

      <section className="builder-workspace">
        <EditorCanvas
          language={language}
          project={project}
          selectedLoaderId={selectedLoaderId}
          selectedSequenceId={selectedSequenceId}
          previewScope={previewScope}
          setPreviewScope={setPreviewScope}
          selectCanvasLoader={selectCanvasLoader}
          layout={layout}
          viewport={viewport}
        />

        <SettingsSidebar
          language={language}
          hasSelection={hasSelection}
          editingLoader={editingLoader}
          propertiesCollapsed={propertiesCollapsed}
          setPropertiesCollapsed={setPropertiesCollapsed}
          collapsedSections={collapsedSections}
          setSectionCollapsed={(section, value) => setCollapsedSections((current) => ({ ...current, [section]: value }))}
          previewScope={previewScope}
          togglePreviewSelected={togglePreviewSelected}
          changeGridSize={changeGridSize}
          changeGridGap={changeGridGap}
        />
      </section>

      <Sheet open={isExportOpen} onOpenChange={setIsExportOpen}>
        <SheetContent className="export-drawer" closeLabel={t.closeExport} id="export-center" side="bottom" aria-label={t.exportFile}>
          <ExportPanel language={language} />
        </SheetContent>
      </Sheet>
    </main>
  );
}
