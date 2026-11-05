/**
 * Command-based undo / redo (docs/refactor-plan.md, section 7). Pure: every function takes a history and
 * a state and returns new ones; nothing is modified in place. Not wired into the editor yet; today's undo
 * (src/stores/editor-history.ts) still snapshots the whole project.
 */

/** One undoable change. apply and revert are pure and must undo each other exactly. */
export interface Command<S> {
  /** Shown in menus: "Brush", "Delete layer", ... */
  readonly label: string;
  /** Consecutive commits with the same key within the merge window become one step (slider drags, typing). */
  readonly mergeKey?: string;
  /** Rough bytes kept alive by this command, for the history's memory budget. */
  readonly size: number;
  apply(state: S): S;
  revert(state: S): S;
}

export type Source = "user" | "agent";

/** One undo step: one or more commands. */
export type Transaction<S> = {
  label: string;
  source: Source;
  mergeKey?: string;
  commands: Command<S>[];
  size: number;
  /** When the step was last extended (ms). */
  at: number;
  /** Closed steps take no more commands (a finished gesture, or one interrupted by undo / redo). */
  closed: boolean;
};

export type HistoryLimits = {
  /** Undo steps kept (today's editor keeps 100). */
  maxSteps: number;
  /** Bytes kept across all steps; the oldest steps go first. The newest step is always kept. */
  maxBytes: number;
  /** Commits with the same mergeKey closer together than this merge. */
  mergeWindowMs: number;
};

export type History<S> = {
  past: Transaction<S>[];
  future: Transaction<S>[];
  /** Inside a gesture (pointer down .. up) every commit joins one step. */
  inGesture: boolean;
  limits: HistoryLimits;
};

export const DEFAULT_LIMITS: HistoryLimits = { maxSteps: 100, maxBytes: 32 * 1024 * 1024, mergeWindowMs: 500 };

export function createHistory<S>(limits: Partial<HistoryLimits> = {}): History<S> {
  return { past: [], future: [], inGesture: false, limits: { ...DEFAULT_LIMITS, ...limits } };
}

export const canUndo = <S>(history: History<S>) => history.past.length > 0;
export const canRedo = <S>(history: History<S>) => history.future.length > 0;
export const undoLabel = <S>(history: History<S>) => history.past.at(-1)?.label ?? null;
export const redoLabel = <S>(history: History<S>) => history.future[0]?.label ?? null;

const sizeOf = <S>(commands: readonly Command<S>[]) => commands.reduce((sum, command) => sum + command.size, 0);
const closeTop = <S>(past: Transaction<S>[]) => (past.length && !past.at(-1)!.closed ? [...past.slice(0, -1), { ...past.at(-1)!, closed: true }] : past);

/** Drops the oldest steps beyond the step and byte limits, never the newest one. */
function trim<S>(past: Transaction<S>[], limits: HistoryLimits): Transaction<S>[] {
  let kept = past.slice(-limits.maxSteps);
  let bytes = kept.reduce((sum, step) => sum + step.size, 0);
  while (kept.length > 1 && bytes > limits.maxBytes) {
    bytes -= kept[0].size;
    kept = kept.slice(1);
  }
  return kept;
}

export type CommitOptions = { now: number; source?: Source; label?: string };

/**
 * Applies the commands to the state and records them: inside a gesture they join the gesture's step;
 * otherwise they join the previous step when it is open, has the same mergeKey and source, and is within
 * the merge window; otherwise they start a new step. A commit clears redo.
 */
export function commit<S>(history: History<S>, state: S, commands: Command<S> | Command<S>[], options: CommitOptions): { history: History<S>; state: S } {
  const list = Array.isArray(commands) ? commands : [commands];
  if (!list.length) return { history, state };
  const next = list.reduce((current, command) => command.apply(current), state);
  const source = options.source ?? "user";
  const mergeKey = list.length === 1 ? list[0].mergeKey : undefined;
  const top = history.past.at(-1);
  const joins = Boolean(
    top && !top.closed && top.source === source &&
      (history.inGesture || (mergeKey !== undefined && top.mergeKey === mergeKey && options.now - top.at <= history.limits.mergeWindowMs))
  );
  const step: Transaction<S> = joins && top
    ? { ...top, commands: [...top.commands, ...list], size: top.size + sizeOf(list), at: options.now }
    : {
        label: options.label ?? list[0].label,
        source,
        mergeKey,
        commands: list,
        size: sizeOf(list),
        at: options.now,
        closed: false
      };
  const earlier = joins ? history.past.slice(0, -1) : closeTop(history.past);
  return { history: { ...history, past: trim([...earlier, step], history.limits), future: [] }, state: next };
}

/** Starts a gesture: until endGesture, every commit joins one step. */
export function beginGesture<S>(history: History<S>): History<S> {
  return { ...history, past: closeTop(history.past), inGesture: true };
}

/** Ends a gesture; the next commit starts a new step. */
export function endGesture<S>(history: History<S>): History<S> {
  return { ...history, past: closeTop(history.past), inGesture: false };
}

export function undo<S>(history: History<S>, state: S): { history: History<S>; state: S } {
  const step = history.past.at(-1);
  if (!step) return { history, state };
  const previous = [...step.commands].reverse().reduce((current, command) => command.revert(current), state);
  return {
    history: { ...history, past: history.past.slice(0, -1), future: [{ ...step, closed: true }, ...history.future], inGesture: false },
    state: previous
  };
}

export function redo<S>(history: History<S>, state: S): { history: History<S>; state: S } {
  const step = history.future[0];
  if (!step) return { history, state };
  const next = step.commands.reduce((current, command) => command.apply(current), state);
  return {
    history: { ...history, past: trim([...closeTop(history.past), step], history.limits), future: history.future.slice(1), inGesture: false },
    state: next
  };
}
