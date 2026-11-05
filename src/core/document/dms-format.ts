/**
 * The .dms project file (docs/refactor-plan.md, section 6): a Workspace as JSON, pixel buffers as base64
 * of little-endian 16-bit palette indices. Pure. Files are untrusted: parseWorkspace checks every field,
 * never throws, and names the first problem by its path ("documents[0].cels[3].pixels: ...").
 */
import {
  Cel,
  CelKey,
  celKey,
  Document,
  Frame,
  Layer,
  LibraryItem,
  Palette,
  WORKSPACE_FORMAT,
  WORKSPACE_FORMAT_VERSION,
  Workspace
} from "@/core/document/types";
import type { AnimationStyle, CellShape, Direction, InactiveStyle, MotionPresetId } from "@/types/dot-motion";

/** Limits for what a file may contain (the editor itself uses far less: 32x32, 16 layers). */
export const DMS_LIMITS = {
  side: 128,
  layers: 64,
  frames: 1024,
  documents: 512,
  libraryItems: 1024,
  paletteColors: 65536,
  celSide: 1024,
  celOffset: 4096,
  text: 200
} as const;

const MOTION_PRESETS: readonly MotionPresetId[] = ["wave", "sweep", "bloom", "fish-eye", "checkerboard", "pinwheel", "burst", "random", "diamond-wave", "radar", "heartbeat", "breathing", "static"];
const DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right", "up-left", "up-right", "down-left", "down-right"];
const ANIMATION_STYLES: readonly AnimationStyle[] = ["opacity-only", "pulse-size", "fisheye", "depth-shift", "bloom-pop"];
const INACTIVE_STYLES: readonly InactiveStyle[] = ["none", "static-dim", "breathe", "ghost"];
const CELL_SHAPES: readonly CellShape[] = ["rectangle", "triangle", "star", "diamond", "hexagon", "heart", "square", "rounded-rect", "circle", "pill"];
const HEX = /^#[0-9A-Fa-f]{6}$/;

// ---------------------------------------------------------------- base64 of 16-bit indices

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Map([...ALPHABET].map((char, index) => [char, index]));

export function encodeBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : "=";
  }
  return out;
}

/** null when the text is not canonical base64. */
export function decodeBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  for (let i = 0, o = 0; i < text.length; i += 4) {
    const values: number[] = [];
    for (let k = 0; k < 4; k++) {
      const char = text[i + k];
      if (char === "=" && i + 4 === text.length && k >= 4 - padding) values.push(0);
      else {
        const value = LOOKUP.get(char);
        if (value === undefined) return null;
        values.push(value);
      }
    }
    const n = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    if (o < bytes.length) bytes[o++] = (n >> 16) & 255;
    if (o < bytes.length) bytes[o++] = (n >> 8) & 255;
    if (o < bytes.length) bytes[o++] = n & 255;
  }
  return bytes;
}

const indicesToBase64 = (indices: Uint16Array) => {
  const bytes = new Uint8Array(indices.length * 2);
  indices.forEach((value, i) => {
    bytes[i * 2] = value & 255;
    bytes[i * 2 + 1] = value >> 8;
  });
  return encodeBase64(bytes);
};

// ---------------------------------------------------------------- writing

type SerializedCel = Omit<Cel, "pixels"> & { frame: string; layer: string; pixels: string };

function serializeDocument(doc: Document) {
  // Cels as explicit (frame, layer) pairs: ids may contain ":", so "frame:layer" keys cannot be split back.
  const cels: SerializedCel[] = [];
  for (const frame of doc.frames) {
    for (const layer of doc.layers) {
      const cel = doc.cels[celKey(frame.id, layer.id)];
      if (!cel) continue;
      cels.push({
        frame: frame.id,
        layer: layer.id,
        x: cel.x,
        y: cel.y,
        width: cel.width,
        height: cel.height,
        pixels: indicesToBase64(cel.pixels),
        ...(cel.visible === false ? { visible: false as const } : {})
      });
    }
  }
  return { ...doc, cels };
}

/** The workspace as .dms text (stable: the same workspace always gives the same text). */
export function serializeWorkspace(workspace: Workspace): string {
  return JSON.stringify(
    {
      format: workspace.format,
      formatVersion: workspace.formatVersion,
      id: workspace.id,
      name: workspace.name,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      view: workspace.view,
      documents: workspace.documents.map(serializeDocument),
      library: workspace.library.map((item) => ({ ...item, pixels: indicesToBase64(item.pixels) }))
    },
    null,
    1
  );
}

// ---------------------------------------------------------------- reading

class Invalid extends Error {
  constructor(readonly path: string, message: string) {
    super(message);
  }
}
const fail = (path: string, message: string): never => {
  throw new Invalid(path, message);
};

type Raw = Record<string, unknown>;
const object = (value: unknown, path: string): Raw =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : fail(path, "expected an object");
const list = (value: unknown, path: string, max: number): unknown[] => {
  if (!Array.isArray(value)) return fail(path, "expected a list");
  if (value.length > max) fail(path, `more than ${max} entries`);
  return value;
};
const text = (value: unknown, path: string, { allowEmpty = true } = {}): string => {
  if (typeof value !== "string") return fail(path, "expected text");
  if (!allowEmpty && !value) fail(path, "must not be empty");
  if (value.length > DMS_LIMITS.text) fail(path, `longer than ${DMS_LIMITS.text} characters`);
  return value;
};
const integer = (value: unknown, path: string, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) return fail(path, "expected a whole number");
  if (value < min || value > max) fail(path, `must be between ${min} and ${max}`);
  return value;
};
const number = (value: unknown, path: string, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fail(path, "expected a number");
  if (value < min || value > max) fail(path, `must be between ${min} and ${max}`);
  return value;
};
const flag = (value: unknown, path: string): boolean => (typeof value === "boolean" ? value : fail(path, "expected true or false"));
const choice = <T extends string>(value: unknown, path: string, allowed: readonly T[]): T =>
  allowed.includes(value as T) ? (value as T) : fail(path, `expected one of ${allowed.join(", ")}`);
const color = (value: unknown, path: string): string => {
  const hex = text(value, path);
  if (!HEX.test(hex)) fail(path, "expected a colour like #66BDFF");
  return hex.toUpperCase();
};
const uniqueIds = (ids: string[], path: string) => {
  const seen = new Set<string>();
  ids.forEach((id, i) => {
    if (seen.has(id)) fail(`${path}[${i}].id`, `duplicate id "${id}"`);
    seen.add(id);
  });
};

function indices(value: unknown, path: string, count: number, paletteSize: number): Uint16Array {
  if (typeof value !== "string") return fail(path, "expected base64 text");
  // Checked before decoding, so a huge string is rejected without allocating for it.
  if (value.length !== Math.ceil((count * 2) / 3) * 4) fail(path, `expected ${count} pixels`);
  const bytes = decodeBase64(value);
  if (!bytes) return fail(path, "not valid base64");
  if (bytes.length !== count * 2) fail(path, `expected ${count} pixels, found ${bytes.length / 2}`);
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
    if (out[i] >= paletteSize) fail(path, `pixel ${i} uses colour ${out[i]}, the palette has ${paletteSize}`);
  }
  return out;
}

function palette(value: unknown, path: string): Palette {
  const entries = list(value, path, DMS_LIMITS.paletteColors);
  if (entries.length < 2) fail(path, "needs the two reserved entries (transparent and base colour)");
  return entries.map((entry, i) => (i < 2 ? (text(entry, `${path}[${i}]`), "") : color(entry, `${path}[${i}]`)));
}

function size(value: unknown, path: string) {
  const raw = object(value, path);
  return { width: integer(raw.width, `${path}.width`, 1, DMS_LIMITS.side), height: integer(raw.height, `${path}.height`, 1, DMS_LIMITS.side) };
}

function parseDocument(value: unknown, path: string): Document {
  const raw = object(value, path);
  const pal = palette(raw.palette, `${path}.palette`);
  const layers: Layer[] = list(raw.layers, `${path}.layers`, DMS_LIMITS.layers).map((entry, i) => {
    const layer = object(entry, `${path}.layers[${i}]`);
    return { id: text(layer.id, `${path}.layers[${i}].id`, { allowEmpty: false }), name: text(layer.name, `${path}.layers[${i}].name`), visible: flag(layer.visible, `${path}.layers[${i}].visible`) };
  });
  if (!layers.length) fail(`${path}.layers`, "needs at least one layer");
  uniqueIds(layers.map((layer) => layer.id), `${path}.layers`);

  const frames: Frame[] = list(raw.frames, `${path}.frames`, DMS_LIMITS.frames).map((entry, i) => {
    const frame = object(entry, `${path}.frames[${i}]`);
    return {
      id: text(frame.id, `${path}.frames[${i}].id`, { allowEmpty: false }),
      ...(frame.name !== undefined ? { name: text(frame.name, `${path}.frames[${i}].name`) } : {}),
      durationMs: number(frame.durationMs, `${path}.frames[${i}].durationMs`, 1, 60_000)
    };
  });
  if (!frames.length) fail(`${path}.frames`, "needs at least one frame");
  uniqueIds(frames.map((frame) => frame.id), `${path}.frames`);

  const frameIds = new Set(frames.map((frame) => frame.id));
  const layerIds = new Set(layers.map((layer) => layer.id));
  const cels: Record<CelKey, Cel> = {};
  const seenPairs = new Set<string>();
  list(raw.cels, `${path}.cels`, DMS_LIMITS.frames * DMS_LIMITS.layers).forEach((entry, i) => {
    const at = `${path}.cels[${i}]`;
    const cel = object(entry, at);
    const frame = text(cel.frame, `${at}.frame`);
    const layer = text(cel.layer, `${at}.layer`);
    if (!frameIds.has(frame)) fail(`${at}.frame`, `no frame "${frame}"`);
    if (!layerIds.has(layer)) fail(`${at}.layer`, `no layer "${layer}"`);
    const pair = JSON.stringify([frame, layer]);
    if (seenPairs.has(pair)) fail(at, "a second cel for the same frame and layer");
    seenPairs.add(pair);
    const width = integer(cel.width, `${at}.width`, 1, DMS_LIMITS.celSide);
    const height = integer(cel.height, `${at}.height`, 1, DMS_LIMITS.celSide);
    if (cel.visible !== undefined && cel.visible !== false) fail(`${at}.visible`, "may only be false");
    cels[celKey(frame, layer)] = {
      x: integer(cel.x, `${at}.x`, -DMS_LIMITS.celOffset, DMS_LIMITS.celOffset),
      y: integer(cel.y, `${at}.y`, -DMS_LIMITS.celOffset, DMS_LIMITS.celOffset),
      width,
      height,
      pixels: indices(cel.pixels, `${at}.pixels`, width * height, pal.length),
      ...(cel.visible === false ? { visible: false as const } : {})
    };
  });

  const render = object(raw.render, `${path}.render`);
  const background = object(render.background, `${path}.render.background`);
  const glow = object(render.glow, `${path}.render.glow`);
  const motion = object(raw.motion, `${path}.motion`);
  const origin = object(motion.origin, `${path}.motion.origin`);
  const position = object(raw.position, `${path}.position`);
  const activeLayerId = typeof raw.activeLayerId === "string" && layerIds.has(raw.activeLayerId) ? raw.activeLayerId : layers[layers.length - 1].id;
  const activeFrameId = typeof raw.activeFrameId === "string" && frameIds.has(raw.activeFrameId) ? raw.activeFrameId : frames[0].id;
  return {
    id: text(raw.id, `${path}.id`, { allowEmpty: false }),
    name: text(raw.name, `${path}.name`),
    size: size(raw.size, `${path}.size`),
    palette: pal,
    layers,
    frames,
    cels,
    activeLayerId,
    activeFrameId,
    position: { x: number(position.x, `${path}.position.x`, -1e7, 1e7), y: number(position.y, `${path}.position.y`, -1e7, 1e7) },
    render: {
      baseColor: color(render.baseColor, `${path}.render.baseColor`),
      baseAlpha: number(render.baseAlpha, `${path}.render.baseAlpha`, 0, 1),
      background: { color: color(background.color, `${path}.render.background.color`), alpha: number(background.alpha, `${path}.render.background.alpha`, 0, 1) },
      glow: { enabled: flag(glow.enabled, `${path}.render.glow.enabled`), size: number(glow.size, `${path}.render.glow.size`, 0, 48) },
      gap: number(render.gap, `${path}.render.gap`, 0, 20),
      cellSize: number(render.cellSize, `${path}.render.cellSize`, 1, 256),
      cellShape: choice(render.cellShape, `${path}.render.cellShape`, CELL_SHAPES),
      innerRadius: number(render.innerRadius, `${path}.render.innerRadius`, 0, 1)
    },
    playback: choice(raw.playback, `${path}.playback`, ["frames", "motion"] as const),
    motion: {
      presetId: choice(motion.presetId, `${path}.motion.presetId`, MOTION_PRESETS),
      durationMs: number(motion.durationMs, `${path}.motion.durationMs`, 1, 60_000),
      speed: number(motion.speed, `${path}.motion.speed`, 0.01, 100),
      direction: choice(motion.direction, `${path}.motion.direction`, DIRECTIONS),
      origin: { x: number(origin.x, `${path}.motion.origin.x`, -1e4, 1e4), y: number(origin.y, `${path}.motion.origin.y`, -1e4, 1e4) },
      style: choice(motion.style, `${path}.motion.style`, ANIMATION_STYLES),
      inactiveStyle: choice(motion.inactiveStyle, `${path}.motion.inactiveStyle`, INACTIVE_STYLES),
      scaleIntensity: number(motion.scaleIntensity, `${path}.motion.scaleIntensity`, 0, 1),
      fps: number(motion.fps, `${path}.motion.fps`, 1, 120)
    }
  };
}

function parseLibraryItem(value: unknown, path: string): LibraryItem {
  const raw = object(value, path);
  const itemSize = size(raw.size, `${path}.size`);
  const pal = palette(raw.palette, `${path}.palette`);
  return {
    id: text(raw.id, `${path}.id`, { allowEmpty: false }),
    name: text(raw.name, `${path}.name`),
    size: itemSize,
    palette: pal,
    pixels: indices(raw.pixels, `${path}.pixels`, itemSize.width * itemSize.height, pal.length)
  };
}

/** Upgrades raw file contents of an older format version, one version at a time. */
export type FormatUpgrade = (raw: Raw) => Raw;
/** n -> n + 1. Empty while only format 1 exists. */
export const FORMAT_UPGRADES: Readonly<Record<number, FormatUpgrade>> = {};

export function upgradeFormat(raw: Raw, upgrades: Readonly<Record<number, FormatUpgrade>> = FORMAT_UPGRADES, target: number = WORKSPACE_FORMAT_VERSION): Raw {
  let current = raw;
  let version = integer(current.formatVersion, "formatVersion", 1, Number.MAX_SAFE_INTEGER);
  if (version > target) fail("formatVersion", `the file was made by a newer version of the app (format ${version}, this app reads up to ${target})`);
  while (version < target) {
    const step = upgrades[version];
    if (!step) fail("formatVersion", `no upgrade from format ${version}`);
    current = step(current);
    version++;
    if (current.formatVersion !== version) fail("formatVersion", `upgrade to format ${version} did not set formatVersion`);
  }
  return current;
}

export type ParseResult = { ok: true; workspace: Workspace } | { ok: false; error: string };

/** Reads .dms text. Never throws: any problem is reported with the path of the first bad field. */
export function parseWorkspace(input: string, upgrades: Readonly<Record<number, FormatUpgrade>> = FORMAT_UPGRADES): ParseResult {
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      return { ok: false, error: "not a .dms file (not valid JSON)" };
    }
    const top = object(parsed, "(file)");
    if (top.format !== WORKSPACE_FORMAT) return { ok: false, error: "not a .dms file (format is missing or wrong)" };
    const raw = upgradeFormat(top, upgrades);
    const view = object(raw.view, "view");
    const documents = list(raw.documents, "documents", DMS_LIMITS.documents).map((doc, i) => parseDocument(doc, `documents[${i}]`));
    uniqueIds(documents.map((doc) => doc.id), "documents");
    const library = list(raw.library, "library", DMS_LIMITS.libraryItems).map((item, i) => parseLibraryItem(item, `library[${i}]`));
    uniqueIds(library.map((item) => item.id), "library");
    return {
      ok: true,
      workspace: {
        format: WORKSPACE_FORMAT,
        formatVersion: WORKSPACE_FORMAT_VERSION,
        id: text(raw.id, "id", { allowEmpty: false }),
        name: text(raw.name, "name"),
        createdAt: text(raw.createdAt, "createdAt"),
        updatedAt: text(raw.updatedAt, "updatedAt"),
        documents,
        library,
        view: { zoom: number(view.zoom, "view.zoom", 0.01, 100), panX: number(view.panX, "view.panX", -1e7, 1e7), panY: number(view.panY, "view.panY", -1e7, 1e7) }
      }
    };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: `${error.path}: ${error.message}` };
    return { ok: false, error: `unreadable file (${error instanceof Error ? error.message : String(error)})` };
  }
}
