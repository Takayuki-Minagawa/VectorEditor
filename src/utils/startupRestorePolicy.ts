/**
 * Startup behaviour when an auto-saved document exists.
 *
 * - `auto`    restore the snapshot without asking (default). The editor is
 *             usable immediately, which also keeps automated clients such as
 *             browser-driving AI agents from stalling on a modal.
 * - `ask`     show the confirmation dialog before restoring (legacy behaviour).
 * - `discard` drop the snapshot and open a blank document.
 *
 * The policy is resolved from the URL first (one-off override, e.g.
 * `?restore=discard` for a deterministic blank start) and then from the
 * persisted preference.
 */
export type StartupRestorePolicy = 'auto' | 'ask' | 'discard';

export const STARTUP_RESTORE_POLICIES: readonly StartupRestorePolicy[] = ['auto', 'ask', 'discard'];
export const DEFAULT_STARTUP_RESTORE_POLICY: StartupRestorePolicy = 'auto';
export const STARTUP_RESTORE_STORAGE_KEY = 'vectoreditor-startup-restore-v1';
export const STARTUP_RESTORE_QUERY_PARAM = 'restore';

const QUERY_ALIASES: Record<string, StartupRestorePolicy> = {
  auto: 'auto',
  restore: 'auto',
  yes: 'auto',
  '1': 'auto',
  true: 'auto',
  ask: 'ask',
  prompt: 'ask',
  confirm: 'ask',
  discard: 'discard',
  new: 'discard',
  blank: 'discard',
  no: 'discard',
  '0': 'discard',
  false: 'discard',
};

export function isStartupRestorePolicy(value: unknown): value is StartupRestorePolicy {
  return typeof value === 'string' && (STARTUP_RESTORE_POLICIES as readonly string[]).includes(value);
}

/** Parse a query-string value such as `auto`, `ask`, `discard` or `new`. */
export function parseStartupRestoreQuery(value: string | null | undefined): StartupRestorePolicy | null {
  if (!value) return null;
  return QUERY_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function readStartupRestoreQuery(search: string = typeof location === 'undefined' ? '' : location.search): StartupRestorePolicy | null {
  try {
    return parseStartupRestoreQuery(new URLSearchParams(search).get(STARTUP_RESTORE_QUERY_PARAM));
  } catch {
    return null;
  }
}

export function loadStartupRestorePreference(): StartupRestorePolicy {
  if (typeof localStorage === 'undefined') return DEFAULT_STARTUP_RESTORE_POLICY;
  try {
    const saved = localStorage.getItem(STARTUP_RESTORE_STORAGE_KEY);
    return isStartupRestorePolicy(saved) ? saved : DEFAULT_STARTUP_RESTORE_POLICY;
  } catch {
    return DEFAULT_STARTUP_RESTORE_POLICY;
  }
}

export function saveStartupRestorePreference(policy: StartupRestorePolicy): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (policy === DEFAULT_STARTUP_RESTORE_POLICY) localStorage.removeItem(STARTUP_RESTORE_STORAGE_KEY);
    else localStorage.setItem(STARTUP_RESTORE_STORAGE_KEY, policy);
  } catch {
    // The preference still applies for this session when storage is denied.
  }
}

/** URL override first, then the persisted preference, then the default. */
export function resolveStartupRestorePolicy(search?: string): StartupRestorePolicy {
  return readStartupRestoreQuery(search) ?? loadStartupRestorePreference();
}
