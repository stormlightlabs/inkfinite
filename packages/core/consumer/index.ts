import { Action, Modifiers } from '@inkfinite/core/commands';
import { importInterchange } from '@inkfinite/core/interchange';
import { BoardStatsOps, diffDoc } from '@inkfinite/core/persistence';
import { duplicateSelection } from '@inkfinite/core/selection';
import { shapeBounds, Vec2 } from '@inkfinite/core/geometry';
import { EditorDocument, EditorShapeRecord } from '@inkfinite/core/model';
import type { EditorState } from '@inkfinite/core';

const document = EditorDocument.create();
const shape = EditorShapeRecord.createRect('page:consumer', 0, 0, {
	w: 10,
	h: 10,
	fill: '#ffffff',
	stroke: '#000000',
	radius: 0
});
const state = { doc: { ...document, shapes: { [shape.id]: shape } } } as EditorState;

void Action.keyDown('Escape', 'Escape', Modifiers.create());
void Vec2.create(0, 0);
void shapeBounds(shape);
void duplicateSelection(state);
void importInterchange('{}', 'empty.canvas');
void BoardStatsOps.formatDocSize(0);
void diffDoc(document, document);
