"use client";

import { AnimationSection } from "@/components/editor/animation-section";
import { ColorsSection } from "@/components/editor/colors-section";
import { ContentSection } from "@/components/editor/content-section";
import { EffectsSection } from "@/components/editor/effects-section";
import { GridSection } from "@/components/editor/grid-section";
import { LayersSection } from "@/components/editor/layers-section";
import { MotionPresetSection } from "@/components/editor/motion-preset-section";
import { PanelTuningSection } from "@/components/editor/panel-tuning-section";
import { PatternLibrarySection } from "@/components/editor/pattern-library-section";
import type { PreviewScope } from "@/components/editor/use-canvas-layout";
import { Language, uiCopy } from "@/lib/ui-copy";
import { Button } from "@/toolcraft/ui/components/primitives/button";
import { Panel } from "@/toolcraft/ui/components/panel/panel";
import { PanelSection } from "@/toolcraft/ui/components/panel/panel-section";
import { LoaderComponent } from "@/types/dot-motion";

/** Which sidebar sections start collapsed. */
export const DEFAULT_COLLAPSED_SECTIONS = {
  grid: false,
  pattern: false,
  animation: false,
  colors: true,
  effects: true,
  panel: true,
  library: true,
  layers: false,
  content: false
};

export type SidebarSection = keyof typeof DEFAULT_COLLAPSED_SECTIONS;

type SettingsSidebarProps = {
  language: Language;
  hasSelection: boolean;
  editingLoader: LoaderComponent;
  propertiesCollapsed: boolean;
  setPropertiesCollapsed: (collapsed: boolean) => void;
  collapsedSections: Record<SidebarSection, boolean>;
  setSectionCollapsed: (section: SidebarSection, collapsed: boolean) => void;
  previewScope: PreviewScope;
  togglePreviewSelected: () => void;
  changeGridSize: (value: number) => void;
  changeGridGap: (value: number) => void;
};

/** The settings panel for the selected artboard, one collapsible section per area. */
export function SettingsSidebar({
  language,
  hasSelection,
  editingLoader,
  propertiesCollapsed,
  setPropertiesCollapsed,
  collapsedSections,
  setSectionCollapsed,
  previewScope,
  togglePreviewSelected,
  changeGridSize,
  changeGridGap
}: SettingsSidebarProps) {
  const t = uiCopy[language];

  return (
    <section aria-label={t.settings} className={`settings-sidebar${hasSelection ? " is-open" : " is-hidden"}${propertiesCollapsed ? " is-collapsed" : ""}`} data-artboard-interactive="true">
      <Panel
        title={t.settings}
        className="settings-toolcraft-panel h-full max-h-none w-full rounded-lg"
        collapsed={propertiesCollapsed}
        collapseDirection="right"
        collapseLabel={language === "cn" ? "收起参数面板" : "Collapse controls"}
        expandLabel={language === "cn" ? "展开参数面板" : "Expand controls"}
        onCollapsedChange={setPropertiesCollapsed}
      >
        {hasSelection ? (
          <>
            <GridSection
              language={language}
              loader={editingLoader}
              collapsed={collapsedSections.grid}
              onCollapsedChange={(value) => setSectionCollapsed("grid", value)}
              changeGridSize={changeGridSize}
                  changeGridGap={changeGridGap}
            />

            <LayersSection
              language={language}
              loader={editingLoader}
              collapsed={collapsedSections.layers}
              onCollapsedChange={(value) => setSectionCollapsed("layers", value)}
            />

            <ContentSection
              language={language}
              loader={editingLoader}
              collapsed={collapsedSections.content}
              onCollapsedChange={(value) => setSectionCollapsed("content", value)}
            />

            <MotionPresetSection
              language={language}
              loader={editingLoader}
              collapsed={collapsedSections.pattern}
              onCollapsedChange={(value) => setSectionCollapsed("pattern", value)}
            />

            <AnimationSection
              language={language}
              loader={editingLoader}
              collapsed={collapsedSections.animation}
              onCollapsedChange={(value) => setSectionCollapsed("animation", value)}
            />

            <ColorsSection
              language={language}
              loader={editingLoader}
              collapsed={collapsedSections.colors}
              onCollapsedChange={(value) => setSectionCollapsed("colors", value)}
            />

            <PanelTuningSection
              language={language}
              collapsed={collapsedSections.panel}
              onCollapsedChange={(value) => setSectionCollapsed("panel", value)}
            />

            <PatternLibrarySection
              language={language}
              collapsed={collapsedSections.library}
              onCollapsedChange={(value) => setSectionCollapsed("library", value)}
            />

            <EffectsSection
              language={language}
              loader={editingLoader}
              collapsed={collapsedSections.effects}
              onCollapsedChange={(value) => setSectionCollapsed("effects", value)}
            />
          </>
        ) : null}
      {hasSelection ? (
        <PanelSection actionGroup="primary">
          <Button type="button" className="motion-preview-button" size="default" onClick={togglePreviewSelected}>
            {previewScope === "selected" ? t.stopPreview : t.previewAnimation}
          </Button>
        </PanelSection>
      ) : null}
      </Panel>
    </section>
  );
}
