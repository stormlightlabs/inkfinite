import { Box2 as Box2Ops, exportBounds, getSelectedShapes, type Box2 } from '@inkfinite/core';
import type { EditorShapeRecord, EditorState } from '@inkfinite/core';

/** Export a visible HTML canvas viewport as a PNG blob. */
export async function exportViewportToPNG(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) {
				resolve(blob);
			} else {
				reject(new Error('Failed to export canvas to PNG'));
			}
		}, 'image/png');
	});
}

/**
 * Render the selected editor shapes into a temporary canvas and export them as
 * a PNG blob.
 *
 * The renderer is supplied by the host so this adapter does not duplicate
 * shape drawing or introduce a renderer dependency.
 */
export async function exportSelectionToPNG(
	state: EditorState,
	renderFunction: (context: CanvasRenderingContext2D, shapes: EditorShapeRecord[], bounds: Box2) => void
): Promise<Blob | null> {
	const shapes = getSelectedShapes(state);
	if (shapes.length === 0) {
		return null;
	}

	const bounds = combineBounds(shapes.map((shape) => exportBounds(state, shape)));
	if (!bounds) {
		return null;
	}

	const padding = 20;
	const width = Box2Ops.width(bounds) + padding * 2;
	const height = Box2Ops.height(bounds) + padding * 2;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;

	const context = canvas.getContext('2d');
	if (!context) {
		throw new Error('Failed to get 2D context');
	}

	context.fillStyle = 'white';
	context.fillRect(0, 0, width, height);
	context.save();
	context.translate(-bounds.min.x + padding, -bounds.min.y + padding);
	renderFunction(context, shapes, bounds);
	context.restore();

	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) {
				resolve(blob);
			} else {
				reject(new Error('Failed to export selection to PNG'));
			}
		}, 'image/png');
	});
}

function combineBounds(boxes: Box2[]): Box2 | null {
	if (boxes.length === 0) {
		return null;
	}

	let combined = Box2Ops.clone(boxes[0]);
	for (let index = 1; index < boxes.length; index++) {
		const box = boxes[index];
		combined = {
			min: { x: Math.min(combined.min.x, box.min.x), y: Math.min(combined.min.y, box.min.y) },
			max: { x: Math.max(combined.max.x, box.max.x), y: Math.max(combined.max.y, box.max.y) }
		};
	}
	return combined;
}
