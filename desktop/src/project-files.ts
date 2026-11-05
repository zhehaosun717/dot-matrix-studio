/**
 * Project files on disk for the desktop app (docs/refactor-plan.md, section 6.2): atomic saves with a
 * .bak of the previous version, size-limited reads, the recent-files list, autosave for crash recovery,
 * and a one-time backup of the browser-storage project. Plain Node (no Electron); not wired to IPC yet.
 */
import fs from "node:fs";
import path from "node:path";

export const PROJECT_EXTENSION = ".dms";
/** A .dms file of a few dozen artboards is a few hundred KB; anything near this is not a project. */
export const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
export const MAX_RECENT_FILES = 10;

/** Where projects are saved by default: <Documents>/Dot Matrix Studio. */
export const defaultProjectsDir = (documentsDir: string) => path.join(documentsDir, "Dot Matrix Studio");
/** Crash-recovery copy of the open project, separate from the user's own file. */
export const autosaveFile = (dataDir: string) => path.join(dataDir, "autosave", `autosave${PROJECT_EXTENSION}`);
export const backupsDir = (dataDir: string) => path.join(dataDir, "backups");

/** Adds .dms unless the name already ends with it (any case). */
export function withProjectExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith(PROJECT_EXTENSION) ? filePath : `${filePath}${PROJECT_EXTENSION}`;
}

/**
 * Writes text so that the file is either the old version or the new one, never half of each: the text
 * goes to a temporary file in the same folder, is flushed to disk, then renamed over the target. With
 * keepBackup the previous version is first copied to <file>.bak. On failure the target is untouched and
 * the temporary file is removed.
 */
export function writeFileAtomic(filePath: string, text: string, { keepBackup = true }: { keepBackup?: boolean } = {}): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  let fd: number | null = null;
  try {
    fd = fs.openSync(temp, "wx");
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    if (keepBackup && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) fs.copyFileSync(filePath, `${filePath}.bak`);
    fs.renameSync(temp, filePath);
  } catch (error) {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

/** A project file's text. Refuses folders and files over MAX_PROJECT_BYTES (checked before reading). */
export function readProjectFile(filePath: string, maxBytes: number = MAX_PROJECT_BYTES): string {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`${filePath} is not a file`);
  if (stat.size > maxBytes) throw new Error(`${filePath} is larger than ${maxBytes} bytes`);
  return fs.readFileSync(filePath, "utf8");
}

export type RecentFile = { path: string; name: string; openedAt: string };

/** Windows paths compare without case and with either slash; others exactly (after normalising). */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "win32") return path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
  return path.posix.normalize(a) === path.posix.normalize(b);
}

/** The list with this file first (moved up if it was there already), at most MAX_RECENT_FILES long. */
export function addRecentFile(list: readonly RecentFile[], entry: RecentFile, platform: NodeJS.Platform = process.platform): RecentFile[] {
  return [entry, ...list.filter((item) => !samePath(item.path, entry.path, platform))].slice(0, MAX_RECENT_FILES);
}

/** Drops files that no longer exist (moved, deleted, on a drive that is not attached). */
export function existingRecentFiles(list: readonly RecentFile[], exists: (filePath: string) => boolean = fs.existsSync): RecentFile[] {
  return list.filter((item) => exists(item.path));
}

export function writeAutosave(dataDir: string, text: string): void {
  writeFileAtomic(autosaveFile(dataDir), text, { keepBackup: false });
}

/** The autosaved project, or null when there is none (or it cannot be read). */
export function readAutosave(dataDir: string): string | null {
  try {
    return readProjectFile(autosaveFile(dataDir));
  } catch {
    return null;
  }
}

export function clearAutosave(dataDir: string): void {
  fs.rmSync(autosaveFile(dataDir), { force: true });
}

const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

/**
 * Keeps the project from browser storage exactly as it was, before it is converted to a .dms file:
 * backups/legacy-localstorage-<date>-<time>[-n].json. Never overwrites an earlier backup. Returns its path.
 */
export function backupLegacyProject(dataDir: string, rawText: string, now: Date = new Date()): string {
  const dir = backupsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  for (let n = 0; n < 1000; n++) {
    const file = path.join(dir, `legacy-localstorage-${stamp(now)}${n ? `-${n}` : ""}.json`);
    try {
      fs.writeFileSync(file, rawText, { encoding: "utf8", flag: "wx" });
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("too many backups with the same time stamp");
}
