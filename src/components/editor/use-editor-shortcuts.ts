"use client";

import { useEffect } from "react";
import { DRAW_TOOL_KEYS } from "@/components/editor/drawing-tools";
import { activePixelSelection, copySelection, cutSelection, deleteSelection, nudgeDrawing, pasteSelection } from "@/components/editor/selection-actions";
import type { PreviewScope } from "@/components/editor/use-canvas-layout";
import { GridTransform } from "@/core/grid-transforms";
import { Language } from "@/lib/ui-copy";
import { redo, undo } from "@/stores/editor-history";
import { useDrawStore } from "@/stores/use-draw-store";
import { useEditorStore } from "@/stores/use-editor-store";

const ARROW_NUDGES: Record<string, GridTransform> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
/** Focused widgets that move their own focus or selection with the arrow keys (segmented controls are role=group). */
const ARROW_KEY_WIDGETS = "[role='group'], [role='radiogroup'], [role='radio'], [role='slider'], [role='listbox'], [role='menu'], [role='tablist'], [role='combobox']";

/** Editor keyboard shortcuts: tools, undo / redo, nudging, copy / cut / paste, duplicate, delete, Escape. */
export function useEditorShortcuts(isExportOpen: boolean, language: Language, setPreviewScope: (scope: PreviewScope) => void) {
  const clearSelection = useEditorStore((state) => state.clearSelection);
  const copySelectedLoader = useEditorStore((state) => state.copySelectedLoader);
  const pasteLoader = useEditorStore((state) => state.pasteLoader);
  const duplicateSelectedLoader = useEditorStore((state) => state.duplicateSelectedLoader);
  const deleteSelectedLoader = useEditorStore((state) => state.deleteSelectedLoader);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      if (isTyping) {
        return;
      }

      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const toolKey = DRAW_TOOL_KEYS[key];
      if (toolKey && !modifier && !event.altKey) {
        useDrawStore.getState().setTool(toolKey);
        return;
      }
      if (modifier && !event.altKey && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        redo();
        return;
      }
      if (modifier && !event.altKey && key === "z") {
        event.preventDefault();
        undo();
        return;
      }
      // Arrow keys nudge the drawing, unless a control that uses arrows itself has focus.
      const nudge = ARROW_NUDGES[event.key];
      if (nudge && !modifier && !event.altKey && !event.defaultPrevented && !(target instanceof Element && target.closest(ARROW_KEY_WIDGETS))) {
        const { selectedLoaderId: loaderId } = useEditorStore.getState();
        if (loaderId) {
          event.preventDefault();
          nudgeDrawing(loaderId, nudge);
        }
        return;
      }
      // With a selection box, copy / cut / paste / delete work on pixels; otherwise on whole artboards.
      const pixelSelection = activePixelSelection();
      if (modifier && key === "c") {
        event.preventDefault();
        if (pixelSelection) {
          copySelection();
        } else {
          copySelectedLoader();
          useDrawStore.getState().setLastCopy("artboard");
        }
        return;
      }
      if (modifier && key === "x" && pixelSelection) {
        event.preventDefault();
        cutSelection();
        return;
      }
      if (modifier && key === "v") {
        event.preventDefault();
        if (useDrawStore.getState().lastCopy === "pixels") pasteSelection(language === "cn" ? "粘贴" : "Pasted");
        else pasteLoader();
        return;
      }
      if (modifier && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelectedLoader();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        if (pixelSelection) deleteSelection();
        else deleteSelectedLoader();
        return;
      }
      if (event.key === "Escape" && pixelSelection) {
        useDrawStore.getState().setSelection(null);
        return;
      }
      // Escape deselects (empty-canvas clicks no longer do); the export drawer handles its own Escape.
      if (event.key === "Escape" && !isExportOpen) {
        clearSelection();
        setPreviewScope("none");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearSelection, copySelectedLoader, deleteSelectedLoader, duplicateSelectedLoader, isExportOpen, language, pasteLoader, setPreviewScope]);
}
