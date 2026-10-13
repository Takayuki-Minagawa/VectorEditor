import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_STARTUP_RESTORE_POLICY,
  STARTUP_RESTORE_STORAGE_KEY,
  loadStartupRestorePreference,
  parseStartupRestoreQuery,
  readStartupRestoreQuery,
  resolveStartupRestorePolicy,
  saveStartupRestorePreference,
} from './startupRestorePolicy';

afterEach(() => {
  localStorage.clear();
});

describe('parseStartupRestoreQuery', () => {
  it('maps canonical values and aliases', () => {
    expect(parseStartupRestoreQuery('auto')).toBe('auto');
    expect(parseStartupRestoreQuery('ASK')).toBe('ask');
    expect(parseStartupRestoreQuery(' discard ')).toBe('discard');
    expect(parseStartupRestoreQuery('new')).toBe('discard');
    expect(parseStartupRestoreQuery('prompt')).toBe('ask');
    expect(parseStartupRestoreQuery('1')).toBe('auto');
  });

  it('ignores unknown or empty values', () => {
    expect(parseStartupRestoreQuery('')).toBeNull();
    expect(parseStartupRestoreQuery(null)).toBeNull();
    expect(parseStartupRestoreQuery('maybe')).toBeNull();
  });
});

describe('readStartupRestoreQuery', () => {
  it('reads the restore parameter from a search string', () => {
    expect(readStartupRestoreQuery('?restore=ask')).toBe('ask');
    expect(readStartupRestoreQuery('?lang=en&restore=new')).toBe('discard');
    expect(readStartupRestoreQuery('?restore=')).toBeNull();
    expect(readStartupRestoreQuery('')).toBeNull();
  });
});

describe('persisted preference', () => {
  it('defaults to auto and round-trips the stored policy', () => {
    expect(loadStartupRestorePreference()).toBe(DEFAULT_STARTUP_RESTORE_POLICY);
    saveStartupRestorePreference('ask');
    expect(localStorage.getItem(STARTUP_RESTORE_STORAGE_KEY)).toBe('ask');
    expect(loadStartupRestorePreference()).toBe('ask');
  });

  it('removes the stored key when the default is chosen again', () => {
    saveStartupRestorePreference('discard');
    saveStartupRestorePreference('auto');
    expect(localStorage.getItem(STARTUP_RESTORE_STORAGE_KEY)).toBeNull();
  });

  it('falls back to the default for corrupt values', () => {
    localStorage.setItem(STARTUP_RESTORE_STORAGE_KEY, 'bogus');
    expect(loadStartupRestorePreference()).toBe('auto');
  });
});

describe('resolveStartupRestorePolicy', () => {
  it('prefers the URL override over the stored preference', () => {
    saveStartupRestorePreference('ask');
    expect(resolveStartupRestorePolicy('?restore=discard')).toBe('discard');
    expect(resolveStartupRestorePolicy('')).toBe('ask');
    expect(resolveStartupRestorePolicy('?restore=unknown')).toBe('ask');
  });
});
