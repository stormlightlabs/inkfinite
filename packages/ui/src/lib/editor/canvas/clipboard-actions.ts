import type { EditorState, SvgExport } from '@inkfinite/core';
import {
	copyPngBlob,
	copySelection,
	copySvgMarkup,
	pasteClipboard,
	pasteImage,
	pasteText,
	renderSvgToPng,
	readClipboardContent
} from '../clipboard';

export type ClipboardActionDependencies = {
	getState: () => EditorState;
	getCursorWorld: () => { x: number; y: number };
	commit: (name: string, state: EditorState) => void;
	deleteSelection: () => void;
	importSvgMarkup: (contents: string) => Promise<void>;
	renderSvg: (
		selectedOnly: boolean,
		options?: { transparentBackground?: boolean }
	) => Promise<SvgExport>;
	reportError: (error: unknown, title: string) => void;
	announceStatus: (message: string) => void;
	showSvgFallback: (markup: string, message: string) => void;
};

/** Coordinates clipboard read/write, paste, and export effects for Canvas. */
export function createClipboardActions(deps: ClipboardActionDependencies) {
	async function copyCurrentSelection() {
		try {
			await copySelection(deps.getState());
		} catch (error) {
			deps.reportError(error, 'Clipboard error');
		}
	}

	async function cutCurrentSelection() {
		try {
			await copySelection(deps.getState());
			deps.deleteSelection();
		} catch (error) {
			deps.reportError(error, 'Clipboard error');
		}
	}

	async function pasteFromClipboard(options: { inPlace?: boolean; atCursor?: boolean } = {}) {
		try {
			const content = await readClipboardContent();
			if (!content)
				throw new Error('The clipboard is empty or contains unsupported content.');
			const position = options.atCursor ? deps.getCursorWorld() : undefined;
			if (content.type === 'native') {
				deps.commit(
					options.inPlace ? 'Paste in place' : 'Paste',
					pasteClipboard(deps.getState(), content.payload, {
						inPlace: options.inPlace,
						position: options.inPlace ? undefined : position
					})
				);
			} else if (content.type === 'text') {
				deps.commit(
					'Paste text',
					pasteText(deps.getState(), content.text, content.markdown, position)
				);
			} else if (content.type === 'image') {
				deps.commit('Paste image', await pasteImage(deps.getState(), content, position));
			} else {
				await deps.importSvgMarkup(content.contents);
			}
		} catch (error) {
			deps.reportError(error, 'Clipboard error');
		}
	}

	async function handlePaste(event: ClipboardEvent) {
		event.preventDefault();
		try {
			const content = await readClipboardContent(event.clipboardData ?? undefined);
			if (!content)
				throw new Error('The clipboard is empty or contains unsupported content.');
			const position = deps.getCursorWorld();
			if (content.type === 'native') {
				deps.commit(
					'Paste',
					pasteClipboard(deps.getState(), content.payload, { position })
				);
			} else if (content.type === 'text') {
				deps.commit(
					'Paste text',
					pasteText(deps.getState(), content.text, content.markdown, position)
				);
			} else if (content.type === 'image') {
				deps.commit('Paste image', await pasteImage(deps.getState(), content, position));
			} else {
				await deps.importSvgMarkup(content.contents);
			}
		} catch (error) {
			deps.reportError(error, 'Clipboard error');
		}
	}

	async function copySvg(selectedOnly: boolean) {
		try {
			const exported = await deps.renderSvg(selectedOnly);
			const result = await copySvgMarkup(exported.contents);
			if (result === 'rich')
				deps.announceStatus(
					'SVG copied. It is ready to paste into a vector tool or text editor.'
				);
			else if (result === 'text')
				deps.announceStatus(
					'SVG copied as plain text. Paste it into a text editor or import it manually into a vector tool.'
				);
			else
				deps.showSvgFallback(
					exported.contents,
					'This browser could not access the clipboard. Select the markup below and copy it manually.'
				);
		} catch (error) {
			deps.reportError(error, 'Clipboard error');
		}
	}

	async function copyPng(selectedOnly: boolean, transparentBackground = false) {
		try {
			const exported = await deps.renderSvg(selectedOnly, { transparentBackground });
			const blob = await renderSvgToPng(exported.contents, { transparentBackground });
			const filename = selectedOnly ? 'selection.png' : 'drawing.png';
			const result = await copyPngBlob(blob, filename);
			deps.announceStatus(
				result === 'rich'
					? `${selectedOnly ? 'Selection' : 'Document'} PNG copied to the clipboard${transparentBackground ? ' with transparency' : ''}.`
					: `PNG clipboard access is unavailable. Downloaded ${filename} instead.`
			);
		} catch (error) {
			deps.reportError(error, 'Clipboard error');
		}
	}

	return {
		copyCurrentSelection,
		cutCurrentSelection,
		pasteFromClipboard,
		handlePaste,
		copySvg,
		copyPng
	};
}
