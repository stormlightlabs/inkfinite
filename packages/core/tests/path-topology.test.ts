import fixture from '../../../fixtures/native/path-topology.json';
import { describe, expect, it } from 'vitest';
import {
	Action,
	DirectSelectTool,
	Modifiers,
	EditorPageRecord,
	EditorShapeRecord,
	Store,
	applyPathTopologyOperations
} from '../src';
import type { PathProps, PathTopologyOperation } from '../src/editor-model';

const buttons = { left: true, middle: false, right: false };
const modifiers = Modifiers.create();

function createPath() {
	const page = EditorPageRecord.create('Page', 'page:path-topology');
	const props: PathProps = {
		subpaths: [
			{
				segments: [
					{ type: 'move', to: { x: 0, y: 0 } },
					{ type: 'line', to: { x: 100, y: 0 } },
					{
						type: 'cubic',
						control_1: { x: 130, y: 0 },
						control_2: { x: 160, y: 100 },
						to: { x: 100, y: 100 }
					},
					{ type: 'line', to: { x: 0, y: 100 } }
				],
				closed: true
			}
		],
		fill_rule: 'nonzero',
		fill: '#fff'
	};
	const path = EditorShapeRecord.createPath(page.id, 0, 0, props, 'path:topology');
	page.shapeIds = [path.id];
	const state = new Store({
		doc: { pages: { [page.id]: page }, shapes: { [path.id]: path }, bindings: {} },
		ui: {
			currentPageId: page.id,
			selectionIds: [path.id],
			toolId: 'direct-select',
			pathSelection: { pathId: path.id, anchors: [] }
		},
		camera: { x: 0, y: 0, zoom: 1 }
	}).getState();
	return { path, state };
}

describe('path topology previews', () => {
	it('matches the shared topology fixtures', () => {
		for (const testCase of fixture.cases) {
			const page = EditorPageRecord.create('Page', `page:${testCase.name}`);
			const path = EditorShapeRecord.createPath(
				page.id,
				0,
				0,
				testCase.geometry as PathProps,
				`path:${testCase.name}`
			);
			const result = applyPathTopologyOperations(
				path,
				testCase.operations as unknown as PathTopologyOperation[]
			);
			expect(result?.props.subpaths, testCase.name).toEqual(testCase.expected.subpaths);
			expect(result?.props.fill_rule, testCase.name).toBe(testCase.expected.fill_rule);
		}
	});

	it('splits segments, converts segment kinds, and removes anchors', () => {
		const { path } = createPath();
		const added = applyPathTopologyOperations(path, [
			{ type: 'add_anchor', subpath_index: 0, segment_index: 1, t: 0.5 }
		]);
		expect(added?.props.subpaths[0].segments).toHaveLength(5);
		expect(added?.props.subpaths[0].segments[1]).toMatchObject({ type: 'line', to: { x: 50, y: 0 } });

		const converted = applyPathTopologyOperations(path, [
			{ type: 'convert_to_curve', subpath_index: 0, segment_index: 1, curve: 'quadratic' },
			{ type: 'convert_to_line', subpath_index: 0, segment_index: 2 }
		]);
		expect(converted?.props.subpaths[0].segments[1]?.type).toBe('quadratic');
		expect(converted?.props.subpaths[0].segments[2]?.type).toBe('line');

		const deleted = applyPathTopologyOperations(path, [
			{ type: 'delete_anchor', subpath_index: 0, segment_index: 2 }
		]);
		expect(deleted?.props.subpaths[0].segments).toHaveLength(3);
	});

	it('joins and breaks cubic handles in the direct-selection preview', () => {
		const { path } = createPath();
		const joined = applyPathTopologyOperations(path, [
			{ type: 'join_handles', subpath_index: 0, segment_index: 1 }
		]);
		expect(joined?.props.subpaths[0].handle_modes?.[1]).toBe('joined');
		const broken =
			joined &&
			applyPathTopologyOperations(joined, [{ type: 'break_handles', subpath_index: 0, segment_index: 1 }]);
		expect(broken?.props.subpaths[0].handle_modes?.[1]).toBe('broken');
	});

	it('opens and closes selected subpaths and joins selected endpoints', () => {
		const { path, state } = createPath();
		const tool = new DirectSelectTool();
		let next = tool.onEnter(state);
		next = tool.onAction(
			next,
			Action.pointerDown({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, buttons, modifiers)
		);
		next = tool.onAction(next, Action.keyDown('o', 'KeyO', modifiers));
		const opened = next.doc.shapes[path.id];
		expect(opened?.type).toBe('path');
		if (opened?.type === 'path') expect(opened.props.subpaths[0]?.closed).toBe(false);
		next = tool.onAction(next, Action.keyDown('z', 'KeyZ', modifiers));
		const closed = next.doc.shapes[path.id];
		expect(closed?.type).toBe('path');
		if (closed?.type === 'path') expect(closed.props.subpaths[0]?.closed).toBe(true);

		const joinPage = EditorPageRecord.create('Page', 'page:path-join');
		const joinPath = EditorShapeRecord.createPath(
			joinPage.id,
			0,
			0,
			{
				subpaths: [
					{
						segments: [
							{ type: 'move', to: { x: 0, y: 0 } },
							{ type: 'line', to: { x: 10, y: 0 } }
						],
						closed: false
					},
					{
						segments: [
							{ type: 'move', to: { x: 20, y: 0 } },
							{ type: 'line', to: { x: 30, y: 0 } }
						],
						closed: false
					}
				],
				fill_rule: 'evenodd'
			} as PathProps,
			'path:join'
		);
		joinPage.shapeIds = [joinPath.id];
		const joinState = new Store({
			doc: { pages: { [joinPage.id]: joinPage }, shapes: { [joinPath.id]: joinPath }, bindings: {} },
			ui: {
				currentPageId: joinPage.id,
				selectionIds: [joinPath.id],
				toolId: 'direct-select',
				pathSelection: {
					pathId: joinPath.id,
					anchors: [
						{ subpathIndex: 0, segmentIndex: 1 },
						{ subpathIndex: 1, segmentIndex: 0 }
					]
				}
			},
			camera: { x: 0, y: 0, zoom: 1 }
		}).getState();
		const joinTool = new DirectSelectTool();
		const joined = joinTool.onAction(joinTool.onEnter(joinState), Action.keyDown('j', 'KeyJ', modifiers));
		const joinedPath = joined.doc.shapes[joinPath.id];
		expect(joinedPath?.type).toBe('path');
		if (joinedPath?.type === 'path') expect(joinedPath.props.subpaths).toHaveLength(1);
	});

	it('adds an anchor with Alt-click and deletes it with the direct tool', () => {
		const { path, state } = createPath();
		const tool = new DirectSelectTool();
		let next = tool.onEnter(state);
		next = tool.onAction(
			next,
			Action.pointerDown({ x: 50, y: 0 }, { x: 50, y: 0 }, 0, buttons, Modifiers.create(false, false, true))
		);
		const added = next.doc.shapes[path.id];
		expect(added?.type).toBe('path');
		if (added?.type === 'path') {
			expect(added.props.subpaths[0].segments).toHaveLength(5);
		}
		expect(next.ui.pathSelection?.anchors).toEqual([{ subpathIndex: 0, segmentIndex: 2 }]);
		expect(tool.getPendingTopologyEdits()).toMatchObject([
			{ shapeId: path.id, operations: [{ type: 'add_anchor', segment_index: 1 }] }
		]);

		next = tool.onAction(next, Action.keyDown('Delete', 'Delete', modifiers));
		const deleted = next.doc.shapes[path.id];
		expect(deleted?.type).toBe('path');
		if (deleted?.type === 'path') {
			expect(deleted.props.subpaths[0].segments).toHaveLength(4);
		}
	});
});
