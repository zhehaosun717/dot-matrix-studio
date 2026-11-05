# 重构设计：后续本机工作

> 状态：草案，供审阅。本文只描述方案，不包含代码改动。
> 前提：`refactor/cloud-cleanup` 已合并（toolcraft 清理、`src/core/` 纯逻辑层、store / editor-app / CSS 拆分）。

本文覆盖六件事：新数据模型、旧模型迁移、上游遗留功能清单（只列出，不删）、Next.js → Vite、作品存成磁盘文件（`.dms`）、撤销 / 重做改成命令模式。最后给出建议的实施顺序。

始终不能动的对外约定（与 `refactor/cloud-cleanup` 相同）：

- `desktop/src/api-server.ts` 的 HTTP 路径、字段、令牌机制，`agent-api.json` 的格式；
- `mcp/` 的工具名和参数；
- `%APPDATA%\Dot Matrix Studio`（`desktop/src/main.ts` 的 `APP_NAME`）；
- 已实测验证过的 `src/lib/idotmatrix/`（蓝牙协议、帧队列、GIF/PNG 编码、`panel-profile.ts`、`panel-tuning.ts`）和 `src/lib/agent-display/` 的渲染结果。

---

## 1. 现状与问题

当前的数据模型来自上游的“网页加载动画编辑器”（`src/types/dot-motion.ts`）：

```
Project
├─ canvas            画布缩放、平移
├─ loaders[]         每个 loader 是画布上的一块“画板”
│   ├─ artboard      画板在画布上的位置与尺寸
│   ├─ layout        版式（icon-only / status-pill / …，来自加载动画组件）
│   ├─ pattern
│   │   ├─ grid               行列、cellSize、gap、对称
│   │   ├─ layers[]           图层（像素以 "x,y" → "#RRGGBB" 存，可越界）
│   │   ├─ activeCells[]      ┐ 图层合成后的结果，和 layers 同时存两份
│   │   └─ cellColors{}       ┘
│   ├─ animation     程序化动效（presetId、direction、easing、durationMs、…）
│   ├─ style         颜色、发光、格子形状……
│   ├─ kind / sequenceId / sequenceIndex   序列帧：每一帧是一个独立的 loader
│   └─ text / effects / modes               上游字段，基本不用
├─ assets.patterns   图库
└─ settings
```

主要问题：

1. **派生数据存了两份。** `activeCells` / `cellColors` 是 `layers` 的合成结果，却和 `layers` 一起持久化，靠 `syncLayers` 在每次编辑后重新计算。老作品还可能只有 `activeCells`，没有 `layers`（`layersOf` 里有兼容逻辑）。
2. **序列帧不是真正的帧。** 一个序列是多个 loader 通过 `sequenceId` 串起来的，每帧各有一份 grid、style、animation 和 layers。很多 setter 要带 `updateSequence` 才能把修改同步到所有帧。帧没有各自的时长，只有一个共享的 fps。
3. **像素表示低效。** `"x,y" → "#RRGGBB"` 的对象在 32×32 × 24 帧时会变得很大，而且 localStorage 的上限大约只有 5 MB。
4. **撤销靠整份快照。** `editor-history.ts` 每一步都保存整个 `Project`，最多 100 份。
5. **存储有隐患。**
   - 作品只存在 localStorage 里，按“源”隔离，也就是 `http://127.0.0.1:<端口>`。`desktop/src/main.ts` 在 47321 端口被占用时会改用随机端口，这时编辑器换了源，之前的作品就“看不到”了（数据还在，只是读不到）。
   - `hydrate()`（`src/stores/editor/project-slice.ts`）在存储里的 `version` 不等于 `PROJECT_VERSION`（目前是 `"0.17.0"`）时，**会直接用示例项目覆盖存储**。一旦以后提升版本号，用户的作品就会被清掉。这个问题在迁移方案里必须先修掉。

---

## 2. 新数据模型

借鉴 Aseprite 的结构：**Document（尺寸、调色板）→ frames[]（每帧时长）× layers[] → cel（每个“帧 × 图层”格子一块像素缓冲）**。合成结果只作为派生数据计算，不持久化。

### 2.1 类型草案

```ts
/** 一个 .dms 文件：画布上的若干作品，加上图库和视图。 */
export type Workspace = {
  format: "dot-matrix-studio";
  /** 文件格式版本，每次不兼容的改动加 1；读取时按版本链式迁移。 */
  formatVersion: 1;
  id: string;
  name: string;
  createdAt: string;            // ISO 8601
  updatedAt: string;
  documents: Document[];        // 画布上的每块画板就是一个 Document
  library: LibraryItem[];       // 图库（原 assets.patterns）
  view: { zoom: number; panX: number; panY: number };
};

/** 一个作品：一张静态图或一段逐帧动画。 */
export type Document = {
  id: string;
  name: string;
  /** 3..32；32×32 时一格就是屏上一颗 LED。 */
  size: { width: number; height: number };
  palette: Palette;
  layers: Layer[];              // 自下而上
  frames: Frame[];              // 至少 1 帧
  /** key = celKey(frameId, layerId)；缺省表示这一格是空的。 */
  cels: Record<CelKey, Cel>;
  activeLayerId: string;
  activeFrameId: string;
  /** 画布上的位置（原 artboard.x / y）；尺寸由编辑器根据 size 计算。 */
  position: { x: number; y: number };
  render: RenderStyle;
  /** 可选的程序化动效；没有时按 frames 逐帧播放。见第 4 节的取舍。 */
  effect?: MotionEffect;
};

/**
 * 调色板：下标 0 = 透明（不亮），下标 1 = 底色（跟随 render.baseColor 变化，
 * 对应现在像素值 "" 的语义），2.. = 具体颜色 "#RRGGBB"。
 */
export type Palette = {
  colors: string[];             // colors[0]、colors[1] 是占位，不参与取色
};
export const TRANSPARENT = 0;
export const BASE_COLOR = 1;

export type Layer = {
  id: string;
  name: string;                 // 空串在界面上显示为“图层 n”
  visible: boolean;
  locked?: boolean;
};

export type Frame = {
  id: string;
  /** 这一帧显示的时长，毫秒。点阵屏最多 MAX_GIF_FPS，超出的部分在导出 / 推流时取整。 */
  durationMs: number;
};

export type CelKey = `${string}:${string}`;   // `${frameId}:${layerId}`
export const celKey = (frameId: string, layerId: string): CelKey => `${frameId}:${layerId}`;

/**
 * 一格像素。和现在的图层一样允许超出画布：x / y 是这块缓冲左上角在画布上的位置，
 * 可以是负数。移动图层只改 x / y，越界的像素不会丢。
 */
export type Cel = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** width × height 个调色板下标，按行存放。 */
  pixels: Uint8Array;
  /** 0..1，默认 1。迁移旧序列时用来表示“这一帧里该图层是隐藏的”。 */
  opacity?: number;
};

export type RenderStyle = {
  baseColor: string;            // 原 style.primaryColor
  baseAlpha: number;            // 原 style.primaryAlpha
  background: { color: string; alpha: number };
  glow: { enabled: boolean; size: number };   // 原 style.shadow / style.glow
  gap: number;                  // 原 grid.gap（只影响编辑器显示）
  symmetry?: "none" | "x" | "y" | "xy";
  cellShape?: CellShape;        // 是否保留见第 4.3 节
};

export type MotionEffect = {
  presetId: MotionPresetId;
  /** 一个循环的时长；采样器的 getCycleDuration 用 durationMs / speed 算周期。 */
  durationMs: number;
  speed: number;
  direction: Direction;
  origin: { x: number; y: number };
  style: AnimationStyle;
  inactiveStyle: InactiveStyle;
  scaleIntensity: number;
};

export type LibraryItem = {
  id: string;
  name: string;
  size: { width: number; height: number };
  /** 已经烘焙成具体颜色，换到任何画板上看起来都一样（与现在一致）。 */
  colors: string[];
  pixels: Uint8Array;
};
```

### 2.2 派生数据

合成结果不再存储，统一由 `src/core/` 中的纯函数计算，再在 store 里按 cel 的引用做缓存：

```ts
/** 第 frameIndex 帧所有可见图层合成后的结果：每格一个调色板下标。 */
export function compositeFrame(doc: Document, frameIndex: number): Uint8Array;

/** 合成并换算成颜色：渲染器、导出、实时同步用。 */
export function frameToRgba(doc: Document, frameIndex: number): Uint8ClampedArray;
```

- cel 是不可变的。修改一格像素会产生新的 `Uint8Array` 和新的 cel 对象，所以可以用 `WeakMap<Cel, …>` 以及“各图层 cel 引用组成的元组”作为缓存键，不需要手动维护 dirty 标记。
- **点阵屏渲染不改**。`src/lib/idotmatrix/render-frames.ts` 等已验证的代码继续接收 `LoaderComponent`，在 `src/core/` 里新增一个适配函数 `documentToLoader(doc, frameIndex)`，把新模型投影成渲染器需要的旧结构。这样就不用改动 `idotmatrix/`。等真机验证过新渲染路径之后，再考虑去掉这层适配。
- agent 的编辑接口（`get-drawing` 等，见 `src/components/editor/agent-editor-handler.ts`）对外格式不变，内部改为读写当前 Document 的当前帧和图层。

---

## 3. 从 Project → loaders[] 迁移到新模型

迁移函数放在 `src/core/migrate/`，是纯函数，有完整的单元测试，输入就是现在 localStorage 里的 JSON。

### 3.1 先修掉“版本不符就覆盖”的问题

在做任何迁移之前，单独提交一个小改动：版本不符时**不覆盖**存储，而是先原样备份，再按版本链迁移。否则未来任何一次版本号提升都会清空作品。这个改动在当前模型下就可以做，而且应该最先做。

### 3.2 映射规则

| 旧 | 新 |
|---|---|
| `Project` | `Workspace`：`id`、`name`、`createdAt`、`updatedAt` 照抄，`canvas` 映射到 `view` |
| 没有 `sequenceId` 的 loader | 一个 `Document`，只有 1 帧 |
| 同一个 `sequenceId` 的若干 loader | 一个 `Document`，按 `sequenceIndex` 排序，每个 loader 变成一帧 |
| `pattern.grid.rows / cols` | `size.height / width`（目前都是正方形） |
| `pattern.grid.gap`、`symmetryX/Y` | `render.gap`、`render.symmetry` |
| `pattern.layers[]` | `layers[]` 加上每帧的 cel（见 3.3） |
| 没有 `layers` 的老作品 | 用 `activeCells` / `cellColors` 生成一个图层，id 沿用 `baseLayerId(loader)`（与 `layersOf` 的现有行为一致） |
| 像素值 `""` | 调色板下标 1（底色） |
| 像素值 `"#RRGGBB"` | 加入调色板，重复颜色去重 |
| `style.primaryColor / primaryAlpha` | `render.baseColor / baseAlpha` |
| `style.backgroundColor / backgroundAlpha` | `render.background` |
| `style.shadow / glow` | `render.glow.enabled / size` |
| `style.cellShape / innerRadius` | `render.cellShape`（取决于第 4.3 节的决定） |
| `animation`（非序列） | `effect`：presetId、durationMs、speed、direction、origin、style、inactiveStyle、scaleIntensity |
| `animation.fps`（序列） | 每帧 `durationMs = round(1000 / fps)` |
| `artboard.x / y` | `position` |
| `assets.patterns[]` | `library[]`（`cellColors` 本来就已烘焙；没有颜色的格子用当时的底色） |
| `layout`、`text`、`effects`、`modes`、`snapshots`、`templateId`、`sourceType`、`pattern.presetId`、`easing`、`mode`、`staggerMs`、`segment`、`loop`、`fps`（非序列） | 不迁移（见第 4 节）；原始 JSON 整份留在备份文件里 |

### 3.3 序列帧 → 真正的帧

现在每一帧都有自己的图层列表，而且 id 互不相同。新模型里所有帧共用一组图层。规则如下：

1. **按位置对齐图层。** 第 k 帧的第 i 个图层对应新模型的第 i 个图层。图层名取第一个有这个位置图层的帧；图层数取所有帧中的最大值。
2. **cel**：第 k 帧第 i 个图层的像素（连同 `offsetX / offsetY`）成为 `cels[celKey(frame_k, layer_i)]`。像素先算出包围盒，再存成 `x / y / width / height`，越界的像素原样保留。如果某帧在这个位置没有图层，就不生成 cel。
3. **可见性**：新图层只要在任意一帧里可见，就标记为 `visible: true`；在某帧里原本隐藏的，对应 cel 设成 `opacity: 0`。这样每一帧合成出来的画面与迁移前完全一样。
4. **共享属性**：大多数 style 和 grid 的 setter 本来就带 `updateSequence`，各帧的值是一致的，统一取第一帧的值。如果检测到不一致，记录到迁移报告里，不报错。
5. **动效**：序列帧在界面上不显示动效预设（`!editingLoader.sequenceId`），所以序列迁移后不设 `effect`。
6. **帧顺序和画板位置**：第一帧的 `artboard.x / y` 作为 Document 的 `position`。原来各帧横向排开的布局由编辑器的“帧条”显示代替（属于界面改动，另行设计）。

### 3.4 验证方法

- **逐帧等价**：对每个迁移前的 loader 和迁移后对应的帧，比较 `flattenLayers(...)` 与 `compositeFrame(...)` 换算出的颜色，必须完全一致。用现有测试里的 mock 项目，再加上构造的边界数据（越界像素、隐藏图层、没有 layers 的老作品、帧数不同的序列）。
- **点阵屏输出等价**：用现有的 `renderMatrixFrames`，比较迁移前的 loader 与 `documentToLoader(迁移后)` 渲染出的 32×32 帧，逐字节一致。
- 迁移报告：统计合并了多少序列、出现过哪些不一致、丢弃了哪些字段。第一次迁移时写入备份目录。

---

## 4. 建议删除的上游功能（只列出，由你决定）

以下内容都来自上游的“网页加载动画”定位。**本次不删任何一项。**每一项都列出了影响面，方便你逐条决定。

### 4.1 Web / SwiftUI 代码导出

| 项 | 内容 |
|---|---|
| 代码 | `src/lib/exporters/`（`index.ts`、`web.ts`、`swift.ts`、`motion-data.ts`、`utils.ts`）；`src/components/editor/export-panel.tsx` 里的 JavaScript / Swift 两个页签；`ExportFormat` / `ExportTarget` 类型；store 里的 `exportFormat` / `setExportFormat` |
| 用户可见 | 导出抽屉里的 JavaScript / Swift 页签消失。**“存到屏幕”（iDotMatrix 页签，`matrix-export.tsx`）在同一个抽屉里，必须保留**，抽屉可以改名为“存到屏幕”。README.en.md 的 “Editor code export” 一节、中文 README 的对应说明都要删 |
| 测试 | `scripts/test-exports.cjs` 整个删除；`scripts/test-motion.cjs` 里 `generateExportArtifact` / `buildMotionData` 相关的断言要删掉（逐条列出，采样器相关的断言保留） |
| 其他 | 4 个只为导出服务的手工 QA 脚本：`scripts/browser-qa.mjs`、`browser-export-edge-qa.mjs`、`platform-web-qa.mjs`、`swift-render-qa.swift`。它们没有被 `package.json` 调用，依赖不在依赖列表里的 Playwright，以及一个已经不存在的 3108 端口开发服务器 |
| 风险 | 低。点阵屏不依赖它们。`motion-data.ts` 调用了 `getCellClipPath`，删除后 `cell-shapes` 少一个使用方 |

### 4.2 动效预设（MotionPresetId）、easing 等动画字段

需要分开看：

- **动效预设本身是用户可见的核心功能**：README 写着“12 种动效预设”，实时同步和存到屏幕时，`render-frames.ts` 都通过 `sampleMotion` 渲染这些动效。**不建议删除**。新模型里改成可选的 `effect`。
- **确认没有用的字段**，可以删除：
  - `easing`：除了默认值和 normalize，没有任何地方读取；
  - `mode` / `AnimationMode`：`setAnimationMode` 是空操作，只有 `preview-stage.tsx` 的一段英文提示文字和 `getAnimationSummary`（只在测试里用）读取；
  - `staggerMs`、`segment`：采样器不读取；
  - `loop`：只有 Web / SwiftUI 导出读取（点阵屏上的 GIF 总是循环），删掉代码导出后就没有读取方了；
  - 注意 `durationMs` **要保留**：采样器的 `getCycleDuration` 用 `durationMs / speed` 计算一个循环的时长；
  - `normalizeMotionPresetId` 里大约 50 个旧预设 id 的映射：只在迁移时需要，迁移代码要保留它们。
- **影响**：`AnimationConfig` 类型、`normalizeAnimation`、`mock-project.ts`、`test-motion.cjs` / `test-editor-tools.cjs` 中构造 loader 的地方。
- **风险**：中。采样器的输出必须与现在完全一致，可以用 `test-motion.cjs` 现有的 100,308 个采样点做回归。

### 4.3 格子形状（CellShape）

| 项 | 内容 |
|---|---|
| 代码 | `src/core/cell-shapes.ts`；侧栏“网格”分组里的形状下拉框；`dense-cell-canvas.tsx`、`dot-grid-editor.tsx`、`preview-stage.tsx` 中的形状绘制；store 的 `setCellShape`；`style.cellShape / innerRadius / radius` |
| **会改变点阵屏输出** | `src/lib/idotmatrix/shape-mask.ts` 会根据形状在 LED 上画出圆形、菱形、星形等遮罩。条件是每格至少 6 个 LED，即画板网格不超过 5×5。删除这个功能会改变这类作品在屏上的样子，而 `idotmatrix/` 属于已经真机验证过的代码 |
| 用户可见 | 小网格作品不能再选形状；已经选了形状的作品，在编辑器和屏上都会变成方块 |
| 测试 | `test-exports.cjs` 里的 “six shapes”、`test-idotmatrix.cjs` 里和形状遮罩相关的预算 / 渲染断言、`test-core.cjs` 的 cell-shapes 部分 |
| 建议 | 先不删。如果要删，单独提一个 PR，并在真机上对比 3×3 到 5×5 的作品 |

### 4.4 版式（LayoutType）

| 项 | 内容 |
|---|---|
| 代码 | `LayoutType`、`LayoutConfig`；store 的 `setLayoutType`、`setLabel`（界面上都没有入口）；`preview-stage.tsx` 里的 `preview-card--${layout.type}` 类名（CSS 里没有对应规则）、一段英文提示，以及非画布模式下预览卡片的 `layout.gap` 和 `layout.paddingX / paddingY` |
| 用户可见 | 几乎没有：画布上的画板用的是 `canvasMetrics`，不读 layout。需要注意的是，非画布模式的预览卡片用 `layout.gap` 和 `layout.padding*` 排版，删除时要把现在的默认值（gap 12px，内边距 14px / 18px）写死，否则那里的排版会变 |
| 测试 | 无直接断言 |
| 风险 | 低 |

### 4.5 其他发现的遗留项（同样只列出）

| 项 | 说明 |
|---|---|
| `TextConfig`（`loader.text`）、`setLabel` | 加载动画组件的文字标签。界面没有入口，`renameLoader` 会顺带改写它 |
| `EffectsConfig.shimmer`、`LoaderModes`（`modes`） | 没有读取方 |
| `pattern.snapshots`、`captureSnapshot`、`clearSnapshots` | 界面没有入口 |
| `LoaderTemplate`、`assets.templates`、`applyLoaderTemplate`（空操作）、`templateId`、`sourceType` | 上游的模板功能，normalize 会把它们清空 |
| `PatternPresetId`、`applyPatternPreset`、`src/lib/pattern-presets.ts` | 界面没有入口 |
| `focusModeLoaderId`、`enterFocusMode` / `exitFocusMode`、`isPreviewing` / `togglePreview`、`resetCanvasView` | 界面没有入口 |
| `canvas.background` / `previewMode`、`ProjectSettings` | 固定值 |
| `Timeline` / `compileTimeline` | 只在测试里使用 |
| `src/types/dot-motion.ts` 的文件名、`mock-project.ts` 里的 “Dot Motion Builder V1” | 名称遗留。`STORAGE_KEY` 与 `<dot-motion-loader>` 标签名有意保留，不要改 |
| `src/lib/*.ts` 中转发到 `src/core/` 的 9 个旧路径 | 是为了不改测试而保留的。可以在一个单独的提交里把测试的 require 改成 `src/core/` 路径，然后删掉这些转发文件 |

---

## 5. 构建：Next.js 静态导出 → Vite

### 5.1 现在用到的 Next 功能

- App Router 只有两个页面：`/`（首页）和 `/editor`（编辑器）；`layout.tsx` 里设置了 metadata 和 `<html lang="zh-CN">`。
- `next/link`，只在首页使用一次。
- 桌面构建用 `output: "export"`、`trailingSlash: true`、`distDir: "out"`（`DESKTOP_EXPORT=1`）。Electron 的主进程在 `127.0.0.1` 上提供 `out/`，并打开 `/editor/`；`electron-builder` 把 `out` 作为 `extraResources` 复制到 `web/`。
- 网页版的 `next start` 用 `headers()` 给 `/editor` 加了 no-cache。
- 不使用任何服务端功能：没有 API 路由、`next/font`、`next/image` 或 middleware。所有组件都带 `"use client"`。
- 依赖：`next`、`@next/swc-wasm-nodejs`、`next-env.d.ts`，以及 tsconfig 里的 `plugins: [{ name: "next" }]` 和 `.next/types/**/*.ts`。

### 5.2 步骤

1. 添加 `vite`、`@vitejs/plugin-react`、`@tailwindcss/vite`，并把 `@/` 别名配置到 `resolve.alias`。
2. 新增 `index.html`（承接 title、description、`lang="zh-CN"`）和 `src/main.tsx`：`createRoot(...).render(<StrictMode><EditorApp /></StrictMode>)`。`StrictMode` 对应现在的 `reactStrictMode: true`。
3. 首页（`src/app/page.tsx`）在桌面应用里看不到，建议删除。如果要保留，就用 Vite 的多页面入口做成单独的 `home.html`。
4. `globals.css` 改为在 `main.tsx` 里 import。Tailwind 的 `@source` 路径相对于 CSS 文件，保持不变。
5. 构建产物输出到 `out/editor/index.html`（`base: "./"` 或 `/editor/`），这样 `desktop/src/main.ts` 的 `loadURL(".../editor/")` 和 `electron-builder` 的配置都不用改。如果改用根路径 `/`，也只需改 `main.ts` 一行；localStorage 按“源”（协议 + 主机 + 端口）隔离，与路径无关，所以作品不会丢。
6. `scripts/build-desktop.mjs` 中的 `npx next build` 改成 `npx vite build`。`package.json` 中 `dev`、`build`、`start`、`start:fast` 改为 vite 对应命令，同步更新 README 中英文的“开发”部分（开发地址目前写的是 `http://127.0.0.1:3000/editor`）。
7. 删除 `next.config.mjs`、`next-env.d.ts`、tsconfig 里的 next 插件和 `.next/types` 引用，以及 `next`、`@next/swc-wasm-nodejs` 依赖。
8. 测试脚本不依赖 Next，不需要改动。

### 5.3 风险与验证

- **样式**：Tailwind 的 Vite 插件和 PostCSS 插件对 `@import` 的展开顺序必须一致。验证方法沿用这次 PR 的做法：比较编译后的 CSS（应字节一致或只有等价差异），再比较 DOM 和截图快照。
- **水合**：现在 `/editor` 先在服务端渲染出 “Loading editor...”，再在客户端水合（`suppressHydrationWarning` 就是为此加的）。改成纯客户端渲染后，这个问题自然消失。首屏会短暂空白，可以在 `index.html` 里放同样的加载文字。
- **Web Bluetooth / 屏幕采集**：要求安全上下文，`127.0.0.1` 满足，不受影响。
- **缓存**：`next start` 的 no-cache 头只对网页版有意义。Electron 由自己的静态服务器提供页面（`api-server.ts` 的 static 部分），需要确认它对 `index.html` 的缓存策略，避免升级后加载旧的 JS。
- **打包体积 / 分块**：Vite 默认分块方式和 Next 不同，对桌面应用影响不大。
- **回滚**：单独一个 PR，不和数据模型的改动混在一起。

---

## 6. 作品存储：localStorage → 磁盘项目文件（`.dms`）

### 6.1 文件格式

- 扩展名 `.dms`，UTF-8 JSON，内容就是 2.1 节的 `Workspace`。`Uint8Array` 序列化为 base64 字符串，读取时还原。32×32 × 24 帧 × 若干图层，文件也只有几十 KB。
- 顶层带 `format: "dot-matrix-studio"` 和 `formatVersion`。读取时先校验这两个字段，然后按 `formatVersion` 链式迁移（v1 → v2 → …），每一步都是 `src/core/migrate/` 中的纯函数。
- 读入的数据视为不可信：沿用现在 `sanitizeLayer` / `normalize` 的做法，限制尺寸、校验颜色格式、限制调色板长度和像素下标范围。

### 6.2 读写都放在主进程，通过 IPC 暴露

在 `desktop/src/preload.ts` 的 `matrixDesktop` 桥上增加一组方法。只新增，不改动现有方法：

```ts
type ProjectFilesBridge = {
  /** 打开对话框选文件；返回路径和内容，取消时返回 null。 */
  openProject(): Promise<{ path: string; text: string } | null>;
  /** 保存到已有路径；没有路径时弹出“另存为”。返回最终路径。 */
  saveProject(text: string, path?: string): Promise<string | null>;
  saveProjectAs(text: string): Promise<string | null>;
  listRecent(): Promise<Array<{ path: string; name: string; updatedAt: string }>>;
  /** 自动保存（崩溃恢复用），不改变“当前文件”。 */
  writeAutosave(text: string): Promise<void>;
  readAutosave(): Promise<string | null>;
};
```

- **写入方式**：先写临时文件，再 `rename` 覆盖，保证原子性；覆盖前把旧文件保存为 `.bak`。
- **存放位置**：
  - 默认保存目录为“文档\Dot Matrix Studio”，用户可以自选；
  - 自动保存和迁移备份放在 `%APPDATA%\Dot Matrix Studio\autosave\` 和 `…\backups\`；
  - 最近文件列表放进现有的 `settings.json`（`desktop/src/settings.ts`）。
- **编辑器端**：store 里增加 `filePath` 和 `dirty`。编辑后防抖写自动保存；Ctrl+S 保存，Ctrl+Shift+S 另存为，Ctrl+O 打开。关闭窗口时如果有未保存的修改，要提示。窗口关闭后应用常驻托盘，所以这个提示不能阻止退回托盘。
- **网页版（开发用，没有 Electron）**：
  - 支持 File System Access API 时用它；
  - 不支持时退回到下载 / 上传；
  - 自动保存继续写 localStorage。
- **不放进项目文件的偏好**：点阵屏色彩微调（`dot-matrix-panel-tuning`）和最近用色（`dot-matrix-recent-colors`）是设备 / 个人偏好，继续放在 localStorage，或者以后改放 `settings.json`。

### 6.3 旧数据迁移

1. 新版本第一次在 Electron 里启动时，渲染进程读取 `localStorage["dot-motion-builder.project.v9"]`（`STORAGE_KEY` 不变）。
2. 先把原始 JSON 原样写入 `%APPDATA%\Dot Matrix Studio\backups\legacy-localstorage-<日期>.json`。
3. 用第 3 节的迁移函数转换，写出 `…\Documents\Dot Matrix Studio\我的作品.dms` 并打开它。迁移报告写在备份文件旁边。
4. 在 `settings.json` 里记下 `migratedLegacyProject: true` 和迁移时间，以后不再自动迁移。
5. **不删除 localStorage 里的旧数据**，这样回退到旧版本时作品仍然在。提供菜单项“重新从旧版数据导入”。
6. **端口问题**：如果用户曾经因为 47321 被占用而在随机端口上画过作品，那些作品存在另一个源下，新版本读不到。可选的补救是在主进程里直接读取 `%APPDATA%\Dot Matrix Studio\Local Storage\leveldb`，找出所有 `http://127.0.0.1:*` 源下的这个键。这需要一个 leveldb 读取库，实现上有一定成本，建议先在报告中提示，按需再做。改用 `.dms` 之后，作品不再依赖端口，这个问题也就从根本上消失了。

---

## 7. 撤销 / 重做：从整份快照改成命令模式

### 7.1 现状

`src/stores/editor-history.ts` 订阅 store：每次 `project` 引用变化，就把上一份完整的 `Project` 压入 `past`（最多 100 份）。具体做法：

- 只改了画布视图（`loaders` 和 `assets` 的引用都没变）时不记录；
- 一次指针按下到抬起之间的所有改动合并成一步；
- 不是指针操作的改动（输入、方向键），间隔在 500 ms 内的合并成一步；
- 撤销时保留当前视图，清除选区。

这套做法的优点是简单，而且不会漏记。缺点是：

- 内存随作品大小线性增长；
- 不知道每一步“做了什么”，无法显示“撤销：画笔”；
- 以后一个 `.dms` 里有多个文档，每个文档没法有独立的历史；
- agent 通过 API 做的修改和用户的修改混在一起。

### 7.2 设计

```ts
/** 一次可撤销的修改。apply / revert 都是纯函数，输入输出都是不可变的 Workspace。 */
export interface Command {
  /** 显示在菜单上，例如“画笔”“删除图层”“导入图片”。 */
  readonly label: string;
  /** 合并键：同一个键在合并窗口内连续出现时，合并成一步（例如拖动发光滑块）。 */
  readonly mergeKey?: string;
  apply(ws: Workspace): Workspace;
  revert(ws: Workspace): Workspace;
  /** 估算占用的字节数，用来按内存预算裁剪历史。 */
  readonly size: number;
}

/** 一组命令作为一步，例如一次拖动、一次导入（新建图层 + 写入像素）。 */
export type Transaction = { label: string; commands: Command[]; source: "user" | "agent" };
```

**命令种类**：用少数几种通用命令覆盖全部操作，避免每个按钮都写一个命令类。

| 命令 | 覆盖的操作 | revert 需要保存的数据 |
|---|---|---|
| `ReplaceCel(docId, celKey, before, after)` | 画笔、橡皮、填充、形状、文字、粘贴、导入图片、移动或翻转图层 | 修改前后两个 cel 的引用（cel 不可变，只多保存一份引用和像素） |
| `SetLayerProps(docId, layerId, before, after)` | 改名、显示 / 隐藏、锁定 | 修改前后的属性 |
| `InsertLayer` / `RemoveLayer(docId, index, layer, cels)` | 新建、复制、删除图层；向下合并 = Remove + ReplaceCel | 被删除的图层和它的所有 cel |
| `MoveLayer(docId, from, to)` | 调整图层顺序 | 两个下标 |
| `InsertFrame` / `RemoveFrame` / `SetFrameDuration` | 帧操作 | 同上 |
| `SetDocumentProps(docId, before, after)` | 颜色、发光、动效、对称等 | 修改前后的属性 |
| `ReplaceDocument(docId, before, after)` | 改网格尺寸等难以增量表示的操作 | 修改前后整个文档（这类操作很少） |
| `InsertDocument` / `RemoveDocument` / `MoveDocument` | 画板的新建、复制、删除、拖动 | 文档本身或位置 |

**History 管理器**放在 `src/core/history.ts`，是纯逻辑，可以单元测试：

- `commit(tx)`：清空 `future`，压入 `past`。如果和栈顶的 `mergeKey` 相同，并且在合并窗口内，就合并：保留栈顶的 before，替换成新的 after。
- `beginGesture()` / `endGesture()`：指针按下到抬起之间的所有提交合并成一个 Transaction，保留现在“一笔算一步”的手感。
- **限制**：同时满足“步数不超过 100”（与现在相同）和“总字节不超过预算（例如 32 MB）”，从最旧的开始丢弃。
- **视图**（缩放、平移、选中哪个画板）不生成命令，与现在一致。
- **agent 的修改**：生成 `source: "agent"` 的 Transaction。默认也能撤销，但不和用户的步骤合并。

**接入 store**：现在的 action 内部改为“构造命令，然后 `dispatch`”，对组件暴露的 action 名称和参数不变。`useHistoryStore` 继续提供 `canUndo` / `canRedo`，并新增 `undoLabel` / `redoLabel`。

**测试**：

- 对每种命令做往返测试：`revert(apply(ws))` 与 `ws` 深度相等，`apply(revert(apply(ws)))` 与 `apply(ws)` 深度相等；
- 随机操作序列：执行 N 步，再撤销 N 步，必须回到初始状态；
- 合并与手势分组的时序测试，使用可控时钟。

---

## 8. 建议的实施顺序

每一步都是独立的 PR，都要在本机 Windows 和真实点阵屏上验收后再合并。

1. **修复 `hydrate` 版本不符时覆盖作品的问题**（3.1 节）。改动小，风险高、收益大，应该最先做。
2. **决定第 4 节的删除清单**，按项分别提 PR，删除功能和删除相关测试断言放在同一个 PR 里，逐条说明。先删掉不要的东西，新模型就能更小。
3. **新数据模型和迁移函数**，只在 `src/core/` 里实现，包括 `compositeFrame`、`documentToLoader` 和 `migrate`，并有完整测试，不接入界面。
4. **store 切换到新模型**：渲染器通过 `documentToLoader` 适配，`idotmatrix/` 不改动。在真机上验证实时同步、存到屏幕和 agent 状态画面。
5. **命令式撤销 / 重做**（第 7 节）。
6. **`.dms` 文件存储和旧数据迁移**（第 6 节）。
7. **Vite**（第 5 节）。这一步与数据模型无关，也可以提前到第 2 步之后做。

每一步的通用验收方法（沿用 `refactor/cloud-cleanup` 的做法）：

- `pnpm test` 全部通过；
- 用 `pnpm qa:snapshot` 对比 DOM、截图、CSS 和一串编辑操作（用法见 README 的“开发”部分）；
- 点阵屏输出用 `renderMatrixFrames` 逐字节比对；
- 最后在本机真机上检查：实时同步、存到屏幕、投屏、agent 状态画面、安装包能否正常启动。
