import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ProposalReview from './ProposalReview.svelte';
import type { LiveProposal } from '../platform';

const proposal: LiveProposal = {
	id: 'proposal:1',
	transaction: { operations: [{ type: 'rename_page' }, { type: 'patch_shape' }] },
	preview: { created: ['shape:new'], changed: ['shape:changed'], deleted: ['shape:deleted'] },
	affected_regions: [{ page_id: 'page:one', bounds: { x: 10, y: 20, width: 80, height: 40 } }],
	warnings: [],
	expires_at: Date.now() + 60_000
};

describe('ProposalReview', () => {
	it('exposes review, partial acceptance, and rejection through accessible controls', async () => {
		const accept = vi.fn(async () => undefined);
		const reject = vi.fn(async () => undefined);
		const authorize = vi.fn(async () => ({
			token: 'one-time-token',
			session_id: 'session:1',
			expires_at: 1
		}));
		const screen = render(ProposalReview, {
			proposal,
			message: null,
			onAccept: accept,
			onReject: reject,
			onAuthorize: authorize
		});

		await expect
			.element(screen.getByRole('complementary', { name: 'Agent review' }))
			.toBeInTheDocument();
		await expect.element(screen.getByText('proposal:1')).toBeInTheDocument();
		await expect.element(screen.getByText('created')).toBeInTheDocument();

		await screen.getByRole('checkbox', { name: 'Select operation 2' }).click();
		await screen.getByRole('button', { name: 'Accept selected' }).click();
		await screen.getByRole('button', { name: 'Authorize direct apply' }).click();
		await screen.getByRole('button', { name: 'Reject' }).click();

		expect(accept).toHaveBeenCalledWith([1]);
		expect(reject).toHaveBeenCalledOnce();
		expect(authorize).toHaveBeenCalledOnce();
		await expect.element(screen.getByText('one-time-token')).toBeInTheDocument();
	});

	it('announces a cleared proposal conflict', async () => {
		const screen = render(ProposalReview, {
			proposal: null,
			message: 'The document changed while this proposal was open. Review it again.',
			onAccept: vi.fn(async () => undefined),
			onReject: vi.fn(async () => undefined)
		});

		await expect
			.element(screen.getByRole('status'))
			.toHaveTextContent(
				'The document changed while this proposal was open. Review it again.'
			);
	});
});
