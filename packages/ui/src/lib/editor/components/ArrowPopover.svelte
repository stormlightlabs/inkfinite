<script lang="ts">
	import type { Store } from '@inkfinite/core';
	import {
		disconnectSelectedArrowEndpoints,
		getArrowInspectorState,
		setSelectedArrowHead,
		setSelectedArrowLabel,
		setSelectedArrowRouting,
		setSelectedArrowStrokeWidth
	} from '@inkfinite/core';
	import { executeEditorStateCommand } from '../commands';
	import { untrack } from 'svelte';

	type Props = { store: Store; disabled?: boolean };
	type ArrowHandle = 'start' | 'end';

	let { store, disabled = false }: Props = $props();

	let isOpen = $state(false);
	let popoverEl = $state<HTMLDivElement | null>(null);
	let buttonEl = $state<HTMLButtonElement | null>(null);
	let startHeadEl = $state<HTMLInputElement | null>(null);
	let endHeadEl = $state<HTMLInputElement | null>(null);
	let restoreFocus = false;
	let menuPosition = $state({ left: 8, top: 8 });
	let editorState = $state<import('@inkfinite/core').EditorState>(
		untrack(() => store.getState())
	);
	let arrowState = $derived(getArrowInspectorState(editorState));
	let selectedArrows = $derived(arrowState.arrows);
	let routingKind = $derived(arrowState.routingKind);
	let labelState = $derived(arrowState.label);
	let strokeWidthState = $derived(arrowState.strokeWidth);
	let startHeadState = $derived(arrowState.startHead);
	let endHeadState = $derived(arrowState.endHead);
	let startConnectionState = $derived(arrowState.startConnection);
	let endConnectionState = $derived(arrowState.endConnection);

	$effect(() => {
		const unsubscribe = store.subscribe((state) => {
			editorState = state;
		});
		return () => unsubscribe();
	});

	$effect(() => {
		if (startHeadEl) {
			startHeadEl.checked = startHeadState.value;
			startHeadEl.indeterminate = startHeadState.mixed;
		}
		if (endHeadEl) {
			endHeadEl.checked = endHeadState.value;
			endHeadEl.indeterminate = endHeadState.mixed;
		}
	});

	$effect(() => {
		if (!isOpen) {
			if (restoreFocus) {
				restoreFocus = false;
				queueMicrotask(() => buttonEl?.focus());
			}
			return;
		}

		if (!popoverEl || !buttonEl || typeof document === 'undefined') return;
		const menu = popoverEl;
		const trigger = buttonEl;

		queueMicrotask(() => {
			const triggerBounds = trigger.getBoundingClientRect();
			const menuBounds = menu.getBoundingClientRect();
			const gutter = 8;
			const preferredTop = triggerBounds.bottom + gutter;
			const top =
				preferredTop + menuBounds.height <= window.innerHeight - gutter
					? preferredTop
					: Math.max(gutter, triggerBounds.top - menuBounds.height - gutter);
			const left = Math.max(
				gutter,
				Math.min(triggerBounds.left, window.innerWidth - menuBounds.width - gutter)
			);
			menuPosition = { left, top };
			menu.querySelector<HTMLElement>('button, input')?.focus();
		});

		function handlePointerDown(event: PointerEvent) {
			const target = event.target as Node | null;
			if (target && !menu.contains(target) && !trigger.contains(target)) closePopover(true);
		}

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.preventDefault();
				closePopover(true);
			}
		}

		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
		};
	});

	function portal(node: HTMLElement) {
		if (typeof document !== 'undefined') document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	function openPopover() {
		if (!disabled) {
			restoreFocus = false;
			isOpen = true;
		}
	}

	function closePopover(shouldRestoreFocus = false) {
		if (!isOpen) return;
		restoreFocus = shouldRestoreFocus;
		isOpen = false;
	}

	function togglePopover() {
		if (isOpen) closePopover(true);
		else openPopover();
	}

	function setRouting(kind: 'straight' | 'curved' | 'orthogonal') {
		executeEditorStateCommand(store, 'Set arrow routing', (state) =>
			setSelectedArrowRouting(state, kind)
		);
	}

	function setStrokeWidth(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
		if (Number.isFinite(value) && value > 0) {
			executeEditorStateCommand(store, 'Set arrow stroke width', (state) =>
				setSelectedArrowStrokeWidth(state, value)
			);
		}
	}

	function setArrowHead(handle: ArrowHandle, value: boolean) {
		executeEditorStateCommand(store, `Set ${handle} arrowhead`, (state) =>
			setSelectedArrowHead(state, handle, value)
		);
	}

	function handleLabelChange(event: Event) {
		const text = (event.currentTarget as HTMLInputElement).value;
		executeEditorStateCommand(store, 'Set arrow label', (state) =>
			setSelectedArrowLabel(state, text)
		);
	}

	function disconnect(handle: ArrowHandle) {
		executeEditorStateCommand(store, `Disconnect ${handle} arrow endpoint`, (state) =>
			disconnectSelectedArrowEndpoints(state, handle)
		);
	}
</script>

<div class="arrow-popover">
	<button
		class="arrow-popover__button"
		bind:this={buttonEl}
		type="button"
		onclick={togglePopover}
		{disabled}
		aria-label="Arrow settings"
		aria-haspopup="dialog"
		aria-expanded={isOpen}>
		<span>Arrow</span>
		<span class="arrow-popover__summary">{selectedArrows.length}</span>
	</button>

	{#if isOpen}
		<div
			use:portal
			class="arrow-popover__menu"
			bind:this={popoverEl}
			style:left={`${menuPosition.left}px`}
			style:top={`${menuPosition.top}px`}
			role="dialog"
			aria-label="Arrow settings">
			<section class="arrow-popover__section">
				<h3>Stroke</h3>
				<label class="arrow-popover__field">
					<span>Width</span>
					<input
						type="number"
						min="0.5"
						step="0.5"
						value={strokeWidthState.mixed ? '' : strokeWidthState.value}
						placeholder={strokeWidthState.mixed ? 'Mixed' : undefined}
						onchange={setStrokeWidth}
						aria-label="Arrow stroke width" />
				</label>
				<div class="arrow-popover__routing">
					<span>Routing</span>
					<div class="arrow-popover__routing-buttons">
						<button
							class:arrow-popover__routing-btn--active={routingKind === 'straight'}
							type="button"
							onclick={() => setRouting('straight')}
							aria-label="Straight routing"
							aria-pressed={routingKind === 'straight'}>
							Straight
						</button>
						<button
							class:arrow-popover__routing-btn--active={routingKind === 'curved'}
							type="button"
							onclick={() => setRouting('curved')}
							aria-label="Curved routing"
							aria-pressed={routingKind === 'curved'}>
							Curved
						</button>
						<button
							class:arrow-popover__routing-btn--active={routingKind === 'orthogonal'}
							type="button"
							onclick={() => setRouting('orthogonal')}
							aria-label="Orthogonal routing"
							aria-pressed={routingKind === 'orthogonal'}>
							Orthogonal
						</button>
					</div>
				</div>
			</section>

			<section class="arrow-popover__section">
				<h3>Endpoints</h3>
				<label class="arrow-popover__check">
					<input
						bind:this={startHeadEl}
						type="checkbox"
						checked={startHeadState.value}
						onchange={(event) =>
							setArrowHead(
								'start',
								(event.currentTarget as HTMLInputElement).checked
							)}
						aria-label="Start arrowhead" />
					<span>Start arrowhead</span>
				</label>
				<label class="arrow-popover__check">
					<input
						bind:this={endHeadEl}
						type="checkbox"
						checked={endHeadState.value}
						onchange={(event) =>
							setArrowHead('end', (event.currentTarget as HTMLInputElement).checked)}
						aria-label="End arrowhead" />
					<span>End arrowhead</span>
				</label>
			</section>

			<section class="arrow-popover__section">
				<h3>Connections</h3>
				<div class="arrow-popover__connection">
					<div>
						<strong>Start</strong>
						<span
							>{startConnectionState.mixed
								? 'Mixed'
								: startConnectionState.connected
									? 'Connected'
									: 'Free'}</span>
					</div>
					{#if startConnectionState.anyConnected}
						<button
							type="button"
							onclick={() => disconnect('start')}
							aria-label="Disconnect start connection">Disconnect</button>
					{/if}
				</div>
				<div class="arrow-popover__connection">
					<div>
						<strong>End</strong>
						<span
							>{endConnectionState.mixed
								? 'Mixed'
								: endConnectionState.connected
									? 'Connected'
									: 'Free'}</span>
					</div>
					{#if endConnectionState.anyConnected}
						<button
							type="button"
							onclick={() => disconnect('end')}
							aria-label="Disconnect end connection">Disconnect</button>
					{/if}
				</div>
			</section>

			<section class="arrow-popover__section">
				<label class="arrow-popover__field arrow-popover__label-field">
					<span>Label</span>
					<input
						type="text"
						value={labelState.mixed ? '' : labelState.value}
						placeholder={labelState.mixed ? 'Mixed labels' : 'Optional label'}
						onchange={handleLabelChange}
						aria-label="Arrow label" />
				</label>
			</section>
		</div>
	{/if}
</div>

<style>
	.arrow-popover {
		position: relative;
		display: inline-flex;
	}

	.arrow-popover__button,
	.arrow-popover__routing-buttons button,
	.arrow-popover__connection button {
		border: 1px solid var(--ink-border);
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text);
		background: var(--ink-canvas);
		font: 650 var(--ink-type-xs) / 1 var(--ink-font-body);
		cursor: pointer;
	}

	.arrow-popover__button {
		display: inline-flex;
		min-height: var(--ink-control-height);
		align-items: center;
		gap: var(--ink-space-2);
		padding: 0 var(--ink-space-3);
	}

	.arrow-popover__button:hover:not(:disabled),
	.arrow-popover__routing-buttons button:hover,
	.arrow-popover__connection button:hover {
		border-color: var(--ink-accent);
		background: var(--ink-surface-hover);
	}

	.arrow-popover__button:focus-visible,
	.arrow-popover__routing-buttons button:focus-visible,
	.arrow-popover__connection button:focus-visible,
	.arrow-popover__field input:focus-visible,
	.arrow-popover__check input:focus-visible {
		outline: 3px solid var(--ink-focus);
		outline-offset: 2px;
	}

	.arrow-popover__button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.arrow-popover__summary {
		color: var(--ink-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.arrow-popover__menu {
		position: fixed;
		top: 8px;
		left: 8px;
		z-index: 1000;
		display: grid;
		width: min(22rem, calc(100vw - 2rem));
		max-height: min(34rem, calc(100vh - 8rem));
		gap: var(--ink-space-3);
		overflow: auto;
		padding: var(--ink-space-3);
		border: 1px solid var(--ink-border);
		border-radius: var(--ink-radius-panel-small);
		color: var(--ink-text);
		background: var(--ink-surface-raised);
		box-shadow: var(--ink-shadow-toolbar);
	}

	.arrow-popover__section {
		display: grid;
		gap: var(--ink-space-2);
	}

	.arrow-popover__section + .arrow-popover__section {
		padding-top: var(--ink-space-3);
		border-top: 1px solid color-mix(in srgb, var(--ink-border) 60%, transparent);
	}

	.arrow-popover__section h3,
	.arrow-popover__routing > span {
		margin: 0;
		color: var(--ink-text-muted);
		font: 700 var(--ink-type-xs) / 1.1 var(--ink-font-body);
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.arrow-popover__field {
		display: grid;
		grid-template-columns: 4.5rem minmax(0, 1fr);
		align-items: center;
		gap: var(--ink-space-2);
		color: var(--ink-text-muted);
		font: 650 var(--ink-type-xs) / 1 var(--ink-font-body);
	}

	.arrow-popover__field input {
		box-sizing: border-box;
		width: 100%;
		min-height: var(--ink-control-height);
		padding: 0 var(--ink-space-2);
		border: 1px solid var(--ink-border);
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text);
		background: var(--ink-canvas);
		font: 600 var(--ink-type-xs) / 1 var(--ink-font-body);
	}

	.arrow-popover__field input::placeholder {
		color: var(--ink-text-muted);
	}

	.arrow-popover__routing {
		display: grid;
		gap: var(--ink-space-2);
	}

	.arrow-popover__routing-buttons {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--ink-space-1);
	}

	.arrow-popover__routing-buttons button {
		min-height: 2.5rem;
		padding: 0 var(--ink-space-1);
	}

	.arrow-popover__routing-btn--active {
		border-color: var(--ink-accent) !important;
		color: var(--ink-on-accent) !important;
		background: var(--ink-accent) !important;
	}

	.arrow-popover__check {
		display: flex;
		min-height: var(--ink-control-height);
		align-items: center;
		gap: var(--ink-space-2);
		color: var(--ink-text);
		font: 600 var(--ink-type-xs) / 1.2 var(--ink-font-body);
		cursor: pointer;
	}

	.arrow-popover__check input {
		width: 1rem;
		height: 1rem;
		margin: 0;
		accent-color: var(--ink-accent);
	}

	.arrow-popover__connection {
		display: flex;
		min-height: 2.5rem;
		align-items: center;
		justify-content: space-between;
		gap: var(--ink-space-2);
	}

	.arrow-popover__connection > div {
		display: grid;
		gap: 2px;
	}

	.arrow-popover__connection strong {
		color: var(--ink-text);
		font-size: var(--ink-type-xs);
	}

	.arrow-popover__connection span {
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
	}

	.arrow-popover__connection button {
		min-height: 2.25rem;
		padding: 0 var(--ink-space-2);
		font-size: var(--ink-type-xs);
	}
</style>
