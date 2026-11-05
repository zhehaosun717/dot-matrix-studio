// Browser decoding (canvas, createImageBitmap, ImageDecoder) for image import; the pixel maths is @/core/image-pixels.
import {
  type ImportedRaster,
  type ImportFit,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_FRAMES,
  sampleFrameIndices,
  sequenceFps
} from "@/core/image-pixels";

/** Decoded size cap (~60 MP): a tiny but huge-dimensioned PNG must not exhaust memory. */
const MAX_IMPORT_PIXELS = 60_000_000;

/**
 * Downscales by halving until close to the target, so every cell averages its whole area
 * (one big drawImage step only samples a few source pixels per cell).
 */
function halveTowards(source: CanvasImageSource, width: number, height: number, targetWidth: number, targetHeight: number) {
  let current: CanvasImageSource = source;
  let w = width, h = height;
  while (w / 2 >= targetWidth * 2 && h / 2 >= targetHeight * 2) {
    const next = document.createElement("canvas");
    next.width = Math.max(1, Math.round(w / 2));
    next.height = Math.max(1, Math.round(h / 2));
    const context = next.getContext("2d");
    if (!context) break;
    context.imageSmoothingQuality = "high";
    context.drawImage(current, 0, 0, next.width, next.height);
    current = next;
    w = next.width;
    h = next.height;
  }
  return { image: current, width: w, height: h };
}

/** Scales one picture to the grid (letterboxed or cropped); each cell takes the averaged colour of its area. */
function rasterize(source: CanvasImageSource, width: number, height: number, rows: number, cols: number, fit: ImportFit): Uint8ClampedArray {
  if (width * height > MAX_IMPORT_PIXELS) throw new Error("image dimensions are too large");
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2D canvas unavailable");
  const scale = fit === "cover" ? Math.max(cols / width, rows / height) : Math.min(cols / width, rows / height);
  const drawWidth = width * scale, drawHeight = height * scale;
  const reduced = halveTowards(source, width, height, drawWidth, drawHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(reduced.image, (cols - drawWidth) / 2, (rows - drawHeight) / 2, drawWidth, drawHeight);
  return context.getImageData(0, 0, cols, rows).data;
}

type DecodedFrame = { image: CanvasImageSource & { displayWidth: number; displayHeight: number; duration: number | null; close(): void } };
type ImageDecoderLike = {
  completed: Promise<void>;
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(options: { frameIndex: number }): Promise<DecodedFrame>;
  close(): void;
};
type ImageDecoderCtor = {
  new (init: { data: ArrayBuffer; type: string }): ImageDecoderLike;
  isTypeSupported(type: string): Promise<boolean>;
};

/** Every frame of an animated image (GIF, WebP, APNG) via WebCodecs, or null when unsupported or still. */
async function rasterizeAnimation(file: File, rows: number, cols: number, fit: ImportFit): Promise<ImportedRaster | null> {
  const Decoder = (globalThis as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
  if (!Decoder || !(await Decoder.isTypeSupported(file.type))) return null;
  const decoder = new Decoder({ data: await file.arrayBuffer(), type: file.type });
  try {
    // frameCount can still grow until the whole file is parsed.
    await decoder.tracks.ready;
    await decoder.completed;
    const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 1;
    if (frameCount < 2) return null;
    const frames: Uint8ClampedArray[] = [];
    let totalMs = 0;
    const picked = new Set(sampleFrameIndices(frameCount, MAX_IMPORT_FRAMES));
    for (let index = 0; index < frameCount; index++) {
      const { image } = await decoder.decode({ frameIndex: index });
      try {
        totalMs += (image.duration ?? 100_000) / 1000; // microseconds
        if (picked.has(index)) frames.push(rasterize(image, image.displayWidth, image.displayHeight, rows, cols, fit));
      } finally {
        image.close();
      }
    }
    return { frames, fps: sequenceFps(totalMs, frames.length) };
  } finally {
    decoder.close();
  }
}

/**
 * Reads an image file into grid-sized rasters: every sampled frame of an animated image, or the single
 * picture. Browser-only (canvas, WebCodecs).
 */
export async function rasterizeImageFile(file: File, rows: number, cols: number, fit: ImportFit): Promise<ImportedRaster> {
  if (!file.type.startsWith("image/")) throw new Error("not an image file");
  if (file.size > MAX_IMPORT_BYTES) throw new Error("image is larger than 20 MB");
  const animated = await rasterizeAnimation(file, rows, cols, fit).catch((error) => {
    console.warn("[editor] animated decode failed, importing the first frame", error);
    return null;
  });
  if (animated) return animated;
  const bitmap = await createImageBitmap(file);
  try {
    return { frames: [rasterize(bitmap, bitmap.width, bitmap.height, rows, cols, fit)], fps: 10 };
  } finally {
    bitmap.close();
  }
}
