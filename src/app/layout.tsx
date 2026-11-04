import "@/app/globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Dot Matrix Studio",
  description: "Desktop app for the iDotMatrix 32x32 Bluetooth LED panel: pixel animation editor, live sync, screen mirroring, panel colour calibration, and a local API / MCP server for AI agents to show their status."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
