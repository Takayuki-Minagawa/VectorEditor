import { create } from 'zustand';
import ja from './ja';
import en from './en';
import type { TranslationKeys } from './ja';

export type Lang = 'ja' | 'en';

const translations: Record<Lang, Record<TranslationKeys, string>> = { ja, en };

interface I18nStore {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKeys) => string;
}

const STORAGE_KEY = 'vectoreditor-language-v1';

function loadLanguage(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ja' || saved === 'en') return saved;
  } catch {
    // Fall back to the browser locale when storage is unavailable.
  }
  return 'ja';
}

function applyLanguage(lang: Lang): void {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* optional */ }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

const initialLanguage = loadLanguage();
if (typeof document !== 'undefined') document.documentElement.lang = initialLanguage;

export const useI18n = create<I18nStore>((set, get) => ({
  lang: initialLanguage,
  setLang: (lang) => {
    applyLanguage(lang);
    set({ lang });
  },
  t: (key) => translations[get().lang][key] ?? key,
}));
