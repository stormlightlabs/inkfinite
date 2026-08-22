<script module lang="ts">
	/** Props for the Reasonable Colors picker. */
	export interface ColorPickerProps {
		/** Current color as a CSS hex value or `transparent`. */
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
		/** Shows a transparent/none option in the quick palette. */
		allowNone?: boolean;
		/** Label for the transparent/none option. */
		noneLabel?: string;
		/** Horizontal alignment of the palette below the trigger. */
		align?: 'start' | 'end';
	}
</script>

<script lang="ts">
	import Icon from './Icon.svelte';
	import { normalizeHex } from './color-math';
	import {
		colorFamilies,
		findPaletteColor,
		getPaletteColor,
		quickColors,
		REASONABLE_COLORS,
		type ColorFamily,
		type ColorShade
	} from './colors';

	const TRANSPARENT = 'transparent';
	type PickerMode = 'palette' | 'custom';

	let {
		value,
		label,
		onchange,
		recentColors = [],
		disabled = false,
		mixed = false,
		allowNone = false,
		noneLabel = 'Transparent',
		align = 'start'
	}: ColorPickerProps = $props();

	let pickerEl = $state<HTMLDivElement | null>(null);
	let panelEl = $state<HTMLDivElement | null>(null);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let customButtonEl = $state<HTMLButtonElement | null>(null);
	let customBackButtonEl = $state<HTMLButtonElement | null>(null);
	let hexInputEl = $state<HTMLInputElement | null>(null);
	let isOpen = $state(false);
	let mode = $state<PickerMode>('palette');
	let activeFamily = $state<ColorFamily>('blue');
	let hexDraft = $state('');
	let hexError = $state(false);
	let recent = $state<string[]>([]);
	let restoreFocus = false;
	let panelPosition = $state({ left: 8, top: 8 });

	const familyEntries = colorFamilies.map((family) => ({
		family,
		color: getPaletteColor(family, 3)
	}));

	let pickerId = $derived(`color-picker-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
	let currentColor = $derived(normalizePickerColor(value));
	let activeShades = $derived(REASONABLE_COLORS[activeFamily]);
	let displayedRecent = $derived(
		recent.filter((color, index) => recent.indexOf(color) === index).slice(0, 6)
	);
	let isTransparent = $derived(currentColor === TRANSPARENT);

	$effect(() => {
		const normalized = normalizeHex(value);
		hexDraft = normalized ?? (isTransparentValue(value) ? '' : value);
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
			positionPanel();
			if (mode === 'custom') {
				hexInputEl?.focus();
				return;
			}

			const selectedOption = panel.querySelector<HTMLElement>('[aria-pressed="true"]');
			(
				selectedOption ??
				panel.querySelector<HTMLElement>('[data-color-option]') ??
				panel
			).focus();
		});

		function handlePointerDown(event: PointerEvent) {
			const target = event.target as Node | null;
			if (target && !pickerElement.contains(target) && !panelEl?.contains(target)) {
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

	function normalizePickerColor(color: string): string {
		return normalizeHex(color) ?? (isTransparentValue(color) ? TRANSPARENT : color);
	}

	function isTransparentValue(color: string): boolean {
		return color.trim() === '' || color.trim().toLowerCase() === TRANSPARENT;
	}

	function portal(node: HTMLElement) {
		if (typeof document !== 'undefined') document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	function positionPanel() {
		if (!panelEl || !triggerEl || typeof window === 'undefined') return;

		const triggerBounds = triggerEl.getBoundingClientRect();
		const panelBounds = panelEl.getBoundingClientRect();
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
	}

	function openPicker() {
		if (!disabled) {
			restoreFocus = false;
			mode = 'palette';
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

	function openCustom() {
		mode = 'custom';
	}

	function closeCustom() {
		mode = 'palette';
		queueMicrotask(() => customButtonEl?.focus());
	}

	function selectColor(color: string, family?: ColorFamily) {
		const normalized = normalizePickerColor(color);
		if (!normalized) return;

		const paletteColor = findPaletteColor(normalized);
		if (family) activeFamily = family;
		else if (paletteColor) activeFamily = paletteColor.family;
		hexDraft = normalized === TRANSPARENT ? '' : normalized;
		hexError = false;
		if (normalized !== TRANSPARENT) {
			recent = [
				normalized,
				...recent.filter((recentColor) => recentColor !== normalized)
			].slice(0, 6);
		}
		onchange(normalized);
	}

	function selectQuickColor(family: ColorFamily, shade: ColorShade) {
		selectColor(getPaletteColor(family, shade), family);
	}

	function selectNone() {
		selectColor(TRANSPARENT);
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

	function handleGridKeyDown(
		event: KeyboardEvent,
		index: number,
		count: number,
		columns: number,
		selector: string
	) {
		let nextIndex = index;
		switch (event.key) {
			case 'ArrowLeft':
				nextIndex = index - 1;
				break;
			case 'ArrowRight':
				nextIndex = index + 1;
				break;
			case 'ArrowUp':
				nextIndex = index - columns;
				break;
			case 'ArrowDown':
				nextIndex = index + columns;
				break;
			case 'Home':
				nextIndex = 0;
				break;
			case 'End':
				nextIndex = count - 1;
				break;
			default:
				return;
		}

		if (nextIndex < 0 || nextIndex >= count) return;
		event.preventDefault();
		panelEl?.querySelectorAll<HTMLButtonElement>(selector)[nextIndex]?.focus();
	}
</script>

<div class="color-picker" bind:this={pickerEl}>
	<button
		class="color-picker__trigger"
		class:color-picker__trigger--mixed={mixed}
		class:color-picker__trigger--none={!mixed && isTransparent}
		bind:this={triggerEl}
		type="button"
		{disabled}
		style:background={!mixed && !isTransparent ? currentColor : undefined}
		aria-label={mixed ? `${label}, mixed values` : label}
		aria-haspopup="dialog"
		aria-expanded={isOpen}
		title={mixed ? `${label}, mixed values` : label}
		onclick={togglePicker}>
		<span class="color-picker__sr-only">{mixed ? `${label}, mixed values` : label}</span>
	</button>

	{#if isOpen}
		<div
			use:portal
			class="color-picker__panel"
			class:color-picker__panel--custom={mode === 'custom'}
			class:color-picker__panel--end={align === 'end'}
			bind:this={panelEl}
			style:left={`${panelPosition.left}px`}
			style:top={`${panelPosition.top}px`}
			role="dialog"
			tabindex="-1"
			aria-label={label}>
			{#if mode === 'palette'}
				<div class="color-picker__panel-header">
					<div>
						<p class="color-picker__eyebrow">{label}</p>
						<h2>Quick colors</h2>
					</div>
					<a
						class="color-picker__hint"
						href="https://www.reasonable.work/artifacts/ra005-reasonable-colors/"
						target="_blank"
						rel="noreferrer">
						Reasonable Colors
					</a>
				</div>

				<section class="color-picker__section" aria-labelledby={`${pickerId}-quick-label`}>
					<h3 id={`${pickerId}-quick-label`} class="color-picker__sr-only">
						Quick colors
					</h3>
					<div class="color-picker__quick-grid" role="group" aria-label="Quick colors">
						{#if allowNone}
							<button
								class="color-picker__swatch color-picker__swatch--quick color-picker__swatch--none"
								class:color-picker__swatch--selected={isTransparent}
								data-color-option
								type="button"
								aria-label={noneLabel}
								aria-pressed={isTransparent}
								title={noneLabel}
								onclick={selectNone}
								onkeydown={(event) =>
									handleGridKeyDown(
										event,
										0,
										quickColors.length + 1,
										4,
										'[data-color-option]'
									)}>
								<span class="color-picker__none-mark" aria-hidden="true"></span>
							</button>
						{/if}
						{#each quickColors as quickColor, index}
							{@const color = getPaletteColor(quickColor.family, quickColor.shade)}
							{@const optionIndex = allowNone ? index + 1 : index}
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
								onclick={() =>
									selectQuickColor(quickColor.family, quickColor.shade)}
								onkeydown={(event) =>
									handleGridKeyDown(
										event,
										optionIndex,
										quickColors.length + (allowNone ? 1 : 0),
										4,
										'[data-color-option]'
									)}></button>
						{/each}
					</div>
				</section>

				{#if displayedRecent.length > 0}
					<div class="color-picker__divider" aria-hidden="true"></div>
					<section
						class="color-picker__section"
						aria-labelledby={`${pickerId}-recent-label`}>
						<div class="color-picker__section-heading">
							<h3
								id={`${pickerId}-recent-label`}
								class="color-picker__section-label">
								Recent
							</h3>
							<span class="color-picker__section-note">Last used</span>
						</div>
						<div class="color-picker__recent" role="group" aria-label="Recent colors">
							{#each displayedRecent as color, index}
								<button
									class="color-picker__swatch color-picker__swatch--recent"
									class:color-picker__swatch--selected={currentColor === color}
									type="button"
									style:background={color}
									aria-label={`Recent ${color}`}
									aria-pressed={currentColor === color}
									title={`Recent ${color}`}
									onclick={() => selectColor(color)}
									onkeydown={(event) =>
										handleGridKeyDown(
											event,
											index,
											displayedRecent.length,
											6,
											'[aria-label^="Recent "]'
										)}></button>
							{/each}
						</div>
					</section>
				{/if}

				<div class="color-picker__divider" aria-hidden="true"></div>
				<button
					class="color-picker__custom-action"
					bind:this={customButtonEl}
					type="button"
					onclick={openCustom}
					aria-label="Custom…">
					<span>
						<strong>Custom…</strong>
						<small>All families and hex</small>
					</span>
					<span class="color-picker__custom-arrow" aria-hidden="true">
						<Icon name="expand" size={16} />
					</span>
				</button>
			{:else}
				<div class="color-picker__custom-header">
					<button
						class="color-picker__back"
						bind:this={customBackButtonEl}
						type="button"
						onclick={closeCustom}>
						<span aria-hidden="true">←</span>
						<span>Palette</span>
					</button>
					<div>
						<p class="color-picker__eyebrow">Custom colors</p>
						<h2>All families</h2>
					</div>
				</div>

				<div class="color-picker__custom-scroll">
					<section
						class="color-picker__section"
						aria-labelledby={`${pickerId}-families-label`}>
						<div class="color-picker__section-heading">
							<h3
								id={`${pickerId}-families-label`}
								class="color-picker__section-label">
								Families
							</h3>
							<span class="color-picker__section-note">Choose a shade below</span>
						</div>
						<div
							class="color-picker__family-grid"
							role="group"
							aria-label="Color families">
							{#each familyEntries as entry, index}
								<button
									class="color-picker__family"
									class:color-picker__family--selected={activeFamily ===
										entry.family}
									data-family-option
									type="button"
									aria-label={entry.family}
									aria-pressed={activeFamily === entry.family}
									onclick={() => (activeFamily = entry.family)}
									onkeydown={(event) =>
										handleGridKeyDown(
											event,
											index,
											familyEntries.length,
											4,
											'[data-family-option]'
										)}>
									<span
										class="color-picker__family-dot"
										style:background={entry.color}></span>
									<span>{entry.family}</span>
								</button>
							{/each}
						</div>
					</section>

					<div class="color-picker__divider" aria-hidden="true"></div>

					<section
						class="color-picker__section"
						aria-labelledby={`${pickerId}-shades-label`}>
						<div class="color-picker__section-heading">
							<h3
								id={`${pickerId}-shades-label`}
								class="color-picker__section-label">
								{activeFamily} shades
							</h3>
							<span class="color-picker__section-note">Light to deep</span>
						</div>
						<div
							class="color-picker__shades"
							role="group"
							aria-label={`${activeFamily} shades`}>
							{#each activeShades as color, index}
								<button
									class="color-picker__swatch"
									class:color-picker__swatch--selected={currentColor === color}
									type="button"
									style:background={color}
									aria-label={`${activeFamily} ${index + 1}`}
									aria-pressed={currentColor === color}
									title={`${activeFamily} ${index + 1}`}
									onclick={() => selectColor(color, activeFamily)}
									onkeydown={(event) =>
										handleGridKeyDown(
											event,
											index,
											activeShades.length,
											6,
											'[aria-label^="' + activeFamily + ' "]'
										)}></button>
							{/each}
						</div>
					</section>

					<div class="color-picker__divider" aria-hidden="true"></div>

					<section
						class="color-picker__section"
						aria-labelledby={`${pickerId}-hex-label`}>
						<div class="color-picker__section-heading">
							<h3 id={`${pickerId}-hex-label`} class="color-picker__section-label">
								Custom hex
							</h3>
							<span class="color-picker__section-note">3 or 6 digits</span>
						</div>
						<form class="color-picker__custom" onsubmit={handleHexSubmit}>
							<label class="color-picker__hex-label" for={`${pickerId}-hex`}
								>Hex value</label>
							<div class="color-picker__hex-row">
								<input
									id={`${pickerId}-hex`}
									class="color-picker__hex-input"
									class:color-picker__hex-input--error={hexError}
									bind:this={hexInputEl}
									value={hexDraft}
									oninput={(event) => {
										hexDraft = (event.currentTarget as HTMLInputElement).value;
										hexError = false;
									}}
									onblur={handleHexBlur}
									onkeydown={handleHexKeyDown}
									aria-label="Hex color"
									aria-invalid={hexError}
									aria-describedby={hexError
										? `${pickerId}-hex-error`
										: undefined}
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

	.color-picker__trigger--none,
	.color-picker__swatch--none {
		background-color: var(--ink-surface-raised);
		background-image:
			linear-gradient(
				45deg,
				color-mix(in srgb, var(--ink-border) 54%, transparent) 25%,
				transparent 25%
			),
			linear-gradient(
				-45deg,
				color-mix(in srgb, var(--ink-border) 54%, transparent) 25%,
				transparent 25%
			),
			linear-gradient(
				45deg,
				transparent 75%,
				color-mix(in srgb, var(--ink-border) 54%, transparent) 75%
			),
			linear-gradient(
				-45deg,
				transparent 75%,
				color-mix(in srgb, var(--ink-border) 54%, transparent) 75%
			);
		background-position:
			0 0,
			0 0,
			6px 6px,
			6px 6px;
		background-size: 12px 12px;
	}

	.color-picker__trigger--none::after {
		display: block;
		width: 100%;
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(
			135deg,
			transparent 44%,
			var(--ink-danger) 45%,
			var(--ink-danger) 55%,
			transparent 56%
		);
		content: '';
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
	.color-picker__family:focus-visible,
	.color-picker__custom-action:focus-visible,
	.color-picker__back:focus-visible,
	.color-picker__apply:focus-visible,
	.color-picker__hex-input:focus-visible,
	.color-picker__hint:focus-visible {
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
		z-index: 1000;
		width: min(17rem, calc(100vw - 1rem));
		padding: var(--ink-space-3);
		border: var(--ink-line-width) solid var(--ink-border-strong);
		border-radius: var(--ink-radius-panel-small);
		color: var(--ink-text);
		background: var(--ink-surface-raised);
		box-shadow: var(--ink-shadow-popover);
	}

	.color-picker__panel--custom {
		width: min(27rem, calc(100vw - 1rem));
		padding-bottom: var(--ink-space-2);
	}

	.color-picker__panel-header,
	.color-picker__custom-header,
	.color-picker__section-heading {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: var(--ink-space-3);
	}

	.color-picker__panel-header,
	.color-picker__custom-header {
		margin-bottom: var(--ink-space-3);
	}

	.color-picker__eyebrow {
		margin: 0 0 0.15rem;
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
		font-weight: 650;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}

	.color-picker__panel h2 {
		margin: 0;
		color: var(--ink-heading);
		font: 700 var(--ink-type-base) / 1.2 var(--ink-font-body);
	}

	.color-picker__hint,
	.color-picker__section-note {
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
		line-height: 1.3;
		text-align: right;
	}

	.color-picker__hint {
		text-decoration: none;
	}

	.color-picker__hint:hover {
		color: var(--ink-accent-text);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.color-picker__section {
		display: grid;
		gap: var(--ink-space-2);
	}

	.color-picker__section-label {
		margin: 0;
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.color-picker__quick-grid,
	.color-picker__family-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--ink-space-2);
	}

	.color-picker__swatch {
		width: 2.25rem;
		height: 2.25rem;
		justify-self: center;
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

	.color-picker__swatch--selected {
		box-shadow:
			0 0 0 2px var(--ink-surface-raised),
			0 0 0 4px var(--ink-text),
			inset 0 0 0 1px color-mix(in srgb, var(--ink-shadow-color) 28%, transparent);
	}

	.color-picker__none-mark {
		display: block;
		width: 100%;
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(
			135deg,
			transparent 44%,
			var(--ink-danger) 45%,
			var(--ink-danger) 55%,
			transparent 56%
		);
	}

	.color-picker__recent,
	.color-picker__shades {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ink-space-2);
	}

	.color-picker__recent .color-picker__swatch,
	.color-picker__shades .color-picker__swatch {
		justify-self: auto;
	}

	.color-picker__divider {
		height: 1px;
		margin-block: var(--ink-space-3);
		background: var(--ink-border);
	}

	.color-picker__custom-action {
		display: flex;
		width: 100%;
		min-height: var(--ink-control-height);
		align-items: center;
		justify-content: space-between;
		padding: var(--ink-space-2) var(--ink-space-3);
		border: var(--ink-line-width) solid var(--ink-border);
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text);
		background: var(--ink-canvas);
		text-align: left;
		cursor: pointer;
		transition:
			background-color var(--ink-duration-fast) var(--ink-ease-out),
			border-color var(--ink-duration-fast) var(--ink-ease-out);
	}

	.color-picker__custom-action:hover {
		border-color: var(--ink-accent);
		background: var(--ink-surface-hover);
	}

	.color-picker__custom-action strong,
	.color-picker__custom-action small {
		display: block;
	}

	.color-picker__custom-action strong {
		font-size: var(--ink-type-sm);
	}

	.color-picker__custom-action small {
		margin-top: 0.15rem;
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
	}

	.color-picker__custom-arrow {
		display: inline-flex;
		align-items: center;
		color: var(--ink-accent-text);
	}

	.color-picker__back {
		display: inline-flex;
		min-height: var(--ink-control-height-sm);
		align-items: center;
		gap: var(--ink-space-1);
		padding: 0 var(--ink-space-2);
		border: var(--ink-line-width) solid var(--ink-border);
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text);
		background: var(--ink-canvas);
		font-size: var(--ink-type-xs);
		font-weight: 650;
		cursor: pointer;
	}

	.color-picker__back:hover {
		border-color: var(--ink-accent);
		background: var(--ink-surface-hover);
	}

	.color-picker__custom-scroll {
		max-height: min(68vh, 35rem);
		overflow-y: auto;
		padding-inline: 1px;
		scrollbar-width: thin;
	}

	.color-picker__family {
		display: flex;
		min-width: 0;
		min-height: 2.25rem;
		align-items: center;
		gap: var(--ink-space-2);
		padding: var(--ink-space-1) var(--ink-space-2);
		border: var(--ink-line-width) solid transparent;
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text-muted);
		background: transparent;
		font: 600 var(--ink-type-xs) / 1 var(--ink-font-body);
		text-align: left;
		text-transform: capitalize;
		cursor: pointer;
	}

	.color-picker__family:hover {
		background: var(--ink-surface-hover);
		color: var(--ink-text);
	}

	.color-picker__family--selected {
		border-color: color-mix(in srgb, var(--ink-accent) 62%, var(--ink-border));
		color: var(--ink-text);
		background: color-mix(in srgb, var(--ink-accent) 14%, var(--ink-surface-raised));
	}

	.color-picker__family-dot {
		width: 1.25rem;
		height: 1.25rem;
		flex: 0 0 auto;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink-shadow-color) 28%, transparent);
	}

	.color-picker__custom {
		display: grid;
		gap: var(--ink-space-1);
	}

	.color-picker__hex-label {
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
	}

	.color-picker__hex-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--ink-space-2);
	}

	.color-picker__hex-input {
		min-width: 0;
		min-height: var(--ink-control-height);
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
		min-height: var(--ink-control-height);
		padding-inline: var(--ink-space-3);
		border: var(--ink-line-width) solid var(--ink-border-strong);
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-on-accent);
		background: var(--ink-accent);
		font-size: var(--ink-type-xs);
		font-weight: 700;
		cursor: pointer;
	}

	.color-picker__apply:hover {
		background: var(--ink-accent-hover);
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
		.color-picker__swatch {
			width: 2.75rem;
			height: 2.75rem;
		}

		.color-picker__family {
			min-height: 2.75rem;
		}
	}

	@media (max-width: 420px) {
		.color-picker__panel--custom {
			width: min(27rem, calc(100vw - 1rem));
		}

		.color-picker__family-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.color-picker__trigger,
		.color-picker__swatch,
		.color-picker__custom-action {
			transition: none;
		}
	}
</style>
