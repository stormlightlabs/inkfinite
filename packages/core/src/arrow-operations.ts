/** Pure arrow inspector operations shared by UI entry points. */
import type { ArrowShape } from './editor-model';
import type { EditorState } from './reactivity';

export type ArrowHandle = 'start' | 'end';

export type ArrowInspectorValue<T> = { value: T; mixed: boolean };
export type ArrowConnectionState = { connected: boolean; mixed: boolean; anyConnected: boolean };
export type ArrowInspectorState = {
	arrows: ArrowShape[];
	routingKind: 'straight' | 'curved' | 'orthogonal' | 'mixed';
	label: ArrowInspectorValue<string>;
	strokeWidth: ArrowInspectorValue<number>;
	startHead: ArrowInspectorValue<boolean>;
	endHead: ArrowInspectorValue<boolean>;
	startConnection: ArrowConnectionState;
	endConnection: ArrowConnectionState;
};

function shared<T>(values: T[]): T | null {
	if (values.length === 0) return null;
	const first = values[0];
	return values.every((value) => Object.is(value, first)) ? first : null;
}

function booleanState(values: boolean[]): ArrowInspectorValue<boolean> {
	const value = shared(values);
	return { value: value ?? false, mixed: values.length > 1 && value === null };
}

function connectionState(arrows: ArrowShape[], handle: ArrowHandle): ArrowConnectionState {
	const values = arrows.map((arrow) => arrow.props[handle].kind === 'bound');
	const value = shared(values);
	return {
		connected: value === true,
		mixed: values.length > 1 && value === null,
		anyConnected: values.some(Boolean)
	};
}

/** Derives all values shown by the arrow inspector. */
export function getArrowInspectorState(state: EditorState): ArrowInspectorState {
	const arrows = selectedArrows(state);
	const routing = shared(arrows.map((arrow) => arrow.props.routing?.kind ?? 'straight'));
	const label = shared(arrows.map((arrow) => arrow.props.label?.text ?? ''));
	const width = shared(arrows.map((arrow) => arrow.props.style.width));
	return {
		arrows,
		routingKind: routing ?? (arrows.length > 1 ? 'mixed' : 'straight'),
		label: { value: label ?? '', mixed: arrows.length > 1 && label === null },
		strokeWidth: { value: width ?? 2, mixed: arrows.length > 1 && width === null },
		startHead: booleanState(arrows.map((arrow) => arrow.props.style.headStart === true)),
		endHead: booleanState(arrows.map((arrow) => arrow.props.style.headEnd !== false)),
		startConnection: connectionState(arrows, 'start'),
		endConnection: connectionState(arrows, 'end')
	};
}

/** Returns the selected arrow records in selection order. */
export function selectedArrows(state: EditorState): ArrowShape[] {
	return state.ui.selectionIds
		.map((id) => state.doc.shapes[id])
		.filter((shape): shape is ArrowShape => shape?.type === 'arrow');
}

/** Applies an update to all selected arrows. */
export function updateSelectedArrows(state: EditorState, update: (arrow: ArrowShape) => ArrowShape): EditorState {
	const arrows = selectedArrows(state);
	if (arrows.length === 0) return state;
	const shapes = { ...state.doc.shapes };
	let changed = false;
	for (const arrow of arrows) {
		const next = update(arrow);
		if (next === arrow) continue;
		shapes[arrow.id] = next;
		changed = true;
	}
	return changed ? { ...state, doc: { ...state.doc, shapes } } : state;
}

/** Sets routing on all selected arrows. */
export function setSelectedArrowRouting(state: EditorState, kind: 'straight' | 'curved' | 'orthogonal'): EditorState {
	return updateSelectedArrows(state, (arrow) => ({
		...arrow,
		props: { ...arrow.props, routing: { ...arrow.props.routing, kind } }
	}));
}

/** Sets stroke width on all selected arrows. */
export function setSelectedArrowStrokeWidth(state: EditorState, width: number): EditorState {
	if (!Number.isFinite(width) || width <= 0) return state;
	return updateSelectedArrows(state, (arrow) => ({
		...arrow,
		props: { ...arrow.props, style: { ...arrow.props.style, width } }
	}));
}

/** Sets one arrowhead flag on all selected arrows. */
export function setSelectedArrowHead(state: EditorState, handle: ArrowHandle, value: boolean): EditorState {
	return updateSelectedArrows(state, (arrow) => ({
		...arrow,
		props: {
			...arrow.props,
			style: { ...arrow.props.style, [handle === 'start' ? 'headStart' : 'headEnd']: value }
		}
	}));
}

/** Sets or clears the label on all selected arrows. */
export function setSelectedArrowLabel(state: EditorState, text: string): EditorState {
	return updateSelectedArrows(state, (arrow) => ({
		...arrow,
		props: {
			...arrow.props,
			label: text.trim()
				? {
						text,
						align: arrow.props.label?.align ?? 'center',
						offset: arrow.props.label?.offset ?? 0,
						...(arrow.props.label?.distance === undefined ? {} : { distance: arrow.props.label.distance })
					}
				: undefined
		}
	}));
}

/** Disconnects one endpoint from all selected arrows and removes its binding. */
export function disconnectSelectedArrowEndpoints(state: EditorState, handle: ArrowHandle): EditorState {
	const arrows = selectedArrows(state);
	if (arrows.length === 0) return state;
	const shapes = { ...state.doc.shapes };
	const bindings = { ...state.doc.bindings };
	let changed = false;
	for (const arrow of arrows) {
		const endpoint = arrow.props[handle];
		if (endpoint.kind !== 'bound') continue;
		if (endpoint.bindingId) delete bindings[endpoint.bindingId];
		shapes[arrow.id] = { ...arrow, props: { ...arrow.props, [handle]: { kind: 'free' } } };
		changed = true;
	}
	return changed ? { ...state, doc: { ...state.doc, shapes, bindings } } : state;
}
