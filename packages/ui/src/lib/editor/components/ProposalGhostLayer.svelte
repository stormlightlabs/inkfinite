<script lang="ts">
	import { Camera, type Camera as CameraState, type Viewport } from '@inkfinite/core';

	import type { LiveProposal } from '../platform';

	type ProposedShape = {
		id: string;
		kind: string;
		parent: { kind: string };
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

	function proposedShape(operation: unknown): ProposedShape | null {
		if (typeof operation !== 'object' || operation === null) return null;
		const candidate = operation as { type?: unknown; shape?: unknown };
		if (
			candidate.type !== 'create_shape' ||
			typeof candidate.shape !== 'object' ||
			!candidate.shape
		) {
			return null;
		}

		const shape = candidate.shape as Partial<ProposedShape>;
		const translation = shape.transform?.translation;
		const width = shape.properties?.width;
		const height = shape.properties?.height;
		if (
			typeof shape.id !== 'string' ||
			typeof shape.kind !== 'string' ||
			shape.parent?.kind !== 'layer' ||
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

		return shape as ProposedShape;
	}

	let shapes = $derived(
		proposal.transaction.operations
			.map(proposedShape)
			.filter((shape): shape is ProposedShape => shape !== null)
	);
	let needsRegionFallback = $derived(shapes.length !== proposal.transaction.operations.length);
</script>

<svg
	class="proposal-ghost-layer"
	viewBox={`0 0 ${viewport.width} ${viewport.height}`}
	preserveAspectRatio="none"
	aria-hidden="true">
	{#each shapes as shape (shape.id)}
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
			{@const topLeft = Camera.worldToScreen(camera, { x: bounds.x, y: bounds.y }, viewport)}
			{@const bottomRight = Camera.worldToScreen(
				camera,
				{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
				viewport
			)}
			<rect
				class="affected-region"
				data-testid="proposal-affected-region"
				x={Math.min(topLeft.x, bottomRight.x)}
				y={Math.min(topLeft.y, bottomRight.y)}
				width={Math.abs(bottomRight.x - topLeft.x)}
				height={Math.abs(bottomRight.y - topLeft.y)}></rect>
		{/each}
	{/if}
</svg>

<style>
	.proposal-ghost-layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 1;
		overflow: visible;
	}

	.created-shape,
	.affected-region {
		fill: color-mix(in srgb, var(--ink-accent) 16%, transparent);
		stroke: color-mix(in srgb, var(--ink-accent) 82%, white 18%);
		stroke-width: 2;
		stroke-dasharray: 7 5;
		vector-effect: non-scaling-stroke;
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
