import { Camera, EditorState } from '@inkfinite/core';
import { describe, expect, it, vi } from 'vitest';
import { handleCanvasDrop } from './drop-handler';

describe('canvas drop handler', () => {
	it('routes SVG files to the SVG importer before stencil handling', () => {
		const importSvgFile = vi.fn();
		const event = {
			preventDefault: vi.fn(),
			clientX: 20,
			clientY: 30,
			dataTransfer: {
				files: [{ name: 'diagram.svg', type: 'image/svg+xml' }],
				getData: vi.fn()
			}
		} as unknown as DragEvent;
		handleCanvasDrop(event, {
			canvas: null,
			getState: () => ({ ...EditorState.create(), camera: Camera.create() }),
			getViewport: () => ({ width: 100, height: 100 }),
			getDraggedStencil: () => null,
			findStencil: () => null,
			clearStencilDrag: vi.fn(),
			importSvgFile,
			importImageFile: vi.fn(),
			importDroppedFile: vi.fn(),
			insertStencil: vi.fn()
		});
		expect(event.preventDefault).toHaveBeenCalled();
		expect(importSvgFile).toHaveBeenCalledOnce();
	});
});
