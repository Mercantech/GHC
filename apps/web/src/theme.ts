export type Theme = "light" | "dark";

const SK_THEME = "ghc_theme";

export function readStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(SK_THEME);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function resolveTheme(stored: Theme | null = readStoredTheme()): Theme {
  return stored ?? (systemPrefersDark() ? "dark" : "light");
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(SK_THEME, theme);
  } catch {
    /* ignore */
  }
  applyTheme(theme);
}

export function toggleTheme(): Theme {
  const next: Theme = resolveTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

export function initTheme() {
  applyTheme(resolveTheme());
}
