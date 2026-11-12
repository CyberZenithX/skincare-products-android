import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { DevSettings, I18nManager } from 'react-native';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Language } from '@skinfix/shared';
import en from '@/locales/en.json';
import ar from '@/locales/ar.json';

const LANG_KEY = 'settings:language';

export function deviceLanguage(): Language {
  return getLocales()[0]?.languageCode === 'ar' ? 'ar' : 'en';
}

export async function initI18n(): Promise<Language> {
  let lang: Language = deviceLanguage();
  try {
    const saved = await AsyncStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'ar') lang = saved;
  } catch {
    /* first run */
  }
  await i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, ar: { translation: ar } },
    lng: lang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  // Layout direction must match the language. If it doesn't (first launch in
  // Arabic, or a switch), set it and reload once.
  I18nManager.allowRTL(true);
  const wantRTL = lang === 'ar';
  if (I18nManager.isRTL !== wantRTL) {
    I18nManager.forceRTL(wantRTL);
    await reloadApp();
  }
  return lang;
}

export const currentLanguage = (): Language => (i18n.language === 'ar' ? 'ar' : 'en');

/**
 * Switch language. Flipping RTL needs a reload, so the caller must save any
 * in-progress scan first (see scanStore.saveDraft) — it's restored after reload.
 */
export async function setLanguage(lang: Language, beforeReload?: () => Promise<void>): Promise<void> {
  await AsyncStorage.setItem(LANG_KEY, lang);
  await i18n.changeLanguage(lang);
  const wantRTL = lang === 'ar';
  if (I18nManager.isRTL !== wantRTL) {
    await beforeReload?.();
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(wantRTL);
    await reloadApp();
  }
}

async function reloadApp() {
  try {
    await Updates.reloadAsync();
  } catch {
    DevSettings.reload(); // development builds
  }
}

export default i18n;
