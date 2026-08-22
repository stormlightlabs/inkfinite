import { boundsForShape, validatePathGeometry, validateShapeProperties } from './registry.js';
import type { RegistryShape } from './registry.js';
import type { Request, Response } from './protocol.js';
import type { PathGeometry, ShapeRecord, ShapeProperties, Transform } from './model.js';
import type { Bounds, ShapePatch, TransactionDraft } from './transaction.js';

const transform: Transform = { translation: { x: 10, y: 20 }, rotation: 0.5, scale_x: 2, scale_y: 1.5 };

const properties: ShapeProperties = { width: 40, height: 20 };
const strokeProperties: ShapeProperties = {
	points: [
		[0, 0],
		[20, 10]
	],
	style: { color: '#000000', opacity: 1 },
	brush: { size: 8, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true }
};

const pathGeometry: PathGeometry = {
	subpaths: [
		{
			segments: [
				{ type: 'move', to: { x: 0, y: 0 } },
				{ type: 'line', to: { x: 40, y: 0 } },
				{ type: 'quadratic', control: { x: 50, y: 10 }, to: { x: 40, y: 20 } },
				{ type: 'cubic', control_1: { x: 40, y: 30 }, control_2: { x: 0, y: 30 }, to: { x: 0, y: 20 } }
			],
			closed: true
		}
	],
	fill_rule: 'evenodd'
};

const shape: ShapeRecord = {
	id: 'shape:fixture',
	kind: 'rect',
	parent: { kind: 'layer', id: 'layer:fixture' },
	transform,
	child_ids: [],
	layout: null,
	properties,
	metadata: {
		name: 'Fixture rectangle',
		title: null,
		role: 'fixture.shape',
		description: null,
		body: null,
		tags: ['fixture'],
		source: null,
		link: null,
		custom_metadata: {},
		locked: false,
		agent_editable: true,
		provenance: {
			actor_id: 'actor:fixture',
			origin: 'system',
			timestamp: 1_700_000_000_000,
			source: 'native-fixture'
		}
	},
	style: { opacity: 1, fill_opacity: null, stroke_opacity: null },
	version: 1
};

const patch: ShapePatch = { transform, properties, metadata: null, style: null, layout: null };

const transaction: TransactionDraft = {
	id: 'transaction:fixture',
	actor_id: 'actor:fixture',
	origin: 'system',
	base_heads: ['head:fixture'],
	description: 'Native shared binding fixture',
	operations: [{ type: 'patch_shape', shape_id: shape.id, patch, expected_version: 1 }],
	timestamp: 1_700_000_000_000
};

const request: Request = { type: 'commit', session_id: 'session:fixture', transaction };
const response: Response = { type: 'valid' };
const protocolShape: RegistryShape = { kind: shape.kind, properties, transform };
const bounds: Bounds = boundsForShape(protocolShape);

if (
	!validateShapeProperties(shape.kind, properties) ||
	!validateShapeProperties('stroke', strokeProperties) ||
	!validatePathGeometry(pathGeometry) ||
	bounds.width <= 0 ||
	bounds.height <= 0
) {
	throw new Error('generated binding conformance fixture is invalid');
}

void [request, response, bounds];
