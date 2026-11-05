/** Palettes, cels and compositing for the document model. Pure; inputs are never modified. */
import { BASE_COLOR, Cel, celKey, Document, FIRST_COLOR, Palette, TRANSPARENT } from "@/core/document/types";

/** A pixel at grid position (x, y) with a palette index. */
export type PlacedPixel = { x: number; y: number; index: number };

/**
 * Collects colours into a palette while handing out their indices. "" is the base colour; colours are
 * compared case-insensitively and stored upper-case.
 */
export function createPaletteBuilder(initial: Palette = ["", ""]) {
  const colors = [...initial];
  const indexByColor = new Map(colors.slice(FIRST_COLOR).map((color, i) => [color.toUpperCase(), i + FIRST_COLOR]));
  return {
    indexOf(color: string): number {
      if (color === "") return BASE_COLOR;
      const key = color.toUpperCase();
      const existing = indexByColor.get(key);
      if (existing !== undefined) return existing;
      colors.push(key);
      indexByColor.set(key, colors.length - 1);
      return colors.length - 1;
    },
    palette: (): Palette => [...colors]
  };
}

/** "" for the base colour, "#RRGGBB" for a concrete colour, null for transparent or unknown indices. */
export function colorOf(palette: Palette, index: number): string | null {
  if (index === BASE_COLOR) return "";
  if (index === TRANSPARENT || index >= palette.length) return null;
  return palette[index];
}

/** The smallest cel holding the given pixels (null when there are none). Later pixels win on duplicates. */
export function celFromPixels(pixels: readonly PlacedPixel[]): Cel | null {
  const lit = pixels.filter((pixel) => pixel.index !== TRANSPARENT);
  if (!lit.length) return null;
  const x = Math.min(...lit.map((p) => p.x));
  const y = Math.min(...lit.map((p) => p.y));
  const width = Math.max(...lit.map((p) => p.x)) - x + 1;
  const height = Math.max(...lit.map((p) => p.y)) - y + 1;
  const buffer = new Uint16Array(width * height);
  for (const pixel of lit) buffer[(pixel.y - y) * width + (pixel.x - x)] = pixel.index;
  return { x, y, width, height, pixels: buffer };
}

/** The lit pixels of a cel at their grid positions (may lie outside the grid). */
export function celPixels(cel: Cel): PlacedPixel[] {
  const out: PlacedPixel[] = [];
  for (let row = 0; row < cel.height; row++) {
    for (let col = 0; col < cel.width; col++) {
      const index = cel.pixels[row * cel.width + col];
      if (index !== TRANSPARENT) out.push({ x: cel.x + col, y: cel.y + row, index });
    }
  }
  return out;
}

/**
 * The frame as one width x height buffer of palette indices: visible layers bottom to top, a lit pixel
 * of a higher layer replaces whatever is below it (the base colour included), pixels off the grid are cut.
 */
export function compositeFrame(doc: Document, frameIndex: number): Uint16Array {
  const { width, height } = doc.size;
  const out = new Uint16Array(width * height);
  const frame = doc.frames[frameIndex];
  if (!frame) return out;
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const cel = doc.cels[celKey(frame.id, layer.id)];
    if (!cel || cel.visible === false) continue;
    for (const pixel of celPixels(cel)) {
      if (pixel.x < 0 || pixel.y < 0 || pixel.x >= width || pixel.y >= height) continue;
      out[pixel.y * width + pixel.x] = pixel.index;
    }
  }
  return out;
}

/**
 * The frame in today's flat form: lit cells (row-major indices, ascending) and the cells that have their
 * own colour. Equal to flattenLayers() on the layers it was migrated from.
 */
export function frameCells(doc: Document, frameIndex: number): { activeCells: number[]; cellColors: Record<string, string> } {
  const composite = compositeFrame(doc, frameIndex);
  const activeCells: number[] = [];
  const cellColors: Record<string, string> = {};
  composite.forEach((index, cell) => {
    const color = colorOf(doc.palette, index);
    if (color === null) return;
    activeCells.push(cell);
    if (color) cellColors[cell] = color;
  });
  return { activeCells, cellColors };
}
