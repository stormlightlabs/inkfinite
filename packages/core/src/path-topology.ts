import { validatePathGeometry } from '@inkfinite/bindings';
import type { PathCurveKind, PathHandleMode, PathTopologyOperation } from './editor-model';
import { EditorShapeRecord, type PathShape, type PathSegment, type PathSubpath } from './editor-model';
import type { Vec2 } from './math';

/**
 * Applies the canonical path-topology semantics to a local editor preview.
 *
 * Rust applies the same operations at commit time. Returning a cloned shape
 * keeps pointer previews separate from the committed document snapshot.
 */
export function applyPathTopologyOperations(
	shape: PathShape,
	operations: readonly PathTopologyOperation[]
): PathShape | null {
	if (!validatePathGeometry(shape.props)) return null;
	const preview = EditorShapeRecord.clone(shape) as PathShape;
	for (const operation of operations) {
		if (!applyPathTopologyOperation(preview, operation)) return null;
	}
	return validatePathGeometry(preview.props) ? preview : null;
}

function applyPathTopologyOperation(shape: PathShape, operation: PathTopologyOperation): boolean {
	if (operation.type === 'join_endpoints') {
		return joinEndpoints(
			shape,
			operation.first_subpath_index,
			operation.first_at_start,
			operation.second_subpath_index,
			operation.second_at_start
		);
	}
	const subpath = shape.props.subpaths[operation.subpath_index];
	if (!subpath) return false;

	switch (operation.type) {
		case 'add_anchor':
			return splitSegment(subpath, operation.segment_index, operation.t);
		case 'delete_anchor':
			return deleteAnchor(subpath, operation.segment_index);
		case 'convert_to_curve':
			return convertToCurve(subpath, operation.segment_index, operation.curve);
		case 'convert_to_line':
			return convertToLine(subpath, operation.segment_index);
		case 'open_path':
			if (!subpath.closed) return false;
			subpath.closed = false;
			return true;
		case 'close_path':
			if (subpath.closed) return false;
			subpath.closed = true;
			return true;
		case 'break_handles':
			return setHandleMode(subpath, operation.segment_index, 'broken');
		case 'join_handles':
			return joinHandles(subpath, operation.segment_index);
	}
}

function joinEndpoints(
	shape: PathShape,
	firstSubpathIndex: number,
	firstAtStart: boolean,
	secondSubpathIndex: number,
	secondAtStart: boolean
): boolean {
	if (firstSubpathIndex === secondSubpathIndex) return false;
	const first = shape.props.subpaths[firstSubpathIndex];
	const second = shape.props.subpaths[secondSubpathIndex];
	if (!first || !second || first.closed || second.closed) return false;

	const orientedFirst = firstAtStart ? reverseSubpath(first) : first;
	const orientedSecond = secondAtStart ? second : reverseSubpath(second);
	const firstEnd = orientedFirst.segments.at(-1)?.to;
	const secondStart = orientedSecond.segments[0]?.to;
	if (!firstEnd || !secondStart) return false;

	const firstModes = handleModes(orientedFirst);
	const secondModes = handleModes(orientedSecond);
	const hasHandleModes = orientedFirst.handle_modes !== undefined || orientedSecond.handle_modes !== undefined;
	const segments = [...orientedFirst.segments];
	const modes = [...firstModes];
	if (firstEnd.x !== secondStart.x || firstEnd.y !== secondStart.y) {
		segments.push({ type: 'line', to: { ...secondStart } });
		modes.push(secondModes[0]!);
	}
	segments.push(...orientedSecond.segments.slice(1));
	modes.push(...secondModes.slice(1));

	const merged: PathSubpath = {
		segments,
		closed: false,
		...(hasHandleModes ? { handle_modes: modes } : {})
	};
	const targetIndex = Math.min(firstSubpathIndex, secondSubpathIndex);
	const removedIndex = Math.max(firstSubpathIndex, secondSubpathIndex);
	shape.props.subpaths[targetIndex] = merged;
	shape.props.subpaths.splice(removedIndex, 1);
	return true;
}

function reverseSubpath(subpath: PathSubpath): PathSubpath {
	const original = subpath.segments;
	const segments: PathSegment[] = [];
	const last = original.at(-1);
	if (last) {
		segments.push({ type: 'move', to: { ...last.to } });
		for (let index = original.length - 1; index >= 1; index -= 1) {
			const segment = original[index]!;
			const start = original[index - 1]!.to;
			if (segment.type === 'line') segments.push({ type: 'line', to: { ...start } });
			else if (segment.type === 'quadratic') {
				segments.push({ type: 'quadratic', control: { ...segment.control }, to: { ...start } });
			} else if (segment.type === 'cubic') {
				segments.push({
					type: 'cubic',
					control_1: { ...segment.control_2 },
					control_2: { ...segment.control_1 },
					to: { ...start }
				});
			}
		}
	}
	return {
		segments,
		closed: subpath.closed,
		...(subpath.handle_modes ? { handle_modes: [...subpath.handle_modes].reverse() } : {})
	};
}

function handleModes(subpath: PathSubpath): PathHandleMode[] {
	return subpath.handle_modes
		? [...subpath.handle_modes]
		: Array.from({ length: subpath.segments.length }, () => 'broken' as const);
}

function splitSegment(subpath: PathSubpath, segmentIndex: number, t: number): boolean {
	if (!Number.isFinite(t) || t <= 0 || t >= 1 || segmentIndex <= 0) return false;
	const closing = segmentIndex === subpath.segments.length && subpath.closed;
	const segment = closing
		? ({ type: 'line', to: segmentTo(subpath.segments[0]!) } as const)
		: subpath.segments[segmentIndex];
	const start = closing
		? segmentTo(subpath.segments[subpath.segments.length - 1]!)
		: segmentStart(subpath, segmentIndex);
	if (!segment || !start || segment.type === 'move') return false;

	let first: PathSegment;
	let second: PathSegment;
	if (segment.type === 'line') {
		const middle = lerp(start, segment.to, t);
		first = { type: 'line', to: middle };
		second = { type: 'line', to: segment.to };
	} else if (segment.type === 'quadratic') {
		const firstControl = lerp(start, segment.control, t);
		const secondControl = lerp(segment.control, segment.to, t);
		const middle = lerp(firstControl, secondControl, t);
		first = { type: 'quadratic', control: firstControl, to: middle };
		second = { type: 'quadratic', control: secondControl, to: segment.to };
	} else {
		const firstControl = lerp(start, segment.control_1, t);
		const bridge = lerp(segment.control_1, segment.control_2, t);
		const secondControl = lerp(segment.control_2, segment.to, t);
		const firstBridge = lerp(firstControl, bridge, t);
		const secondBridge = lerp(bridge, secondControl, t);
		const middle = lerp(firstBridge, secondBridge, t);
		first = { type: 'cubic', control_1: firstControl, control_2: firstBridge, to: middle };
		second = { type: 'cubic', control_1: secondBridge, control_2: secondControl, to: segment.to };
	}

	if (closing) {
		subpath.segments.push(first);
		if (subpath.handle_modes) subpath.handle_modes.push('joined');
	} else {
		subpath.segments[segmentIndex] = first;
		subpath.segments.splice(segmentIndex + 1, 0, second);
		if (subpath.handle_modes) subpath.handle_modes.splice(segmentIndex + 1, 0, 'joined');
	}
	return true;
}

function deleteAnchor(subpath: PathSubpath, segmentIndex: number): boolean {
	if (subpath.segments.length === 1 || segmentIndex < 0 || segmentIndex >= subpath.segments.length) return false;
	if (segmentIndex === 0) {
		const replacement = subpath.segments[1];
		if (!replacement) return false;
		subpath.segments[0] = { type: 'move', to: segmentTo(replacement) };
		subpath.segments.splice(1, 1);
		if (subpath.handle_modes) {
			subpath.handle_modes[0] = subpath.handle_modes[1] ?? 'broken';
			subpath.handle_modes.splice(1, 1);
		}
		return true;
	}

	subpath.segments.splice(segmentIndex, 1);
	subpath.handle_modes?.splice(segmentIndex, 1);
	return true;
}

function convertToCurve(subpath: PathSubpath, segmentIndex: number, curve: PathCurveKind): boolean {
	if (segmentIndex <= 0) return false;
	const segment = subpath.segments[segmentIndex];
	const start = segmentStart(subpath, segmentIndex);
	if (!segment || !start) return false;
	if (segment.type !== 'line') return true;
	if (curve === 'quadratic') {
		subpath.segments[segmentIndex] = { type: 'quadratic', control: lerp(start, segment.to, 0.5), to: segment.to };
	} else {
		subpath.segments[segmentIndex] = {
			type: 'cubic',
			control_1: lerp(start, segment.to, 1 / 3),
			control_2: lerp(start, segment.to, 2 / 3),
			to: segment.to
		};
	}
	return true;
}

function convertToLine(subpath: PathSubpath, segmentIndex: number): boolean {
	if (segmentIndex <= 0) return false;
	const segment = subpath.segments[segmentIndex];
	if (!segment || segment.type === 'move') return false;
	if (segment.type !== 'line') subpath.segments[segmentIndex] = { type: 'line', to: segment.to };
	return true;
}

function setHandleMode(subpath: PathSubpath, segmentIndex: number, mode: PathHandleMode): boolean {
	if (segmentIndex < 0 || segmentIndex >= subpath.segments.length) return false;
	subpath.handle_modes ??= Array.from({ length: subpath.segments.length }, () => 'broken' as const);
	subpath.handle_modes[segmentIndex] = mode;
	return true;
}

function joinHandles(subpath: PathSubpath, segmentIndex: number): boolean {
	if (!setHandleMode(subpath, segmentIndex, 'joined')) return false;
	if (segmentIndex <= 0 || segmentIndex + 1 >= subpath.segments.length) return true;
	const incoming = subpath.segments[segmentIndex];
	const outgoing = subpath.segments[segmentIndex + 1];
	if (incoming.type !== 'cubic' || outgoing.type !== 'cubic') return true;

	const anchor = incoming.to;
	let direction = subtract(outgoing.control_1, anchor);
	if (length(direction) <= Number.EPSILON) direction = subtract(anchor, incoming.control_2);
	const directionLength = length(direction);
	if (directionLength <= Number.EPSILON) return true;
	const unit = scale(direction, 1 / directionLength);
	const incomingLength = length(subtract(incoming.control_2, anchor));
	const outgoingLength = length(subtract(outgoing.control_1, anchor));
	incoming.control_2 = subtract(anchor, scale(unit, incomingLength));
	outgoing.control_1 = add(anchor, scale(unit, outgoingLength));
	return true;
}

function segmentStart(subpath: PathSubpath, segmentIndex: number): Vec2 | null {
	if (segmentIndex <= 0) return null;
	const previous = subpath.segments[segmentIndex - 1];
	return previous ? segmentTo(previous) : null;
}

function segmentTo(segment: PathSegment): Vec2 {
	return segment.to;
}

function lerp(start: Vec2, end: Vec2, t: number): Vec2 {
	return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
}

function subtract(left: Vec2, right: Vec2): Vec2 {
	return { x: left.x - right.x, y: left.y - right.y };
}

function add(left: Vec2, right: Vec2): Vec2 {
	return { x: left.x + right.x, y: left.y + right.y };
}

function scale(point: Vec2, factor: number): Vec2 {
	return { x: point.x * factor, y: point.y * factor };
}

function length(point: Vec2): number {
	return Math.hypot(point.x, point.y);
}
