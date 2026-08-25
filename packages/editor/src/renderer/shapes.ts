import type {
	ArrowShape,
	BindingIndex,
	EditorState,
	EditorShapeRecord,
	EllipseShape,
	LineShape,
	PathShape,
	RectShape,
	StrokeShape
} from '@inkfinite/core';
import {
	arrowGeometryForShape,
	arrowHeadGeometry,
	arrowPathForShape,
	arrowShaftGeometry,
	getStrokeOutline,
	pathGeometryBounds,
	textPathLayoutForShape
} from '@inkfinite/core';
import { applyShapeEffects, applyShapeTransform, drawNativePath, paintForCanvas } from './canvas.js';
import { drawImage, drawReference } from './assets.js';
import { drawArrowLabel, drawMarkdown, drawText, drawTextOnPath } from './text.js';
import type { RendererResources } from './resources.js';

/** Render one shape through the single exhaustive shape-kind dispatch point. */
export function drawShape(
	context: CanvasRenderingContext2D,
	state: EditorState,
	shape: EditorShapeRecord,
	bindingsBySource: BindingIndex,
	theme: 'light' | 'dark',
	resources: RendererResources,
	onImageLoaded: () => void
) {
	context.save();
	context.globalAlpha *= shape.opacity ?? 1;

	const attachedText =
		shape.type === 'text' && shape.props.textPath
			? (() => {
					context.font = `${shape.props.fontSize}px ${shape.props.fontFamily}`;
					return textPathLayoutForShape(state, shape, (value) => context.measureText(value).width);
				})()
			: null;
	if (!attachedText) {
		applyShapeTransform(context, shape);
		applyShapeEffects(context, shape);
	}

	switch (shape.type) {
		case 'rect': {
			drawRect(context, shape);
			break;
		}
		case 'ellipse': {
			drawEllipse(context, shape);
			break;
		}
		case 'line': {
			drawLine(context, shape);
			break;
		}
		case 'arrow': {
			drawArrow(context, state, shape, bindingsBySource);
			break;
		}
		case 'text': {
			if (attachedText) drawTextOnPath(context, shape, attachedText.path, attachedText.layout);
			else drawText(context, shape, resources);
			break;
		}
		case 'markdown': {
			drawMarkdown(context, shape, theme, resources);
			break;
		}
		case 'image': {
			drawImage(context, state, shape, resources.images, onImageLoaded);
			break;
		}
		case 'reference': {
			drawReference(context, shape);
			break;
		}
		case 'stroke': {
			drawStroke(context, shape);
			break;
		}
		case 'path': {
			drawPath(context, shape);
			break;
		}
		case 'container': {
			drawContainer(context, shape);
			break;
		}
		default:
			return assertNeverShape(shape);
	}

	context.restore();
}

/**
 * Draw a rectangle shape
 */
function drawRect(context: CanvasRenderingContext2D, shape: RectShape) {
	const { w, h, fill, stroke, radius } = shape.props;
	const shapeAlpha = context.globalAlpha;

	context.beginPath();
	if (radius > 0) {
		const r = Math.min(radius, w / 2, h / 2);
		context.moveTo(r, 0);
		context.lineTo(w - r, 0);
		context.arcTo(w, 0, w, r, r);
		context.lineTo(w, h - r);
		context.arcTo(w, h, w - r, h, r);
		context.lineTo(r, h);
		context.arcTo(0, h, 0, h - r, r);
		context.lineTo(0, r);
		context.arcTo(0, 0, r, 0, r);
		context.closePath();
	} else {
		context.rect(0, 0, w, h);
	}

	if (fill) {
		context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
		const fillStyle = paintForCanvas(context, fill, { x: 0, y: 0, width: w, height: h });
		if (fillStyle) {
			context.fillStyle = fillStyle;
			context.fill();
		}
	}

	if (stroke) {
		context.globalAlpha = shapeAlpha * (shape.strokeOpacity ?? 1);
		const strokeStyle = paintForCanvas(context, stroke, { x: 0, y: 0, width: w, height: h });
		if (strokeStyle) {
			context.strokeStyle = strokeStyle;
			context.lineWidth = 2;
			context.stroke();
		}
	}
}

/**
 * Draw an ellipse shape
 */
function drawEllipse(context: CanvasRenderingContext2D, shape: EllipseShape) {
	const { w, h, fill, stroke } = shape.props;
	const shapeAlpha = context.globalAlpha;

	context.beginPath();
	context.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);

	if (fill) {
		context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
		const fillStyle = paintForCanvas(context, fill, { x: 0, y: 0, width: w, height: h });
		if (fillStyle) {
			context.fillStyle = fillStyle;
			context.fill();
		}
	}

	if (stroke) {
		context.globalAlpha = shapeAlpha * (shape.strokeOpacity ?? 1);
		const strokeStyle = paintForCanvas(context, stroke, { x: 0, y: 0, width: w, height: h });
		if (strokeStyle) {
			context.strokeStyle = strokeStyle;
			context.lineWidth = 2;
			context.stroke();
		}
	}
}

/**
 * Draw a line shape
 */
function drawLine(context: CanvasRenderingContext2D, shape: LineShape) {
	const { a, b, stroke, width } = shape.props;

	context.beginPath();
	context.moveTo(a.x, a.y);
	context.lineTo(b.x, b.y);

	context.globalAlpha *= shape.strokeOpacity ?? 1;
	const strokeStyle = paintForCanvas(context, stroke, {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		width: Math.abs(b.x - a.x),
		height: Math.abs(b.y - a.y)
	});
	if (strokeStyle) {
		context.strokeStyle = strokeStyle;
		context.lineWidth = width;
		context.stroke();
	}
}

function drawContainer(context: CanvasRenderingContext2D, shape: Extract<EditorShapeRecord, { type: 'container' }>) {
	const { w = 0, h = 0, title, fill, stroke, radius = 0 } = shape.props;
	const shapeAlpha = context.globalAlpha;
	context.beginPath();
	if (radius > 0) {
		const r = Math.min(radius, w / 2, h / 2);
		context.moveTo(r, 0);
		context.lineTo(w - r, 0);
		context.arcTo(w, 0, w, r, r);
		context.lineTo(w, h - r);
		context.arcTo(w, h, w - r, h, r);
		context.lineTo(r, h);
		context.arcTo(0, h, 0, h - r, r);
		context.lineTo(0, r);
		context.arcTo(0, 0, r, 0, r);
		context.closePath();
	} else {
		context.rect(0, 0, w, h);
	}
	if (fill) {
		context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
		const fillStyle = paintForCanvas(context, fill, { x: 0, y: 0, width: w, height: h });
		if (fillStyle) {
			context.fillStyle = fillStyle;
			context.fill();
		}
	}
	if (stroke) {
		context.globalAlpha = shapeAlpha * (shape.strokeOpacity ?? 1);
		const strokeStyle = paintForCanvas(context, stroke, { x: 0, y: 0, width: w, height: h });
		if (strokeStyle) {
			context.strokeStyle = strokeStyle;
			context.lineWidth = 1.5;
			context.stroke();
		}
	}
	if (title) {
		context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
		context.fillStyle = paintForCanvas(context, stroke, { x: 0, y: 0, width: w, height: h }) ?? '#69717d';
		context.font = '600 14px sans-serif';
		context.textBaseline = 'top';
		context.fillText(title, 8, 6);
		context.globalAlpha = shapeAlpha * (shape.strokeOpacity ?? 1);
		context.strokeStyle =
			paintForCanvas(context, stroke, { x: 0, y: 0, width: w, height: h }) ?? 'rgba(37, 99, 235, 0.45)';
		context.lineWidth = 1;
		context.beginPath();
		context.moveTo(0, 26);
		context.lineTo(w, 26);
		context.stroke();
	}
}

/** Draw a native path shape using the shared Canvas path helper. */
function drawPath(context: CanvasRenderingContext2D, shape: PathShape): void {
	const { subpaths, fill_rule: fillRule, fill, stroke, stroke_width: strokeWidth } = shape.props;
	const shapeAlpha = context.globalAlpha;
	drawNativePath(context, { subpaths, fill_rule: fillRule });
	if (fill && fill !== 'none' && fill !== 'transparent') {
		context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
		const fillStyle = paintForCanvas(context, fill, pathGeometryBounds(shape.props));
		if (fillStyle) {
			context.fillStyle = fillStyle;
			context.fill(fillRule);
		}
	}
	if (stroke && stroke !== 'none' && stroke !== 'transparent') {
		context.globalAlpha = shapeAlpha * (shape.strokeOpacity ?? 1);
		const strokeStyle = paintForCanvas(context, stroke, pathGeometryBounds(shape.props));
		if (strokeStyle) {
			context.strokeStyle = strokeStyle;
			context.lineWidth = Math.max(0, strokeWidth ?? 2);
			context.stroke();
		}
	}
}

/**
 * Draw an arrow shape
 */
function drawArrow(
	context: CanvasRenderingContext2D,
	state: EditorState,
	shape: ArrowShape,
	bindingsBySource?: BindingIndex
) {
	const style = shape.props.style;
	const shapeAlpha = context.globalAlpha;

	const geometry = arrowGeometryForShape(state, shape, bindingsBySource);
	if (!geometry) return;

	const shaft = arrowShaftGeometry(geometry.path, style);
	drawNativePath(context, shaft);

	const strokePaint = paintForCanvas(context, style.stroke, pathGeometryBounds(geometry.path));
	if (!strokePaint) return;
	context.strokeStyle = strokePaint;
	context.globalAlpha = shapeAlpha * (shape.strokeOpacity ?? 1);
	context.lineWidth = style.width;
	if (style.dash) context.setLineDash(style.dash);
	context.stroke();
	if (style.dash) context.setLineDash([]);

	const drawHead = (atStart: boolean) => {
		const head = arrowHeadGeometry(geometry.path, atStart);
		if (!head) return;
		const headStyle = atStart ? style.headStartStyle : style.headEndStyle;
		context.beginPath();
		context.moveTo(head.tip.x, head.tip.y);
		if (headStyle === 'triangle') {
			context.lineTo(head.left.x, head.left.y);
			context.lineTo(head.right.x, head.right.y);
			context.closePath();
			const headFill = paintForCanvas(context, style.stroke, pathGeometryBounds(geometry.path));
			if (headFill) {
				context.fillStyle = headFill;
				context.fill();
			}
		} else {
			context.lineTo(head.left.x, head.left.y);
			context.moveTo(head.tip.x, head.tip.y);
			context.lineTo(head.right.x, head.right.y);
		}
		const headStroke = paintForCanvas(context, style.stroke, pathGeometryBounds(geometry.path));
		if (headStroke) {
			context.strokeStyle = headStroke;
			context.lineWidth = style.width;
			context.stroke();
		}
	};

	if (style.headEnd !== false) drawHead(false);
	if (style.headStart) drawHead(true);

	const label = shape.props.label;
	if (label) {
		context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
		drawArrowLabel(context, state, geometry.path, label);
	}
}

/**
 * Draw a stroke shape (freehand drawing)
 */
function drawStroke(context: CanvasRenderingContext2D, shape: StrokeShape) {
	const { points, style } = shape.props;

	if (points.length < 2) {
		return;
	}

	const outline = getStrokeOutline(shape);

	if (outline.length === 0) {
		return;
	}

	context.globalAlpha *= shape.strokeOpacity ?? style.opacity;
	const outlineBounds = {
		x: Math.min(...outline.map((point) => point.x)),
		y: Math.min(...outline.map((point) => point.y)),
		width: Math.max(...outline.map((point) => point.x)) - Math.min(...outline.map((point) => point.x)),
		height: Math.max(...outline.map((point) => point.y)) - Math.min(...outline.map((point) => point.y))
	};
	context.fillStyle = paintForCanvas(context, style.color, outlineBounds) ?? '#000000';
	context.beginPath();
	context.moveTo(outline[0].x, outline[0].y);

	for (let i = 1; i < outline.length; i++) {
		context.lineTo(outline[i].x, outline[i].y);
	}

	context.closePath();
	context.fill();
}

function assertNeverShape(shape: never): never {
	throw new Error(`Unsupported shape type: ${String(shape)}`);
}
