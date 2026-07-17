import { browser } from "$app/environment";

export type Theme = "light" | "dark";

export function createThemeStore() {
  const stored = browser ? localStorage.getItem("theme") : null;
  const initialTheme: Theme = stored === "light" || stored === "dark" ? stored : "dark";
  let theme = $state<Theme>(initialTheme);

  if (browser) {
    if (stored !== "light" && stored !== "dark") {
      localStorage.setItem("theme", "dark");
    }
    document.documentElement.setAttribute("data-theme", initialTheme);
  }

  function toggle() {
    theme = theme === "dark" ? "light" : "dark";
    if (browser) {
      localStorage.setItem("theme", theme);
      document.documentElement.setAttribute("data-theme", theme);
    }
  }

  function set(newTheme: Theme) {
    theme = newTheme;
    if (browser) {
      localStorage.setItem("theme", theme);
      document.documentElement.setAttribute("data-theme", theme);
    }
  }

  return {
    get current() {
      return theme;
    },
    toggle,
    set,
  };
}

export const themeStore = createThemeStore();
