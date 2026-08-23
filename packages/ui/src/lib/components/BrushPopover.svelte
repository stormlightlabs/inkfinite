<script module lang="ts">
	/** Visual brush settings edited by the shared brush popover. */
	export interface BrushSettings {
		color: string;
		simulatePressure: boolean;
		size: number;
		smoothing: number;
		streamline: number;
		thinning: number;
	}

	/** Props for the shared brush settings control. */
	export interface BrushPopoverProps {
		brush: BrushSettings;
		onBrushChange: (brush: BrushSettings) => void;
		disabled?: boolean;
		align?: 'start' | 'end';
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';

	let { brush, onBrushChange, disabled = false, align = 'start' }: BrushPopoverProps = $props();

	let isOpen = $state(false);
	let popoverEl = $state<HTMLDivElement | null>(null);
	let buttonEl = $state<HTMLButtonElement | null>(null);
	let menuPosition = $state({ left: 8, top: 8 });
	let positioned = $state(false);

	let size = $derived(brush.size);
	let thinning = $derived(brush.thinning);
	let smoothing = $derived(brush.smoothing);
	let streamline = $derived(brush.streamline);
	let simulatePressure = $derived(brush.simulatePressure);
	let color = $derived(brush.color);

	$effect(() => {
		size = brush.size;
		thinning = brush.thinning;
		smoothing = brush.smoothing;
		streamline = brush.streamline;
		simulatePressure = brush.simulatePressure;
		color = brush.color;
	});

	$effect(() => {
		if (!isOpen || typeof document === 'undefined') return;
		let cancelled = false;

		async function positionMenu() {
			positioned = false;
			await tick();
			if (cancelled || !popoverEl || !buttonEl) return;
			const gutter = 8;
			const trigger = buttonEl.getBoundingClientRect();
			const menu = popoverEl.getBoundingClientRect();
			const preferredLeft = align === 'end' ? trigger.right - menu.width : trigger.left;
			const below = trigger.bottom + gutter;
			const top =
				below + menu.height <= window.innerHeight - gutter
					? below
					: trigger.top - menu.height - gutter;
			menuPosition = {
				left: Math.max(
					gutter,
					Math.min(preferredLeft, window.innerWidth - menu.width - gutter)
				),
				top: Math.max(gutter, Math.min(top, window.innerHeight - menu.height - gutter))
			};
			positioned = true;
			await tick();
			popoverEl.querySelector<HTMLElement>('input, button')?.focus();
		}

		void positionMenu();
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!target || popoverEl?.contains(target) || buttonEl?.contains(target)) return;
			isOpen = false;
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			isOpen = false;
			buttonEl?.focus();
		};

		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		window.addEventListener('resize', positionMenu);
		return () => {
			cancelled = true;
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('resize', positionMenu);
		};
	});

	function togglePopover() {
		if (!disabled) {
			isOpen = !isOpen;
		}
	}

	function handleSizeInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		size = Number(input.value);
	}

	function handleSizeChange() {
		onBrushChange({ size, thinning, smoothing, streamline, simulatePressure, color });
	}

	function handleThinningInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		thinning = Number(input.value);
	}

	function handleThinningChange() {
		onBrushChange({ size, thinning, smoothing, streamline, simulatePressure, color });
	}

	function handleSmoothingInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		smoothing = Number(input.value);
	}

	function handleSmoothingChange() {
		onBrushChange({ size, thinning, smoothing, streamline, simulatePressure, color });
	}

	function handleStreamlineInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		streamline = Number(input.value);
	}

	function handleStreamlineChange() {
		onBrushChange({ size, thinning, smoothing, streamline, simulatePressure, color });
	}

	function handleSimulatePressureChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		simulatePressure = input.checked;
		onBrushChange({ size, thinning, smoothing, streamline, simulatePressure, color });
	}

	function handleColorInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		color = input.value;
	}

	function handleColorChange() {
		onBrushChange({ size, thinning, smoothing, streamline, simulatePressure, color });
	}
</script>

<div class="brush-popover">
	<button
		class="brush-popover__button"
		bind:this={buttonEl}
		onclick={togglePopover}
		{disabled}
		aria-label="Brush settings"
		aria-haspopup="true"
		aria-expanded={isOpen}>
		Brush
	</button>

	{#if isOpen}
		<div
			class="brush-popover__menu"
			bind:this={popoverEl}
			role="dialog"
			style:left={`${menuPosition.left}px`}
			style:top={`${menuPosition.top}px`}
			style:visibility={positioned ? 'visible' : 'hidden'}
			aria-label="Brush settings">
			<div class="brush-popover__control">
				<label for="brush-size">
					<span class="brush-popover__label">Size</span>
					<span class="brush-popover__value">{size}</span>
				</label>
				<input
					id="brush-size"
					type="range"
					min="1"
					max="50"
					step="1"
					value={size}
					oninput={handleSizeInput}
					onchange={handleSizeChange}
					aria-label="Brush size" />
			</div>

			<div class="brush-popover__control">
				<label for="brush-thinning">
					<span class="brush-popover__label">Thinning</span>
					<span class="brush-popover__value">{thinning.toFixed(2)}</span>
				</label>
				<input
					id="brush-thinning"
					type="range"
					min="-1"
					max="1"
					step="0.01"
					value={thinning}
					oninput={handleThinningInput}
					onchange={handleThinningChange}
					aria-label="Brush thinning" />
			</div>

			<div class="brush-popover__control">
				<label for="brush-smoothing">
					<span class="brush-popover__label">Smoothing</span>
					<span class="brush-popover__value">{smoothing.toFixed(2)}</span>
				</label>
				<input
					id="brush-smoothing"
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={smoothing}
					oninput={handleSmoothingInput}
					onchange={handleSmoothingChange}
					aria-label="Brush smoothing" />
			</div>

			<div class="brush-popover__control">
				<label for="brush-streamline">
					<span class="brush-popover__label">Streamline</span>
					<span class="brush-popover__value">{streamline.toFixed(2)}</span>
				</label>
				<input
					id="brush-streamline"
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={streamline}
					oninput={handleStreamlineInput}
					onchange={handleStreamlineChange}
					aria-label="Brush streamline" />
			</div>

			<div class="brush-popover__control brush-popover__control--color">
				<label for="brush-color">
					<span class="brush-popover__label">Color</span>
					<span class="brush-popover__value">{color}</span>
				</label>
				<input
					id="brush-color"
					type="color"
					value={color}
					oninput={handleColorInput}
					onchange={handleColorChange}
					aria-label="Brush color" />
			</div>

			<div class="brush-popover__control brush-popover__control--checkbox">
				<label for="brush-simulate-pressure">
					<input
						id="brush-simulate-pressure"
						type="checkbox"
						checked={simulatePressure}
						onchange={handleSimulatePressureChange}
						aria-label="Simulate pressure" />
					<span class="brush-popover__label">Simulate Pressure</span>
				</label>
			</div>
		</div>
	{/if}
</div>

<style>
	.brush-popover {
		position: relative;
	}

	.brush-popover__button {
		min-height: var(--ink-control-height);
		border: var(--ink-line-width) solid var(--ink-border);
		background: var(--ink-surface-raised);
		color: var(--ink-text);
		padding: 0 var(--ink-space-3);
		border-radius: var(--ink-radius-control-small);
		cursor: pointer;
		font-size: 13px;
		min-width: 60px;
	}

	.brush-popover__button:hover:not(:disabled) {
		background: var(--ink-surface-hover);
	}

	.brush-popover__button:active:not(:disabled) {
		transform: scale(0.96);
	}

	.brush-popover__button:focus-visible {
		outline: 3px solid var(--ink-focus);
		outline-offset: 2px;
	}

	.brush-popover__button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.brush-popover__menu {
		position: fixed;
		background: var(--ink-surface-raised);
		color: var(--ink-text);
		border: var(--ink-line-width) solid var(--ink-border-strong);
		border-radius: var(--ink-radius-panel-small);
		box-shadow: var(--ink-shadow-toolbar);
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		z-index: 1000;
		width: min(14rem, calc(100vw - 1rem));
	}

	.brush-popover__control {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.brush-popover__control label {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.75rem;
		color: var(--ink-text);
	}

	.brush-popover__label {
		font-weight: 500;
	}

	.brush-popover__value {
		color: var(--ink-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.brush-popover__control input[type='range'] {
		width: 100%;
		height: 0.25rem;
		border-radius: 2px;
		background: var(--ink-border);
		outline: none;
		-webkit-appearance: none;
		appearance: none;
	}

	.brush-popover__control input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--ink-accent);
		cursor: pointer;
	}

	.brush-popover__control input[type='range']::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--ink-accent);
		cursor: pointer;
		border: none;
	}

	.brush-popover__control input[type='range']:focus::-webkit-slider-thumb {
		outline: 2px solid var(--ink-focus);
		outline-offset: 2px;
	}

	.brush-popover__control input[type='range']:focus::-moz-range-thumb {
		outline: 2px solid var(--ink-focus);
		outline-offset: 2px;
	}

	.brush-popover__control--checkbox label {
		flex-direction: row;
		gap: 8px;
	}

	.brush-popover__control--color input[type='color'] {
		width: 100%;
		border: 1px solid var(--ink-border);
		border-radius: 0.25rem;
		height: 32px;
		background: var(--ink-surface-raised);
		cursor: pointer;
	}

	.brush-popover__control--checkbox input[type='checkbox'] {
		width: 16px;
		height: 16px;
		cursor: pointer;
		accent-color: var(--ink-accent);
	}
</style>
