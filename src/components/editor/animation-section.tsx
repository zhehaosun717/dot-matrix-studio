"use client";

import { motionPresets } from "@/lib/motion-presets";
import { inactiveStyleCopy, uiCopy } from "@/lib/ui-copy";
import { useEditorStore } from "@/stores/use-editor-store";
import { Button } from "@/toolcraft/ui/components/primitives/button";
import { PanelSection } from "@/toolcraft/ui/components/panel/panel-section";
import { SelectControl } from "@/toolcraft/ui/components/controls/select/select-control";
import { SliderControl } from "@/toolcraft/ui/components/controls/slider/slider-control";
import { Direction, InactiveStyle } from "@/types/dot-motion";

const inactiveStyles: Array<{ value: InactiveStyle }> = [
  { value: "none" },
  { value: "static-dim" },
  { value: "breathe" },
  { value: "ghost" }
];
const directionOptions: Array<{ value: Direction; label: string; icon: string }> = [
  { value: "up-left", label: "Bottom Right to Top Left", icon: "↖" },
  { value: "up", label: "Bottom to Top", icon: "↑" },
  { value: "up-right", label: "Bottom Left to Top Right", icon: "↗" },
  { value: "left", label: "Right to Left", icon: "←" },
  { value: "right", label: "Left to Right", icon: "→" },
  { value: "down-left", label: "Top Right to Bottom Left", icon: "↙" },
  { value: "down", label: "Top to Bottom", icon: "↓" },
  { value: "down-right", label: "Top Left to Bottom Right", icon: "↘" }
];
const directionControlCells = [
  directionOptions[0],
  directionOptions[1],
  directionOptions[2],
  directionOptions[3],
  null,
  directionOptions[4],
  directionOptions[5],
  directionOptions[6],
  directionOptions[7]
];
import type { SectionProps } from "@/components/editor/section-props";

/** Speed, cell styles, direction and origin of the motion. */
export function AnimationSection({ language, loader: editingLoader, collapsed, onCollapsedChange }: SectionProps) {
  const setMotionOrigin = useEditorStore((state) => state.setMotionOrigin);
  const setDirection = useEditorStore((state) => state.setDirection);
  const setSpeed = useEditorStore((state) => state.setSpeed);
  const setScaleIntensity = useEditorStore((state) => state.setScaleIntensity);
  const setAnimationStyle = useEditorStore((state) => state.setAnimationStyle);
  const setFps = useEditorStore((state) => state.setFps);
  const setInactiveStyle = useEditorStore((state) => state.setInactiveStyle);
  const t = uiCopy[language];
  const activeMotionPreset = motionPresets.find((preset) => preset.id === editingLoader.animation.presetId) ?? motionPresets[0];

  return (
    <PanelSection
      title={t.animation}
      collapsible
      collapsed={collapsed}
      collapseLabel={language === "cn" ? "收起动画" : "Collapse animation"}
      expandLabel={language === "cn" ? "展开动画" : "Expand animation"}
      onCollapsedChange={onCollapsedChange}
    >
      <div className="toolcraft-control-stack">
        {!editingLoader.sequenceId ? (
          <>
            <SliderControl showFill name={t.playbackSpeed} min={0.25} max={3} step={0.05} unit="×" value={editingLoader.animation.speed ?? 1} onValueChange={setSpeed} />
            <SelectControl
              name={t.activeCells}
              value={editingLoader.animation.style}
              options={[
                { value: "opacity-only", label: language === "cn" ? "透明度" : "Opacity Only" },
                { value: "pulse-size", label: language === "cn" ? "亮度缩放" : "Brightness Scale" },
                { value: "fisheye", label: language === "cn" ? "鱼眼镜头" : "Fish-eye Lens" },
                { value: "depth-shift", label: language === "cn" ? "收缩激活点" : "Shrink Active" },
                { value: "bloom-pop", label: language === "cn" ? "弹性出现" : "Pop In/Out" }
              ]}
              onValueChange={(value) => setAnimationStyle(value as typeof editingLoader.animation.style)}
            />
            {editingLoader.animation.style === "opacity-only" ? null : (
              <SliderControl showFill name={language === "cn" ? "缩放强度" : "Scale Intensity"} min={0} max={100} step={5} unit="%" value={Math.round((editingLoader.animation.scaleIntensity ?? 1) * 100)} onValueChange={(value) => setScaleIntensity(value / 100)} />
            )}
          </>
        ) : (
          <SliderControl showFill variant="discrete" markerCount={6} name={t.speed} min={1} max={30} step={1} value={editingLoader.animation.fps} onValueChange={setFps} />
        )}
        <SelectControl
          name={t.inactiveCells}
          value={editingLoader.animation.inactiveStyle}
          options={inactiveStyles.map(style => ({ value: style.value, label: inactiveStyleCopy[language][style.value] }))}
          onValueChange={(value) => setInactiveStyle(value as InactiveStyle)}
        />
        {activeMotionPreset.supportsDirection ? (
          <div className="toolcraft-direction-control">
            <span className="toolcraft-field-label">{t.direction}</span>
            <div className="direction-picker" role="radiogroup" aria-label="Animation direction">
              {directionControlCells.map((option, index) =>
                option ? (
                  <Button
                    key={option.value}
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className={`direction-picker__item${editingLoader.animation.direction === option.value ? " is-active" : ""}`}
                    onClick={() => setDirection(option.value)}
                    role="radio"
                    aria-checked={editingLoader.animation.direction === option.value}
                    aria-pressed={editingLoader.animation.direction === option.value}
                    title={option.label}
                  >
                    <span aria-hidden="true" className="direction-picker__icon">{option.icon}</span>
                  </Button>
                ) : (
                  <span key={`direction-center-${index}`} className="direction-picker__center" aria-hidden="true" />
                )
              )}
            </div>
          </div>
        ) : null}
        {activeMotionPreset.supportsOrigin ? (
          <>
            <SliderControl showFill variant="discrete" markerCount={editingLoader.pattern.grid.cols} name={t.originX} min={1} max={editingLoader.pattern.grid.cols} step={1} value={editingLoader.animation.originX} onValueChange={(value) => setMotionOrigin("x", value)} />
            <SliderControl showFill variant="discrete" markerCount={editingLoader.pattern.grid.rows} name={t.originY} min={1} max={editingLoader.pattern.grid.rows} step={1} value={editingLoader.animation.originY} onValueChange={(value) => setMotionOrigin("y", value)} />
          </>
        ) : null}
      </div>
    </PanelSection>
  );
}
