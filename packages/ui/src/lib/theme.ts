/** A forced Inkfinite color theme, or the user's operating-system preference. */
export type InkTheme = "light" | "dark" | "system";

/**
 * Applies an Inkfinite theme to a document root or a themed subtree.
 *
 * Calling this during server rendering is safe: it becomes a no-op when no DOM
 * target is available.
 */
export function applyInkTheme(theme: InkTheme, target?: HTMLElement): void {
  const root =
    target ??
    (typeof document === "undefined" ? undefined : document.documentElement);
  if (!root) return;

  if (theme === "system") {
    root.removeAttribute("data-ink-theme");
    root.style.removeProperty("color-scheme");
    return;
  }

  root.dataset.inkTheme = theme;
  root.style.colorScheme = theme;
}
