import { createSignal } from 'solid-js';

export type ThemeMode = 'dark' | 'light';

const STORAGE_THEME_KEY = 'desktopTheme';
const [themeMode, setThemeModeSignal] = createSignal<ThemeMode>('dark');

const isThemeMode = (value: unknown): value is ThemeMode => value === 'dark' || value === 'light';

const applyTheme = (theme: ThemeMode) => {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
};

const getChromeStorage = () => {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  return chrome.storage.local;
};

const saveThemeMode = (theme: ThemeMode) => {
  if (typeof window === 'undefined') return;

  const storage = getChromeStorage();
  if (storage) {
    storage.set({ [STORAGE_THEME_KEY]: theme });
    return;
  }

  localStorage.setItem(STORAGE_THEME_KEY, theme);
};

export const currentThemeMode = themeMode;

export const setThemeMode = (theme: ThemeMode) => {
  setThemeModeSignal(theme);
  applyTheme(theme);
  saveThemeMode(theme);
};

export const loadThemeMode = () => {
  if (typeof window === 'undefined') return;

  applyTheme(themeMode());

  const storage = getChromeStorage();
  if (storage) {
    storage.get(STORAGE_THEME_KEY, (result) => {
      const stored = result?.[STORAGE_THEME_KEY];
      if (!isThemeMode(stored)) return;
      setThemeModeSignal(stored);
      applyTheme(stored);
    });
    return;
  }

  const stored = localStorage.getItem(STORAGE_THEME_KEY);
  if (!isThemeMode(stored)) return;
  setThemeModeSignal(stored);
  applyTheme(stored);
};
