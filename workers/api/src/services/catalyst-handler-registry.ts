/**
 * Catalyst Handler Registry
 *
 * Extension point for domain-specific catalyst action handlers. Replaces the
 * previous keyword-sniff dispatch in catalyst-engine.ts::performAction.
 *
 * Handlers registered via registerHandler (domain plugins) are tried first.
 * Handlers registered via registerDefaultHandler (built-in generic handlers)
 * are tried last. Within each group, insertion order wins.
 *
 * The last default handler registered MUST always match (catch-all) — if no
 * handler matches, dispatchAction throws.
 */

import type { TaskDefinition } from './catalyst-engine';

export type CatalystHandler = {
  /** Human-readable name for logging and observability. */
  name: string;
  /** Return true if this handler can execute the task. */
  match: (task: TaskDefinition) => boolean;
  /** Execute the task and return the output payload. */
  execute: (task: TaskDefinition, db: D1Database) => Promise<Record<string, unknown>>;
};

const customHandlers: CatalystHandler[] = [];
const defaultHandlers: CatalystHandler[] = [];

/** Register a domain-specific handler. Tried before built-in defaults. */
export function registerHandler(handler: CatalystHandler): void {
  customHandlers.push(handler);
}

/** Register a built-in generic handler. Tried after custom handlers. */
export function registerDefaultHandler(handler: CatalystHandler): void {
  defaultHandlers.push(handler);
}

/** Dispatch a task to the first handler whose match() returns true. */
export async function dispatchAction(
  task: TaskDefinition,
  db: D1Database,
): Promise<Record<string, unknown>> {
  for (const h of customHandlers) {
    if (h.match(task)) return h.execute(task, db);
  }
  for (const h of defaultHandlers) {
    if (h.match(task)) return h.execute(task, db);
  }
  throw new Error(`catalyst-engine: no handler matched action "${task.action}"`);
}

/** Test-only helpers. Do not use in production code. */
export function _resetRegistryForTests(): void {
  customHandlers.length = 0;
  defaultHandlers.length = 0;
}
export function _listHandlersForTests(): { custom: string[]; defaults: string[] } {
  return {
    custom: customHandlers.map(h => h.name),
    defaults: defaultHandlers.map(h => h.name),
  };
}
