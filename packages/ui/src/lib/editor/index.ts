export { default as Editor } from './Editor.svelte';
export type {
	DesktopDocumentRepo,
	EditorPlatform,
	EditorPlatformAdapter,
	EditorPlatformSession,
	InterchangeFileAccess,
	InterchangeSourceFile,
	NativeFileMenuAction
} from './platform';
export { createStatusStore } from './status';
export { themeStore, ThemeStore, type Theme } from './theme.svelte';
