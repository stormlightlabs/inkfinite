export { default as Editor } from "./Editor.svelte";
export type {
  DesktopDocumentRepo,
  EditorPlatform,
  EditorPlatformAdapter,
  EditorPlatformSession,
} from "./platform";
export { createStatusStore } from "./status";
export { themeStore, ThemeStore, type Theme } from "./theme.svelte";
