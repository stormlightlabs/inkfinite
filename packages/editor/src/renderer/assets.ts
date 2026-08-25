import type { EditorState, EditorShapeRecord } from '@inkfinite/core';
import type { RendererImageCache } from './resources.js';

/** Draw an embedded image, preserving its crop window when one is set. */
export function drawImage(
	context: CanvasRenderingContext2D,
	state: EditorState,
	shape: Extract<EditorShapeRecord, { type: 'image' }>,
	imageCache: RendererImageCache,
	onImageLoaded: () => void
) {
	const asset = state.doc.assets?.[shape.props.assetId];
	const { w, h, crop, mask, caption } = shape.props;
	context.globalAlpha *= shape.fillOpacity ?? 1;
	if (!asset) {
		context.fillStyle = '#e5e7eb';
		context.fillRect(0, 0, w, h);
		return;
	}
	const image = imageCache.get(asset, onImageLoaded);
	if (!image || !image.complete || image.naturalWidth === 0) {
		context.fillStyle = '#e5e7eb';
		context.fillRect(0, 0, w, h);
		context.strokeStyle = '#9ca3af';
		context.strokeRect(0, 0, w, h);
		return;
	}
	const top = crop?.top ?? 0;
	const right = crop?.right ?? 0;
	const bottom = crop?.bottom ?? 0;
	const left = crop?.left ?? 0;
	const sourceX = image.naturalWidth * left;
	const sourceY = image.naturalHeight * top;
	const sourceWidth = image.naturalWidth * Math.max(0.001, 1 - left - right);
	const sourceHeight = image.naturalHeight * Math.max(0.001, 1 - top - bottom);
	context.save();
	if (mask?.kind === 'ellipse') {
		context.beginPath();
		context.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
		context.clip();
	} else if (mask?.kind === 'rounded') {
		const radius = Math.min(mask.radius ?? 16, w / 2, h / 2);
		context.beginPath();
		context.roundRect(0, 0, w, h, radius);
		context.clip();
	}
	context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, w, h);
	context.restore();
	if (caption?.trim()) {
		const captionHeight = Math.min(24, h);
		context.fillStyle = 'rgba(0, 0, 0, 0.58)';
		context.fillRect(0, h - captionHeight, w, captionHeight);
		context.fillStyle = '#ffffff';
		context.font = '12px sans-serif';
		context.textBaseline = 'middle';
		context.fillText(caption, 8, h - captionHeight / 2, Math.max(0, w - 16));
	}
}

export function drawReference(
	context: CanvasRenderingContext2D,
	shape: Extract<EditorShapeRecord, { type: 'reference' }>
) {
	const { w, h, referenceType, value, label } = shape.props;
	const accent = referenceType === 'url' ? '#2563eb' : referenceType === 'file' ? '#16a34a' : '#7c3aed';
	context.fillStyle = '#f8fafc';
	context.strokeStyle = accent;
	context.lineWidth = 2;
	context.beginPath();
	context.roundRect(0, 0, w, h, 8);
	context.fill();
	context.stroke();
	context.fillStyle = accent;
	context.font = '600 12px sans-serif';
	context.fillText(referenceType.toUpperCase(), 12, 20);
	context.fillStyle = '#1f2937';
	context.font = '13px sans-serif';
	context.fillText(label || value, 12, 42, Math.max(0, w - 24));
}
