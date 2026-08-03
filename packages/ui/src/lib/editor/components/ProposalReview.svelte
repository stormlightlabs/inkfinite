<script lang="ts">
	import type { LiveProposal } from '../platform';

	let {
		proposal,
		message,
		agentAccess,
		onAccept,
		onReject,
		onAgentAccessChange
	}: {
		proposal: LiveProposal | null;
		message: string | null;
		agentAccess: 'review' | 'direct';
		onAccept: (operationPositions?: number[]) => Promise<void>;
		onReject: () => Promise<void>;
		onAgentAccessChange: (mode: 'review' | 'direct') => Promise<void>;
	} = $props();

	let selected = $state<number[]>([]);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let accessBusy = $state(false);
	let accessError = $state<string | null>(null);

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

	async function changeAgentAccess(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		const mode = select.value as 'review' | 'direct';
		accessBusy = true;
		accessError = null;
		try {
			await onAgentAccessChange(mode);
		} catch (cause) {
			select.value = agentAccess;
			accessError =
				cause instanceof Error ? cause.message : 'Agent access could not be changed.';
		} finally {
			accessBusy = false;
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
</script>

<aside class="agent-access" data-mode={agentAccess} aria-label="Agent access" data-agent-occlusion>
	<label for="agent-access-mode">Agent access</label>
	<select
		id="agent-access-mode"
		value={agentAccess}
		disabled={accessBusy}
		onchange={changeAgentAccess}>
		<option value="review">Review changes</option>
		<option value="direct">Apply directly</option>
	</select>
	<small>
		{agentAccess === 'direct'
			? 'Agents can edit this document until you close it or switch back.'
			: 'Agent edits appear as proposals before they change the document.'}
	</small>
	{#if accessError}<p class="access-error" role="alert">{accessError}</p>{/if}
</aside>

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
			Ghost shapes preview proposed creations. Outlined regions mark other affected geometry.
		</p>

		<div class="change-grid" aria-label="Proposal changes">
			<div><strong>{proposal.preview.created.length}</strong><span>created</span></div>
			<div><strong>{proposal.preview.changed.length}</strong><span>changed</span></div>
			<div><strong>{proposal.preview.deleted.length}</strong><span>deleted</span></div>
			<div><strong>{proposal.affected_regions.length}</strong><span>regions</span></div>
		</div>

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
		top: 7.25rem;
		right: 1rem;
		z-index: 4;
		width: min(24rem, calc(100% - 2rem));
		box-sizing: border-box;
		border-radius: 0.9rem;
		background: color-mix(in srgb, var(--ink-canvas) 94%, var(--ink-accent) 6%);
		color: var(--ink-text);
		box-shadow:
			0 1rem 2.5rem color-mix(in srgb, #000 22%, transparent),
			0 0 0 1px color-mix(in srgb, var(--ink-accent) 24%, transparent);
		-webkit-font-smoothing: antialiased;
	}

	.agent-access {
		position: absolute;
		top: 1rem;
		right: 1rem;
		z-index: 4;
		display: grid;
		grid-template-columns: auto auto;
		gap: 0.35rem 0.75rem;
		align-items: center;
		width: min(24rem, calc(100% - 2rem));
		box-sizing: border-box;
		padding: 0.75rem 0.9rem;
		border: 1px solid color-mix(in srgb, var(--ink-text) 22%, transparent);
		border-radius: 0.9rem;
		background: color-mix(in srgb, var(--ink-canvas) 96%, var(--ink-accent) 4%);
		color: var(--ink-text);
		box-shadow: 0 0.4rem 1.2rem color-mix(in srgb, #000 24%, transparent);
	}

	.agent-access[data-mode='direct'] {
		border-color: color-mix(in srgb, #d4a96a 72%, transparent);
	}

	.agent-access label {
		font-weight: 700;
	}

	.agent-access select {
		min-width: 9.5rem;
		padding: 0.4rem 0.55rem;
		border: 1px solid color-mix(in srgb, var(--ink-text) 28%, transparent);
		border-radius: 0.55rem;
		color: var(--ink-text);
		background: var(--ink-canvas);
	}

	.agent-access small,
	.access-error {
		grid-column: 1 / -1;
		margin: 0;
		line-height: 1.35;
	}

	.agent-access small {
		color: color-mix(in srgb, var(--ink-text) 66%, transparent);
	}

	.access-error {
		color: #e98282;
	}

	.proposal-panel {
		padding: 1rem;
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
		border-radius: 0.5rem;
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
		border-radius: 0.5rem;
		font-size: 0.75rem;
		line-height: 1.35;
	}

	.warnings {
		background: color-mix(in srgb, #e5a84b 14%, transparent);
	}

	.warnings p {
		margin: 0;
	}

	.error {
		background: color-mix(in srgb, #d96060 16%, transparent);
	}

	.actions {
		justify-content: flex-end;
		gap: 0.45rem;
	}

	button {
		min-height: 2.5rem;
		padding: 0.45rem 0.72rem;
		border: 0;
		border-radius: 0.55rem;
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

	button.secondary {
		background: color-mix(in srgb, var(--ink-accent) 20%, var(--ink-canvas));
		color: var(--ink-text);
	}

	button.quiet {
		background: transparent;
		color: color-mix(in srgb, var(--ink-text) 68%, transparent);
	}
</style>
