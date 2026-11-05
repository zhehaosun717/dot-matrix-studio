"use client";

import { BaseColorControls } from "@/components/editor/base-color-controls";
import { uiCopy } from "@/lib/ui-copy";
import { useEditorStore } from "@/stores/use-editor-store";
import { PanelSection } from "@/toolcraft/ui/components/panel/panel-section";
import { ColorOpacityControl } from "@/toolcraft/ui/components/controls/color/color-control";
import type { SectionProps } from "@/components/editor/section-props";

/** Base colour and the artboard background. */
export function ColorsSection({ language, loader: editingLoader, collapsed, onCollapsedChange }: SectionProps) {
  const setBackgroundColor = useEditorStore((state) => state.setBackgroundColor);
  const setBackgroundAlpha = useEditorStore((state) => state.setBackgroundAlpha);
  const t = uiCopy[language];

  return (
    <PanelSection
      title={t.colors}
      collapsible
      collapsed={collapsed}
      collapseLabel={language === "cn" ? "收起颜色" : "Collapse colors"}
      expandLabel={language === "cn" ? "展开颜色" : "Expand colors"}
      onCollapsedChange={onCollapsedChange}
    >
      <div className="toolcraft-control-stack">
        <BaseColorControls language={language} loader={editingLoader} />
        <ColorOpacityControl
          showLabel
          name={t.backgroundColor}
          hex={editingLoader.style.backgroundColor ?? "#2D3743"}
          opacity={(editingLoader.style.backgroundAlpha ?? 1) * 100}
          onValueChange={({ hex, opacity }) => { setBackgroundColor(hex); setBackgroundAlpha(opacity / 100); }}
        />
      </div>
    </PanelSection>
  );
}
