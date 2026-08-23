<script lang="ts">
	import type { LiveProposal, ProposalObjectPreview } from '../platform';

	let {
		proposal,
		message,
		onAccept,
		onReject
	}: {
		proposal: LiveProposal | null;
		message: string | null;
		onAccept: (operationPositions?: number[]) => Promise<void>;
		onReject: () => Promise<void>;
	} = $props();

	let selected = $state<number[]>([]);
	let busy = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		proposal?.id;
		selected = [];
		error = null;
	});

	function operationCount() {
		return proposal?.transaction.operations.length ?? 0;
	}

	function toggleOperation(position: number) {
		selected = selected.includes(position)
			? selected.filter((value) => value !== position)
			: [...selected, position].sort((left, right) => left - right);
	}

	async function accept(operationPositions?: number[]) {
		busy = true;
		error = null;
		try {
			await onAccept(operationPositions);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The proposal could not be accepted.';
		} finally {
			busy = false;
		}
	}

	async function reject() {
		busy = true;
		error = null;
		try {
			await onReject();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The proposal could not be rejected.';
		} finally {
			busy = false;
		}
	}

	function operationLabel(position: number): string {
		return proposal?.operation_previews?.[position]?.label ?? `Operation ${position + 1}`;
	}

	function geometryLabel(position: number): string {
		const bounds = proposal?.operation_previews?.[position]?.bounds ?? [];
		if (bounds.length === 0) return 'No shape geometry';
		return bounds.map((box) => `${box.x},${box.y} ${box.width}×${box.height}`).join(' → ');
	}

	function previewRecord(preview: ProposalObjectPreview) {
		return (preview.change === 'removed' ? preview.before : preview.after)?.record ?? null;
	}

	function recordValue(preview: ProposalObjectPreview, key: string): string | null {
		const record = previewRecord(preview);
		const value = record?.[key];
		return typeof value === 'string' && value.length > 0 ? value : null;
	}

	function objectLabel(preview: ProposalObjectPreview): string {
		const record = previewRecord(preview);
		if (preview.record_id.kind === 'binding') {
			const relation = recordValue(preview, 'relation_type');
			return relation ? `Relationship · ${relation}` : 'Relationship';
		}
		const metadata = record?.metadata;
		if (typeof metadata === 'object' && metadata !== null) {
			const fields = metadata as Record<string, unknown>;
			if (typeof fields.name === 'string' && fields.name) return fields.name;
			if (typeof fields.role === 'string' && fields.role) return fields.role;
		}
		return `${preview.record_id.kind} · ${preview.record_id.id}`;
	}

	function relationshipLabel(preview: ProposalObjectPreview): string | null {
		if (preview.record_id.kind !== 'binding') return null;
		const source = recordValue(preview, 'source_shape_id');
		const target = recordValue(preview, 'target_shape_id');
		if (!source || !target) return null;
		return `${source} → ${target}`;
	}

	function changeLabel(change: ProposalObjectPreview['change']): string {
		return change === 'added'
			? 'Added'
			: change === 'removed'
				? 'Removed'
				: change === 'moved'
					? 'Moved'
					: 'Modified';
	}

	function changeFields(preview: ProposalObjectPreview): string {
		if (preview.changed_fields.length === 0) return 'No field details';
		return preview.changed_fields.join(', ');
	}
</script>

{#if proposal}
	<aside class="proposal-panel" aria-label="Agent review" data-agent-occlusion>
		<div class="proposal-heading">
			<div>
				<p class="eyebrow">Agent review</p>
				<h2 id="proposal-title">{proposal.id}</h2>
			</div>
			<span class="expiry" title="Proposal expiry"
				>Review before {new Date(proposal.expires_at).toLocaleTimeString()}</span>
		</div>

		<p class="summary">
			The canvas separates additions, edits, moves, removals, and relationship changes before
			you commit them.
		</p>

		<div class="change-grid" aria-label="Proposal changes">
			<div><strong>{proposal.preview.created.length}</strong><span>added</span></div>
			<div><strong>{proposal.preview.changed.length}</strong><span>changed</span></div>
			<div><strong>{proposal.preview.deleted.length}</strong><span>removed</span></div>
			<div><strong>{proposal.affected_regions.length}</strong><span>regions</span></div>
		</div>

		{#if proposal.object_previews && proposal.object_previews.length > 0}
			<section class="object-changes" aria-label="Object changes">
				<h3>Object changes</h3>
				<div class="object-change-list">
					{#each proposal.object_previews as preview (preview.record_id.id)}
						<article class={`object-change object-change--${preview.change}`}>
							<span class="change-badge">{changeLabel(preview.change)}</span>
							<div class="object-change__content">
								<strong>{objectLabel(preview)}</strong>
								<small>{preview.record_id.id}</small>
								{#if relationshipLabel(preview)}
									<small class="relationship-detail"
										>{relationshipLabel(preview)}</small>
								{/if}
								{#if preview.changed_fields.length > 0}
									<small>Changed: {changeFields(preview)}</small>
								{/if}
							</div>
						</article>
					{/each}
				</div>
			</section>
		{/if}

		{#if operationCount() > 1}
			<fieldset class="operations">
				<legend>Review operations</legend>
				{#each proposal.transaction.operations as _operation, position}
					<label class="operation-row">
						<input
							type="checkbox"
							checked={selected.includes(position)}
							onchange={() => toggleOperation(position)}
							aria-label={`Select operation ${position + 1}`} />
						<span>{operationLabel(position)}</span>
						<code>{geometryLabel(position)}</code>
					</label>
				{/each}
			</fieldset>
		{/if}

		{#if proposal.warnings.length > 0}
			<div class="warnings" role="status">
				{#each proposal.warnings as warning}
					<p>{warning.message}</p>
				{/each}
			</div>
		{/if}

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		<div class="actions">
			<button class="quiet" type="button" disabled={busy} onclick={reject}>Reject</button>
			{#if operationCount() > 1}
				<button
					class="secondary"
					type="button"
					disabled={busy || selected.length === 0}
					onclick={() => accept(selected)}>
					Accept selected
				</button>
			{/if}
			<button class="primary" type="button" disabled={busy} onclick={() => accept()}
				>Accept all</button>
		</div>
	</aside>
{:else if message}
	<div class="proposal-message" role="status">{message}</div>
{/if}

<style>
	.proposal-panel,
	.proposal-message {
		position: absolute;
		top: 1rem;
		right: 1rem;
		z-index: 120;
		width: min(24rem, calc(100% - 2rem));
		box-sizing: border-box;
		border: var(--ink-line-width) solid
			color-mix(in srgb, var(--ink-accent) 30%, var(--ink-border));
		border-radius: var(--ink-radius-panel);
		background: color-mix(in srgb, var(--ink-canvas) 94%, var(--ink-accent) 6%);
		color: var(--ink-text);
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--ink-accent) 24%, transparent),
			var(--ink-shadow-popover);
		-webkit-font-smoothing: antialiased;
	}

	.proposal-panel {
		max-height: min(42rem, calc(100% - 2rem));
		padding: 1rem;
		overflow: auto;
	}

	.proposal-message {
		padding: 0.8rem 1rem;
		font-size: 0.82rem;
	}

	.proposal-heading,
	.actions,
	.operation-row {
		display: flex;
		align-items: center;
	}

	.proposal-heading {
		justify-content: space-between;
		gap: 0.75rem;
	}

	.eyebrow {
		margin: 0 0 0.2rem;
		color: var(--ink-accent);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h2 {
		margin: 0;
		font-size: 1rem;
		text-wrap: balance;
	}

	.expiry {
		color: color-mix(in srgb, var(--ink-text) 60%, transparent);
		font-size: 0.68rem;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.summary {
		margin: 0.8rem 0;
		color: color-mix(in srgb, var(--ink-text) 72%, transparent);
		font-size: 0.78rem;
		line-height: 1.4;
		text-wrap: pretty;
	}

	.change-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.35rem;
		margin-bottom: 0.85rem;
	}

	.change-grid div {
		padding: 0.45rem 0.3rem;
		border-radius: var(--ink-radius-control-small);
		background: color-mix(in srgb, var(--ink-surface) 88%, var(--ink-accent) 12%);
		text-align: center;
	}

	.change-grid strong,
	.change-grid span {
		display: block;
	}

	.change-grid strong {
		font-size: 1.05rem;
		font-variant-numeric: tabular-nums;
	}

	.change-grid span {
		margin-top: 0.12rem;
		color: color-mix(in srgb, var(--ink-text) 62%, transparent);
		font-size: 0.65rem;
		text-transform: uppercase;
	}

	.object-changes {
		margin: 0 0 0.85rem;
	}

	.object-changes h3 {
		margin: 0 0 0.4rem;
		color: color-mix(in srgb, var(--ink-text) 66%, transparent);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.object-change-list {
		display: grid;
		gap: 0.35rem;
		max-height: 12rem;
		overflow: auto;
	}

	.object-change {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.5rem;
		border-left: 3px solid var(--change-color);
		border-radius: var(--ink-radius-control-small);
		background: color-mix(in srgb, var(--change-color) 9%, var(--ink-surface));
	}

	.object-change--added {
		--change-color: var(--ink-accent);
	}

	.object-change--modified,
	.object-change--moved {
		--change-color: var(--ink-warning);
	}

	.object-change--removed {
		--change-color: var(--ink-danger);
	}

	.change-badge {
		flex: 0 0 auto;
		padding: 0.18rem 0.3rem;
		border-radius: 999px;
		color: var(--change-color);
		background: color-mix(in srgb, var(--change-color) 15%, transparent);
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.object-change__content {
		display: grid;
		min-width: 0;
		gap: 0.12rem;
	}

	.object-change__content strong,
	.object-change__content small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.object-change__content strong {
		font-size: 0.75rem;
	}

	.object-change__content small {
		color: color-mix(in srgb, var(--ink-text) 58%, transparent);
		font-size: 0.65rem;
	}

	.object-change__content .relationship-detail {
		color: var(--change-color);
	}

	.operations {
		max-height: 9rem;
		margin: 0 0 0.85rem;
		padding: 0.55rem;
		overflow: auto;
		border: 0;
		background: color-mix(in srgb, var(--ink-surface) 70%, transparent);
	}

	legend {
		padding: 0 0.25rem;
		color: color-mix(in srgb, var(--ink-text) 66%, transparent);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.operation-row {
		min-height: 2.25rem;
		gap: 0.5rem;
		font-size: 0.78rem;
	}

	.operation-row input {
		width: 1rem;
		height: 1rem;
		accent-color: var(--ink-accent);
	}

	.operation-row code {
		margin-left: auto;
		color: color-mix(in srgb, var(--ink-text) 58%, transparent);
		font-size: 0.68rem;
		text-transform: capitalize;
	}

	.warnings,
	.error {
		margin: 0 0 0.8rem;
		padding: 0.55rem 0.65rem;
		border-radius: var(--ink-radius-control-small);
		font-size: 0.75rem;
		line-height: 1.35;
	}

	.warnings {
		background: color-mix(in srgb, var(--ink-warning) 14%, transparent);
	}

	.warnings p {
		margin: 0;
	}

	.error {
		background: color-mix(in srgb, var(--ink-danger) 16%, transparent);
	}

	.actions {
		justify-content: flex-end;
		gap: 0.45rem;
	}

	button {
		min-height: 2.5rem;
		padding: 0.45rem 0.72rem;
		border: 0;
		border-radius: var(--ink-radius-control);
		font: inherit;
		font-size: 0.75rem;
		font-weight: 700;
		cursor: pointer;
		transition-property: transform, opacity, background-color;
		transition-duration: 140ms;
	}

	button:active:not(:disabled) {
		transform: scale(0.96);
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	button.primary {
		background: var(--ink-accent);
		color: var(--ink-on-accent);
	}

	button:focus-visible {
		outline: var(--ink-line-width-strong) solid var(--ink-focus);
		outline-offset: 2px;
	}

	button.secondary {
		background: color-mix(in srgb, var(--ink-accent) 20%, var(--ink-canvas));
		color: var(--ink-text);
	}

	button.quiet {
		background: transparent;
		color: color-mix(in srgb, var(--ink-text) 68%, transparent);
	}
</style>
