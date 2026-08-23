<script lang="ts">
	import { Camera, type Camera as CameraState, type Viewport } from '@inkfinite/core';

	import type { LiveProposal, ProposalObjectPreview } from '../platform';

	type NativeRecord = Record<string, unknown>;
	type PreviewSide = 'before' | 'after';
	type PreviewSegment = {
		id: string;
		recordId: string;
		change: ProposalObjectPreview['change'];
		side: PreviewSide;
		bounds: NonNullable<ProposalObjectPreview['before_bounds']>;
		record: NativeRecord;
	};

	type LegacyShape = {
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

	let {
		proposal,
		camera,
		viewport
	}: { proposal: LiveProposal; camera: CameraState; viewport: Viewport } = $props();

	function isRecordPreview(preview: ProposalObjectPreview, kind: string): boolean {
		return preview.record_id.kind === kind;
	}

	function recordFor(preview: ProposalObjectPreview, side: PreviewSide): NativeRecord | null {
		return side === 'before'
			? (preview.before?.record ?? null)
			: (preview.after?.record ?? null);
	}

	function shapeSegmentsFor(preview: ProposalObjectPreview): PreviewSegment[] {
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
		else if (preview.change === 'added' || preview.change === 'modified') {
			add('after', preview.after_bounds);
		} else {
			add('before', preview.before_bounds);
			add('after', preview.after_bounds);
		}
		return segments;
	}

	let objectPreviews = $derived(proposal.object_previews ?? []);
	let shapePreviews = $derived(
		objectPreviews.filter((preview) => isRecordPreview(preview, 'shape'))
	);
	let bindingPreviews = $derived(
		objectPreviews.filter((preview) => isRecordPreview(preview, 'binding'))
	);
	let shapeSegments = $derived(shapePreviews.flatMap(shapeSegmentsFor));
	let hasStructuredVisualPreview = $derived(
		shapeSegments.length > 0 || bindingPreviews.length > 0
	);

	function legacyShape(operation: unknown): LegacyShape | null {
		if (typeof operation !== 'object' || operation === null) return null;
		const candidate = operation as { type?: unknown; shape?: unknown };
		if (
			candidate.type !== 'create_shape' ||
			typeof candidate.shape !== 'object' ||
			!candidate.shape
		) {
			return null;
		}

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
		) {
			return null;
		}

		return shape as LegacyShape;
	}

	let legacyShapes = $derived(
		proposal.object_previews
			? []
			: proposal.transaction.operations
					.map(legacyShape)
					.filter((shape): shape is LegacyShape => shape !== null)
	);
	let needsRegionFallback = $derived(!hasStructuredVisualPreview && legacyShapes.length === 0);

	function screenBounds(bounds: NonNullable<ProposalObjectPreview['before_bounds']>) {
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

	function properties(record: NativeRecord): Record<string, unknown> {
		return typeof record.properties === 'object' && record.properties !== null
			? (record.properties as Record<string, unknown>)
			: {};
	}

	function numberProperty(record: NativeRecord, key: string, fallback: number): number {
		const value = properties(record)[key];
		return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	}

	function stringProperty(record: NativeRecord, key: string): string | null {
		const value = properties(record)[key];
		return typeof value === 'string' && value.length > 0 ? value : null;
	}

	function fill(record: NativeRecord): string {
		return stringProperty(record, 'fill') ?? 'var(--ink-accent)';
	}

	function stroke(record: NativeRecord): string {
		return stringProperty(record, 'stroke') ?? 'var(--ink-accent)';
	}

	function recordLabel(preview: ProposalObjectPreview): string {
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

	function bindingBox(preview: ProposalObjectPreview) {
		const bounds = preview.change === 'removed' ? preview.before_bounds : preview.after_bounds;
		return bounds ? screenBounds(bounds) : null;
	}

	function bindingClass(change: ProposalObjectPreview['change']): string {
		return `proposal-binding proposal-binding--${change}`;
	}
</script>

<svg
	class="proposal-ghost-layer"
	viewBox={`0 0 ${viewport.width} ${viewport.height}`}
	preserveAspectRatio="none"
	aria-hidden="true">
	{#each shapeSegments as segment (segment.id)}
		{@const box = screenBounds(segment.bounds)}
		{@const kind = typeof segment.record.kind === 'string' ? segment.record.kind : 'shape'}
		<g
			class={`proposal-object proposal-object--${segment.change} proposal-object--${segment.side}`}
			data-testid="proposal-object-preview"
			data-change={segment.change}
			data-side={segment.side}
			data-record-id={segment.recordId}
			data-shape-kind={kind}
			style={`--proposal-fill:${fill(segment.record)};--proposal-stroke:${stroke(segment.record)}`}
			transform={`translate(${box.x} ${box.y})`}>
			{#if kind === 'ellipse'}
				<ellipse
					data-testid="proposal-object-outline"
					cx={box.width / 2}
					cy={box.height / 2}
					rx={Math.max(1, box.width / 2)}
					ry={Math.max(1, box.height / 2)}></ellipse>
			{:else if kind === 'line' || kind === 'arrow'}
				<line
					data-testid="proposal-object-outline"
					x1="0"
					y1={box.height / 2}
					x2={box.width}
					y2={box.height / 2}></line>
			{:else}
				<rect
					data-testid="proposal-object-outline"
					width={Math.max(1, box.width)}
					height={Math.max(1, box.height)}
					rx={kind === 'rect' || kind === 'container'
						? Math.min(
								numberProperty(segment.record, 'radius', 0),
								box.width / 2,
								box.height / 2
							)
						: 0}></rect>
			{/if}
			{#if kind === 'text' || kind === 'markdown'}
				<text x="8" y="20"
					>{stringProperty(segment.record, kind === 'text' ? 'text' : 'markdown') ??
						'Proposed content'}</text>
			{/if}
		</g>
	{/each}

	{#each bindingPreviews as preview (preview.record_id.id)}
		{@const box = bindingBox(preview)}
		{#if box}
			<g
				class={bindingClass(preview.change)}
				data-testid="proposal-relationship-preview"
				data-change={preview.change}>
				<line x1={box.x} y1={box.y} x2={box.x + box.width} y2={box.y + box.height}></line>
				<text x={box.x + box.width / 2} y={box.y + box.height / 2}
					>{recordLabel(preview)}</text>
			</g>
		{/if}
	{/each}

	{#each legacyShapes as shape (shape.id)}
		{@const origin = Camera.worldToScreen(camera, shape.transform.translation, viewport)}
		{@const width = Math.abs(shape.properties.width as number)}
		{@const height = Math.abs(shape.properties.height as number)}
		{@const cos = Math.cos(shape.transform.rotation)}
		{@const sin = Math.sin(shape.transform.rotation)}
		{@const scaleX = shape.transform.scale_x * camera.zoom}
		{@const scaleY = shape.transform.scale_y * camera.zoom}
		<g
			class="created-shape"
			data-testid="proposal-created-shape"
			data-shape-id={shape.id}
			data-shape-kind={shape.kind}
			style={`--proposal-fill:${typeof shape.properties.fill === 'string' ? shape.properties.fill : 'var(--ink-accent)'}`}
			transform={`matrix(${cos * scaleX} ${sin * scaleX} ${-sin * scaleY} ${cos * scaleY} ${origin.x} ${origin.y})`}>
			{#if shape.kind === 'ellipse'}
				<ellipse
					data-testid="proposal-created-shape-outline"
					cx={width / 2}
					cy={height / 2}
					rx={width / 2}
					ry={height / 2}></ellipse>
			{:else}
				<rect
					data-testid="proposal-created-shape-outline"
					{width}
					{height}
					rx={shape.kind === 'rect' && typeof shape.properties.radius === 'number'
						? Math.max(0, shape.properties.radius)
						: 0}></rect>
			{/if}
		</g>
	{/each}

	{#if needsRegionFallback}
		{#each proposal.affected_regions as region}
			{@const bounds = region.bounds}
			{@const box = screenBounds(bounds)}
			<rect
				class="affected-region"
				data-testid="proposal-affected-region"
				x={box.x}
				y={box.y}
				width={box.width}
				height={box.height}></rect>
		{/each}
	{/if}
</svg>

<style>
	.proposal-ghost-layer {
		position: absolute;
		inset: 0;
		z-index: 1;
		width: 100%;
		height: 100%;
		pointer-events: none;
		overflow: visible;
	}

	.proposal-object,
	.proposal-binding,
	.affected-region {
		vector-effect: non-scaling-stroke;
	}

	.proposal-object {
		fill: color-mix(in srgb, var(--proposal-fill) 24%, transparent);
		stroke: color-mix(in srgb, var(--proposal-color) 82%, var(--proposal-stroke));
		stroke-width: 2;
		stroke-dasharray: 7 5;
	}

	.proposal-object--added {
		--proposal-color: var(--ink-accent);
		fill: color-mix(in srgb, var(--proposal-color) 24%, transparent);
	}

	.proposal-object--modified {
		--proposal-color: var(--ink-warning);
		fill: color-mix(in srgb, var(--proposal-color) 20%, transparent);
	}

	.proposal-object--moved-before {
		--proposal-color: var(--ink-warning);
		fill: transparent;
		stroke-dasharray: 3 5;
		opacity: 0.72;
	}

	.proposal-object--moved-after {
		--proposal-color: var(--ink-accent);
		fill: color-mix(in srgb, var(--proposal-color) 22%, transparent);
	}

	.proposal-object--removed {
		--proposal-color: var(--ink-danger);
		fill: color-mix(in srgb, var(--proposal-color) 18%, transparent);
		stroke-dasharray: 3 4;
	}

	.proposal-object text,
	.proposal-binding text {
		fill: var(--proposal-color, var(--ink-text));
		font: 600 12px var(--ink-font-body);
		paint-order: stroke;
		stroke: var(--ink-canvas);
		stroke-width: 3px;
		stroke-linejoin: round;
	}

	.proposal-binding {
		--proposal-color: var(--ink-accent);
		fill: none;
		stroke: var(--proposal-color);
		stroke-width: 2;
		stroke-dasharray: 6 4;
	}

	.proposal-binding--removed {
		--proposal-color: var(--ink-danger);
	}

	.proposal-binding--modified,
	.proposal-binding--moved {
		--proposal-color: var(--ink-warning);
	}

	.proposal-binding text {
		fill: var(--proposal-color);
		font-size: 10px;
	}

	.created-shape,
	.affected-region {
		fill: color-mix(in srgb, var(--ink-accent) 16%, transparent);
		stroke: color-mix(in srgb, var(--ink-accent) 82%, white 18%);
		stroke-width: 2;
		stroke-dasharray: 7 5;
		animation: proposal-pulse 1.8s ease-in-out infinite;
	}

	.created-shape {
		fill: color-mix(in srgb, var(--proposal-fill) 46%, transparent);
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--ink-accent) 38%, transparent));
	}

	.affected-region {
		stroke-width: 1;
	}

	@keyframes proposal-pulse {
		0%,
		100% {
			opacity: 0.62;
		}
		50% {
			opacity: 0.98;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.created-shape,
		.affected-region {
			animation: none;
		}
	}
</style>
