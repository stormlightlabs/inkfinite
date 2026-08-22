<script module lang="ts">
	/** Props for the Reasonable Colors picker. */
	export interface ColorPickerProps {
		/** Current color as a CSS hex value. */
		value: string;
		/** Accessible name for the trigger and picker panel. */
		label: string;
		/** Called when a palette color or valid custom hex value is selected. */
		onchange: (value: string) => void;
		/** Optional colors to show in the recent colors row. */
		recentColors?: readonly string[];
		/** Prevents opening and changing the color. */
		disabled?: boolean;
		/** Indicates that the selected shapes do not share one color. */
		mixed?: boolean;
		/** Horizontal alignment of the palette below the trigger. */
		align?: 'start' | 'end';
	}
</script>

<script lang="ts">
	import { normalizeHex } from './color-math';
	import {
		findPaletteColor,
		getPaletteColor,
		quickColors,
		REASONABLE_COLORS,
		type ColorFamily
	} from './colors';

	let {
		value,
		label,
		onchange,
		recentColors = [],
		disabled = false,
		mixed = false,
		align = 'start'
	}: ColorPickerProps = $props();

	let pickerEl = $state<HTMLDivElement | null>(null);
	let panelEl = $state<HTMLDivElement | null>(null);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let isOpen = $state(false);
	let activeFamily = $state<ColorFamily>('blue');
	let hexDraft = $state('');
	let hexError = $state(false);
	let recent = $state<string[]>([]);
	let restoreFocus = false;
	let panelPosition = $state({ left: 8, top: 8 });

	let pickerId = $derived(`color-picker-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
	let currentColor = $derived(normalizeHex(value) ?? value);
	let activeShades = $derived(REASONABLE_COLORS[activeFamily]);
	let displayedRecent = $derived(
		recent.filter((color, index) => recent.indexOf(color) === index).slice(0, 6)
	);

	$effect(() => {
		const normalized = normalizeHex(value);
		hexDraft = normalized ?? value;
		hexError = false;

		const paletteColor = findPaletteColor(value);
		if (paletteColor) {
			activeFamily = paletteColor.family;
		}
	});

	$effect(() => {
		recent = recentColors
			.map(normalizeHex)
			.filter((color): color is string => color !== undefined)
			.slice(0, 6);
	});

	$effect(() => {
		if (!isOpen) {
			if (restoreFocus) {
				restoreFocus = false;
				queueMicrotask(() => triggerEl?.focus());
			}
			return;
		}

		const panel = panelEl;
		const picker = pickerEl;
		const trigger = triggerEl;
		if (!panel || !picker || !trigger || typeof document === 'undefined') return;
		const pickerElement = picker;

		queueMicrotask(() => {
			const triggerBounds = trigger.getBoundingClientRect();
			const panelBounds = panel.getBoundingClientRect();
			const gutter = 8;
			const preferredTop = triggerBounds.bottom + gutter;
			const top =
				preferredTop + panelBounds.height <= window.innerHeight - gutter
					? preferredTop
					: Math.max(gutter, triggerBounds.top - panelBounds.height - gutter);
			const preferredLeft =
				align === 'end' ? triggerBounds.right - panelBounds.width : triggerBounds.left;
			const left = Math.max(
				gutter,
				Math.min(preferredLeft, window.innerWidth - panelBounds.width - gutter)
			);
			panelPosition = { left, top };
			const selectedOption = panel.querySelector<HTMLElement>('[aria-pressed="true"]');
			(selectedOption ?? panel).focus();
		});

		function handlePointerDown(event: PointerEvent) {
			const target = event.target as Node | null;
			if (target && !pickerElement.contains(target)) {
				closePicker();
			}
		}

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.preventDefault();
				closePicker();
			}
		}

		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
		};
	});

	function openPicker() {
		if (!disabled) {
			restoreFocus = false;
			isOpen = true;
		}
	}

	function closePicker() {
		if (isOpen) {
			restoreFocus = true;
			isOpen = false;
		}
	}

	function togglePicker() {
		if (isOpen) closePicker();
		else openPicker();
	}

	function selectColor(color: string, family?: ColorFamily) {
		const normalized = normalizeHex(color);
		if (!normalized) return;

		const paletteColor = findPaletteColor(normalized);
		if (family) activeFamily = family;
		else if (paletteColor) activeFamily = paletteColor.family;
		hexDraft = normalized;
		hexError = false;
		recent = [normalized, ...recent.filter((recentColor) => recentColor !== normalized)].slice(
			0,
			6
		);
		onchange(normalized);
	}

	function selectQuickColor(family: ColorFamily, shade: 1 | 2 | 3 | 4 | 5 | 6) {
		selectColor(getPaletteColor(family, shade), family);
	}

	function commitHex() {
		const normalized = normalizeHex(hexDraft);
		if (!normalized) {
			hexError = true;
			return;
		}

		selectColor(normalized);
	}

	function handleHexSubmit(event: SubmitEvent) {
		event.preventDefault();
		commitHex();
	}

	function handleHexBlur(event: FocusEvent) {
		const nextTarget = event.relatedTarget as Node | null;
		if (nextTarget && pickerEl?.contains(nextTarget)) return;
		commitHex();
	}

	function handleHexKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			closePicker();
		}
	}
</script>

<div class="color-picker" bind:this={pickerEl}>
	<button
		class="color-picker__trigger"
		class:color-picker__trigger--mixed={mixed}
		bind:this={triggerEl}
		type="button"
		{disabled}
		style:background={mixed ? undefined : currentColor}
		aria-label={mixed ? `${label}, mixed values` : label}
		aria-haspopup="dialog"
		aria-expanded={isOpen}
		title={mixed ? `${label}, mixed values` : label}
		onclick={togglePicker}>
		<span class="color-picker__sr-only">{mixed ? `${label}, mixed values` : label}</span>
	</button>

	{#if isOpen}
		<div
			class="color-picker__panel"
			class:color-picker__panel--end={align === 'end'}
			bind:this={panelEl}
			style:left={`${panelPosition.left}px`}
			style:top={`${panelPosition.top}px`}
			role="dialog"
			tabindex="-1"
			aria-label={label}>
			<section class="color-picker__section" aria-labelledby={`${pickerId}-palette-label`}>
				<h2 id={`${pickerId}-palette-label`} class="color-picker__section-label">
					Palette
				</h2>
				<div class="color-picker__quick-grid" role="group" aria-label="Quick colors">
					{#each quickColors as quickColor}
						{@const color = getPaletteColor(quickColor.family, quickColor.shade)}
						<button
							class="color-picker__swatch color-picker__swatch--quick"
							class:color-picker__swatch--selected={currentColor === color}
							data-color-option
							type="button"
							style:background={color}
							aria-label={`${quickColor.family} ${quickColor.shade}`}
							aria-pressed={currentColor === color}
							title={`${quickColor.family} ${quickColor.shade}`}
							onfocus={() => (activeFamily = quickColor.family)}
							onclick={() => selectQuickColor(quickColor.family, quickColor.shade)}
						></button>
					{/each}
				</div>
			</section>

			<div class="color-picker__divider" aria-hidden="true"></div>

			<section class="color-picker__section" aria-labelledby={`${pickerId}-shades-label`}>
				<h2 id={`${pickerId}-shades-label`} class="color-picker__section-label">
					{activeFamily} shades
				</h2>
				<div
					class="color-picker__shades"
					role="group"
					aria-label={`${activeFamily} shades`}>
					{#each activeShades as color, index}
						<button
							class="color-picker__swatch color-picker__swatch--shade"
							class:color-picker__swatch--selected={currentColor === color}
							type="button"
							style:background={color}
							aria-label={`${activeFamily} ${index + 1}`}
							aria-pressed={currentColor === color}
							title={`${activeFamily} ${index + 1}`}
							onclick={() => selectColor(color, activeFamily)}></button>
					{/each}
				</div>
			</section>

			{#if displayedRecent.length > 0}
				<div class="color-picker__divider" aria-hidden="true"></div>
				<section
					class="color-picker__section"
					aria-labelledby={`${pickerId}-recent-label`}>
					<h2 id={`${pickerId}-recent-label`} class="color-picker__section-label">
						Recent
					</h2>
					<div class="color-picker__recent" role="group" aria-label="Recent colors">
						{#each displayedRecent as color}
							<button
								class="color-picker__swatch color-picker__swatch--recent"
								class:color-picker__swatch--selected={currentColor === color}
								type="button"
								style:background={color}
								aria-label={`Recent ${color}`}
								aria-pressed={currentColor === color}
								title={`Recent ${color}`}
								onclick={() => selectColor(color)}></button>
						{/each}
					</div>
				</section>
			{/if}

			<div class="color-picker__divider" aria-hidden="true"></div>

			<section class="color-picker__section" aria-labelledby={`${pickerId}-custom-label`}>
				<h2 id={`${pickerId}-custom-label`} class="color-picker__section-label">
					Custom color
				</h2>
				<form class="color-picker__custom" onsubmit={handleHexSubmit}>
					<label class="color-picker__hex-label" for={`${pickerId}-hex`}>Hex</label>
					<div class="color-picker__hex-row">
						<input
							id={`${pickerId}-hex`}
							class="color-picker__hex-input"
							class:color-picker__hex-input--error={hexError}
							value={hexDraft}
							oninput={(event) => {
								hexDraft = (event.currentTarget as HTMLInputElement).value;
								hexError = false;
							}}
							onblur={handleHexBlur}
							onkeydown={handleHexKeyDown}
							aria-label="Hex color"
							aria-invalid={hexError}
							aria-describedby={hexError ? `${pickerId}-hex-error` : undefined}
							spellcheck="false"
							inputmode="text" />
						<button class="color-picker__apply" type="submit">Apply</button>
					</div>
					{#if hexError}
						<p id={`${pickerId}-hex-error`} class="color-picker__error">
							Enter a 3- or 6-digit hex color.
						</p>
					{/if}
				</form>
			</section>
		</div>
	{/if}
</div>

<style>
	.color-picker {
		position: relative;
		display: inline-flex;
	}

	.color-picker__trigger {
		width: 2.5rem;
		height: 2.5rem;
		padding: 0.25rem;
		border: var(--ink-line-width) solid var(--ink-border-strong);
		border-radius: var(--ink-radius-control-small);
		box-shadow: var(--ink-shadow-control);
		cursor: pointer;
		transition: transform var(--ink-duration-fast) var(--ink-ease-out);
	}

	.color-picker__trigger--mixed {
		background: repeating-linear-gradient(
			-45deg,
			var(--ink-surface-hover) 0,
			var(--ink-surface-hover) 5px,
			var(--ink-border-strong) 5px,
			var(--ink-border-strong) 7px
		);
	}

	.color-picker__trigger:hover:not(:disabled) {
		transform: translateY(-1px);
	}

	.color-picker__trigger:active:not(:disabled) {
		transform: scale(0.98);
	}

	.color-picker__trigger:focus-visible,
	.color-picker__swatch:focus-visible,
	.color-picker__apply:focus-visible,
	.color-picker__hex-input:focus-visible {
		outline: var(--ink-line-width-strong) solid var(--ink-focus);
		outline-offset: 2px;
	}

	.color-picker__trigger:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.color-picker__panel {
		position: fixed;
		top: 8px;
		left: 8px;
		z-index: 10;
		width: min(15rem, calc(100vw - 1rem));
		padding: var(--ink-space-3);
		border: var(--ink-line-width) solid var(--ink-border-strong);
		border-radius: var(--ink-radius-panel-small);
		color: var(--ink-text);
		background: var(--ink-surface-raised);
		box-shadow: var(--ink-shadow-toolbar);
	}

	.color-picker__panel--end {
		right: 0;
		left: auto;
	}

	.color-picker__section {
		display: grid;
		gap: var(--ink-space-2);
	}

	.color-picker__section-label {
		margin: 0;
		font-size: var(--ink-type-xs);
		font-weight: 650;
		line-height: 1.25;
		color: var(--ink-text-muted);
	}

	.color-picker__quick-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--ink-space-2);
	}

	.color-picker__shades,
	.color-picker__recent {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ink-space-2);
	}

	.color-picker__swatch {
		flex: 0 0 auto;
		padding: 0;
		border: 0;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink-shadow-color) 28%, transparent);
		cursor: pointer;
		transition: transform var(--ink-duration-fast) var(--ink-ease-out);
	}

	.color-picker__swatch:hover {
		transform: scale(1.08);
	}

	.color-picker__swatch--quick {
		width: 2rem;
		height: 2rem;
		justify-self: center;
	}

	.color-picker__swatch--shade {
		width: 1.75rem;
		height: 1.75rem;
	}

	.color-picker__swatch--recent {
		width: 1.75rem;
		height: 1.75rem;
	}

	.color-picker__swatch--selected {
		box-shadow:
			0 0 0 2px var(--ink-surface-raised),
			0 0 0 4px var(--ink-text),
			inset 0 0 0 1px color-mix(in srgb, var(--ink-shadow-color) 28%, transparent);
	}

	.color-picker__divider {
		height: 1px;
		margin-block: var(--ink-space-3);
		background: var(--ink-border);
	}

	.color-picker__custom {
		display: grid;
		gap: var(--ink-space-1);
	}

	.color-picker__hex-label {
		font-size: var(--ink-type-xs);
		color: var(--ink-text-muted);
	}

	.color-picker__hex-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--ink-space-2);
	}

	.color-picker__hex-input {
		min-width: 0;
		min-height: var(--ink-control-height-sm);
		padding: 0 var(--ink-space-2);
		border: var(--ink-line-width) solid var(--ink-border);
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text);
		background: var(--ink-surface);
		font: 600 var(--ink-type-sm) / 1 var(--ink-font-body);
		font-variant-numeric: tabular-nums;
	}

	.color-picker__hex-input--error {
		border-color: var(--ink-danger);
	}

	.color-picker__apply {
		min-height: var(--ink-control-height-sm);
		padding-inline: var(--ink-space-2);
		border: var(--ink-line-width) solid var(--ink-border-strong);
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text);
		background: var(--ink-surface);
		font-size: var(--ink-type-xs);
		font-weight: 650;
		cursor: pointer;
	}

	.color-picker__apply:hover {
		background: var(--ink-surface-hover);
	}

	.color-picker__error {
		margin: 0;
		font-size: var(--ink-type-xs);
		color: var(--ink-danger);
	}

	.color-picker__sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (pointer: coarse) {
		.color-picker__swatch--quick {
			width: 2.75rem;
			height: 2.75rem;
		}

		.color-picker__swatch--shade,
		.color-picker__swatch--recent {
			width: 2.5rem;
			height: 2.5rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.color-picker__trigger,
		.color-picker__swatch {
			transition: none;
		}
	}
</style>
