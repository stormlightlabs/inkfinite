import { browser } from "$app/environment";

export type Theme = "light" | "dark";

export function createThemeStore() {
  let theme = $state<Theme>("dark");

  if (browser) {
    const stored = localStorage.getItem("theme") as Theme | null;
    if (stored === "light" || stored === "dark") {
      theme = stored;
    } else {
      theme = "dark";
      localStorage.setItem("theme", "dark");
    }
    document.documentElement.setAttribute("data-theme", theme);
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
