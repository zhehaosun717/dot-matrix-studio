// Visual regression check for refactors: capture the editor before and after a change, then compare.
//
//   node scripts/qa-snapshot.mjs capture <dir> [--url http://127.0.0.1:3000] [--build]
//   node scripts/qa-snapshot.mjs compare <beforeDir> <afterDir>
//
// capture serves the current production build (`pnpm build`, or pass --build) with `next start` on a free
// port, unless --url points at a running editor. It records, in <dir>:
//   - for several screens: the DOM (React ids normalised) and a 1440x900 screenshot;
//   - the CSS the page loads;
//   - a fixed sequence of edits (drawing, undo, shortcuts, panning, sequences, ...): the DOM and the saved
//     project after every step, with random ids and the clock fixed so two runs match exactly.
// compare reports every difference and exits with 1 when there is one.
//
// Needs Playwright with Chromium, which is not a project dependency:
//   npx playwright install chromium   (and `pnpm add -D playwright`, or set PLAYWRIGHT_MODULE to its path)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const STORAGE_KEY = "dot-motion-builder.project.v9";
const VIEWPORT = { width: 1440, height: 900 };

async function loadPlaywright() {
  try {
    return await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  } catch {
    console.error("Playwright is not installed. Run `npx playwright install chromium` and `pnpm add -D playwright`,\nor set PLAYWRIGHT_MODULE to an installed playwright package.");
    process.exit(2);
  }
}

/** React's generated ids depend on where components sit in the tree; number them in order of appearance. */
function normaliseHtml(html) {
  const ids = new Map();
  return html
    .replace(/«[^»]+»|:r[0-9a-z]+:|:R[0-9A-Za-z]+:|_r_[0-9a-z]+_/g, (id) => {
      if (!ids.has(id)) ids.set(id, `ID${ids.size}`);
      return ids.get(id);
    })
    .replace(/></g, ">\n<");
}

const freePort = () => new Promise((done, fail) => {
  const server = net.createServer();
  server.once("error", fail);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => done(port));
  });
});

function run(args) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`${args.join(" ")} exited with ${code}`))));
  });
}

/** Starts `next start` on a free port; returns its URL and a stop function. */
async function startServer() {
  const nextBin = require.resolve("next/dist/bin/next");
  const port = await freePort();
  const child = spawn(process.execPath, [nextBin, "start", "--port", String(port), "--hostname", "127.0.0.1"], { cwd: root, stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) return { url, stop: () => child.kill() };
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  child.kill();
  throw new Error("next start did not come up; run `pnpm build` first (or pass --build)");
}

async function bodyHtml(page) {
  return normaliseHtml(await page.evaluate(() => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll("script, next-route-announcer, link, style").forEach((node) => node.remove());
    return clone.outerHTML;
  }));
}

/** Screens captured as DOM + screenshot. Each step works from the previous one. */
const SCREENS = [
  ["01-editor", async () => {}],
  ["02-artboard-selected", async (page) => page.locator(".canvas-artboard").first().click({ position: { x: 20, y: 20 } })],
  ["03-sections-expanded", async (page) => {
    for (let i = 0; i < 16; i++) {
      const toggle = page.locator('.settings-sidebar [data-slot="control-section-header"] button[aria-expanded="false"]').first();
      if (!(await toggle.count())) break;
      await toggle.click();
      await page.waitForTimeout(150);
    }
  }],
  ["04-sidebar-scrolled", async (page) => page.locator(".settings-sidebar").evaluate((el) => {
    const scroller = el.querySelector('[data-slot="toolcraft-panel-content"]') || el;
    scroller.scrollTop = scroller.scrollHeight;
  })],
  ["05-add-menu", async (page) => page.locator(".builder-topbar__center button").first().click()],
  ["06-export-drawer", async (page) => {
    await page.keyboard.press("Escape");
    await page.mouse.click(700, 850);
    await page.locator(".builder-topbar__actions button").last().click();
  }]
];

/** Edits replayed in a fresh editor; the DOM and the saved project are recorded after each. */
const cell = (page, i) => page.locator('[data-dot-cell="true"]').nth(i);
const STEPS = [
  ["brush", async (page) => { await page.keyboard.press("b"); await cell(page, 0).click(); await cell(page, 7).click(); await cell(page, 14).click(); }],
  ["nudge", async (page) => { await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowDown"); }],
  ["undo", async (page) => page.keyboard.press("Control+z")],
  ["redo", async (page) => page.keyboard.press("Control+y")],
  ["erase", async (page) => { await page.keyboard.press("e"); await cell(page, 15).click(); }],
  ["fill-tool", async (page) => page.keyboard.press("g")],
  ["wheel-zoom", async (page) => { await page.mouse.move(900, 600); await page.mouse.wheel(0, -200); }],
  ["pan", async (page) => { await page.mouse.move(1000, 700); await page.mouse.down(); await page.mouse.move(900, 650, { steps: 5 }); await page.mouse.up(); }],
  ["fit-to-content", async (page) => page.locator(".canvas-center-button").click()],
  ["drag-artboard", async (page) => {
    const box = await page.locator(".canvas-artboard.is-selected").first().boundingBox();
    await page.mouse.move(box.x + 6, box.y + 6);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 40, { steps: 5 });
    await page.mouse.up();
  }],
  ["duplicate", async (page) => page.keyboard.press("Control+d")],
  ["delete", async (page) => page.keyboard.press("Delete")],
  ["add-sequence", async (page) => { await page.locator(".builder-topbar__center button").first().click(); await page.locator(".add-artboard-card").nth(1).click(); }],
  ["add-frame", async (page) => page.locator(".sequence-group-chrome__actions button").first().click()],
  ["preview-selected", async (page) => page.locator(".motion-preview-button").click()],
  ["escape", async (page) => page.keyboard.press("Escape")],
  ["preview-all", async (page) => {
    await page.locator(".canvas-artboard").first().click({ position: { x: 20, y: 20 } });
    await page.locator(".builder-topbar__actions button").nth(-2).click();
  }],
  ["english", async (page) => {
    await page.locator(".builder-topbar__actions button").nth(-2).click();
    await page.locator('.language-switch [role="radio"], .language-switch button').last().click();
  }],
  ["collapse-section", async (page) => page.locator('.settings-sidebar [data-slot="control-section-header"] button[aria-expanded="true"]').first().click()]
];

/**
 * Fixed random ids and clocks, so two captures of the same code match exactly: saved projects get the same
 * ids and dates, and running previews stay on their first frame (animation time is always 0).
 */
function freezeRandomness() {
  performance.now = () => 0;
  const nativeFrame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => nativeFrame(() => callback(0));
  let next = 0;
  crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
  const fixed = 1700000000000;
  const RealDate = Date;
  // eslint-disable-next-line no-global-assign
  Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  };
}

async function capture(dir, options) {
  const { chromium } = await loadPlaywright();
  if (options.build) await run([require.resolve("next/dist/bin/next"), "build"]);
  const server = options.url ? { url: options.url.replace(/\/$/, ""), stop: () => {} } : await startServer();
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  try {
    const newPage = async () => {
      const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: "reduce" });
      await context.addInitScript(freezeRandomness);
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(`${server.url}/editor`);
      await page.waitForSelector(".builder-shell");
      return page;
    };

    const page = await newPage();
    for (const [name, action] of SCREENS) {
      await action(page);
      await page.waitForTimeout(700);
      fs.writeFileSync(path.join(dir, `${name}.html`), await bodyHtml(page));
      await page.screenshot({ path: path.join(dir, `${name}.png`), animations: "disabled" });
    }
    const css = await page.evaluate(async () => {
      const hrefs = [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.href);
      const texts = await Promise.all(hrefs.map((href) => fetch(href).then((response) => response.text())));
      return texts.sort().join("\n/* ---- */\n");
    });
    fs.writeFileSync(path.join(dir, "styles.css"), css.replace(/\}/g, "}\n"));
    await page.context().close();

    const editPage = await newPage();
    const steps = [];
    for (const [name, action] of STEPS) {
      let failure = "";
      try {
        await action(editPage);
      } catch (error) {
        failure = `step failed: ${String(error).split("\n")[0]}`;
      }
      await editPage.waitForTimeout(400);
      const saved = await editPage.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
      steps.push(`### ${name}\n${failure}\n${await bodyHtml(editPage)}\n### saved project\n${saved}`);
    }
    fs.writeFileSync(path.join(dir, "edits.txt"), steps.join("\n"));
  } finally {
    fs.writeFileSync(path.join(dir, "page-errors.txt"), errors.join("\n"));
    await browser.close();
    server.stop();
  }
  console.log(`captured ${dir}${errors.length ? ` (${errors.length} page errors, see page-errors.txt)` : ""}`);
}

/** Number of differing pixels between two PNGs (-1 when the sizes differ), computed in the browser. */
async function pixelDiff(page, a, b) {
  return page.evaluate(async ([left, right]) => {
    const load = (data) => new Promise((done) => { const image = new Image(); image.onload = () => done(image); image.src = `data:image/png;base64,${data}`; });
    const [x, y] = await Promise.all([load(left), load(right)]);
    if (x.width !== y.width || x.height !== y.height) return -1;
    const pixels = (image) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const p = pixels(x), q = pixels(y);
    let count = 0;
    for (let i = 0; i < p.length; i += 4) if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) count++;
    return count;
  }, [fs.readFileSync(a).toString("base64"), fs.readFileSync(b).toString("base64")]);
}

function firstDifference(a, b) {
  const left = a.split("\n"), right = b.split("\n");
  const index = left.findIndex((line, i) => line !== right[i]);
  const at = index === -1 ? left.length : index;
  return `line ${at + 1}:\n  - ${(left[at] ?? "").slice(0, 200)}\n  + ${(right[at] ?? "").slice(0, 200)}`;
}

async function compare(before, after) {
  const { chromium } = await loadPlaywright();
  let different = 0;
  const report = (ok, label, detail = "") => {
    if (!ok) different++;
    console.log(`${ok ? "same     " : "DIFFERENT"} ${label}${detail ? `\n${detail}` : ""}`);
  };
  const read = (dir, name) => (fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), "utf8") : null);

  const screens = fs.readdirSync(before).filter((name) => name.endsWith(".html")).sort();
  for (const name of screens) {
    const a = read(before, name), b = read(after, name);
    report(a === b, `DOM ${name}`, a === b || b === null ? (b === null ? "  missing in the second capture" : "") : firstDifference(a, b));
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const name of fs.readdirSync(before).filter((file) => file.endsWith(".png")).sort()) {
    if (!fs.existsSync(path.join(after, name))) { report(false, `screenshot ${name}`, "  missing in the second capture"); continue; }
    const pixels = await pixelDiff(page, path.join(before, name), path.join(after, name));
    report(pixels === 0, `screenshot ${name}`, pixels === 0 ? "" : pixels < 0 ? "  sizes differ" : `  ${pixels} pixels differ`);
  }
  await browser.close();

  const cssA = read(before, "styles.css") ?? "", cssB = read(after, "styles.css") ?? "";
  if (cssA === cssB) report(true, "CSS (byte-identical)");
  else {
    const linesA = new Set(cssA.split("\n")), linesB = new Set(cssB.split("\n"));
    const removed = [...linesA].filter((line) => !linesB.has(line)), added = [...linesB].filter((line) => !linesA.has(line));
    fs.writeFileSync(path.join(after, "styles.removed.css"), removed.join("\n"));
    fs.writeFileSync(path.join(after, "styles.added.css"), added.join("\n"));
    report(false, "CSS", `  ${removed.length} rules only before, ${added.length} only after (styles.removed.css / styles.added.css in ${after})`);
  }

  const split = (text) => Object.fromEntries((text ?? "").split(/^### (?!saved project)/m).filter(Boolean).map((chunk) => [chunk.slice(0, chunk.indexOf("\n")), chunk]));
  const editsA = split(read(before, "edits.txt")), editsB = split(read(after, "edits.txt"));
  for (const step of Object.keys(editsA)) {
    const same = editsA[step] === editsB[step];
    report(same, `edit "${step}" (DOM and saved project)`, same || !editsB[step] ? (editsB[step] ? "" : "  missing in the second capture") : firstDifference(editsA[step], editsB[step]));
  }

  const errorsB = (read(after, "page-errors.txt") ?? "").trim();
  report(!errorsB, "no page errors in the second capture", errorsB ? `  ${errorsB.split("\n")[0]}` : "");

  console.log(different ? `\n${different} difference(s).` : "\nNo differences.");
  process.exit(different ? 1 : 0);
}

const [command, ...args] = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const positional = args.filter((arg, i) => !arg.startsWith("--") && !(i > 0 && args[i - 1] === "--url"));

if (command === "capture" && positional[0]) {
  await capture(path.resolve(positional[0]), { url: value("--url"), build: flag("--build") });
} else if (command === "compare" && positional.length === 2) {
  await compare(path.resolve(positional[0]), path.resolve(positional[1]));
} else {
  console.log("Usage:\n  node scripts/qa-snapshot.mjs capture <dir> [--url <editor base url>] [--build]\n  node scripts/qa-snapshot.mjs compare <beforeDir> <afterDir>");
  process.exit(command ? 1 : 0);
}
