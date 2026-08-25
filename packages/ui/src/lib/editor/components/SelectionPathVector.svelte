<script lang="ts">
	import type { Store } from '@inkfinite/core';
	import { executeEditorStateCommand, executeSelectionCommand } from '../commands';
	import { detachSelectedTextPath, setSelectedTextPathField } from '@inkfinite/core';
	import type { SelectionInspectorState } from '../selection-inspector';
	import ArrowPopover from './ArrowPopover.svelte';

	let { store, selection }: { store: Store; selection: SelectionInspectorState } = $props();

	function setTextPathField(field: 'align' | 'side' | 'direction', event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		executeEditorStateCommand(store, `Set text path ${field}`, (state) =>
			setSelectedTextPathField(state, field, value)
		);
	}
</script>

{#if selection.textPathSelectionAvailable}
	<section
		class="selection-controls__section"
		aria-labelledby="selection-text-path-attach-label">
		<h2 id="selection-text-path-attach-label">Text on path</h2>
		<div class="selection-controls__actions">
			<button
				class="selection-controls__action"
				type="button"
				onclick={() => executeSelectionCommand(store, 'attach-text-path')}
				>Attach text to path</button>
		</div>
	</section>
{/if}

{#if selection.textPathTarget && selection.textPathAttachment}
	<section class="selection-controls__section" aria-labelledby="selection-text-path-label">
		<h2 id="selection-text-path-label">Text on path</h2>
		<div class="selection-controls__fields">
			<label class="selection-controls__field"
				><span>Align</span><select
					value={selection.textPathAttachment.align}
					onchange={(event) => setTextPathField('align', event)}
					aria-label="Text path alignment"
					><option value="start">Start</option><option value="center">Center</option
					><option value="end">End</option></select
				></label>
			<label class="selection-controls__field"
				><span>Side</span><select
					value={selection.textPathAttachment.side}
					onchange={(event) => setTextPathField('side', event)}
					aria-label="Text path side"
					><option value="left">Left</option><option value="right">Right</option></select
				></label>
			<label class="selection-controls__field"
				><span>Direction</span><select
					value={selection.textPathAttachment.direction}
					onchange={(event) => setTextPathField('direction', event)}
					aria-label="Text path direction"
					><option value="forward">Forward</option><option value="reverse"
						>Reverse path</option
					></select
				></label>
		</div>
		<div class="selection-controls__actions">
			<button
				class="selection-controls__action"
				type="button"
				onclick={() =>
					executeEditorStateCommand(
						store,
						'Detach text from path',
						detachSelectedTextPath
					)}>Detach text</button>
		</div>
	</section>
{/if}

{#if selection.arrowTargets.length > 0}
	<section
		class="selection-controls__section selection-controls__section--arrow"
		aria-labelledby="selection-arrow-label">
		<h2 id="selection-arrow-label">Arrow</h2>
		<ArrowPopover {store} />
	</section>
{/if}

{#if selection.clipSelectionAvailable || selection.selectedClipCount > 0}
	<section class="selection-controls__section" aria-labelledby="selection-clip-label">
		<h2 id="selection-clip-label">Clipping</h2>
		<div class="selection-controls__actions">
			{#if selection.clipSelectionAvailable}<button
					class="selection-controls__action"
					type="button"
					onclick={() => executeSelectionCommand(store, 'clip-selection')}
					>Use path as clip</button
				>{/if}
			{#if selection.selectedClipCount > 0}<button
					class="selection-controls__action"
					type="button"
					onclick={() => executeSelectionCommand(store, 'remove-clip')}
					>Remove clip</button
				>{/if}
		</div>
	</section>
{/if}

{#if selection.booleanPathSelection}
	<section class="selection-controls__section" aria-labelledby="selection-boolean-label">
		<h2 id="selection-boolean-label">Boolean paths</h2>
		<div class="selection-controls__actions">
			<button
				class="selection-controls__action"
				type="button"
				onclick={() => executeSelectionCommand(store, 'boolean-union')}>Union</button>
			<button
				class="selection-controls__action"
				type="button"
				onclick={() => executeSelectionCommand(store, 'boolean-intersection')}
				>Intersect</button>
			<button
				class="selection-controls__action"
				type="button"
				onclick={() => executeSelectionCommand(store, 'boolean-difference')}
				>Subtract</button>
			<button
				class="selection-controls__action"
				type="button"
				onclick={() => executeSelectionCommand(store, 'boolean-exclusion')}
				>Exclude</button>
		</div>
	</section>
{/if}
