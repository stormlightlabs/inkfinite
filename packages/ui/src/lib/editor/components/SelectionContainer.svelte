<script lang="ts">
	import type { Store } from '@inkfinite/core';
	import { Button, Dialog, Icon } from '../../index';
	import { executeEditorStateCommand } from '../commands';
	import { setSelectedCardFields, setSelectedReferenceFields } from '@inkfinite/core';
	import type { SelectionInspectorState } from '../selection-inspector';

	type Props = {
		store: Store;
		selection: SelectionInspectorState;
		onEnterFrame?: (frameId: string) => void;
		onFitSelection?: () => void;
	};
	let { store, selection, onEnterFrame, onFitSelection }: Props = $props();
	let cardOpen = $state(false);

	function updateCard(event: Event, field: 'title' | 'body') {
		const value = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
		executeEditorStateCommand(store, `Set card ${field}`, (state) =>
			setSelectedCardFields(state, { [field]: value })
		);
	}

	function updateReference(fields: Parameters<typeof setSelectedReferenceFields>[1]) {
		executeEditorStateCommand(store, 'Update reference', (state) =>
			setSelectedReferenceFields(state, fields)
		);
	}
</script>

{#if selection.referenceTarget}
	<section class="selection-controls__section" aria-labelledby="selection-reference-label">
		<h2 id="selection-reference-label">Reference</h2>
		<div class="selection-controls__card-fields">
			<label class="selection-controls__field"
				><span>Type</span><select
					value={selection.referenceTarget.props.referenceType}
					onchange={(event) =>
						updateReference({
							referenceType: (event.currentTarget as HTMLSelectElement).value as
								| 'url'
								| 'file'
								| 'page'
						})}
					aria-label="Reference type"
					><option value="url">URL</option><option value="file">File</option><option
						value="page">Page</option
					></select
				></label>
			{#if selection.referenceTarget.props.referenceType === 'page'}
				<label class="selection-controls__field selection-controls__field--wide"
					><span>Target page</span><select
						value={selection.referenceTarget.props.value}
						onchange={(event) =>
							updateReference({
								value: (event.currentTarget as HTMLSelectElement).value
							})}
						aria-label="Reference target"
						>{#each Object.values(store.getState().doc.pages) as page}<option
								value={page.id}>{page.name}</option
							>{/each}</select
					></label>
			{:else}
				<label class="selection-controls__field selection-controls__field--wide"
					><span>Target</span><input
						type="text"
						value={selection.referenceTarget.props.value}
						onchange={(event) =>
							updateReference({
								value: (event.currentTarget as HTMLInputElement).value
							})}
						aria-label="Reference target" /></label>
			{/if}
			<label class="selection-controls__field selection-controls__field--wide"
				><span>Label</span><input
					type="text"
					value={selection.referenceTarget.props.label ?? ''}
					onchange={(event) =>
						updateReference({
							label: (event.currentTarget as HTMLInputElement).value || undefined
						})}
					aria-label="Reference label" /></label>
		</div>
	</section>
{/if}

{#if selection.cardTarget && selection.cardMetadata}
	<section
		class="selection-controls__section selection-controls__section--card"
		aria-labelledby="selection-card-label">
		<h2 id="selection-card-label">Card</h2>
		<div class="selection-controls__card-summary">
			<span title={selection.cardMetadata.title ?? 'Untitled card'}
				>{selection.cardMetadata.title ?? 'Untitled card'}</span
			><Button size="small" onclick={() => (cardOpen = true)}>Edit card</Button>
		</div>
	</section>
{/if}

{#if cardOpen && selection.cardTarget && selection.cardMetadata}
	<Dialog bind:open={cardOpen} title="Card details" class="card-details-dialog">
		<div class="selection-controls__card-dialog">
			<header class="selection-controls__metadata-header">
				<div>
					<span>Selected object</span>
					<h2>Card details</h2>
				</div>
				<Button size="small" onclick={() => (cardOpen = false)}>Done</Button>
			</header>
			<div class="selection-controls__card-fields">
				<label class="selection-controls__field selection-controls__field--wide"
					><span>Title</span><input
						type="text"
						value={selection.cardMetadata.title ?? ''}
						onchange={(event) => updateCard(event, 'title')}
						aria-label="Card title" /></label>
				<label class="selection-controls__field selection-controls__field--wide"
					><span>Body</span><textarea
						value={selection.cardMetadata.body ?? ''}
						onchange={(event) => updateCard(event, 'body')}
						aria-label="Card body"></textarea
					></label>
			</div>
		</div>
	</Dialog>
{/if}

{#if selection.frameTarget}
	<section class="selection-controls__section" aria-labelledby="selection-frame-label">
		<h2 id="selection-frame-label">Frame</h2>
		<div class="selection-controls__actions">
			<button
				class="selection-controls__action"
				type="button"
				onclick={() => onEnterFrame?.(selection.frameTarget!.id)}
				aria-label="Enter selected frame"
				><Icon name="layers" size={15} /><span>Enter</span></button>
			<button
				class="selection-controls__action"
				type="button"
				onclick={() => onFitSelection?.()}
				aria-label="Fit selected frame"
				><Icon name="expand" size={15} /><span>Fit</span></button>
		</div>
	</section>
{/if}
