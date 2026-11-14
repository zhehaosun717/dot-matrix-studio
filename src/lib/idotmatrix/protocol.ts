import { UPLOAD_CHUNK_BYTES } from "@/lib/idotmatrix/constants";

const GIF_HEADER_BYTES = 16;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** zlib CRC-32, as the firmware validates uploaded GIFs with it. */
export function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const SCREEN_ON = Uint8Array.of(5, 0, 7, 1, 1);
export const SCREEN_OFF = Uint8Array.of(5, 0, 7, 1, 0);
export const MIN_HARDWARE_BRIGHTNESS = 5;
export const MAX_HARDWARE_BRIGHTNESS = 100;

const clampByte = (value: number | undefined, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(255, Math.max(0, Math.round(value))) : fallback;

/** Clamps hardware LED brightness percentage to the vendor panel's 5..100 range. */
export function clampHardwareBrightness(percent: number): number {
  if (!Number.isFinite(percent)) return MAX_HARDWARE_BRIGHTNESS;
  return Math.min(MAX_HARDWARE_BRIGHTNESS, Math.max(MIN_HARDWARE_BRIGHTNESS, Math.round(percent)));
}

/** Switches the panel's LED matrix on or off (`BleProtocolN.sendSwitchplate`). */
export function buildSwitchplateCommand(on: boolean): Uint8Array {
  return on ? SCREEN_ON : SCREEN_OFF;
}

/** Sets panel hardware global brightness 5..100% (`BleProtocolN.setLight`). */
export function buildBrightnessCommand(percent: number): Uint8Array {
  return Uint8Array.of(5, 0, 4, 128, clampHardwareBrightness(percent));
}

/** Flips the LED display orientation 180 degrees (`BleProtocolN.setRotate180`). */
export function buildRotateCommand(flipped: boolean): Uint8Array {
  return Uint8Array.of(5, 0, 6, 128, flipped ? 1 : 0);
}

/** Sets a solid fullscreen RGB colour (`BleProtocolN.sendColor`; 0,0,0 clears the panel). */
export function buildColorCommand(r: number, g: number, b: number): Uint8Array {
  return Uint8Array.of(7, 0, 2, 2, clampByte(r), clampByte(g), clampByte(b));
}

/** Syncs the panel's internal RTC clock (`BleProtocolN.synchronizedTime`, weekday 1..7 = Mon..Sun). */
export function buildSyncTimeCommand(date: Date = new Date()): Uint8Array {
  const year = Math.max(0, date.getFullYear() - 2000) & 0xff;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = date.getDay() === 0 ? 7 : date.getDay();
  return Uint8Array.of(11, 0, 1, 128, year, month, day, weekday, date.getHours(), date.getMinutes(), date.getSeconds());
}

/** Switches to the panel's onboard clock display (`BleProtocolN.sendClockMode`). */
export function buildClockModeCommand(
  style = 0,
  options: { showDate?: boolean; hour24?: boolean; r?: number; g?: number; b?: number } = {}
): Uint8Array {
  const styleByte = (clampByte(style) & 0x07) | ((options.showDate ?? true) ? 0x80 : 0) | ((options.hour24 ?? true) ? 0x40 : 0);
  return Uint8Array.of(8, 0, 6, 1, styleByte, clampByte(options.r, 255), clampByte(options.g, 255), clampByte(options.b, 255));
}

/** DIY ("draw") mode accepts single PNG frames. Entering it blanks the panel for ~200–400 ms (hardware). */
export const DIY_MODE_ON = Uint8Array.of(5, 0, 4, 1, 1);

const IMAGE_HEADER_BYTES = 9;

/**
 * Splits a PNG into 4 KiB chunks, each with the 9-byte DIY header of
 * uint16 chunk length, 00 00, 00 first / 02 continuation, uint32 PNG length (DeskDot, hardware-verified).
 */
export function buildImageChunks(png: Uint8Array): Uint8Array[] {
  if (png.length === 0) throw new Error("PNG is empty");
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < png.length; offset += UPLOAD_CHUNK_BYTES) {
    const body = png.subarray(offset, offset + UPLOAD_CHUNK_BYTES);
    const part = new Uint8Array(IMAGE_HEADER_BYTES + body.length);
    const view = new DataView(part.buffer);
    view.setUint16(0, part.length, true);
    part.set([0, 0, offset === 0 ? 0 : 2], 2);
    view.setUint32(5, png.length, true);
    part.set(body, IMAGE_HEADER_BYTES);
    parts.push(part);
  }
  return parts;
}

/**
 * Frames a PNG for DIY mode: per 4 KiB chunk a 9-byte header of
 * uint16 packet length, 00 00, 00 first / 02 continuation, uint32 PNG length (DeskDot, hardware-verified).
 */
export function buildImageFrame(png: Uint8Array): Uint8Array {
  const parts = buildImageChunks(png);
  const frame = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((offset, part) => { frame.set(part, offset); return offset + part.length; }, 0);
  return frame;
}

/** The panel answers each DIY frame with 05 00 00 00 01, ~200 ms after the write. */
export function isImageAck(bytes: Uint8Array) {
  return bytes.length >= 5 && bytes[0] === 5 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0;
}

/**
 * Frames a GIF for upload: per 4 KiB chunk a 16-byte header of
 * uint16 chunk length, 01 00, 00 first / 02 continuation, uint32 GIF length, uint32 CRC-32, 05 00 0D.
 * The header tail matches DeskDot's hardware-verified encoder (vendor GIF type 13).
 */
export function buildGifChunks(gif: Uint8Array): Uint8Array[] {
  if (gif.length === 0) throw new Error("GIF is empty");
  const crc = crc32(gif);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < gif.length; offset += UPLOAD_CHUNK_BYTES) {
    const body = gif.subarray(offset, offset + UPLOAD_CHUNK_BYTES);
    const chunk = new Uint8Array(GIF_HEADER_BYTES + body.length);
    const view = new DataView(chunk.buffer);
    view.setUint16(0, chunk.length, true);
    chunk.set([1, 0, offset === 0 ? 0 : 2], 2);
    view.setUint32(5, gif.length, true);
    view.setUint32(9, crc, true);
    chunk.set([5, 0, 13], 13);
    chunk.set(body, GIF_HEADER_BYTES);
    chunks.push(chunk);
  }
  return chunks;
}

const isGifReply = (bytes: Uint8Array) =>
  bytes.length >= 5 && bytes[0] === 5 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;

/** The panel answers every GIF chunk with 05 00 01 00 xx (01 more expected, 03 complete). */
export function isGifAck(bytes: Uint8Array) {
  return isGifReply(bytes) && (bytes[4] === 1 || bytes[4] === 3);
}

/** The panel signals a GIF chunk/transfer error with 05 00 01 00 00 or 05 00 01 00 02. */
export function isGifErrorAck(bytes: Uint8Array) {
  return isGifReply(bytes) && (bytes[4] === 0 || bytes[4] === 2);
}
