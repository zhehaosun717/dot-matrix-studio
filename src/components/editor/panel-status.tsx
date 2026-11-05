"use client";

import { useEffect, useState } from "react";
import { describeMatrixStatus } from "@/lib/idotmatrix/matrix-copy";
import { Language } from "@/lib/ui-copy";
import type { MatrixStatus } from "@/stores/use-matrix-store";

export type PanelStatusTone = "busy" | "ok" | "live" | "warn" | "error";

export type PanelStatusView = {
  tone: PanelStatusTone;
  /** Short text for the top bar. */
  label: string;
  /** The full explanation (what happened, what to do). */
  detail: string;
  /** 0..1 while uploading. */
  progress?: number;
  /** Shown as a notice under the top bar until dismissed. */
  notice: "alert" | "info" | null;
};

const copy = {
  cn: {
    connecting: "正在连接…",
    picking: "选择投屏画面…",
    live: { editor: "实时同步中", screen: "投屏中", agent: "Agent 显示中" },
    sending: (sent: number, total: number) => `正在发送 ${sent}/${total}`,
    saved: "已存到屏幕",
    savedUnconfirmed: "已发送，部分未确认",
    errors: {
      unsupported: "不支持蓝牙",
      "bluetooth-off": "蓝牙未开启",
      cancelled: "已取消",
      "connect-failed": "连接失败",
      "upload-failed": "发送中断"
    },
    dismiss: "关闭提示"
  },
  en: {
    connecting: "Connecting…",
    picking: "Pick what to mirror…",
    live: { editor: "Live sync", screen: "Mirroring", agent: "Agent display" },
    sending: (sent: number, total: number) => `Sending ${sent}/${total}`,
    saved: "Saved to panel",
    savedUnconfirmed: "Sent, not all confirmed",
    errors: {
      unsupported: "No Bluetooth",
      "bluetooth-off": "Bluetooth is off",
      cancelled: "Cancelled",
      "connect-failed": "Could not connect",
      "upload-failed": "Upload interrupted"
    },
    dismiss: "Dismiss"
  }
} as const;

/** What the top bar shows for a panel status; null when there is nothing to say (not connected, no error). */
export function panelStatusView(status: MatrixStatus, deviceName: string | null, language: Language): PanelStatusView | null {
  const t = copy[language];
  const detail = describeMatrixStatus(status, deviceName, language);
  const name = deviceName ?? "iDotMatrix";
  switch (status.kind) {
    case "idle":
      return null;
    case "connecting":
      return { tone: "busy", label: t.connecting, detail, notice: null };
    case "picking":
      return { tone: "busy", label: t.picking, detail, notice: null };
    case "connected":
      return { tone: "ok", label: name, detail, notice: null };
    case "live":
      return { tone: "live", label: `${t.live[status.source]} · ${name}`, detail, notice: null };
    case "uploading":
      return { tone: "busy", label: t.sending(status.sent, status.total), detail, progress: status.total ? status.sent / status.total : 0, notice: null };
    case "sent":
      if (status.missedAcks > 0) return { tone: "warn", label: t.savedUnconfirmed, detail, notice: "alert" };
      return { tone: "ok", label: t.saved, detail, notice: status.agentPaused ? "info" : null };
    case "error":
      return { tone: "error", label: t.errors[status.reason], detail, notice: "alert" };
  }
}

/**
 * The panel's state, always visible: a small status chip in the top bar, and the full explanation under the
 * top bar when something went wrong or needs a hint. Previously this text only existed as a hover tooltip.
 */
export function PanelStatus({ status, deviceName, language }: { status: MatrixStatus; deviceName: string | null; language: Language }) {
  const view = panelStatusView(status, deviceName, language);
  const [dismissed, setDismissed] = useState<MatrixStatus | null>(null);
  // A new status (even of the same kind) brings the notice back.
  useEffect(() => setDismissed(null), [status]);
  // Hints go away by themselves; problems stay until dismissed or replaced.
  useEffect(() => {
    if (view?.notice !== "info") return;
    const timer = window.setTimeout(() => setDismissed(status), 8000);
    return () => window.clearTimeout(timer);
  }, [status, view?.notice]);
  if (!view) return null;

  const showNotice = view.notice !== null && dismissed !== status;
  return (
    <>
      <span className={`panel-status panel-status--${view.tone}`} title={view.detail}>
        <span className="panel-status__dot" aria-hidden="true" />
        <span className="panel-status__label">{view.label}</span>
        {view.progress !== undefined ? (
          <span className="panel-status__progress" aria-hidden="true">
            <span style={{ width: `${Math.round(view.progress * 100)}%` }} />
          </span>
        ) : null}
      </span>
      {showNotice ? (
        <div className={`panel-status-notice panel-status-notice--${view.tone}`} role={view.notice === "alert" ? "alert" : "status"}>
          <span>{view.detail}</span>
          <button type="button" className="panel-status-notice__close" aria-label={copy[language].dismiss} onClick={() => setDismissed(status)}>
            ×
          </button>
        </div>
      ) : null}
    </>
  );
}
