export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'vectoreditor-theme';

export function loadThemePreference(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Ignore storage access failures.
  }
  return 'light';
}

export function saveThemePreference(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage access failures.
  }
}

export function applyThemeToDom(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
}
