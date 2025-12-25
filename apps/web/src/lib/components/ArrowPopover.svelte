<script lang="ts">
	import type { ArrowShape, Store } from 'inkfinite-core';
	import { EditorState, getSelectedShapes, SnapshotCommand } from 'inkfinite-core';

	type Props = { store: Store; disabled?: boolean };

	let { store, disabled = false }: Props = $props();

	let isOpen = $state(false);
	let popoverEl = $state<HTMLDivElement | null>(null);
	let buttonEl = $state<HTMLButtonElement | null>(null);

	let editorState = $derived(store.getState());

	let selectedArrows = $derived<ArrowShape[]>(
		getSelectedShapes(editorState).filter((s): s is ArrowShape => s.type === 'arrow')
	);

	let routingKind = $derived<'straight' | 'orthogonal' | 'mixed'>(
		(() => {
			if (selectedArrows.length === 0) return 'straight';
			const first = selectedArrows[0].props.routing?.kind ?? 'straight';
			const allSame = selectedArrows.every(
				(arrow) => (arrow.props.routing?.kind ?? 'straight') === first
			);
			return allSame ? first : 'mixed';
		})()
	);

	let labelText = $derived<string>(
		(() => {
			if (selectedArrows.length === 0) return '';
			if (selectedArrows.length === 1) return selectedArrows[0].props.label?.text ?? '';
			const first = selectedArrows[0].props.label?.text ?? '';
			const allSame = selectedArrows.every((arrow) => (arrow.props.label?.text ?? '') === first);
			return allSame ? first : '';
		})()
	);

	$effect(() => {
		const unsubscribe = store.subscribe((state) => {
			editorState = state;
		});
		return () => unsubscribe();
	});

	$effect(() => {
		if (!isOpen || typeof document === 'undefined') {
			return;
		}
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!target) {
				return;
			}
			if (popoverEl?.contains(target) || buttonEl?.contains(target)) {
				return;
			}
			isOpen = false;
		};

		document.addEventListener('pointerdown', handlePointerDown);
		return () => document.removeEventListener('pointerdown', handlePointerDown);
	});

	function togglePopover() {
		if (!disabled) {
			isOpen = !isOpen;
		}
	}

	function setRouting(kind: 'straight' | 'orthogonal') {
		const state = store.getState();
		const arrows = getSelectedShapes(state).filter((s): s is ArrowShape => s.type === 'arrow');
		if (arrows.length === 0) return;

		const before = EditorState.clone(state);
		const newShapes = { ...state.doc.shapes };

		for (const arrow of arrows) {
			const updated: ArrowShape = { ...arrow, props: { ...arrow.props, routing: { kind } } };
			newShapes[arrow.id] = updated;
		}

		const after = { ...state, doc: { ...state.doc, shapes: newShapes } };
		const command = new SnapshotCommand(
			'Set arrow routing',
			'doc',
			before,
			EditorState.clone(after)
		);
		store.executeCommand(command);
	}

	function handleLabelChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const text = input.value;
		const state = store.getState();
		const arrows = getSelectedShapes(state).filter((s): s is ArrowShape => s.type === 'arrow');
		if (arrows.length === 0) return;

		const before = EditorState.clone(state);
		const newShapes = { ...state.doc.shapes };

		for (const arrow of arrows) {
			const updated: ArrowShape = {
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
			};
			newShapes[arrow.id] = updated;
		}

		const after = { ...state, doc: { ...state.doc, shapes: newShapes } };
		const command = new SnapshotCommand(
			'Set arrow label',
			'doc',
			before,
			EditorState.clone(after)
		);
		store.executeCommand(command);
	}
</script>

<div class="arrow-popover">
	<button
		class="arrow-popover__button"
		bind:this={buttonEl}
		onclick={togglePopover}
		{disabled}
		aria-label="Arrow settings"
		aria-haspopup="true"
		aria-expanded={isOpen}>
		Arrow
	</button>

	{#if isOpen}
		<div
			class="arrow-popover__menu"
			bind:this={popoverEl}
			role="dialog"
			aria-label="Arrow settings">
			<div class="arrow-popover__section">
				<div class="arrow-popover__label">Routing</div>
				<div class="arrow-popover__routing-buttons">
					<button
						class="arrow-popover__routing-btn"
						class:arrow-popover__routing-btn--active={routingKind === 'straight'}
						onclick={() => setRouting('straight')}
						aria-label="Straight routing"
						aria-pressed={routingKind === 'straight'}>
						Straight
					</button>
					<button
						class="arrow-popover__routing-btn"
						class:arrow-popover__routing-btn--active={routingKind === 'orthogonal'}
						onclick={() => setRouting('orthogonal')}
						aria-label="Orthogonal routing"
						aria-pressed={routingKind === 'orthogonal'}>
						Orthogonal
					</button>
				</div>
			</div>

			<div class="arrow-popover__divider"></div>

			<div class="arrow-popover__section">
				<label for="arrow-label">
					<span class="arrow-popover__label">Label</span>
				</label>
				<input
					id="arrow-label"
					type="text"
					class="arrow-popover__input"
					value={labelText}
					onchange={handleLabelChange}
					placeholder="Enter label..."
					aria-label="Arrow label" />
			</div>
		</div>
	{/if}
</div>

<style>
	.arrow-popover {
		position: relative;
	}

	.arrow-popover__button {
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		padding: 8px 12px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 13px;
		min-width: 60px;
	}

	.arrow-popover__button:hover:not(:disabled) {
		background: var(--surface-elevated);
	}

	.arrow-popover__button:focus {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.arrow-popover__button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.arrow-popover__menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 6px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		z-index: 10;
		min-width: 200px;
	}

	.arrow-popover__section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.arrow-popover__label {
		font-size: 12px;
		font-weight: 500;
		color: var(--text);
	}

	.arrow-popover__routing-buttons {
		display: flex;
		gap: 6px;
	}

	.arrow-popover__routing-btn {
		flex: 1;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		padding: 6px 12px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		transition: all 0.15s;
	}

	.arrow-popover__routing-btn:hover {
		background: var(--surface-elevated);
	}

	.arrow-popover__routing-btn:focus {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.arrow-popover__routing-btn--active {
		background: var(--accent);
		color: var(--surface);
		border-color: var(--accent);
	}

	.arrow-popover__input {
		width: 100%;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		padding: 6px 8px;
		border-radius: 4px;
		font-size: 13px;
	}

	.arrow-popover__input:focus {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.arrow-popover__input::placeholder {
		color: var(--text-muted);
	}

	.arrow-popover__divider {
		height: 1px;
		background: var(--border);
	}
</style>
