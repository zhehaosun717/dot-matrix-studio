/** Drawing layers of one artboard. */
import * as layerOps from "@/core/layer-ops";
import type { EditorState, EditorSet } from "./types";
import { createEditLoader } from "./project-helpers";

export type LayerSlice = Pick<EditorState, "addLayer" | "duplicateLayer" | "deleteLayer" | "selectLayer" | "setLayerVisible" | "renameLayer" | "reorderLayer" | "mergeLayerDown" | "moveLayerBy" | "addLayerFromPixels" | "liftToLayer">;

export function createLayerSlice(set: EditorSet): LayerSlice {
  const editLoader = createEditLoader(set);
  return {
    addLayer: (loaderId, name) => editLoader(loaderId, (loader) => layerOps.addEmptyLayer(loader, name)),
    duplicateLayer: (loaderId, layerId, name) => editLoader(loaderId, (loader) => layerOps.duplicateLayer(loader, layerId, name)),
    deleteLayer: (loaderId, layerId) => editLoader(loaderId, (loader) => layerOps.deleteLayer(loader, layerId)),
    selectLayer: (loaderId, layerId) => editLoader(loaderId, (loader) => layerOps.selectLayer(loader, layerId)),
    setLayerVisible: (loaderId, layerId, visible) => editLoader(loaderId, (loader) => layerOps.setLayerVisible(loader, layerId, visible)),
    renameLayer: (loaderId, layerId, name) => editLoader(loaderId, (loader) => layerOps.renameLayer(loader, layerId, name)),
    reorderLayer: (loaderId, layerId, direction) => editLoader(loaderId, (loader) => layerOps.reorderLayer(loader, layerId, direction)),
    mergeLayerDown: (loaderId, layerId) => editLoader(loaderId, (loader) => layerOps.mergeLayerDown(loader, layerId)),
    moveLayerBy: (loaderId, layerId, dx, dy) => editLoader(loaderId, (loader) => layerOps.moveLayerBy(loader, layerId, dx, dy)),
    addLayerFromPixels: (loaderId, name, pixels) => {
      let layerId: string | null = null;
      editLoader(loaderId, (loader) => {
        const result = layerOps.addLayerWithPixels(loader, name, pixels);
        layerId = result.layerId;
        return result.loader;
      });
      return layerId;
    },
    liftToLayer: (loaderId, cells, name) => {
      let layerId: string | null = null;
      editLoader(loaderId, (loader) => {
        const result = layerOps.liftToLayer(loader, cells, name);
        layerId = result.layerId;
        return result.loader;
      });
      return layerId;
    },
  };
}
