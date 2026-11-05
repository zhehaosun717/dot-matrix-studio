"use client";

import { motionPresets } from "@/lib/motion-presets";
import { motionPresetCopy, uiCopy } from "@/lib/ui-copy";
import { useEditorStore } from "@/stores/use-editor-store";
import { Button } from "@/toolcraft/ui/components/primitives/button";
import { PanelSection } from "@/toolcraft/ui/components/panel/panel-section";
import { SelectControl } from "@/toolcraft/ui/components/controls/select/select-control";
import type { SectionProps } from "@/components/editor/section-props";

/** The motion preset, plus filling and clearing the grid. */
export function MotionPresetSection({ language, loader: editingLoader, collapsed, onCollapsedChange }: SectionProps) {
  const setMotionPreset = useEditorStore((state) => state.setMotionPreset);
  const fillGrid = useEditorStore((state) => state.fillGrid);
  const t = uiCopy[language];
  const activeMotionPreset = motionPresets.find((preset) => preset.id === editingLoader.animation.presetId) ?? motionPresets[0];
  const activeMotionCopy = motionPresetCopy[language][activeMotionPreset.id];

  return (
    <PanelSection
      title={t.preset}
      collapsible
      collapsed={collapsed}
      collapseLabel={language === "cn" ? "收起预设" : "Collapse preset"}
      expandLabel={language === "cn" ? "展开预设" : "Expand preset"}
      onCollapsedChange={onCollapsedChange}
    >
      <div className="toolcraft-control-stack">
        {!editingLoader.sequenceId ? (
          <>
            <SelectControl
              name={t.preset}
              value={editingLoader.animation.presetId}
              options={motionPresets.map(preset => ({ value: preset.id, label: motionPresetCopy[language][preset.id].name }))}
              onValueChange={(value) => setMotionPreset(value as typeof editingLoader.animation.presetId)}
            />
            <p className="field-help">{activeMotionCopy.description}</p>
          </>
        ) : null}
        <div className="motion-grid-actions">
          <Button type="button" variant="outline" onClick={() => fillGrid(true)}>{language === "cn" ? "填满点阵" : "Fill grid"}</Button>
          <Button type="button" variant="outline" onClick={() => fillGrid(false)}>{language === "cn" ? "清空点阵" : "Clear grid"}</Button>
        </div>
      </div>
    </PanelSection>
  );
}
