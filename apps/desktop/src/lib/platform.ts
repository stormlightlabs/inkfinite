import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createStatusStore, type EditorPlatformAdapter, type NativeFileMenuAction } from '@inkfinite/ui/editor';
import { createDesktopFileOps } from './fileops';
import { createDesktopPersistenceSink, createDesktopSessionRepo } from './persistence/desktop-session';

/** Creates the Tauri application's Rust-session-backed editor adapter. */
export function createDesktopPlatformAdapter(): EditorPlatformAdapter {
	return {
		kind: 'desktop',
		async connect() {
			const repo = createDesktopSessionRepo(createDesktopFileOps());
			const status = createStatusStore({ backend: 'filesystem', state: 'saved', pendingWrites: 0 });
			return {
				repo,
				desktop: repo,
				sink: createDesktopPersistenceSink(repo, status),
				status,
				interchange: {
					pickImport: () => invoke<{ name: string; contents: string } | null>('pick_interchange_document'),
					saveExport: (file, defaultStem) =>
						invoke<boolean>('save_interchange_document', {
							defaultName: `${defaultStem}.${file.extension}`,
							extension: file.extension,
							contents: file.contents
						})
				},
				subscribeFileMenu(listener) {
					let active = true;
					let stop: (() => void) | undefined;
					void listen<NativeFileMenuAction>('inkfinite-file-menu', (event) => {
						void invoke('record_renderer_event', { action: event.payload }).catch((error) =>
							console.error('Failed to record native File menu command', error)
						);
						listener(event.payload);
					})
						.then((unlisten) => {
							if (active) stop = unlisten;
							else unlisten();
						})
						.catch((error) => console.error('Failed to listen for native File menu commands', error));
					return () => {
						active = false;
						stop?.();
					};
				}
			};
		}
	};
}
