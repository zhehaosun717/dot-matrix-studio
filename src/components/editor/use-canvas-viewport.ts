"use client";

import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { drawingPointerDowns } from "@/components/editor/dot-grid-editor";
import type { PreviewScope } from "@/components/editor/use-canvas-layout";
import { useEditorStore } from "@/stores/use-editor-store";
import { LoaderComponent, Project } from "@/types/dot-motion";

type CanvasViewportOptions = {
  loaders: LoaderComponent[];
  canvas: Project["canvas"];
  sequenceGroups: Map<string, LoaderComponent[]>;
  selectedLoaderId: string;
  previewScope: PreviewScope;
  setPreviewScope: (scope: PreviewScope) => void;
};

/** Canvas zoom (wheel, zoom HUD, fit to content), panning and dragging artboards. */
export function useCanvasViewport({ loaders, canvas, sequenceGroups, selectedLoaderId, previewScope, setPreviewScope }: CanvasViewportOptions) {
  const selectLoader = useEditorStore((state) => state.selectLoader);
  const moveLoader = useEditorStore((state) => state.moveLoader);
  const moveLoaders = useEditorStore((state) => state.moveLoaders);
  const setCanvasView = useEditorStore((state) => state.setCanvasView);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [showZoomHud, setShowZoomHud] = useState(false);
  const zoomHudTimeoutRef = useRef<number | null>(null);
  const panStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originPanX: number;
    originPanY: number;
    moved: boolean;
  } | null>(null);
  const dragArtboardRef = useRef<{
    pointerId: number;
    loaderId: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    loaderOrigins: Array<{ id: string; x: number; y: number }>;
  } | null>(null);

  function pulseZoomHud() {
    setShowZoomHud(true);
    if (zoomHudTimeoutRef.current) {
      window.clearTimeout(zoomHudTimeoutRef.current);
    }
    zoomHudTimeoutRef.current = window.setTimeout(() => {
      setShowZoomHud(false);
      zoomHudTimeoutRef.current = null;
    }, 900);
  }

  function zoomTo(nextZoom: number, clientX?: number, clientY?: number) {
    const viewport = viewportRef.current;
    const clampedZoom = Math.min(2.4, Math.max(0.25, Number(nextZoom.toFixed(3))));
    pulseZoomHud();

    if (!viewport || clientX === undefined || clientY === undefined) {
      setCanvasView({
        zoom: clampedZoom,
        panX: canvas.panX,
        panY: canvas.panY
      });
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const anchorX = clientX - rect.left;
    const anchorY = clientY - rect.top;
    const worldX = (anchorX - canvas.panX) / canvas.zoom;
    const worldY = (anchorY - canvas.panY) / canvas.zoom;

    setCanvasView({
      zoom: clampedZoom,
      panX: anchorX - worldX * clampedZoom,
      panY: anchorY - worldY * clampedZoom
    });
  }

  function handleCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.92 : 1.08;
    zoomTo(canvas.zoom * delta, event.clientX, event.clientY);
  }

  function centerCanvasContent() {
    const viewport = viewportRef.current;
    if (!viewport || loaders.length === 0) {
      return;
    }

    const contentLeft = Math.min(...loaders.map((loader) => loader.artboard.x));
    const contentTop = Math.min(...loaders.map((loader) => loader.artboard.y));
    const contentRight = Math.max(...loaders.map((loader) => loader.artboard.x + loader.artboard.width));
    const contentBottom = Math.max(...loaders.map((loader) => loader.artboard.y + loader.artboard.height));
    const contentWidth = Math.max(contentRight - contentLeft, 1);
    const contentHeight = Math.max(contentBottom - contentTop, 1);
    const viewportRect = viewport.getBoundingClientRect();
    const edgePadding = 48;
    let visibleLeft = edgePadding;
    let visibleRight = viewportRect.width - edgePadding;
    const visibleTop = 64;
    const visibleBottom = viewportRect.height - 72;
    const sidebar = document.querySelector<HTMLElement>(".settings-sidebar.is-open:not(.is-hidden)");

    if (sidebar) {
      const sidebarRect = sidebar.getBoundingClientRect();
      const overlapsViewport = sidebarRect.top < viewportRect.bottom && sidebarRect.bottom > viewportRect.top;
      const occupiesRightSide = sidebarRect.left > viewportRect.left + viewportRect.width / 2;
      if (overlapsViewport && occupiesRightSide) {
        visibleRight = Math.min(visibleRight, sidebarRect.left - viewportRect.left - 24);
      }
    }

    const availableWidth = Math.max(visibleRight - visibleLeft, 1);
    const availableHeight = Math.max(visibleBottom - visibleTop, 1);
    const targetZoom = Math.min(
      1,
      Math.max(
        .25,
        Math.min(
          (availableWidth - edgePadding * 2) / contentWidth,
          (availableHeight - edgePadding * 2) / contentHeight
        )
      )
    );
    const targetCenterX = (visibleLeft + visibleRight) / 2;
    const targetCenterY = (visibleTop + visibleBottom) / 2;
    const contentCenterX = contentLeft + contentWidth / 2;
    const contentCenterY = contentTop + contentHeight / 2;

    setCanvasView({
      zoom: Number(targetZoom.toFixed(3)),
      panX: Number((targetCenterX - contentCenterX * targetZoom).toFixed(2)),
      panY: Number((targetCenterY - contentCenterY * targetZoom).toFixed(2))
    });
    pulseZoomHud();
  }

  function handleViewportPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // The dot grid is drawing with this press and holds the pointer; dragging the artboard would steal it.
    if (drawingPointerDowns.has(event.nativeEvent)) {
      return;
    }
    const target = event.target as HTMLElement;
    const artboard = target.closest("[data-artboard-id]") as HTMLElement | null;
    const hitDotCell = target.closest("[data-dot-cell='true']");
    const hitArtboardAction = target.closest("[data-artboard-action='true']");

    if (hitArtboardAction) {
      return;
    }

    if (artboard && !hitDotCell) {
      const loaderId = artboard.dataset.artboardId;
      const loader = loaders.find((item) => item.id === loaderId);
      if (!loaderId || !loader) {
        return;
      }
      const framesToMove = loader.sequenceId ? sequenceGroups.get(loader.sequenceId) ?? [loader] : [loader];
      dragArtboardRef.current = {
        pointerId: event.pointerId,
        loaderId,
        startX: event.clientX,
        startY: event.clientY,
        originX: loader.artboard.x,
        originY: loader.artboard.y,
        loaderOrigins: framesToMove.map((item) => ({
          id: item.id,
          x: item.artboard.x,
          y: item.artboard.y
        }))
      };
      if (previewScope !== "none" || selectedLoaderId !== loaderId) {
        setPreviewScope("none");
      }
      selectLoader(loaderId);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (artboard || target.closest("[data-artboard-interactive='true']")) {
      return;
    }

    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originPanX: canvas.panX,
      originPanY: canvas.panY,
      moved: false
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleViewportPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragArtboardRef.current;
    if (dragState && dragState.pointerId === event.pointerId) {
      const deltaX = (event.clientX - dragState.startX) / canvas.zoom;
      const deltaY = (event.clientY - dragState.startY) / canvas.zoom;
      if (dragState.loaderOrigins.length > 1) {
        moveLoaders(dragState.loaderOrigins.map((origin) => ({
          id: origin.id,
          x: origin.x + deltaX,
          y: origin.y + deltaY
        })));
        return;
      }

      moveLoader(dragState.loaderId, {
        x: dragState.originX + deltaX,
        y: dragState.originY + deltaY
      });
      return;
    }

    const state = panStateRef.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > 4) {
      state.moved = true;
    }

    setCanvasView({
      zoom: canvas.zoom,
      panX: state.originPanX + (event.clientX - state.startX),
      panY: state.originPanY + (event.clientY - state.startY)
    });
  }

  // A click on empty canvas used to clear the selection, which hid the settings sidebar mid-edit.
  // It now keeps the selection; Escape deselects instead (see the keydown effect).
  function endPan(event?: ReactPointerEvent<HTMLDivElement>) {
    const activePointerId = panStateRef.current?.pointerId ?? dragArtboardRef.current?.pointerId;
    if (event && activePointerId !== undefined && event.currentTarget.hasPointerCapture(activePointerId)) {
      event.currentTarget.releasePointerCapture(activePointerId);
    }
    panStateRef.current = null;
    dragArtboardRef.current = null;
    setIsPanning(false);
  }

  return {
    viewportRef,
    isPanning,
    showZoomHud,
    handleCanvasWheel,
    handleViewportPointerDown,
    handleViewportPointerMove,
    endPan,
    centerCanvasContent
  };
}

export type CanvasViewport = ReturnType<typeof useCanvasViewport>;
