"use client";

import { ImageImportControls } from "@/components/editor/image-import-controls";
import { TextStampControls } from "@/components/editor/text-stamp-controls";
import { PanelSection } from "@/toolcraft/ui/components/panel/panel-section";
import type { SectionProps } from "@/components/editor/section-props";

/** Writing text and importing pictures onto the artboard. */
export function ContentSection({ language, loader: editingLoader, collapsed, onCollapsedChange }: SectionProps) {
  return (
    <PanelSection
      title={language === "cn" ? "文字与图片" : "Text & Images"}
      collapsible
      collapsed={collapsed}
      collapseLabel={language === "cn" ? "收起文字与图片" : "Collapse text and images"}
      expandLabel={language === "cn" ? "展开文字与图片" : "Expand text and images"}
      onCollapsedChange={onCollapsedChange}
    >
      <div className="toolcraft-control-stack">
        <TextStampControls language={language} loader={editingLoader} />
        <ImageImportControls language={language} loader={editingLoader} />
      </div>
    </PanelSection>
  );
}
