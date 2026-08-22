<script lang="ts">
	import type { ArrowShape, EditorState as EditorStateType, Store } from '@inkfinite/core';
	import { EditorState, getSelectedShapes, SnapshotCommand } from '@inkfinite/core';

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
	let editorState = $derived<EditorStateType>(store.getState());

	let selectedArrows = $derived<ArrowShape[]>(
		getSelectedShapes(editorState).filter(
			(shape): shape is ArrowShape => shape.type === 'arrow'
		)
	);

	let routingKind = $derived.by((): 'straight' | 'curved' | 'orthogonal' | 'mixed' => {
		if (selectedArrows.length === 0) return 'straight';
		const first = selectedArrows[0].props.routing?.kind ?? 'straight';
		return selectedArrows.every((arrow) => (arrow.props.routing?.kind ?? 'straight') === first)
			? first
			: 'mixed';
	});

	let labelState = $derived.by(() => {
		const shared = getSharedValue(
			selectedArrows.map((arrow) => arrow.props.label?.text ?? '')
		);
		return { value: shared ?? '', mixed: selectedArrows.length > 1 && shared === null };
	});
	let strokeWidthState = $derived.by(() => {
		const shared = getSharedValue(selectedArrows.map((arrow) => arrow.props.style.width));
		return { value: shared ?? 2, mixed: selectedArrows.length > 1 && shared === null };
	});
	let startHeadState = $derived(
		getBooleanState(selectedArrows.map((arrow) => arrow.props.style.headStart === true))
	);
	let endHeadState = $derived(
		getBooleanState(selectedArrows.map((arrow) => arrow.props.style.headEnd !== false))
	);
	let startConnectionState = $derived(getConnectionState('start'));
	let endConnectionState = $derived(getConnectionState('end'));

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

	function getSharedValue<T>(values: T[]): T | null {
		if (values.length === 0) return null;
		const first = values[0];
		return values.every((value) => Object.is(value, first)) ? first : null;
	}

	function getBooleanState(values: boolean[]) {
		const shared = getSharedValue(values);
		return { value: shared ?? false, mixed: values.length > 1 && shared === null };
	}

	function getConnectionState(handle: ArrowHandle) {
		const connected = selectedArrows.map((arrow) => arrow.props[handle].kind === 'bound');
		const shared = getSharedValue(connected);
		return {
			connected: shared === true,
			mixed: connected.length > 1 && shared === null,
			anyConnected: connected.some(Boolean)
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

	function updateSelectedArrows(label: string, update: (arrow: ArrowShape) => ArrowShape) {
		const state = store.getState();
		const arrows = getSelectedShapes(state).filter(
			(shape): shape is ArrowShape => shape.type === 'arrow'
		);
		if (arrows.length === 0) return;
		const before = EditorState.clone(state);
		const shapes = { ...state.doc.shapes };
		for (const arrow of arrows) shapes[arrow.id] = update(arrow);
		store.executeCommand(
			new SnapshotCommand(label, 'doc', before, { ...state, doc: { ...state.doc, shapes } })
		);
	}

	function setRouting(kind: 'straight' | 'curved' | 'orthogonal') {
		updateSelectedArrows('Set arrow routing', (arrow) => ({
			...arrow,
			props: { ...arrow.props, routing: { ...arrow.props.routing, kind } }
		}));
	}

	function setStrokeWidth(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
		if (!Number.isFinite(value) || value <= 0) return;
		updateSelectedArrows('Set arrow stroke width', (arrow) => ({
			...arrow,
			props: { ...arrow.props, style: { ...arrow.props.style, width: value } }
		}));
	}

	function setArrowHead(handle: ArrowHandle, value: boolean) {
		updateSelectedArrows(`Set ${handle} arrowhead`, (arrow) => ({
			...arrow,
			props: {
				...arrow.props,
				style: {
					...arrow.props.style,
					[handle === 'start' ? 'headStart' : 'headEnd']: value
				}
			}
		}));
	}

	function handleLabelChange(event: Event) {
		const text = (event.currentTarget as HTMLInputElement).value;
		updateSelectedArrows('Set arrow label', (arrow) => ({
			...arrow,
			props: {
				...arrow.props,
				label: text.trim()
					? {
							text,
							align: arrow.props.label?.align ?? 'center',
							offset: arrow.props.label?.offset ?? 0
						}
					: undefined
			}
		}));
	}

	function disconnect(handle: ArrowHandle) {
		const state = store.getState();
		const arrows = getSelectedShapes(state).filter(
			(shape): shape is ArrowShape => shape.type === 'arrow'
		);
		if (arrows.length === 0) return;
		const before = EditorState.clone(state);
		const shapes = { ...state.doc.shapes };
		const bindings = { ...state.doc.bindings };
		let changed = false;
		for (const arrow of arrows) {
			const endpoint = arrow.props[handle];
			if (endpoint.kind !== 'bound') continue;
			if (endpoint.bindingId) delete bindings[endpoint.bindingId];
			shapes[arrow.id] = { ...arrow, props: { ...arrow.props, [handle]: { kind: 'free' } } };
			changed = true;
		}
		if (!changed) return;
		store.executeCommand(
			new SnapshotCommand(`Disconnect ${handle} arrow endpoint`, 'doc', before, {
				...state,
				doc: { ...state.doc, shapes, bindings }
			})
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
		border-radius: var(--ink-radius-wobbly-small);
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
		border-radius: var(--ink-radius-wobbly-small);
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
