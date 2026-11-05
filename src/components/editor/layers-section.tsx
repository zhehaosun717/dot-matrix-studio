"use client";

import { LayersPanel } from "@/components/editor/layers-panel";
import { PanelSection } from "@/toolcraft/ui/components/panel/panel-section";
import type { SectionProps } from "@/components/editor/section-props";

/** The layers of the selected artboard. */
export function LayersSection({ language, loader: editingLoader, collapsed, onCollapsedChange }: SectionProps) {
  return (
    <PanelSection
      title={language === "cn" ? "图层" : "Layers"}
      collapsible
      collapsed={collapsed}
      collapseLabel={language === "cn" ? "收起图层" : "Collapse layers"}
      expandLabel={language === "cn" ? "展开图层" : "Expand layers"}
      onCollapsedChange={onCollapsedChange}
    >
      <LayersPanel language={language} loader={editingLoader} />
    </PanelSection>
  );
}
