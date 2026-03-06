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

export const useI18n = create<I18nStore>((set, get) => ({
  lang: 'ja',
  setLang: (lang) => set({ lang }),
  t: (key) => translations[get().lang][key] ?? key,
}));
