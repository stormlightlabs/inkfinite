import { Camera, type Camera as CameraState, type Viewport } from '@inkfinite/core';
import type { LiveProposal, ProposalObjectPreview } from '../platform';

export type NativeRecord = Record<string, unknown>;
export type PreviewSide = 'before' | 'after';
export type PreviewSegment = {
	id: string;
	recordId: string;
	change: ProposalObjectPreview['change'];
	side: PreviewSide;
	bounds: NonNullable<ProposalObjectPreview['before_bounds']>;
	record: NativeRecord;
};

export type LegacyShape = {
	id: string;
	kind: string;
	transform: {
		translation: { x: number; y: number };
		rotation: number;
		scale_x: number;
		scale_y: number;
	};
	properties: Record<string, unknown>;
};

export function isRecordPreview(preview: ProposalObjectPreview, kind: string): boolean {
	return preview.record_id.kind === kind;
}

export function recordFor(preview: ProposalObjectPreview, side: PreviewSide): NativeRecord | null {
	return side === 'before' ? (preview.before?.record ?? null) : (preview.after?.record ?? null);
}

export function shapeSegmentsFor(preview: ProposalObjectPreview): PreviewSegment[] {
	const segments: PreviewSegment[] = [];
	const add = (side: PreviewSide, bounds: ProposalObjectPreview['before_bounds']) => {
		const record = recordFor(preview, side);
		if (!bounds || !record) return;
		segments.push({
			id: `${preview.record_id.id}:${side}`,
			recordId: preview.record_id.id,
			change: preview.change,
			side,
			bounds,
			record
		});
	};
	if (preview.change === 'removed') add('before', preview.before_bounds);
	else if (preview.change === 'added' || preview.change === 'modified')
		add('after', preview.after_bounds);
	else {
		add('before', preview.before_bounds);
		add('after', preview.after_bounds);
	}
	return segments;
}

export function legacyShape(operation: unknown): LegacyShape | null {
	if (typeof operation !== 'object' || operation === null) return null;
	const candidate = operation as { type?: unknown; shape?: unknown };
	if (
		candidate.type !== 'create_shape' ||
		typeof candidate.shape !== 'object' ||
		!candidate.shape
	)
		return null;
	const shape = candidate.shape as Partial<LegacyShape>;
	const translation = shape.transform?.translation;
	const width = shape.properties?.width;
	const height = shape.properties?.height;
	if (
		typeof shape.id !== 'string' ||
		typeof shape.kind !== 'string' ||
		!translation ||
		![
			translation.x,
			translation.y,
			shape.transform?.rotation,
			shape.transform?.scale_x,
			shape.transform?.scale_y
		].every((value) => typeof value === 'number' && Number.isFinite(value)) ||
		typeof width !== 'number' ||
		!Number.isFinite(width) ||
		typeof height !== 'number' ||
		!Number.isFinite(height)
	)
		return null;
	return shape as LegacyShape;
}

export function screenBounds(
	camera: CameraState,
	viewport: Viewport,
	bounds: NonNullable<ProposalObjectPreview['before_bounds']>
) {
	const topLeft = Camera.worldToScreen(camera, { x: bounds.x, y: bounds.y }, viewport);
	const bottomRight = Camera.worldToScreen(
		camera,
		{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
		viewport
	);
	return {
		x: Math.min(topLeft.x, bottomRight.x),
		y: Math.min(topLeft.y, bottomRight.y),
		width: Math.abs(bottomRight.x - topLeft.x),
		height: Math.abs(bottomRight.y - topLeft.y)
	};
}

export function properties(record: NativeRecord): Record<string, unknown> {
	return typeof record.properties === 'object' && record.properties !== null
		? (record.properties as Record<string, unknown>)
		: {};
}

export function numberProperty(record: NativeRecord, key: string, fallback: number): number {
	const value = properties(record)[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function stringProperty(record: NativeRecord, key: string): string | null {
	const value = properties(record)[key];
	return typeof value === 'string' && value.length > 0 ? value : null;
}

export function fill(record: NativeRecord): string {
	return stringProperty(record, 'fill') ?? 'var(--ink-accent)';
}

export function stroke(record: NativeRecord): string {
	return stringProperty(record, 'stroke') ?? 'var(--ink-accent)';
}

export function recordLabel(preview: ProposalObjectPreview): string {
	const record = recordFor(preview, preview.change === 'removed' ? 'before' : 'after');
	if (preview.record_id.kind === 'binding') {
		const relation = record?.relation_type;
		return typeof relation === 'string' && relation
			? `Relationship · ${relation}`
			: 'Relationship';
	}
	const metadata = record?.metadata;
	if (typeof metadata === 'object' && metadata !== null) {
		const name = (metadata as Record<string, unknown>).name;
		if (typeof name === 'string' && name) return name;
		const role = (metadata as Record<string, unknown>).role;
		if (typeof role === 'string' && role) return role;
	}
	return `${preview.record_id.kind} · ${preview.record_id.id}`;
}

export function bindingBox(
	camera: CameraState,
	viewport: Viewport,
	preview: ProposalObjectPreview
) {
	const bounds = preview.change === 'removed' ? preview.before_bounds : preview.after_bounds;
	return bounds ? screenBounds(camera, viewport, bounds) : null;
}

export function bindingClass(change: ProposalObjectPreview['change']): string {
	return `proposal-binding proposal-binding--${change}`;
}

export function proposalSegments(proposal: LiveProposal) {
	const objectPreviews = proposal.object_previews ?? [];
	const shapePreviews = objectPreviews.filter((preview) => isRecordPreview(preview, 'shape'));
	const bindingPreviews = objectPreviews.filter((preview) =>
		isRecordPreview(preview, 'binding')
	);
	return {
		shapePreviews,
		bindingPreviews,
		shapeSegments: shapePreviews.flatMap(shapeSegmentsFor),
		legacyShapes: proposal.object_previews
			? []
			: proposal.transaction.operations
					.map(legacyShape)
					.filter((shape): shape is LegacyShape => shape !== null)
	};
}
