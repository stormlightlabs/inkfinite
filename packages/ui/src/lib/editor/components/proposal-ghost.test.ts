import { describe, expect, it } from 'vitest';
import type { ProposalObjectPreview } from '../platform';
import { legacyShape, shapeSegmentsFor } from './proposal-ghost';

describe('proposal ghost projection', () => {
	it('projects moved previews into before and after segments', () => {
		const preview: ProposalObjectPreview = {
			record_id: { kind: 'shape', id: 'shape:moved' },
			change: 'moved',
			before: { kind: 'shape', record: { kind: 'rect' } },
			after: { kind: 'shape', record: { kind: 'rect' } },
			before_bounds: { x: 0, y: 0, width: 10, height: 10 },
			after_bounds: { x: 20, y: 20, width: 10, height: 10 },
			operation_positions: [0],
			changed_fields: ['transform.translation']
		};
		expect(shapeSegmentsFor(preview).map((segment) => segment.side)).toEqual([
			'before',
			'after'
		]);
	});

	it('rejects malformed legacy shape operations', () => {
		expect(legacyShape({ type: 'create_shape', shape: { id: 'shape:bad' } })).toBeNull();
		expect(legacyShape({ type: 'patch_shape' })).toBeNull();
	});
});
