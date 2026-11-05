import Link from "next/link";
import type { CSSProperties } from "react";

export default function HomePage() {
  const previewCells = Array.from({ length: 36 }, (_, index) => {
    const x = index % 6;
    const y = Math.floor(index / 6);
    const distance = Math.hypot(x - 2.5, y - 2.5);

    return (
      <span
        key={index}
        className="home-motion-demo__dot"
        style={{ "--home-wave-delay": `${distance * 0.12}s` } as CSSProperties}
      />
    );
  });

  return (
    <main className="home-page">
      <div className="home-page__card">
        <div className="home-motion-demo" aria-hidden="true">
          <div className="home-motion-demo__grid">{previewCells}</div>
        </div>
        <p className="panel__eyebrow">Dot Matrix Studio</p>
        <h1>iDotMatrix 点阵屏桌面应用</h1>
        <p>
          给 iDotMatrix 32×32 蓝牙 LED 点阵屏用的编辑器：画像素动画并实时同步到屏幕，把动画存进屏幕，把电脑画面投到屏上，还能让 AI agent 在屏上显示工作状态。
        </p>
        <Link href="/editor" className="button">
          开始创作
        </Link>
      </div>
    </main>
  );
}
