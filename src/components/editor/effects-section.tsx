"use client";

import { uiCopy } from "@/lib/ui-copy";
import { useEditorStore } from "@/stores/use-editor-store";
import { PanelSection } from "@/toolcraft/ui/components/panel/panel-section";
import { SliderControl } from "@/toolcraft/ui/components/controls/slider/slider-control";
import { SwitchControl } from "@/toolcraft/ui/components/controls/boolean/boolean-controls";
import type { SectionProps } from "@/components/editor/section-props";

/** Glow around lit cells. */
export function EffectsSection({ language, loader: editingLoader, collapsed, onCollapsedChange }: SectionProps) {
  const setGlowEnabled = useEditorStore((state) => state.setGlowEnabled);
  const setGlowSize = useEditorStore((state) => state.setGlowSize);
  const t = uiCopy[language];

  return (
    <PanelSection
      title={t.effects}
      collapsible
      collapsed={collapsed}
      collapseLabel={language === "cn" ? "收起效果" : "Collapse effects"}
      expandLabel={language === "cn" ? "展开效果" : "Expand effects"}
      onCollapsedChange={onCollapsedChange}
    >
      <div className="toolcraft-control-stack">
        <SwitchControl checked={editingLoader.style.shadow} name={t.glow} onCheckedChange={setGlowEnabled} />
        {editingLoader.style.shadow ? (
          <SliderControl showFill name={t.spread} min={0} max={48} step={1} unit="px" value={editingLoader.style.glow} onValueChange={setGlowSize} />
        ) : null}
      </div>
    </PanelSection>
  );
}
