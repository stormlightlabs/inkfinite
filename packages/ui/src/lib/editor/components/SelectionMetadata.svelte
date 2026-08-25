<script lang="ts">
	import type { Store } from '@inkfinite/core';
	import { Button, Dialog } from '../../index';
	import { executeEditorStateCommand } from '../commands';
	import { setSelectedMetadata } from '@inkfinite/core';
	import type { SelectionInspectorState } from '../selection-inspector';

	let { store, selection }: { store: Store; selection: SelectionInspectorState } = $props();
	let open = $state(false);

	function updateText(event: Event, field: 'name' | 'role' | 'description' | 'source' | 'link') {
		const value = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
		executeEditorStateCommand(store, `Set ${field}`, (state) =>
			setSelectedMetadata(state, { [field]: value || null })
		);
	}

	function updateTags(event: Event) {
		const tags = (event.currentTarget as HTMLInputElement).value
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean);
		executeEditorStateCommand(store, 'Set object tags', (state) =>
			setSelectedMetadata(state, { tags })
		);
	}

	function updateCustomMetadata(event: Event) {
		try {
			const value = JSON.parse(
				(event.currentTarget as HTMLTextAreaElement).value
			) as unknown;
			if (!value || typeof value !== 'object' || Array.isArray(value)) return;
			executeEditorStateCommand(store, 'Set object metadata', (state) =>
				setSelectedMetadata(state, { customMetadata: value as Record<string, unknown> })
			);
		} catch {
			// Leave the previous value until the JSON is valid.
		}
	}
</script>

{#if selection.selectionCount > 0}
	<section
		class="selection-controls__section selection-controls__section--metadata"
		aria-labelledby="selection-metadata-label">
		<h2 id="selection-metadata-label">Object metadata</h2>
		<div class="selection-controls__metadata-summary">
			<span
				class="selection-controls__metadata-name"
				title={selection.semanticNameState.mixed
					? 'Mixed names'
					: selection.semanticNameState.value || 'Unnamed object'}
				>{selection.semanticNameState.mixed
					? 'Mixed names'
					: selection.semanticNameState.value || 'Unnamed object'}</span>
			<Button size="small" onclick={() => (open = true)}>Edit metadata</Button>
		</div>
	</section>
{/if}

{#if open && selection.selectionCount > 0}
	<Dialog bind:open title="Object metadata" class="object-metadata-dialog">
		<div class="selection-controls__metadata-drawer">
			<header class="selection-controls__metadata-header">
				<div>
					<span>Selected object</span>
					<h2>Object metadata</h2>
				</div>
				<Button size="small" onclick={() => (open = false)}>Done</Button>
			</header>
			<div class="selection-controls__metadata-fields">
				{@render Field(
					'Name',
					selection.semanticNameState,
					'Object name',
					'Object name',
					(event) => updateText(event, 'name')
				)}
				{@render Field(
					'Role',
					selection.semanticRoleState,
					'Semantic role',
					'Object role',
					(event) => updateText(event, 'role')
				)}
				{@render Field(
					'Tags',
					selection.semanticTagsState,
					'Comma-separated tags',
					'Object tags',
					updateTags,
					true
				)}
				{@render TextareaField(
					'Description',
					selection.semanticDescriptionState,
					'Description',
					'Object description',
					(event) => updateText(event, 'description'),
					true
				)}
				{@render Field(
					'Source',
					selection.semanticSourceState,
					'Citation or file',
					'Object source',
					(event) => updateText(event, 'source')
				)}
				{@render Field(
					'Link',
					selection.semanticLinkState,
					'https://',
					'Object link',
					(event) => updateText(event, 'link'),
					false,
					'url'
				)}
				{@render TextareaField(
					'Structured metadata',
					selection.semanticCustomMetadataState,
					'{ }',
					'Object structured metadata',
					updateCustomMetadata,
					true
				)}
			</div>
			{#if selection.semanticTarget?.provenance}
				<dl class="selection-controls__provenance" aria-label="Object provenance">
					<div>
						<dt>Actor</dt>
						<dd>{selection.semanticTarget.provenance.actorId}</dd>
					</div>
					<div>
						<dt>Origin</dt>
						<dd>{selection.semanticTarget.provenance.origin}</dd>
					</div>
					<div>
						<dt>Recorded</dt>
						<dd>{selection.semanticTarget.provenance.timestamp}</dd>
					</div>
					{#if selection.semanticTarget.provenance.source}<div>
							<dt>Provenance source</dt>
							<dd>{selection.semanticTarget.provenance.source}</dd>
						</div>{/if}
				</dl>
			{/if}
		</div>
	</Dialog>
{/if}

{#snippet Field(
	label: string,
	value: { value: string; mixed: boolean },
	placeholder: string,
	ariaLabel: string,
	onchange: (event: Event) => void,
	wide = false,
	type = 'text'
)}
	<label class:selection-controls__field--wide={wide} class="selection-controls__field">
		<span>{label}</span>
		<input
			{type}
			value={value.mixed ? '' : value.value}
			placeholder={value.mixed ? 'Mixed' : placeholder}
			{onchange}
			aria-label={ariaLabel} />
	</label>
{/snippet}

{#snippet TextareaField(
	label: string,
	value: { value: string; mixed: boolean },
	placeholder: string,
	ariaLabel: string,
	onchange: (event: Event) => void,
	wide = false
)}
	<label class:selection-controls__field--wide={wide} class="selection-controls__field">
		<span>{label}</span>
		<textarea
			value={value.mixed ? '' : value.value}
			placeholder={value.mixed ? 'Mixed' : placeholder}
			{onchange}
			aria-label={ariaLabel}></textarea>
	</label>
{/snippet}
