import { useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'grc:theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

let preference: ThemePreference = (() => {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
})();

const resolved = (): 'light' | 'dark' =>
  preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;

function apply(): void {
  const theme = resolved();
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  window.dispatchEvent(new Event('grc-theme'));
}

/** Applies the cached preference and follows OS changes while on "system". */
export function initTheme(): void {
  apply();
  media.addEventListener('change', () => {
    if (preference === 'system') apply();
  });
}

export function setTheme(next: ThemePreference): void {
  preference = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* Settings remain in the database. */
  }
  apply();
}

/** The theme the user picked, including "system". */
export function useThemePreference(): ThemePreference {
  const [value, setValue] = useState(preference);
  useEffect(() => {
    const update = () => setValue(preference);
    window.addEventListener('grc-theme', update);
    return () => window.removeEventListener('grc-theme', update);
  }, []);
  return value;
}

/** The theme currently on screen. */
export function useResolvedTheme(): 'light' | 'dark' {
  const [value, setValue] = useState(resolved);
  useEffect(() => {
    const update = () => setValue(resolved());
    window.addEventListener('grc-theme', update);
    return () => window.removeEventListener('grc-theme', update);
  }, []);
  return value;
}
