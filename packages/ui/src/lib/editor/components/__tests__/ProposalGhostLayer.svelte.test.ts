import { Camera } from '@inkfinite/core';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { LiveProposal } from '../../platform';
import ProposalGhostLayer from '../ProposalGhostLayer.svelte';

function proposalWith(operation: unknown): LiveProposal {
	return {
		id: 'proposal:ghost',
		transaction: { operations: [operation] },
		preview: { created: ['shape:ghost'], changed: [], deleted: [] },
		affected_regions: [
			{ page_id: 'page:one', bounds: { x: 10, y: 20, width: 30, height: 40 } }
		],
		warnings: [],
		expires_at: Date.now() + 60_000
	};
}

describe('ProposalGhostLayer', () => {
	it('draws a proposed root-layer shape at its canvas transform', async () => {
		const proposal = proposalWith({
			type: 'create_shape',
			shape: {
				id: 'shape:ghost',
				kind: 'rect',
				parent: { kind: 'layer', id: 'layer:one' },
				transform: { translation: { x: 10, y: 20 }, rotation: 0, scale_x: 1, scale_y: 1 },
				properties: { width: 30, height: 40, radius: 6, fill: '#88edc4' }
			}
		});
		const screen = render(ProposalGhostLayer, {
			proposal,
			camera: Camera.create(0, 0, 2),
			viewport: { width: 800, height: 600 }
		});

		const ghost = screen.getByTestId('proposal-created-shape');
		await expect.element(ghost).toHaveAttribute('data-shape-id', 'shape:ghost');
		await expect.element(ghost).toHaveAttribute('transform', 'matrix(2 0 0 2 420 340)');
		expect(ghost.element().style.getPropertyValue('--proposal-fill')).toBe('#88edc4');
		await expect
			.element(screen.getByTestId('proposal-created-shape-outline'))
			.toHaveAttribute('width', '30');
		await expect
			.element(screen.getByTestId('proposal-affected-region'))
			.not.toBeInTheDocument();
	});

	it('keeps an affected-region outline for operations it cannot materialize', async () => {
		const screen = render(ProposalGhostLayer, {
			proposal: proposalWith({ type: 'patch_shape', shape_id: 'shape:existing' }),
			camera: Camera.create(0, 0, 2),
			viewport: { width: 800, height: 600 }
		});

		const region = screen.getByTestId('proposal-affected-region');
		await expect.element(region).toHaveAttribute('x', '420');
		await expect.element(region).toHaveAttribute('y', '340');
		await expect.element(region).toHaveAttribute('width', '60');
		await expect.element(region).toHaveAttribute('height', '80');
		await expect.element(screen.getByTestId('proposal-created-shape')).not.toBeInTheDocument();
	});
});
