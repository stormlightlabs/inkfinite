/** Requests an application host can handle outside the headless editor runtime. */
export type EditorHostRequest =
	| { type: 'browse' }
	| { type: 'shortcuts' }
	| { type: 'command-palette' }
	| { type: 'undo' }
	| { type: 'redo' }
	| { type: 'copy' }
	| { type: 'cut' }
	| { type: 'paste' };

/** Host effects requested by keyboard commands and editor menus. */
export type EditorHostRequests = {
	onBrowseRequested?: () => void;
	onShortcutsRequested?: () => void;
	onCommandPaletteRequested?: () => void;
	onUndoRequested?: () => void;
	onRedoRequested?: () => void;
	onCopyRequested?: () => void;
	onCutRequested?: () => void;
	onPasteRequested?: () => void;
};

/** Dispatch one host request without making the editor runtime platform-aware. */
export function dispatchHostRequest(request: EditorHostRequest, handlers: EditorHostRequests): void {
	switch (request.type) {
		case 'browse':
			handlers.onBrowseRequested?.();
			break;
		case 'shortcuts':
			handlers.onShortcutsRequested?.();
			break;
		case 'command-palette':
			handlers.onCommandPaletteRequested?.();
			break;
		case 'undo':
			handlers.onUndoRequested?.();
			break;
		case 'redo':
			handlers.onRedoRequested?.();
			break;
		case 'copy':
			handlers.onCopyRequested?.();
			break;
		case 'cut':
			handlers.onCutRequested?.();
			break;
		case 'paste':
			handlers.onPasteRequested?.();
			break;
	}
}
