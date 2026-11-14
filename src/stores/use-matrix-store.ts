"use client";

import { create } from "zustand";
import { AgentScene, isAnimated, renderScene, sameScene } from "@/lib/agent-display/scene";
import { MATRIX_SIZE } from "@/lib/idotmatrix/constants";
import { FrameSource, LiveFrameStream } from "@/lib/idotmatrix/live-stream";
import { MatrixLink } from "@/lib/idotmatrix/matrix-link";
import { applyPanelTuning, DEFAULT_PANEL_TUNING, PanelTuning, sanitizePanelTuning } from "@/lib/idotmatrix/panel-tuning";
import { encodePng } from "@/lib/idotmatrix/png-encoder";
import {
  buildBrightnessCommand,
  buildClockModeCommand,
  buildColorCommand,
  buildRotateCommand,
  buildSwitchplateCommand,
  buildSyncTimeCommand,
  clampHardwareBrightness,
  MAX_HARDWARE_BRIGHTNESS,
  SCREEN_ON
} from "@/lib/idotmatrix/protocol";
import { ScreenMirror, startScreenMirror } from "@/lib/idotmatrix/screen-mirror";
import { connectMatrix, MatrixError, MatrixErrorKind } from "@/lib/idotmatrix/web-bluetooth";

/** "agent": scenes pushed by AI agents through the desktop app's API (status, mood, text, pixels). */
export type LiveSource = "off" | "editor" | "screen" | "agent";

export type MatrixStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "picking" }
  | { kind: "connected" }
  | { kind: "live"; source: Exclude<LiveSource, "off"> }
  | { kind: "uploading"; sent: number; total: number }
  | { kind: "sent"; missedAcks: number; agentPaused: boolean }
  | { kind: "error"; reason: MatrixErrorKind; detail: string };

export type PanelHardwareSettings = {
  /** Hardware global LED brightness percentage (5..100). */
  brightness: number;
  /** Whether the panel display orientation is rotated 180 degrees. */
  flipped180: boolean;
};

export const DEFAULT_HARDWARE_SETTINGS: PanelHardwareSettings = {
  brightness: MAX_HARDWARE_BRIGHTNESS,
  flipped180: false
};

/** Normalises stored or patched hardware settings, keeping unknown inputs safe. */
export function sanitizeHardwareSettings(input?: Partial<PanelHardwareSettings> | null): PanelHardwareSettings {
  const source = input && typeof input === "object" ? input : {};
  const brightness =
    typeof source.brightness === "number" && Number.isFinite(source.brightness)
      ? clampHardwareBrightness(source.brightness)
      : DEFAULT_HARDWARE_SETTINGS.brightness;
  const flipped180 = typeof source.flipped180 === "boolean" ? source.flipped180 : DEFAULT_HARDWARE_SETTINGS.flipped180;
  return { brightness, flipped180 };
}

type MatrixState = {
  link: MatrixLink | null;
  status: MatrixStatus;
  live: LiveSource;
  showInactive: boolean;
  /** Dark line between scaled-up cells on the panel (off: blocks fill the panel edge to edge). */
  pixelGaps: boolean;
  /** Colour correction applied to every frame and GIF sent to the panel (not to the editor or exports). */
  tuning: PanelTuning;
  /** Whether the physical LED switchplate is powered on. */
  screenOn: boolean;
  /** Persistent panel hardware preferences re-applied on connect. */
  hardware: PanelHardwareSettings;
  /** Desktop app: agents may drive the panel whenever you are not using live sync or mirroring. */
  agentEnabled: boolean;
  agentScene: AgentScene | null;
  /** Why the last link ended: only a lost link (not your Disconnect) should be reconnected automatically. */
  lastDisconnect: "manual" | "lost" | null;
  connect: () => Promise<MatrixLink | null>;
  sendGif: (gif: Uint8Array) => Promise<void>;
  setLive: (source: LiveSource) => Promise<void>;
  pushFrame: (rgb: Uint8Array) => void;
  /** Streams an animation by sampling it whenever the link is free; null stops it. */
  playFrames: (source: FrameSource | null) => void;
  setShowInactive: (value: boolean) => void;
  setPixelGaps: (value: boolean) => void;
  setTuning: (patch: Partial<PanelTuning>) => void;
  setScreenOn: (on: boolean) => Promise<void>;
  setHardwareBrightness: (percent: number) => Promise<void>;
  setFlipped180: (flipped: boolean) => Promise<void>;
  clearPanel: () => Promise<void>;
  showHardwareClock: (style?: number) => Promise<void>;
  showAgentScene: (scene: AgentScene) => void;
  setAgentEnabled: (enabled: boolean) => void;
  disconnect: () => void;
};

function toErrorStatus(error: unknown, fallback: MatrixErrorKind): MatrixStatus {
  const reason = error instanceof MatrixError ? error.kind : fallback;
  const detail = error instanceof Error ? error.message : String(error);
  // warn, not error: these are expected device conditions and must not trip the Next.js error overlay.
  console.warn("[iDotMatrix]", reason, error);
  return { kind: "error", reason, detail };
}

// Non-serialisable live plumbing stays outside the reactive state.
let stream: LiveFrameStream | null = null;
let mirror: ScreenMirror | null = null;
/** Bumped by every live-mode change; a screen picker that resolves after a newer change is discarded. */
let liveRequest = 0;
/** When the current agent scene was set; its animation time starts here. */
let agentSince = 0;
/** The last frame handed to the stream, before tuning: re-sent when the tuning changes. */
let lastLiveFrame: Uint8Array | null = null;
let brightnessLoop: Promise<void> | null = null;
let brightnessDirty = false;

const TUNING_STORAGE_KEY = "dot-matrix-panel-tuning";
const HARDWARE_STORAGE_KEY = "dot-matrix-panel-hardware";

function loadStored<T>(key: string, sanitize: (raw: unknown) => T, fallback: T, label: string): T {
  try {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem(key);
    return stored ? sanitize(JSON.parse(stored)) : fallback;
  } catch (error) {
    console.warn(`[iDotMatrix] ignoring unreadable ${label}`, error);
    return fallback;
  }
}

function saveStored(key: string, value: unknown, label: string) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[iDotMatrix] could not save ${label}`, error);
  }
}

const loadTuning = () => loadStored(TUNING_STORAGE_KEY, (raw) => sanitizePanelTuning(raw as Partial<PanelTuning>), DEFAULT_PANEL_TUNING, "panel tuning");
const saveTuning = (tuning: PanelTuning) => saveStored(TUNING_STORAGE_KEY, tuning, "panel tuning");
const loadHardware = () => loadStored(HARDWARE_STORAGE_KEY, (raw) => sanitizeHardwareSettings(raw as Partial<PanelHardwareSettings>), DEFAULT_HARDWARE_SETTINGS, "panel hardware settings");
const saveHardware = (hardware: PanelHardwareSettings) => saveStored(HARDWARE_STORAGE_KEY, hardware, "panel hardware settings");

function stopMirror() {
  lastLiveFrame = null;
  const active = mirror;
  mirror = null;
  active?.stop();
}

/** Lives outside the export drawer so the BLE connection survives closing and reopening it. */
export const useMatrixStore = create<MatrixState>((set, get) => {
  const isCurrent = (link: MatrixLink) => get().link === link;

  /** Drops a broken link after a fatal GATT/upload error so the user and auto-reconnect recover cleanly. */
  const dropBrokenLink = (broken: MatrixLink, error: unknown) => {
    if (!isCurrent(broken)) return;
    liveRequest++;
    brightnessDirty = false;
    stopMirror();
    stream?.cancel();
    stream = null;
    set({
      link: null,
      live: "off",
      screenOn: true,
      lastDisconnect: "lost",
      status: toErrorStatus(error, "upload-failed")
    });
    broken.disconnect();
  };

  /** Puts the current agent scene on the panel; returns false when it cannot or should not. */
  const playAgent = () => {
    const { link, agentEnabled, agentScene, screenOn } = get();
    if (!link || !agentEnabled || !agentScene || !stream || !screenOn || link.uploading) return false;
    stream.cancel();
    stream.reset();
    if (isAnimated(agentScene)) stream.play((displayAt) => renderScene(agentScene, displayAt - agentSince));
    else stream.show(renderScene(agentScene, 0));
    set({ live: "agent", status: { kind: "live", source: "agent" } });
    return true;
  };

  /** Stops whatever is streaming without handing the panel back to the agent (e.g. before a GIF upload). */
  const stopLive = () => {
    liveRequest++;
    stopMirror();
    stream?.cancel();
    set({ live: "off", status: get().link ? { kind: "connected" } : { kind: "idle" } });
  };

  const pauseLiveForCommand = async () => {
    stopLive();
    if (get().agentEnabled) set({ agentEnabled: false });
    await stream?.idle();
  };

  const ensureScreenOn = async (link: MatrixLink) => {
    if (get().screenOn) return;
    set({ screenOn: true });
    await link.send(SCREEN_ON);
  };

  const withActiveLink = async (fn: (link: MatrixLink) => Promise<void>) => {
    const link = get().link;
    if (!link || link.uploading) return;
    try {
      await fn(link);
    } catch (error) {
      dropBrokenLink(link, error);
    }
  };

  return {
    link: null,
    status: { kind: "idle" },
    live: "off",
    showInactive: true,
    pixelGaps: false,
    tuning: loadTuning(),
    screenOn: true,
    hardware: loadHardware(),
    agentEnabled: false,
    agentScene: null,
    lastDisconnect: null,

    connect: async () => {
      set({ status: { kind: "connecting" } });
      let opened: MatrixLink | null = null;
      try {
        const link = await connectMatrix((closed) => {
          if (!isCurrent(closed)) return;
          liveRequest++;
          brightnessDirty = false;
          stopMirror();
          stream = null;
          set({
            link: null,
            live: "off",
            screenOn: true,
            lastDisconnect: "lost",
            status: closed.uploading ? { kind: "error", reason: "upload-failed", detail: "disconnected" } : { kind: "idle" }
          });
        });
        opened = link;
        stream = new LiveFrameStream(async (rgb, stillWanted) => {
          lastLiveFrame = rgb;
          // Plain RGB PNGs: indexed PNGs were acknowledged by the panel but showed black in live sync
          // (user report on v0.2.0), so the panel's decoder is only trusted with what v0.1 proved.
          const png = await encodePng(MATRIX_SIZE, MATRIX_SIZE, applyPanelTuning(rgb, get().tuning), { allowPalette: false });
          if (stillWanted()) await link.showFrame(png);
        }, {
          onError: (error) => dropBrokenLink(link, error)
        });
        const { hardware } = get();
        if (hardware.flipped180) await link.send(buildRotateCommand(true));
        if (hardware.brightness !== MAX_HARDWARE_BRIGHTNESS) await link.send(buildBrightnessCommand(hardware.brightness));
        set({ link, screenOn: true, status: { kind: "connected" }, lastDisconnect: null });
        playAgent();
        return link;
      } catch (error) {
        opened?.disconnect();
        const cancelled = error instanceof MatrixError && error.kind === "cancelled";
        set({ status: cancelled ? { kind: "idle" } : toErrorStatus(error, "connect-failed") });
        return null;
      }
    },

    sendGif: async (gif) => {
      stopLive();
      // A frame still being encoded or waiting its turn would otherwise land after the GIF and replace it.
      stream?.cancel();
      await stream?.idle();
      const link = get().link ?? (await get().connect());
      if (!link || link.uploading) return;
      // A link that has since disconnected or been replaced must not overwrite the current status.
      const update = (status: MatrixStatus) => {
        if (isCurrent(link)) set({ status });
      };
      update({ kind: "uploading", sent: 0, total: 1 });
      try {
        await ensureScreenOn(link);
        const result = await link.uploadGif(gif, (sent, total) => update({ kind: "uploading", sent, total }));
        stream?.reset();
        // The GIF now lives in the panel's memory; agent scenes would replace it on the next hook, so the
        // agent display pauses until you turn it back on.
        const agentPaused = get().agentEnabled;
        if (agentPaused && isCurrent(link)) set({ agentEnabled: false });
        update({ kind: "sent", missedAcks: result.missedAcks, agentPaused });
      } catch (error) {
        dropBrokenLink(link, error);
      }
    },

    setLive: async (source) => {
      if (source === get().live) return;
      const request = ++liveRequest;
      stopMirror();
      stream?.cancel();
      if (source === "off" || source === "agent") {
        // Leaving live sync or mirroring hands the panel back to the agent display when it is on.
        if (!playAgent()) set({ live: "off", status: get().link ? { kind: "connected" } : { kind: "idle" } });
        return;
      }
      // Both the device chooser and the screen picker need a fresh click, so live modes start
      // only once connected (the UI offers "connect" first).
      const link = get().link;
      if (!link) return;
      stream?.reset();
      if (source === "screen") {
        set({ live: "off", status: { kind: "picking" } });
        let started: ScreenMirror;
        try {
          started = await startScreenMirror((rgb) => get().pushFrame(rgb), () => {
            if (get().live === "screen") set({ live: "off", status: { kind: "connected" } });
          });
        } catch (error) {
          if (request !== liveRequest) return;
          // Dismissing the browser's share picker is a NotAllowedError: treat it as "never mind".
          const dismissed = error instanceof DOMException && error.name === "NotAllowedError";
          set({ live: "off", status: dismissed ? { kind: "connected" } : toErrorStatus(error, "connect-failed") });
          return;
        }
        // Superseded while the picker was open (stopped, disconnected, another mode): release the capture.
        if (request !== liveRequest || !isCurrent(link)) {
          started.stop();
          return;
        }
        mirror = started;
      }
      if (!get().screenOn) {
        try {
          await ensureScreenOn(link);
        } catch (error) {
          stopMirror();
          dropBrokenLink(link, error);
          return;
        }
        if (request !== liveRequest || !isCurrent(link)) {
          stopMirror();
          return;
        }
      }
      set({ live: source, status: { kind: "live", source } });
    },

    pushFrame: (rgb) => {
      if (get().live !== "off" && !get().link?.uploading) stream?.show(rgb);
    },

    playFrames: (source) => {
      if (!source) {
        stream?.play(null);
        return;
      }
      if (get().live !== "off" && !get().link?.uploading) stream?.play(source);
    },

    setShowInactive: (value) => set({ showInactive: value }),
    setPixelGaps: (value) => set({ pixelGaps: value }),

    setTuning: (patch) => {
      const tuning = sanitizePanelTuning({ ...get().tuning, ...patch });
      set({ tuning });
      saveTuning(tuning);
      // A still picture would keep its old colours until the next edit: show it again with the new tuning.
      if (stream && lastLiveFrame && get().live !== "off" && !get().link?.uploading) {
        stream.reset();
        stream.show(lastLiveFrame);
      }
    },

    setScreenOn: async (on) => {
      set({ screenOn: on });
      if (!on) {
        stopLive();
        await stream?.idle();
      }
      await withActiveLink(async (link) => {
        await link.send(buildSwitchplateCommand(on));
        if (on && isCurrent(link) && get().live === "off") playAgent();
      });
    },

    setHardwareBrightness: async (percent) => {
      const hardware = sanitizeHardwareSettings({ ...get().hardware, brightness: percent });
      set({ hardware });
      saveHardware(hardware);
      const link = get().link;
      if (!link || link.uploading) return;
      if (brightnessLoop) {
        brightnessDirty = true;
        return brightnessLoop;
      }
      brightnessLoop = (async () => {
        try {
          do {
            brightnessDirty = false;
            const active = get().link;
            if (!active || active.uploading) break;
            const level = get().hardware.brightness;
            try {
              await active.send(buildBrightnessCommand(level));
            } catch (error) {
              dropBrokenLink(active, error);
              break;
            }
          } while (brightnessDirty);
        } finally {
          brightnessDirty = false;
          brightnessLoop = null;
        }
      })();
      return brightnessLoop;
    },

    setFlipped180: async (flipped) => {
      const hardware = sanitizeHardwareSettings({ ...get().hardware, flipped180: flipped });
      set({ hardware });
      saveHardware(hardware);
      await withActiveLink((link) => link.send(buildRotateCommand(hardware.flipped180)));
    },

    clearPanel: async () => {
      await pauseLiveForCommand();
      set({ screenOn: true });
      await withActiveLink((link) => link.send(buildColorCommand(0, 0, 0)));
    },

    showHardwareClock: async (style = 0) => {
      await pauseLiveForCommand();
      await withActiveLink(async (link) => {
        await ensureScreenOn(link);
        await link.send(buildSyncTimeCommand());
        await link.send(buildClockModeCommand(style));
      });
    },

    showAgentScene: (scene) => {
      // The same scene again (e.g. a tray tool re-syncing) keeps its clock, so its intro does not replay.
      if (!sameScene(get().agentScene, scene)) agentSince = Date.now();
      set({ agentScene: scene });
      // Your own live sync or mirroring keeps the panel; the scene shows once you stop them.
      const live = get().live;
      if (live === "off" || live === "agent") playAgent();
    },

    setAgentEnabled: (enabled) => {
      set({ agentEnabled: enabled });
      if (enabled && get().live === "off") playAgent();
      if (!enabled && get().live === "agent") stopLive();
    },

    disconnect: () => {
      liveRequest++;
      brightnessDirty = false;
      stopMirror();
      stream = null;
      get().link?.disconnect();
      set({ link: null, live: "off", screenOn: true, status: { kind: "idle" }, lastDisconnect: "manual" });
    }
  };
});
