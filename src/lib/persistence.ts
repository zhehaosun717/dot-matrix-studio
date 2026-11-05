import { Project } from "@/types/dot-motion";

// Keeps the pre-rename name on purpose: changing it would make every saved project unreadable.
export const STORAGE_KEY = "dot-motion-builder.project.v9";
/** Backups of a stored project taken before it is replaced; each gets its own key and is never written over. */
export const BACKUP_KEY_PREFIX = `${STORAGE_KEY}.backup.`;

type SaveListener = (ok: boolean) => void;
const saveListeners = new Set<SaveListener>();
/** A stored project that still has to be backed up before anything may overwrite it. */
let pendingBackup: { raw: string; label: string } | null = null;

/** Notified after every save attempt; false means the browser refused it (usually storage full). */
export function onSaveResult(listener: SaveListener) {
  saveListeners.add(listener);
  return () => {
    saveListeners.delete(listener);
  };
}

/**
 * Writes the project to localStorage. A full storage (~5 MB) must not throw out of a store update and
 * lose the edit on screen too, so failures are reported to listeners instead.
 */
export function saveProject(project: Project) {
  if (typeof window === "undefined") {
    return;
  }

  let ok = true;
  if (pendingBackup && backupStoredProject(pendingBackup.raw, pendingBackup.label)) {
    pendingBackup = null;
  }
  if (pendingBackup) {
    // The old project could not be copied anywhere yet, so it must stay where it is.
    ok = false;
  } else {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch (error) {
      ok = false;
      console.warn("[editor] could not save the project", error);
    }
  }
  saveListeners.forEach((listener) => listener(ok));
}

export function loadProject() {
  const stored = readStoredProject();
  return stored.kind === "ok" ? stored.project : null;
}

export type StoredProject =
  | { kind: "empty" }
  | { kind: "ok"; project: Project; raw: string }
  | { kind: "unreadable"; raw: string };

/** The stored project, telling an empty storage apart from one holding text that is not a project. */
export function readStoredProject(): StoredProject {
  if (typeof window === "undefined") {
    return { kind: "empty" };
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { kind: "empty" };
  }

  try {
    const project = JSON.parse(raw) as Project;
    return project && typeof project === "object" ? { kind: "ok", project, raw } : { kind: "unreadable", raw };
  } catch {
    return { kind: "unreadable", raw };
  }
}

/**
 * Copies the stored text, unchanged, to a new backup key ("<STORAGE_KEY>.backup.<label>.<time>").
 * Returns false when the browser refused (storage full).
 */
export function backupStoredProject(raw: string, label: string) {
  if (typeof window === "undefined") {
    return false;
  }

  const key = `${BACKUP_KEY_PREFIX}${label}.${new Date().toISOString()}`;
  try {
    window.localStorage.setItem(key, raw);
    return true;
  } catch (error) {
    console.warn("[editor] could not back up the stored project", error);
    return false;
  }
}

/**
 * Keeps the stored project from being overwritten until a backup of it succeeds: every save tries the
 * backup again first, and reports failure (the save banner) while it cannot be made.
 */
export function keepStoredProjectUntilBackedUp(raw: string, label: string) {
  pendingBackup = { raw, label };
}
