<script lang="ts">
	import type { LiveProposal } from '../platform';

	let {
		proposal,
		message,
		onAccept,
		onReject,
		onAuthorize
	}: {
		proposal: LiveProposal | null;
		message: string | null;
		onAccept: (operationPositions?: number[]) => Promise<void>;
		onReject: () => Promise<void>;
		onAuthorize?: () => Promise<{ token: string; session_id: string; expires_at: number }>;
	} = $props();

	let selected = $state<number[]>([]);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let authorizationToken = $state<string | null>(null);

	$effect(() => {
		proposal?.id;
		selected = [];
		error = null;
		authorizationToken = null;
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

	async function authorize() {
		if (!onAuthorize) return;
		busy = true;
		error = null;
		try {
			authorizationToken = (await onAuthorize()).token;
		} catch (cause) {
			error =
				cause instanceof Error
					? cause.message
					: 'The desktop could not issue authorization.';
		} finally {
			busy = false;
		}
	}

	function operationLabel(operation: unknown): string {
		if (typeof operation !== 'object' || operation === null) return 'unknown operation';
		const type = (operation as { type?: unknown }).type;
		return typeof type === 'string' ? type.replaceAll('_', ' ') : 'document operation';
	}
</script>

{#if proposal}
	<aside class="proposal-panel" aria-label="Agent review">
		<div class="proposal-heading">
			<div>
				<p class="eyebrow">Agent review</p>
				<h2 id="proposal-title">{proposal.id}</h2>
			</div>
			<span class="expiry" title="Proposal expiry"
				>Review before {new Date(proposal.expires_at).toLocaleTimeString()}</span>
		</div>

		<p class="summary">
			Ghost regions mark the document geometry this transaction would change.
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
				{#each proposal.transaction.operations as operation, position}
					<label class="operation-row">
						<input
							type="checkbox"
							checked={selected.includes(position)}
							onchange={() => toggleOperation(position)}
							aria-label={`Select operation ${position + 1}`} />
						<span>Operation {position + 1}</span>
						<code>{operationLabel(operation)}</code>
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

		{#if onAuthorize}
			{#if authorizationToken}
				<div class="authorization" role="status">
					<span>One-time apply authorization</span>
					<code>{authorizationToken}</code>
					<small>Copy this token into <code>app apply --authorization</code>.</small>
				</div>
			{:else}
				<button class="authorize" type="button" disabled={busy} onclick={authorize}
					>Authorize direct apply</button>
			{/if}
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
		z-index: 4;
		width: min(24rem, calc(100% - 2rem));
		box-sizing: border-box;
		border-radius: 0.9rem;
		background: color-mix(in srgb, var(--surface) 94%, var(--accent) 6%);
		color: var(--text);
		box-shadow:
			0 1rem 2.5rem color-mix(in srgb, #000 22%, transparent),
			0 0 0 1px color-mix(in srgb, var(--accent) 24%, transparent);
		-webkit-font-smoothing: antialiased;
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
		color: var(--accent);
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
		color: color-mix(in srgb, var(--text) 60%, transparent);
		font-size: 0.68rem;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.summary {
		margin: 0.8rem 0;
		color: color-mix(in srgb, var(--text) 72%, transparent);
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
		background: color-mix(in srgb, var(--surface-2, var(--surface)) 88%, var(--accent) 12%);
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
		color: color-mix(in srgb, var(--text) 62%, transparent);
		font-size: 0.65rem;
		text-transform: uppercase;
	}

	.operations {
		max-height: 9rem;
		margin: 0 0 0.85rem;
		padding: 0.55rem;
		overflow: auto;
		border: 0;
		background: color-mix(in srgb, var(--surface-2, var(--surface)) 70%, transparent);
	}

	legend {
		padding: 0 0.25rem;
		color: color-mix(in srgb, var(--text) 66%, transparent);
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
		accent-color: var(--accent);
	}

	.operation-row code {
		margin-left: auto;
		color: color-mix(in srgb, var(--text) 58%, transparent);
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

	.authorization {
		display: grid;
		gap: 0.35rem;
		margin: 0 0 0.8rem;
		padding: 0.6rem 0.65rem;
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--accent) 13%, transparent);
		font-size: 0.72rem;
	}

	.authorization > code {
		padding: 0.35rem;
		overflow-wrap: anywhere;
		background: color-mix(in srgb, var(--surface) 72%, transparent);
		font-size: 0.68rem;
		user-select: all;
	}

	.authorization small {
		color: color-mix(in srgb, var(--text) 66%, transparent);
		line-height: 1.35;
	}

	.authorize {
		width: 100%;
		margin-bottom: 0.7rem;
		background: color-mix(in srgb, var(--accent) 12%, var(--surface));
		color: var(--text);
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
		background: var(--accent);
		color: var(--surface);
	}

	button.secondary {
		background: color-mix(in srgb, var(--accent) 20%, var(--surface));
		color: var(--text);
	}

	button.quiet {
		background: transparent;
		color: color-mix(in srgb, var(--text) 68%, transparent);
	}
</style>
