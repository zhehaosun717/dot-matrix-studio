import { buildGifChunks, buildImageChunks, DIY_MODE_ON, isGifAck, isGifErrorAck, isImageAck } from "@/lib/idotmatrix/protocol";
import { backgroundSleep } from "@/lib/idotmatrix/background-timer";

/** The GATT pieces MatrixLink needs; Web Bluetooth objects satisfy this shape. */
export type MatrixGatt = {
  name: string;
  write: { writeValueWithoutResponse(data: Uint8Array): Promise<void> };
  notify: EventTarget & { value?: DataView | null };
  disconnect(): void;
};

export type MatrixLinkOptions = {
  /** Back-to-back unpaced packets are silently dropped by the panel (hardware). */
  packetGapMs?: number;
  ackTimeoutMs?: number;
  /** Rapid repeat GIF uploads make the panel stop acking (hardware). */
  cooldownMs?: number;
  /** Packet sizes to probe, largest first; a size is kept once a full-size packet goes through. */
  packetSizes?: readonly number[];
  /** First retry delay for a failed write; doubles per attempt. */
  retryDelayMs?: number;
  /** How long a live frame waits for its predecessor's ack before moving on. */
  frameAckTimeoutMs?: number;
  /** Entering DIY mode blanks the panel briefly; frames sent sooner can be lost. */
  diySettleMs?: number;
  /**
   * Starting gap between the packets of a live frame; if lower than packetGapMs it backs off towards it when
   * frame acks go missing (with the default both are 20 ms, matching the vendor app).
   */
  framePacketGapMs?: number;
};

export type UploadResult = { chunks: number; missedAcks: number };
type PanelMode = "unknown" | "diy" | "gif";

/** 509 B is the vendor app's size for MTU 512+; smaller sizes cover links that negotiated less. */
export const DEFAULT_PACKET_SIZES = [509, 182, 20] as const;
const WRITE_RETRIES = 3;
const GIF_UPLOAD_RETRIES = 1;
const MAX_INBOX = 32;
/** One frame in flight: waiting for every ack caps at ~2.6 fps, pipelining one gives ~9 fps (hardware). */
const MAX_FRAMES_IN_FLIGHT = 1;
/** A frame ack this late after its timeout is treated as stale rather than credited to a newer frame. */
const LATE_ACK_GRACE_MS = 1000;
const DEFAULT_OPTIONS: Required<MatrixLinkOptions> = {
  packetGapMs: 20,
  ackTimeoutMs: 5000,
  cooldownMs: 3000,
  packetSizes: DEFAULT_PACKET_SIZES,
  retryDelayMs: 50,
  frameAckTimeoutMs: 600,
  diySettleMs: 400,
  framePacketGapMs: 20
};
const FRAME_GAP_BACKOFF_MS = 6;

const sleep = (ms: number) => backgroundSleep(ms);

/** One connected panel: serialised, paced writes with MTU fallback and ack flow control. */
export class MatrixLink {
  readonly name: string;
  private readonly gatt: MatrixGatt;
  private readonly options: Required<MatrixLinkOptions>;
  private packetSizeIndex = 0;
  private packetSizeConfirmed = false;
  private inbox: Uint8Array[] = [];
  private wake: (() => void) | null = null;
  private busy = false;
  private readyAt = 0;
  /** When the last packet went out: the gap is measured from here, so idle time (encoding, acks) counts. */
  private lastWriteAt = 0;
  private mode: PanelMode = "unknown";
  private framesInFlight = 0;
  private staleImageAcks = 0;
  private frameGapMs: number;
  private staleImageAcksUntil = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(gatt: MatrixGatt, options: MatrixLinkOptions = {}) {
    this.gatt = gatt;
    this.name = gatt.name;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.frameGapMs = Math.min(this.options.framePacketGapMs, this.options.packetGapMs);
    gatt.notify.addEventListener("characteristicvaluechanged", this.onNotify);
  }

  get uploading() {
    return this.busy;
  }

  send(data: Uint8Array) {
    return this.exclusive(() => this.writePacketed(data));
  }

  /** Never abandoned midway: a half-sent GIF leaves the firmware ignoring the next one (hardware). */
  async uploadGif(gif: Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<UploadResult> {
    if (this.busy) throw new Error("A GIF upload is already in progress");
    this.busy = true;
    try {
      return await this.exclusive(() => this.writeGif(gif, onProgress));
    } finally {
      this.readyAt = Date.now() + this.options.cooldownMs;
      this.busy = false;
    }
  }

  /** Shows one PNG immediately (DIY mode); the panel keeps it until something else is sent. */
  showFrame(png: Uint8Array) {
    return this.exclusive(async () => {
      if (this.mode !== "diy") {
        await sleep(this.readyAt - Date.now());
        await this.writePacketed(DIY_MODE_ON);
        await sleep(this.options.diySettleMs);
        this.mode = "diy";
        this.framesInFlight = 0;
      }
      const chunks = buildImageChunks(png);
      if (chunks.length > 1) {
        await this.drainFrames();
        for (let i = 0; i < chunks.length - 1; i++) {
          await this.writePacketed(chunks[i], undefined, this.frameGapMs);
          this.framesInFlight++;
          await this.drainFrames(0, false, this.options.ackTimeoutMs);
        }
      }
      await this.writePacketed(chunks[chunks.length - 1], undefined, this.frameGapMs);
      this.framesInFlight++;
      await this.drainFrames(MAX_FRAMES_IN_FLIGHT, true);
    });
  }

  disconnect() {
    this.gatt.notify.removeEventListener("characteristicvaluechanged", this.onNotify);
    this.gatt.disconnect();
  }

  /** Waits until at most `targetInFlight` DIY frame ACKs remain outstanding. */
  private async drainFrames(targetInFlight = 0, backoffOnMiss = false, timeoutMs = this.options.frameAckTimeoutMs) {
    while (this.framesInFlight > targetInFlight) {
      if (!(await this.waitFor(isImageAck, timeoutMs))) {
        // Its ack may still turn up; it must not then release a newer frame early.
        this.staleImageAcks++;
        if (backoffOnMiss) {
          // A lost ack can mean lost packets: give the panel more room between them.
          this.frameGapMs = Math.min(this.options.packetGapMs, this.frameGapMs + FRAME_GAP_BACKOFF_MS);
        }
        this.staleImageAcksUntil = Date.now() + LATE_ACK_GRACE_MS;
      }
      this.framesInFlight--;
    }
  }

  /** Runs operations one at a time so GIF chunks and live frames never interleave on the wire. */
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async writeGif(gif: Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<UploadResult> {
    try {
      if (this.framesInFlight > 0) await this.drainFrames();
      if (this.mode === "diy") await sleep(this.lastWriteAt + this.options.diySettleMs - Date.now());
      await sleep(this.readyAt - Date.now());
      const chunks = buildGifChunks(gif);
      this.mode = "gif";
      for (let attempt = 0; attempt <= GIF_UPLOAD_RETRIES; attempt++) {
        let missedAcks = 0;
        let retry = false;
        for (const [i, chunk] of chunks.entries()) {
          // The panel acks a chunk only once it has all of it, so anything received before the
          // last packet goes out is a late ack for an earlier, timed-out chunk.
          await this.writePacketed(chunk, () => { this.inbox = []; });
          const reply = await this.waitFor((bytes) => isGifAck(bytes) || isGifErrorAck(bytes), this.options.ackTimeoutMs);
          if (reply && isGifErrorAck(reply)) {
            if (attempt < GIF_UPLOAD_RETRIES) {
              await sleep(this.options.diySettleMs);
              retry = true;
              break;
            }
            missedAcks++;
          } else if (!reply) {
            missedAcks++;
          }
          onProgress?.(i + 1, chunks.length);
        }
        if (!retry) return { chunks: chunks.length, missedAcks };
      }
      return { chunks: chunks.length, missedAcks: chunks.length };
    } finally {
      this.readyAt = Date.now() + this.options.cooldownMs;
    }
  }

  private onNotify = () => {
    const value = this.gatt.notify.value;
    if (!value) return;
    const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    if (isImageAck(bytes) && this.staleImageAcks > 0) {
      this.staleImageAcks--;
      if (Date.now() < this.staleImageAcksUntil) return;
    }
    this.inbox = [...this.inbox, bytes].slice(-MAX_INBOX);
    this.wake?.();
  };

  /**
   * Writes data in paced packets. A rejected write delivered nothing, so the same bytes are retried
   * with backoff; only a size that keeps failing before any full-size success is stepped down.
   */
  private async writePacketed(data: Uint8Array, beforeLastPacket?: () => void, gapMs = this.options.packetGapMs) {
    const sizes = this.options.packetSizes;
    let offset = 0;
    let failures = 0;
    while (offset < data.length) {
      const size = sizes[this.packetSizeIndex];
      const packet = data.slice(offset, offset + size);
      if (offset + packet.length === data.length) beforeLastPacket?.();
      try {
        await sleep(this.lastWriteAt + gapMs - Date.now());
        await this.gatt.write.writeValueWithoutResponse(packet);
        this.lastWriteAt = Date.now();
      } catch (error) {
        failures++;
        if (failures <= WRITE_RETRIES) {
          await sleep(this.options.retryDelayMs * 2 ** (failures - 1));
          continue;
        }
        if (this.packetSizeConfirmed || this.packetSizeIndex === sizes.length - 1) throw error;
        this.packetSizeIndex++;
        failures = 0;
        continue;
      }
      failures = 0;
      if (packet.length === size) this.packetSizeConfirmed = true;
      offset += packet.length;
    }
  }

  private async waitFor(match: (bytes: Uint8Array) => boolean, timeoutMs: number): Promise<Uint8Array | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.inbox.findIndex(match);
      if (index >= 0) {
        const hit = this.inbox[index];
        this.inbox = this.inbox.slice(index + 1);
        return hit;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await new Promise<void>(resolve => {
        const done = () => {
          if (this.wake === done) this.wake = null;
          resolve();
        };
        this.wake = done;
        void backgroundSleep(remaining).then(done);
      });
    }
  }
}
