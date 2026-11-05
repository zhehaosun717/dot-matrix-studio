"use client";

import { DrawingTools } from "@/components/editor/drawing-tools";
import { normalizeCellShape, shapeOptions } from "@/core/cell-shapes";
import { MAX_GRID_SIZE, MIN_SLIDER_GRID_SIZE } from "@/lib/grid-limits";
import { uiCopy } from "@/lib/ui-copy";
import { useEditorStore } from "@/stores/use-editor-store";
import { PanelSection } from "@/toolcraft/ui/components/panel/panel-section";
import { SelectControl } from "@/toolcraft/ui/components/controls/select/select-control";
import { SliderControl } from "@/toolcraft/ui/components/controls/slider/slider-control";
import { CellShape } from "@/types/dot-motion";
import type { SectionProps } from "@/components/editor/section-props";

type GridSectionProps = SectionProps & {
  changeGridSize: (value: number) => void;
  changeGridGap: (value: number) => void;
};

/** Drawing tools, grid size, cell shape and gap. */
export function GridSection({ language, loader: editingLoader, collapsed, onCollapsedChange, changeGridSize, changeGridGap }: GridSectionProps) {
  const setCellShape = useEditorStore((state) => state.setCellShape);
  const t = uiCopy[language];
  const selectedShape = normalizeCellShape(editingLoader.style.cellShape);

  return (
    <PanelSection
      title={t.grid}
      collapsible
      collapsed={collapsed}
      collapseLabel={language === "cn" ? "收起网格" : "Collapse grid"}
      expandLabel={language === "cn" ? "展开网格" : "Expand grid"}
      onCollapsedChange={onCollapsedChange}
    >
      <div className="toolcraft-control-stack">
        <DrawingTools language={language} loader={editingLoader} />
        <SliderControl showFill variant="discrete" markerCount={11} name={t.gridSize} min={MIN_SLIDER_GRID_SIZE} max={MAX_GRID_SIZE} step={1} value={editingLoader.pattern.grid.rows} valueLabel={`${editingLoader.pattern.grid.rows}×${editingLoader.pattern.grid.cols}`} onValueChange={changeGridSize} />
        <SelectControl
          name={t.shape}
          value={selectedShape}
          options={shapeOptions.map(option => ({ value: option.value, label: t[option.value] }))}
          onValueChange={(value) => setCellShape(value as CellShape)}
        />
        <SliderControl showFill name={t.gap} min={0} max={20} step={1} unit="px" value={editingLoader.pattern.grid.gap} onValueChange={changeGridGap} />
      </div>
    </PanelSection>
  );
}
