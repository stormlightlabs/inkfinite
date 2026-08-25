import { describe, expect, it } from 'vitest';
import { attachTextPathSelection, shapeBoundsForState } from '../src';
import { PageRecord, ShapeRecord } from '../src/model';
import { EditorState, Store } from '../src/reactivity';
import { SnapshotCommand } from '../src/history';

function createTextPathState() {
	const state = EditorState.create();
	const page = PageRecord.create('Text path');
	state.doc.pages[page.id] = page;
	state.ui.currentPageId = page.id;
	const path = ShapeRecord.createPath(page.id, 20, 40, {
		subpaths: [
			{
				segments: [
					{ type: 'move', to: { x: 0, y: 0 } },
					{ type: 'line', to: { x: 200, y: 0 } }
				],
				closed: false
			}
		],
		fill_rule: 'nonzero',
		stroke: '#000000',
		stroke_width: 2
	});
	const text = ShapeRecord.createText(page.id, 0, 0, {
		text: 'Label',
		fontSize: 16,
		fontFamily: 'sans-serif',
		color: '#000000'
	});
	state.doc.shapes[path.id] = path;
	state.doc.shapes[text.id] = text;
	page.shapeIds.push(path.id, text.id);
	state.ui.selectionIds = [text.id, path.id];
	return { state, path, text };
}

function textPathOf(state: EditorState, shapeId: string) {
	const shape = state.doc.shapes[shapeId];
	return shape?.type === 'text' ? shape.props.textPath : undefined;
}

describe('text on path', () => {
	it('keeps the attachment when the supporting path is edited', () => {
		const { state, path, text } = createTextPathState();
		const attached = attachTextPathSelection(state);
		expect(attached?.doc.shapes[text.id]?.type).toBe('text');
		const attachedText = attached?.doc.shapes[text.id];
		expect(attachedText?.type === 'text' && attachedText.props.textPath?.pathId).toBe(path.id);

		if (!attached || attachedText?.type !== 'text') return;
		const nextPath = {
			...path,
			props: {
				...path.props,
				subpaths: [
					{
						...path.props.subpaths[0]!,
						segments: [
							{ type: 'move' as const, to: { x: 50, y: 0 } },
							{ type: 'line' as const, to: { x: 300, y: 0 } }
						]
					}
				]
			}
		};
		const edited = {
			...attached,
			doc: { ...attached.doc, shapes: { ...attached.doc.shapes, [path.id]: nextPath } }
		};
		expect(edited.doc.shapes[text.id]).toEqual(attachedText);
		expect(shapeBoundsForState(edited, attachedText).max.x).toBeGreaterThan(
			shapeBoundsForState(attached, attachedText).max.x
		);
	});

	it('records attach, undo, and redo as one document command', () => {
		const { state, text } = createTextPathState();
		const store = new Store(state);
		const before = store.getState();
		const after = attachTextPathSelection(before);
		expect(after).not.toBeNull();
		store.executeCommand(new SnapshotCommand('Attach text to path', 'doc', before, after!));
		expect(textPathOf(store.getState(), text.id)).toBeTruthy();
		expect(store.undo()).toBe(true);
		expect(textPathOf(store.getState(), text.id)).toBeUndefined();
		expect(store.redo()).toBe(true);
		expect(textPathOf(store.getState(), text.id)).toBeTruthy();
	});
});
