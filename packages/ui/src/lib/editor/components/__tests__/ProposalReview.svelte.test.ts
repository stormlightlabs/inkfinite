import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ProposalReview from '../ProposalReview.svelte';
import type { LiveProposal } from '../../platform';

const proposal: LiveProposal = {
	id: 'proposal:1',
	transaction: { operations: [{ type: 'rename_page' }, { type: 'patch_shape' }] },
	preview: { created: ['shape:new'], changed: ['shape:changed'], deleted: ['shape:deleted'] },
	affected_regions: [{ page_id: 'page:one', bounds: { x: 10, y: 20, width: 80, height: 40 } }],
	operation_previews: [
		{ position: 0, label: 'Rename page “Overview”', record_ids: [], bounds: [] },
		{
			position: 1,
			label: 'Update shape:service (architecture.service)',
			record_ids: [],
			bounds: [{ x: 10, y: 20, width: 80, height: 40 }]
		}
	],
	warnings: [],
	expires_at: Date.now() + 60_000
};

const handlers = () => ({
	onAccept: vi.fn(async () => undefined),
	onReject: vi.fn(async () => undefined)
});

describe('ProposalReview', () => {
	it('exposes partial acceptance and rejection through accessible controls', async () => {
		const callbacks = handlers();
		const screen = render(ProposalReview, { proposal, message: null, ...callbacks });

		await expect
			.element(screen.getByRole('complementary', { name: 'Agent review' }))
			.toBeInTheDocument();
		await expect.element(screen.getByText('proposal:1')).toBeInTheDocument();
		await expect.element(screen.getByText('created')).toBeInTheDocument();
		await expect
			.element(screen.getByText('Update shape:service (architecture.service)'))
			.toBeInTheDocument();
		await expect.element(screen.getByText('10,20 80×40')).toBeInTheDocument();

		await screen.getByRole('checkbox', { name: 'Select operation 2' }).click();
		await screen.getByRole('button', { name: 'Accept selected' }).click();
		await screen.getByRole('button', { name: 'Reject' }).click();

		expect(callbacks.onAccept).toHaveBeenCalledWith([1]);
		expect(callbacks.onReject).toHaveBeenCalledOnce();
	});

	it('announces a cleared proposal conflict', async () => {
		const screen = render(ProposalReview, {
			proposal: null,
			message: 'The document changed while this proposal was open. Review it again.',
			...handlers()
		});

		await expect
			.element(screen.getByRole('status'))
			.toHaveTextContent(
				'The document changed while this proposal was open. Review it again.'
			);
	});
});
