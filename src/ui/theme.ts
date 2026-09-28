/** The visitor's colour theme: follow the system setting, or force light or dark. */
export type Theme = "system" | "light" | "dark";

export const THEMES: readonly Theme[] = ["system", "light", "dark"];

/** Where the choice is kept; index.html reads the same key before first paint, so keep the two in step. */
export const THEME_KEY = "nl-predict-theme";

/** The stored theme, or "system" when none is stored, it is unknown, or storage is unavailable. */
export function readTheme(storage: Pick<Storage, "getItem"> | undefined): Theme {
  try {
    const stored = storage?.getItem(THEME_KEY);
    return THEMES.find((theme) => theme === stored) ?? "system";
  } catch {
    return "system";
  }
}

/** Remembers the theme ("system" by forgetting it); a storage failure only loses the choice on reload. */
export function storeTheme(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, theme: Theme) {
  try {
    if (theme === "system") storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, theme);
  } catch {
    // Private windows and blocked site data: the theme still applies until the page is left.
  }
}

/** Forces light or dark through `data-theme` on the root element; without it the CSS follows the system. */
export function applyTheme(root: HTMLElement, theme: Theme) {
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}
