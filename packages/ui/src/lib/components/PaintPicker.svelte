<script module lang="ts">
	import type { GradientStop, PaintValue } from '@inkfinite/core';

	export interface PaintPickerProps {
		value: PaintValue;
		label: string;
		onchange: (value: PaintValue) => void;
		mixed?: boolean;
		disabled?: boolean;
	}
</script>

<script lang="ts">
	import { ColorPicker } from '../index';
	import { paintColor, paintPreview } from '@inkfinite/core';

	let { value, label, onchange, mixed = false, disabled = false }: PaintPickerProps = $props();
	let gradientOpen = $state(false);
	let toggleEl = $state<HTMLButtonElement | null>(null);
	let panelPosition = $state({ left: 8, top: 8 });
	let gradient = $derived(
		value && typeof value !== 'string' && value.kind !== 'solid' ? value : null
	);
	let previewColor = $derived(paintColor(value) ?? 'transparent');

	function gradientFor(kind: 'linear_gradient' | 'radial_gradient'): PaintValue {
		return kind === 'linear_gradient'
			? {
					kind,
					x1: 0,
					y1: 0,
					x2: 1,
					y2: 0,
					units: 'object_bounding_box',
					transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
					spread: 'pad',
					stops: [
						{ offset: 0, color: '#2563eb', opacity: 1 },
						{ offset: 1, color: '#c026d3', opacity: 1 }
					]
				}
			: {
					kind,
					cx: 0.5,
					cy: 0.5,
					r: 0.5,
					fx: 0.5,
					fy: 0.5,
					units: 'object_bounding_box',
					transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
					spread: 'pad',
					stops: [
						{ offset: 0, color: '#2563eb', opacity: 1 },
						{ offset: 1, color: '#c026d3', opacity: 1 }
					]
				};
	}

	function updateGradient(
		update: (
			current: Extract<PaintValue, { kind: 'linear_gradient' | 'radial_gradient' }>
		) => PaintValue
	) {
		if (gradient) onchange(update(gradient));
	}

	function setGradientKind(event: Event) {
		const kind = (event.currentTarget as HTMLSelectElement).value as
			| 'linear_gradient'
			| 'radial_gradient';
		if (!gradient || gradient.kind !== kind) onchange(gradientFor(kind));
	}

	function addStop() {
		updateGradient((current) => {
			const stops = [...current.stops].sort((left, right) => left.offset - right.offset);
			const left = stops.at(-2) ?? stops[0];
			const right = stops.at(-1) ?? stops[0];
			const offset = left && right ? (left.offset + right.offset) / 2 : 0.5;
			return {
				...current,
				stops: [
					...current.stops,
					{
						offset,
						color: previewColor === 'transparent' ? '#ffffff' : previewColor,
						opacity: 1
					}
				]
			};
		});
	}

	function updateStop(index: number, field: 'offset' | 'color' | 'opacity', raw: string) {
		updateGradient((current) => ({
			...current,
			stops: current.stops.map((stop: GradientStop, stopIndex: number) =>
				stopIndex === index
					? {
							...stop,
							[field]:
								field === 'color' ? raw : Math.min(1, Math.max(0, Number(raw)))
						}
					: stop
			)
		}));
	}

	function removeStop(index: number) {
		updateGradient((current) =>
			current.stops.length <= 2
				? current
				: {
						...current,
						stops: current.stops.filter(
							(_: GradientStop, stopIndex: number) => stopIndex !== index
						)
					}
		);
	}

	function portal(node: HTMLElement) {
		if (typeof document !== 'undefined') document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	function toggleGradient() {
		if (disabled) return;
		gradientOpen = !gradientOpen;
		if (!gradientOpen || !toggleEl || typeof window === 'undefined') return;
		const bounds = toggleEl.getBoundingClientRect();
		panelPosition = {
			left: Math.max(8, Math.min(bounds.left, window.innerWidth - 316)),
			top: bounds.bottom + 8
		};
	}
</script>

<div class="paint-picker">
	<ColorPicker
		{label}
		value={previewColor}
		{mixed}
		{disabled}
		allowNone
		onchange={(color: string) => onchange(color)} />
	<button
		class="paint-picker__gradient-toggle"
		bind:this={toggleEl}
		type="button"
		{disabled}
		aria-label={gradient ? 'Edit gradient' : 'Add gradient'}
		title={gradient ? 'Edit gradient' : 'Add gradient'}
		onclick={toggleGradient}>
		<span
			class="paint-picker__gradient-swatch"
			style:background={paintPreview(value)}
			aria-hidden="true"></span>
	</button>
	{#if gradientOpen}
		<div
			use:portal
			class="paint-picker__panel"
			role="dialog"
			aria-label={`${label} gradient editor`}
			style:left={`${panelPosition.left}px`}
			style:top={`${panelPosition.top}px`}>
			<div class="paint-picker__header">
				<strong>{gradient ? 'Gradient' : 'Add gradient'}</strong>
				<button
					type="button"
					aria-label="Close gradient editor"
					onclick={() => (gradientOpen = false)}>×</button>
			</div>
			{#if !gradient}
				<div class="paint-picker__actions">
					<button type="button" onclick={() => onchange(gradientFor('linear_gradient'))}
						>Linear gradient</button>
					<button type="button" onclick={() => onchange(gradientFor('radial_gradient'))}
						>Radial gradient</button>
				</div>
			{:else}
				<label class="paint-picker__field">
					<span>Type</span>
					<select
						aria-label={`${label} gradient type`}
						value={gradient.kind}
						onchange={setGradientKind}>
						<option value="linear_gradient">Linear</option>
						<option value="radial_gradient">Radial</option>
					</select>
				</label>
				<label class="paint-picker__field">
					<span>Spread</span>
					<select
						aria-label={`${label} gradient spread`}
						value={gradient.spread}
						onchange={(event) =>
							updateGradient((current) => ({
								...current,
								spread: (event.currentTarget as HTMLSelectElement)
									.value as typeof current.spread
							}))}>
						<option value="pad">Pad</option>
						<option value="reflect">Reflect</option>
						<option value="repeat">Repeat</option>
					</select>
				</label>
				<div class="paint-picker__stops" aria-label="Gradient stops">
					{#each gradient.stops as stop, index}
						<div class="paint-picker__stop">
							<input
								type="color"
								value={stop.color}
								aria-label={`Stop ${index + 1} color`}
								onchange={(event) =>
									updateStop(
										index,
										'color',
										(event.currentTarget as HTMLInputElement).value
									)} />
							<label
								><span>Position</span><input
									type="number"
									min="0"
									max="1"
									step="0.01"
									value={stop.offset}
									aria-label={`Stop ${index + 1} position`}
									onchange={(event) =>
										updateStop(
											index,
											'offset',
											(event.currentTarget as HTMLInputElement).value
										)} /></label>
							<label
								><span>Opacity</span><input
									type="number"
									min="0"
									max="1"
									step="0.01"
									value={stop.opacity}
									aria-label={`Stop ${index + 1} opacity`}
									onchange={(event) =>
										updateStop(
											index,
											'opacity',
											(event.currentTarget as HTMLInputElement).value
										)} /></label>
							<button
								type="button"
								aria-label={`Delete stop ${index + 1}`}
								disabled={gradient.stops.length <= 2}
								onclick={() => removeStop(index)}>×</button>
						</div>
					{/each}
				</div>
				<button
					class="paint-picker__add"
					type="button"
					aria-label="Add gradient stop"
					onclick={addStop}>Add stop</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.paint-picker {
		display: block;
		position: relative;
	}
	.paint-picker__gradient-toggle {
		position: absolute;
		right: 1px;
		bottom: 1px;
		z-index: 1;
		width: 14px;
		height: 14px;
		padding: 2px;
		border: 1px solid var(--ink-border);
		border-radius: 50%;
		background: var(--ink-surface-raised);
		box-shadow: 0 1px 3px rgb(0 0 0 / 20%);
		cursor: pointer;
	}
	.paint-picker__gradient-toggle:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.paint-picker__gradient-swatch {
		display: block;
		width: 100%;
		height: 100%;
		border-radius: 50%;
	}
	.paint-picker__panel {
		position: fixed;
		z-index: 1000;
		width: 300px;
		padding: 12px;
		border: 1px solid var(--ink-border);
		border-radius: 10px;
		background: var(--ink-surface-raised);
		color: var(--ink-text);
		box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
		transform: translateY(34px);
	}
	.paint-picker__header,
	.paint-picker__stop {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.paint-picker__header {
		justify-content: space-between;
		margin-bottom: 10px;
	}
	.paint-picker__header button,
	.paint-picker__stop > button {
		border: 0;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.paint-picker__field,
	.paint-picker__stop label {
		display: grid;
		gap: 3px;
		font-size: 11px;
		color: var(--ink-text-muted);
	}
	.paint-picker__field {
		grid-template-columns: 1fr 1fr;
		align-items: center;
		margin-bottom: 8px;
	}
	.paint-picker__field select,
	.paint-picker__stop input[type='number'] {
		min-width: 0;
		border: 1px solid var(--ink-border);
		border-radius: 5px;
		background: var(--ink-surface);
		color: var(--ink-text);
		padding: 3px;
	}
	.paint-picker__stops {
		display: grid;
		gap: 8px;
	}
	.paint-picker__stop input[type='color'] {
		width: 26px;
		height: 26px;
		padding: 0;
		border: 0;
	}
	.paint-picker__stop label {
		flex: 1;
	}
	.paint-picker__actions {
		display: grid;
		gap: 6px;
	}
	.paint-picker__actions button,
	.paint-picker__add {
		border: 1px solid var(--ink-border);
		border-radius: 6px;
		padding: 6px;
		background: var(--ink-surface);
		color: var(--ink-text);
		cursor: pointer;
	}
	.paint-picker__add {
		width: 100%;
		margin-top: 10px;
	}
</style>
