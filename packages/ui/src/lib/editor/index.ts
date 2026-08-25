export { default as Editor } from './Editor.svelte';
export { FileBrowserVM } from './filebrowser/model';
export type {
	FileBrowserActions,
	FileBrowserOptions,
	FileBrowserSort,
	FileBrowserViewModel
} from './filebrowser/model';
export {
	buildStatusBarVM,
	getSelectionSummary,
	getSnapSummary,
	getToolId,
	getZoomPct
} from './statusbar';
export type { PersistenceStatus, SelectionSummary, SnapSummary, StatusBarVM } from './statusbar';
export type {
	DesktopDocumentRepo,
	EditorPlatform,
	FileHandle,
	EditorPlatformAdapter,
	EditorPlatformSession,
	InterchangeFileAccess,
	InterchangeSourceFile,
	NativeFileMenuAction
} from './platform';
export { createStatusStore } from './status';
export { themeStore, ThemeStore, type Theme } from './theme.svelte';
