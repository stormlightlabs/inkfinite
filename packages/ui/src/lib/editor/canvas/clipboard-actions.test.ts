import { Camera, EditorState } from '@inkfinite/core';
import { describe, expect, it, vi } from 'vitest';
import { createClipboardActions } from './clipboard-actions';

describe('canvas clipboard actions', () => {
	it('uses the visible fallback when SVG clipboard access is unavailable', async () => {
		const fallback = vi.fn();
		const actions = createClipboardActions({
			getState: () => ({ ...EditorState.create(), camera: Camera.create() }),
			getCursorWorld: () => ({ x: 0, y: 0 }),
			commit: vi.fn(),
			deleteSelection: vi.fn(),
			importSvgMarkup: vi.fn(async () => {}),
			renderSvg: vi.fn(async () => ({
				format: 'svg' as const,
				contents: '<svg />',
				extension: 'svg' as const,
				mimeType: 'image/svg+xml' as const,
				warnings: []
			})),
			reportError: vi.fn(),
			announceStatus: vi.fn(),
			showSvgFallback: fallback
		});

		await actions.copySvg(false);
		expect(fallback).toHaveBeenCalledWith('<svg />', expect.any(String));
	});
});
