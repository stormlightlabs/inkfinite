import type { Action } from '../actions';
import {
	hitTestPathAnchor,
	hitTestPathControl,
	hitTestPathSegment,
	hitTestPathSubpath,
	hitTestPoint,
	hitTestStrokeWidthHandle,
	pathAnchorRefs,
	strokeWidthHandleId,
	strokeWidthHandles,
	strokeWidthProfile,
	worldToLocal
} from '../geom';
import type { Vec2 } from '../math';
import { applyPathTopologyOperations } from '../path-topology';
import {
	ShapeRecord,
	type PathAnchorRef,
	type PathControlRef,
	type PathShape,
	type StrokeShape,
	type PathTopologyEdit,
	type PathTopologyOperation
} from '../model';
import { EditorState, getSelectionScopeShapes, selectionTarget, type ToolId } from '../reactivity';
import type { Tool } from './base';

const HANDLE_HIT_RADIUS = 10;

type DirectHandle =
	| { kind: 'anchor'; ref: PathAnchorRef }
	| { kind: 'control'; ref: PathControlRef }
	| { kind: 'width'; index: number };

type DirectToolState = {
	activeHandle: DirectHandle | null;
	dragStartWorld: Vec2 | null;
	initialShape: PathShape | null;
	initialStroke: StrokeShape | null;
};

/** Return the stable renderer ID for a path anchor handle. */
export function pathAnchorHandleId(anchor: PathAnchorRef): string {
	return `path-anchor-${anchor.subpathIndex}-${anchor.segmentIndex}`;
}

/** Return the stable renderer ID for a path control handle. */
export function pathControlHandleId(control: PathControlRef): string {
	return `path-control-${control.subpathIndex}-${control.segmentIndex}-${control.control}`;
}

/**
 * Directly selects and edits the anchors and Bézier controls of native paths.
 *
 * Path geometry stays in the document's local coordinate system. The tool only
 * keeps the selected anchor references and the current gesture snapshot in
 * memory; the runtime commits the resulting path once the pointer is released.
 */
export class DirectSelectTool implements Tool {
	readonly id: ToolId = 'direct-select';
	private toolState: DirectToolState = this.createToolState();
	private pendingTopologyEdits: PathTopologyEdit[] = [];

	onEnter(state: EditorState): EditorState {
		this.resetToolState();
		this.pendingTopologyEdits = [];
		const selected = state.ui.selectionIds.length === 1 ? state.doc.shapes[state.ui.selectionIds[0]] : undefined;
		if (selected?.type !== 'path' && selected?.type !== 'stroke') {
			return { ...state, ui: { ...state.ui, pathSelection: undefined } };
		}
		return {
			...state,
			ui: {
				...state.ui,
				pathSelection:
					state.ui.pathSelection?.pathId === selected.id
						? state.ui.pathSelection
						: {
								pathId: selected.id,
								anchors: [],
								...(selected.type === 'stroke' ? { widthPoints: [] } : {})
							}
			}
		};
	}

	onExit(state: EditorState): EditorState {
		this.resetToolState();
		this.pendingTopologyEdits = [];
		return state;
	}

	onAction(state: EditorState, action: Action): EditorState {
		if (action.type === 'pointer-down') return this.handlePointerDown(state, action);
		if (action.type === 'pointer-move') return this.handlePointerMove(state, action);
		if (action.type === 'pointer-up') {
			this.resetToolState();
			return state;
		}
		if (action.type === 'key-down') {
			if (action.key === 'Escape') return this.handleEscape(state);
			if (action.modifiers.ctrl || action.modifiers.meta || action.modifiers.alt) return state;
			if (action.key === 'Delete' || action.key === 'Backspace') return this.deleteSelectedAnchors(state);
			if (action.key === 'q' || action.key === 'Q') return this.convertSelectedSegments(state, 'quadratic');
			if (action.key === 'c' || action.key === 'C') return this.convertSelectedSegments(state, 'cubic');
			if (action.key === 'l' || action.key === 'L') return this.convertSelectedSegmentsToLines(state);
			if (action.key === 'o' || action.key === 'O') return this.setSelectedPathsClosed(state, false);
			if (action.key === 'z' || action.key === 'Z') return this.setSelectedPathsClosed(state, true);
			if (action.key === 'b' || action.key === 'B') return this.applyHandleOperation(state, 'break_handles');
			if (action.key === 'j' || action.key === 'J') return this.joinSelectedEndpoints(state);
		}
		return state;
	}

	getPendingTopologyEdits(): PathTopologyEdit[] {
		return this.pendingTopologyEdits.map((edit) => ({
			shapeId: edit.shapeId,
			operations: edit.operations.map((operation) => ({ ...operation }))
		}));
	}

	clearPendingTopologyEdits(): void {
		this.pendingTopologyEdits = [];
	}

	/** Return the handle under a point for hover and cursor feedback. */
	getHandleAtPoint(state: EditorState, point: Vec2): string | null {
		const stroke = this.getSelectedStroke(state);
		if (stroke) {
			const widthIndex = hitTestStrokeWidthHandle(stroke, point, HANDLE_HIT_RADIUS);
			return widthIndex === null ? null : strokeWidthHandleId(widthIndex);
		}
		const path = this.getSelectedPath(state);
		if (!path) return null;

		const control = hitTestPathControl(path, point, HANDLE_HIT_RADIUS);
		if (control) return pathControlHandleId(control);
		const anchor = hitTestPathAnchor(path, point, HANDLE_HIT_RADIUS);
		return anchor ? pathAnchorHandleId(anchor) : null;
	}

	getActiveHandle(): string | null {
		const active = this.toolState.activeHandle;
		if (!active) return null;
		if (active.kind === 'width') return strokeWidthHandleId(active.index);
		return active.kind === 'anchor' ? pathAnchorHandleId(active.ref) : pathControlHandleId(active.ref);
	}

	private handlePointerDown(state: EditorState, action: Extract<Action, { type: 'pointer-down' }>): EditorState {
		const selectedStroke = this.getSelectedStroke(state);
		if (selectedStroke) {
			const widthIndex = hitTestStrokeWidthHandle(selectedStroke, action.world, HANDLE_HIT_RADIUS);
			if (widthIndex !== null) {
				const nextState = this.setStrokeSelection(state, selectedStroke, [widthIndex]);
				this.beginWidthDrag(nextState, widthIndex, action.world);
				return nextState;
			}
		}
		const selectedPath = this.getSelectedPath(state);
		if (selectedPath) {
			const control = hitTestPathControl(selectedPath, action.world, HANDLE_HIT_RADIUS);
			if (control) {
				this.beginDrag('control', control, state, action.world);
				return state;
			}

			const anchor = hitTestPathAnchor(selectedPath, action.world, HANDLE_HIT_RADIUS);
			if (anchor) {
				const currentAnchors = state.ui.pathSelection?.anchors ?? [];
				const anchorAlreadySelected = currentAnchors.some((candidate) => sameAnchor(candidate, anchor));
				const nextAnchors =
					!action.modifiers.shift && anchorAlreadySelected
						? currentAnchors
						: toggleAnchor(currentAnchors, anchor, action.modifiers.shift);
				const nextState = this.setPathSelection(state, selectedPath, nextAnchors);
				if (nextAnchors.some((candidate) => sameAnchor(candidate, anchor))) {
					this.beginDrag('anchor', anchor, nextState, action.world);
				}
				return nextState;
			}

			if (action.modifiers.alt) {
				const segment = hitTestPathSegment(selectedPath, action.world, HANDLE_HIT_RADIUS);
				if (segment) {
					return this.addAnchor(state, selectedPath, segment);
				}
			}

			const subpathIndex = hitTestPathSubpath(selectedPath, action.world, HANDLE_HIT_RADIUS);
			if (subpathIndex !== null) {
				const subpathAnchors = pathAnchorRefs(selectedPath).filter(
					(anchorRef) => anchorRef.subpathIndex === subpathIndex
				);
				const currentAnchors = state.ui.pathSelection?.anchors ?? [];
				const nextAnchors = toggleAnchors(currentAnchors, subpathAnchors, action.modifiers.shift);
				const nextState = this.setPathSelection(state, selectedPath, nextAnchors);
				if (
					subpathAnchors.some((candidate) =>
						nextAnchors.some((anchorRef) => sameAnchor(anchorRef, candidate))
					)
				) {
					this.beginDrag('anchor', subpathAnchors[0], nextState, action.world);
				}
				return nextState;
			}
		}

		const hitShapeId = hitTestPoint(state, action.world);
		let targetId = hitShapeId ? selectionTarget(state, hitShapeId) : null;
		if (!targetId) {
			const pathCandidates = getSelectionScopeShapes(state);
			for (let index = pathCandidates.length - 1; index >= 0; index -= 1) {
				const candidate = pathCandidates[index];
				if (
					candidate.type === 'path' &&
					(hitTestPathControl(candidate, action.world, HANDLE_HIT_RADIUS) !== null ||
						hitTestPathAnchor(candidate, action.world, HANDLE_HIT_RADIUS) !== null ||
						hitTestPathSubpath(candidate, action.world, HANDLE_HIT_RADIUS) !== null)
				) {
					targetId = candidate.id;
					break;
				}
			}
		}
		const target = targetId ? state.doc.shapes[targetId] : undefined;
		if (target?.type === 'stroke') {
			const nextState = this.setStrokeSelection(state, target, []);
			const widthIndex = hitTestStrokeWidthHandle(target, action.world, HANDLE_HIT_RADIUS);
			if (widthIndex !== null) this.beginWidthDrag(nextState, widthIndex, action.world);
			return nextState;
		}
		if (target?.type === 'path') {
			if (action.modifiers.alt) {
				const segment = hitTestPathSegment(target, action.world, HANDLE_HIT_RADIUS);
				if (segment) return this.addAnchor(state, target, segment);
			}
			const control = hitTestPathControl(target, action.world, HANDLE_HIT_RADIUS);
			if (control) {
				const nextState = this.setPathSelection(state, target, []);
				this.beginDrag('control', control, nextState, action.world);
				return nextState;
			}
			const anchor = hitTestPathAnchor(target, action.world, HANDLE_HIT_RADIUS);
			if (anchor) {
				const nextState = this.setPathSelection(state, target, [anchor]);
				this.beginDrag('anchor', anchor, nextState, action.world);
				return nextState;
			}
			const subpathIndex = hitTestPathSubpath(target, action.world, HANDLE_HIT_RADIUS);
			const anchors =
				subpathIndex === null
					? []
					: pathAnchorRefs(target).filter((anchorRef) => anchorRef.subpathIndex === subpathIndex);
			const nextState = this.setPathSelection(state, target, anchors);
			if (anchors.length > 0) this.beginDrag('anchor', anchors[0], nextState, action.world);
			return nextState;
		}

		if (targetId) {
			this.resetToolState();
			return { ...state, ui: { ...state.ui, selectionIds: [targetId], pathSelection: undefined } };
		}

		this.resetToolState();
		return { ...state, ui: { ...state.ui, selectionIds: [], pathSelection: undefined } };
	}

	private handlePointerMove(state: EditorState, action: Extract<Action, { type: 'pointer-move' }>): EditorState {
		const { activeHandle, dragStartWorld, initialShape, initialStroke } = this.toolState;
		if (!activeHandle || !dragStartWorld) return state;
		if (activeHandle.kind === 'width' && initialStroke) {
			const updated = moveStrokeWidth(initialStroke, activeHandle.index, action.world);
			return updated
				? { ...state, doc: { ...state.doc, shapes: { ...state.doc.shapes, [updated.id]: updated } } }
				: state;
		}
		if (!initialShape) return state;

		const pathSelection = state.ui.pathSelection;
		if (!pathSelection || pathSelection.pathId !== initialShape.id) return state;

		const updated =
			activeHandle.kind === 'control'
				? moveControl(initialShape, activeHandle.ref, action.world)
				: moveAnchors(
						initialShape,
						pathSelection.anchors,
						dragStartWorld,
						action.world,
						action.modifiers.shift
					);
		if (!updated) return state;
		return { ...state, doc: { ...state.doc, shapes: { ...state.doc.shapes, [updated.id]: updated } } };
	}

	private handleEscape(state: EditorState): EditorState {
		this.resetToolState();
		const pathSelection = state.ui.pathSelection;
		if (!pathSelection) return { ...state, ui: { ...state.ui, selectionIds: [] } };
		if (pathSelection.anchors.length > 0 || (pathSelection.widthPoints?.length ?? 0) > 0) {
			return { ...state, ui: { ...state.ui, pathSelection: { ...pathSelection, anchors: [], widthPoints: [] } } };
		}
		return { ...state, ui: { ...state.ui, selectionIds: [], pathSelection: undefined } };
	}

	private getSelectedPath(state: EditorState): PathShape | null {
		const pathId = state.ui.pathSelection?.pathId;
		if (!pathId || !state.ui.selectionIds.includes(pathId)) return null;
		const path = state.doc.shapes[pathId];
		return path?.type === 'path' ? path : null;
	}

	private getSelectedStroke(state: EditorState): StrokeShape | null {
		const strokeId = state.ui.pathSelection?.pathId;
		if (!strokeId || !state.ui.selectionIds.includes(strokeId)) return null;
		const stroke = state.doc.shapes[strokeId];
		return stroke?.type === 'stroke' ? stroke : null;
	}

	private setPathSelection(state: EditorState, path: PathShape, anchors: PathAnchorRef[]): EditorState {
		return {
			...state,
			ui: {
				...state.ui,
				selectionIds: [path.id],
				pathSelection: { pathId: path.id, anchors: uniqueAnchors(anchors) }
			}
		};
	}

	private setStrokeSelection(state: EditorState, stroke: StrokeShape, widthPoints: number[]): EditorState {
		return {
			...state,
			ui: {
				...state.ui,
				selectionIds: [stroke.id],
				pathSelection: { pathId: stroke.id, anchors: [], widthPoints: [...widthPoints] }
			}
		};
	}

	private addAnchor(
		state: EditorState,
		path: PathShape,
		segment: { subpathIndex: number; segmentIndex: number; t: number }
	): EditorState {
		const operation: PathTopologyOperation = {
			type: 'add_anchor',
			subpath_index: segment.subpathIndex,
			segment_index: segment.segmentIndex,
			t: segment.t
		};
		const subpath = path.props.subpaths[segment.subpathIndex];
		const anchorIndex =
			subpath?.closed && segment.segmentIndex === subpath.segments.length
				? segment.segmentIndex
				: segment.segmentIndex + 1;
		return this.applyTopology(
			state,
			path,
			[operation],
			[{ subpathIndex: segment.subpathIndex, segmentIndex: anchorIndex }]
		);
	}

	private deleteSelectedAnchors(state: EditorState): EditorState {
		const path = this.getSelectedPath(state);
		const anchors = state.ui.pathSelection?.anchors ?? [];
		if (!path || anchors.length === 0) return state;
		const operations = [...anchors]
			.sort((left, right) => right.subpathIndex - left.subpathIndex || right.segmentIndex - left.segmentIndex)
			.map(
				(anchor): PathTopologyOperation => ({
					type: 'delete_anchor',
					subpath_index: anchor.subpathIndex,
					segment_index: anchor.segmentIndex
				})
			);
		return this.applyTopology(state, path, operations, []);
	}

	private convertSelectedSegments(state: EditorState, curve: 'quadratic' | 'cubic'): EditorState {
		const path = this.getSelectedPath(state);
		const anchors = state.ui.pathSelection?.anchors ?? [];
		if (!path) return state;
		const operations = anchors
			.filter((anchor) => anchor.segmentIndex > 0)
			.map(
				(anchor): PathTopologyOperation => ({
					type: 'convert_to_curve',
					subpath_index: anchor.subpathIndex,
					segment_index: anchor.segmentIndex,
					curve
				})
			);
		return this.applyTopology(state, path, operations, anchors);
	}

	private convertSelectedSegmentsToLines(state: EditorState): EditorState {
		const path = this.getSelectedPath(state);
		const anchors = state.ui.pathSelection?.anchors ?? [];
		if (!path) return state;
		const operations = anchors
			.filter((anchor) => anchor.segmentIndex > 0)
			.map(
				(anchor): PathTopologyOperation => ({
					type: 'convert_to_line',
					subpath_index: anchor.subpathIndex,
					segment_index: anchor.segmentIndex
				})
			);
		return this.applyTopology(state, path, operations, anchors);
	}

	private setSelectedPathsClosed(state: EditorState, closed: boolean): EditorState {
		const path = this.getSelectedPath(state);
		const anchors = state.ui.pathSelection?.anchors ?? [];
		if (!path) return state;
		const subpathIndices = [...new Set(anchors.map((anchor) => anchor.subpathIndex))];
		const operations = subpathIndices
			.filter((subpathIndex) => path.props.subpaths[subpathIndex]?.closed !== closed)
			.map(
				(subpathIndex): PathTopologyOperation => ({
					type: closed ? 'close_path' : 'open_path',
					subpath_index: subpathIndex
				})
			);
		return this.applyTopology(state, path, operations, anchors);
	}

	private joinSelectedEndpoints(state: EditorState): EditorState {
		const path = this.getSelectedPath(state);
		const anchors = state.ui.pathSelection?.anchors ?? [];
		if (!path) return state;
		const endpoints = anchors.filter((anchor) => {
			const subpath = path.props.subpaths[anchor.subpathIndex];
			return Boolean(
				subpath &&
				!subpath.closed &&
				(anchor.segmentIndex === 0 || anchor.segmentIndex === subpath.segments.length - 1)
			);
		});
		if (endpoints.length !== 2) return this.applyHandleOperation(state, 'join_handles');
		const [first, second] = endpoints;
		if (!first || !second) return state;
		if (first.subpathIndex === second.subpathIndex) {
			if (
				first.segmentIndex === 0 &&
				second.segmentIndex === path.props.subpaths[first.subpathIndex]!.segments.length - 1
			) {
				return this.applyTopology(
					state,
					path,
					[{ type: 'close_path', subpath_index: first.subpathIndex }],
					[...anchors]
				);
			}
			return state;
		}
		const operation: PathTopologyOperation = {
			type: 'join_endpoints',
			first_subpath_index: first.subpathIndex,
			first_at_start: first.segmentIndex === 0,
			second_subpath_index: second.subpathIndex,
			second_at_start: second.segmentIndex === 0
		};
		const updated = applyPathTopologyOperations(path, [operation]);
		if (!updated) return state;
		const mergedSubpathIndex = Math.min(first.subpathIndex, second.subpathIndex);
		const mergedSubpath = updated.props.subpaths[mergedSubpathIndex];
		const nextAnchors = mergedSubpath
			? [
					{ subpathIndex: mergedSubpathIndex, segmentIndex: 0 },
					{ subpathIndex: mergedSubpathIndex, segmentIndex: mergedSubpath.segments.length - 1 }
				]
			: [];
		return this.applyTopology(state, path, [operation], nextAnchors);
	}

	private applyHandleOperation(state: EditorState, type: 'break_handles' | 'join_handles'): EditorState {
		const path = this.getSelectedPath(state);
		const anchors = state.ui.pathSelection?.anchors ?? [];
		if (!path) return state;
		const operations = anchors.map(
			(anchor): PathTopologyOperation => ({
				type,
				subpath_index: anchor.subpathIndex,
				segment_index: anchor.segmentIndex
			})
		);
		return this.applyTopology(state, path, operations, anchors);
	}

	private applyTopology(
		state: EditorState,
		path: PathShape,
		operations: PathTopologyOperation[],
		anchors: PathAnchorRef[]
	): EditorState {
		if (operations.length === 0) return state;
		const updated = applyPathTopologyOperations(path, operations);
		if (!updated || JSON.stringify(updated.props) === JSON.stringify(path.props)) return state;
		const pending = this.pendingTopologyEdits.find((edit) => edit.shapeId === path.id);
		if (pending) pending.operations.push(...operations);
		else this.pendingTopologyEdits.push({ shapeId: path.id, operations: [...operations] });
		return this.setPathSelection(
			{ ...state, doc: { ...state.doc, shapes: { ...state.doc.shapes, [path.id]: updated } } },
			updated,
			anchors
		);
	}

	private beginDrag(
		kind: 'anchor' | 'control',
		ref: PathAnchorRef | PathControlRef,
		state: EditorState,
		point: Vec2
	): void {
		const pathId = state.ui.pathSelection?.pathId;
		const path = pathId ? state.doc.shapes[pathId] : undefined;
		if (!path || path.type !== 'path') return;
		this.toolState = {
			activeHandle:
				kind === 'anchor' ? { kind, ref: ref as PathAnchorRef } : { kind, ref: ref as PathControlRef },
			dragStartWorld: point,
			initialShape: ShapeRecord.clone(path) as PathShape,
			initialStroke: null
		};
	}

	private beginWidthDrag(state: EditorState, index: number, point: Vec2): void {
		const stroke = this.getSelectedStroke(state);
		if (!stroke) return;
		this.toolState = {
			activeHandle: { kind: 'width', index },
			dragStartWorld: point,
			initialShape: null,
			initialStroke: ShapeRecord.clone(stroke) as StrokeShape
		};
	}

	private resetToolState(): void {
		this.toolState = this.createToolState();
	}

	private createToolState(): DirectToolState {
		return { activeHandle: null, dragStartWorld: null, initialShape: null, initialStroke: null };
	}
}

function moveStrokeWidth(stroke: StrokeShape, index: number, worldPoint: Vec2): StrokeShape | null {
	const handle = strokeWidthHandles(stroke).find((candidate) => candidate.index === index);
	if (!handle) return null;
	const dx = handle.position.x - handle.center.x;
	const dy = handle.position.y - handle.center.y;
	const length = Math.hypot(dx, dy) || 1;
	const normal = { x: dx / length, y: dy / length };
	const localPoint = worldToLocal(worldPoint, stroke);
	const width = Math.max(
		0.01,
		Math.abs((localPoint.x - handle.center.x) * normal.x + (localPoint.y - handle.center.y) * normal.y) * 2
	);
	const profile = strokeWidthProfile(stroke);
	profile[index] = { ...profile[index]!, width };
	return { ...stroke, props: { ...stroke.props, widthProfile: profile } };
}

function toggleAnchor(current: PathAnchorRef[], anchor: PathAnchorRef, shift: boolean): PathAnchorRef[] {
	if (!shift) return [anchor];
	return current.some((candidate) => sameAnchor(candidate, anchor))
		? current.filter((candidate) => !sameAnchor(candidate, anchor))
		: [...current, anchor];
}

function toggleAnchors(current: PathAnchorRef[], anchors: PathAnchorRef[], shift: boolean): PathAnchorRef[] {
	if (!shift) return anchors;
	const allSelected = anchors.every((anchor) => current.some((candidate) => sameAnchor(candidate, anchor)));
	return allSelected
		? current.filter((candidate) => !anchors.some((anchor) => sameAnchor(anchor, candidate)))
		: uniqueAnchors([...current, ...anchors]);
}

function uniqueAnchors(anchors: PathAnchorRef[]): PathAnchorRef[] {
	return anchors.filter((anchor, index) => anchors.findIndex((candidate) => sameAnchor(candidate, anchor)) === index);
}

function sameAnchor(left: PathAnchorRef, right: PathAnchorRef): boolean {
	return left.subpathIndex === right.subpathIndex && left.segmentIndex === right.segmentIndex;
}

function moveAnchors(
	initial: PathShape,
	anchors: PathAnchorRef[],
	startWorld: Vec2,
	currentWorld: Vec2,
	constrainAxis: boolean
): PathShape | null {
	if (anchors.length === 0) return null;
	const start = worldToLocal(startWorld, initial);
	const current = worldToLocal(currentWorld, initial);
	const rawDelta = { x: current.x - start.x, y: current.y - start.y };
	const delta = constrainAxis
		? Math.abs(rawDelta.x) >= Math.abs(rawDelta.y)
			? { x: rawDelta.x, y: 0 }
			: { x: 0, y: rawDelta.y }
		: rawDelta;
	const selected = new Set(anchors.map(anchorKey));
	const updated = ShapeRecord.clone(initial) as PathShape;

	for (const anchor of anchors) {
		const segment = updated.props.subpaths[anchor.subpathIndex]?.segments[anchor.segmentIndex];
		if (segment) segment.to = add(segment.to, delta);
	}

	for (const [subpathIndex, subpath] of updated.props.subpaths.entries()) {
		for (const [segmentIndex, segment] of subpath.segments.entries()) {
			if (segmentIndex === 0) continue;
			const startSelected = selected.has(anchorKey({ subpathIndex, segmentIndex: segmentIndex - 1 }));
			const endSelected = selected.has(anchorKey({ subpathIndex, segmentIndex }));
			if (segment.type === 'quadratic' && (startSelected || endSelected)) {
				segment.control = add(segment.control, delta);
			} else if (segment.type === 'cubic') {
				if (startSelected) segment.control_1 = add(segment.control_1, delta);
				if (endSelected) segment.control_2 = add(segment.control_2, delta);
			}
		}
	}
	return updated;
}

function moveControl(initial: PathShape, control: PathControlRef, point: Vec2): PathShape | null {
	const updated = ShapeRecord.clone(initial) as PathShape;
	const segment = updated.props.subpaths[control.subpathIndex]?.segments[control.segmentIndex];
	if (!segment || segment.type === 'move' || segment.type === 'line') return null;
	const position = worldToLocal(point, initial);
	if (control.control === 'quadratic' && segment.type === 'quadratic') segment.control = position;
	else if (control.control === 'control_1' && segment.type === 'cubic') segment.control_1 = position;
	else if (control.control === 'control_2' && segment.type === 'cubic') segment.control_2 = position;
	else return null;

	if (segment.type === 'cubic') {
		const anchorIndex = control.control === 'control_1' ? control.segmentIndex - 1 : control.segmentIndex;
		const subpath = updated.props.subpaths[control.subpathIndex];
		if (subpath?.handle_modes?.[anchorIndex] === 'joined') {
			const anchor = subpath.segments[anchorIndex]?.to;
			const opposite =
				control.control === 'control_1'
					? subpath.segments[control.segmentIndex - 1]
					: subpath.segments[control.segmentIndex + 1];
			if (anchor && opposite?.type === 'cubic') {
				const oppositeControl = control.control === 'control_1' ? 'control_2' : 'control_1';
				const mirrored = { x: anchor.x * 2 - position.x, y: anchor.y * 2 - position.y };
				if (oppositeControl === 'control_1') opposite.control_1 = mirrored;
				else opposite.control_2 = mirrored;
			}
		}
	}
	return updated;
}

function anchorKey(anchor: PathAnchorRef): string {
	return `${anchor.subpathIndex}:${anchor.segmentIndex}`;
}

function add(left: Vec2, right: Vec2): Vec2 {
	return { x: left.x + right.x, y: left.y + right.y };
}
