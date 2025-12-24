import type {
  ArrowShape,
  Camera,
  CursorState,
  EditorState,
  EllipseShape,
  LineShape,
  RectShape,
  ShapeRecord,
  Store,
  StrokeShape,
  TextShape,
  Vec2,
  Viewport,
} from "inkfinite-core";
import { computeOutline, getShapesOnCurrentPage, resolveArrowEndpoints, shapeBounds } from "inkfinite-core";

export interface Renderer {
  /**
   * Clean up the renderer and stop rendering
   */
  dispose(): void;

  /**
   * Force a redraw on the next frame
   */
  markDirty(): void;
}

export type SnapSettings = { snapEnabled: boolean; gridEnabled: boolean; gridSize: number };

export type PointerVisualState = { isPointerDown: boolean; snappedWorld?: Vec2 | null };

export type HandleRenderState = { hover: string | null; active: string | null } | null | undefined;

export type RendererOptions = {
  snapProvider?: { get(): SnapSettings };
  cursorProvider?: { get(): CursorState };
  pointerStateProvider?: { get(): PointerVisualState };
  handleProvider?: { get(): HandleRenderState };
};

/**
 * Create a canvas renderer
 *
 * The renderer subscribes to the store and redraws the canvas
 * whenever the state changes. It uses requestAnimationFrame with
 * a dirty flag to optimize rendering.
 *
 * @param canvas - The HTMLCanvasElement to render to
 * @param store - The editor state store
 * @param gridProvider - Optional provider for grid settings (snap store)
 * @returns Renderer instance with dispose method
 */
export function createRenderer(canvas: HTMLCanvasElement, store: Store, options?: RendererOptions): Renderer {
  const maybeContext = canvas.getContext("2d");
  if (!maybeContext) {
    throw new Error("Failed to get 2D context from canvas");
  }
  const context: CanvasRenderingContext2D = maybeContext;

  let isDirty = true;
  let animationFrameId: number | null = null;
  let isDisposed = false;

  /**
   * Mark the canvas as needing a redraw
   */
  function markDirty() {
    if (isDisposed) return;
    isDirty = true;
    if (animationFrameId === null) {
      scheduleRender();
    }
  }

  /**
   * Schedule a render on the next animation frame
   */
  function scheduleRender() {
    animationFrameId = requestAnimationFrame(() => {
      animationFrameId = null;
      if (isDirty && !isDisposed) {
        render();
        isDirty = false;
        scheduleRender();
      }
    });
  }

  /**
   * Render the current state to the canvas
   */
  function render() {
    const state = store.getState();

    setupCanvas(canvas, context);

    const viewport: Viewport = { width: canvas.width / getPixelRatio(), height: canvas.height / getPixelRatio() };

    const snapSettings = options?.snapProvider?.get();
    const cursorState = options?.cursorProvider?.get();
    const pointerState = options?.pointerStateProvider?.get();
    const handleState = options?.handleProvider?.get();
    drawScene(context, state, viewport, snapSettings, cursorState, pointerState, handleState);
  }

  /**
   * Subscribe to store updates and mark dirty
   */
  const unsubscribe = store.subscribe(() => {
    markDirty();
  });

  /**
   * Dispose the renderer
   */
  function dispose() {
    isDisposed = true;
    unsubscribe();
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  markDirty();

  return { dispose, markDirty };
}

/**
 * Setup canvas with proper pixel ratio for sharp rendering
 */
function setupCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  const pixelRatio = getPixelRatio();
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * pixelRatio;
  canvas.height = rect.height * pixelRatio;

  context.scale(pixelRatio, pixelRatio);
}

/**
 * Get device pixel ratio for sharp rendering on high-DPI displays
 */
function getPixelRatio(): number {
  return globalThis.window !== undefined && window.devicePixelRatio ? window.devicePixelRatio : 1;
}

/**
 * Draw the entire scene
 */
function drawScene(
  context: CanvasRenderingContext2D,
  state: EditorState,
  viewport: Viewport,
  snapSettings?: SnapSettings,
  cursorState?: CursorState,
  pointerState?: PointerVisualState,
  handleState?: HandleRenderState,
) {
  context.clearRect(0, 0, viewport.width, viewport.height);

  context.save();

  applyCameraTransform(context, state.camera, viewport);

  drawGrid(context, state.camera, viewport, snapSettings);

  const shapes = getShapesOnCurrentPage(state);
  for (const shape of shapes) {
    drawShape(context, state, shape);
  }

  drawSelection(context, state, shapes, handleState);

  drawSnapGuides(context, state.camera, viewport, snapSettings, cursorState, pointerState);

  context.restore();
}

/**
 * Apply camera transform to the canvas context
 *
 * This transforms the coordinate system so that drawing in world
 * coordinates appears correctly on screen.
 */
function applyCameraTransform(context: CanvasRenderingContext2D, camera: Camera, viewport: Viewport) {
  context.translate(viewport.width / 2, viewport.height / 2);

  context.scale(camera.zoom, camera.zoom);

  context.translate(-camera.x, -camera.y);
}

/**
 * Draw grid/graph paper background
 *
 * Draws a subtle grid that helps with spatial awareness and alignment.
 * The grid adapts to zoom level to maintain visual clarity.
 */
function drawGrid(context: CanvasRenderingContext2D, camera: Camera, viewport: Viewport, snapSettings?: SnapSettings) {
  if (snapSettings && !snapSettings.gridEnabled) {
    return;
  }
  const gridSize = snapSettings?.gridSize ?? 50;
  const minorGridColor = "rgba(128, 128, 128, 0.1)";
  const majorGridColor = "rgba(128, 128, 128, 0.2)";

  const topLeft = {
    x: camera.x - viewport.width / (2 * camera.zoom),
    y: camera.y - viewport.height / (2 * camera.zoom),
  };
  const bottomRight = {
    x: camera.x + viewport.width / (2 * camera.zoom),
    y: camera.y + viewport.height / (2 * camera.zoom),
  };

  const startX = Math.floor(topLeft.x / gridSize) * gridSize;
  const endX = Math.ceil(bottomRight.x / gridSize) * gridSize;
  const startY = Math.floor(topLeft.y / gridSize) * gridSize;
  const endY = Math.ceil(bottomRight.y / gridSize) * gridSize;

  context.lineWidth = 1 / camera.zoom;

  for (let x = startX; x <= endX; x += gridSize) {
    const isMajor = x % (gridSize * 5) === 0;
    context.strokeStyle = isMajor ? majorGridColor : minorGridColor;
    context.beginPath();
    context.moveTo(x, startY);
    context.lineTo(x, endY);
    context.stroke();
  }

  for (let y = startY; y <= endY; y += gridSize) {
    const isMajor = y % (gridSize * 5) === 0;
    context.strokeStyle = isMajor ? majorGridColor : minorGridColor;
    context.beginPath();
    context.moveTo(startX, y);
    context.lineTo(endX, y);
    context.stroke();
  }
}

function drawSnapGuides(
  context: CanvasRenderingContext2D,
  camera: Camera,
  viewport: Viewport,
  snapSettings?: SnapSettings,
  cursorState?: CursorState,
  pointerState?: PointerVisualState,
) {
  if (!snapSettings?.snapEnabled || !pointerState?.isPointerDown) {
    return;
  }

  const gridSize = snapSettings.gridSize || 1;
  const guideWorld = pointerState.snappedWorld ?? cursorState?.cursorWorld;
  if (!guideWorld) {
    return;
  }
  const snappedX = pointerState.snappedWorld
    ? pointerState.snappedWorld.x
    : Math.round(guideWorld.x / gridSize) * gridSize;
  const snappedY = pointerState.snappedWorld
    ? pointerState.snappedWorld.y
    : Math.round(guideWorld.y / gridSize) * gridSize;

  const halfWidth = viewport.width / (2 * camera.zoom);
  const halfHeight = viewport.height / (2 * camera.zoom);
  const minX = camera.x - halfWidth;
  const maxX = camera.x + halfWidth;
  const minY = camera.y - halfHeight;
  const maxY = camera.y + halfHeight;

  context.save();
  const dashLength = 4 / camera.zoom;
  context.setLineDash([dashLength, dashLength]);
  context.lineWidth = 1 / camera.zoom;
  context.strokeStyle = "rgba(59, 130, 246, 0.6)";

  context.beginPath();
  context.moveTo(minX, snappedY);
  context.lineTo(maxX, snappedY);
  context.stroke();

  context.beginPath();
  context.moveTo(snappedX, minY);
  context.lineTo(snappedX, maxY);
  context.stroke();

  context.setLineDash([]);
  context.fillStyle = "rgba(59, 130, 246, 0.6)";
  context.beginPath();
  context.arc(snappedX, snappedY, 4 / camera.zoom, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

/**
 * Draw a single shape
 */
function drawShape(context: CanvasRenderingContext2D, state: EditorState, shape: ShapeRecord) {
  context.save();

  context.translate(shape.x, shape.y);
  if (shape.rot !== 0) {
    context.rotate(shape.rot);
  }

  switch (shape.type) {
    case "rect": {
      drawRect(context, shape);
      break;
    }
    case "ellipse": {
      drawEllipse(context, shape);
      break;
    }
    case "line": {
      drawLine(context, shape);
      break;
    }
    case "arrow": {
      drawArrow(context, state, shape);
      break;
    }
    case "text": {
      drawText(context, shape);
      break;
    }
    case "stroke": {
      drawStroke(context, shape);
      break;
    }
  }

  context.restore();
}

/**
 * Draw a rectangle shape
 */
function drawRect(context: CanvasRenderingContext2D, shape: RectShape) {
  const { w, h, fill, stroke, radius } = shape.props;

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
    context.fillStyle = fill;
    context.fill();
  }

  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 2;
    context.stroke();
  }
}

/**
 * Draw an ellipse shape
 */
function drawEllipse(context: CanvasRenderingContext2D, shape: EllipseShape) {
  const { w, h, fill, stroke } = shape.props;

  context.beginPath();
  context.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);

  if (fill) {
    context.fillStyle = fill;
    context.fill();
  }

  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 2;
    context.stroke();
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

  context.strokeStyle = stroke;
  context.lineWidth = width;
  context.stroke();
}

/**
 * Draw an arrow shape
 */
function drawArrow(context: CanvasRenderingContext2D, state: EditorState, shape: ArrowShape) {
  const legacyStroke = shape.props.stroke;
  const legacyWidth = shape.props.width;
  const modernStyle = shape.props.style;
  const style = modernStyle ?? { stroke: legacyStroke ?? "#000", width: legacyWidth ?? 2 };

  const resolved = resolveArrowEndpoints(state, shape.id);
  if (!resolved) return;

  const a = { x: resolved.a.x - shape.x, y: resolved.a.y - shape.y };
  const b = { x: resolved.b.x - shape.x, y: resolved.b.y - shape.y };

  let points: Vec2[];
  const modernPoints = shape.props.points;
  if (modernPoints && modernPoints.length >= 2) {
    points = modernPoints.map((p: Vec2, index: number) => {
      if (index === 0) return a;
      if (index === modernPoints.length - 1) return b;
      return p;
    });
  } else {
    points = [a, b];
  }

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    context.lineTo(points[i].x, points[i].y);
  }

  context.strokeStyle = style.stroke;
  context.lineWidth = style.width;
  if (style.dash) {
    context.setLineDash(style.dash);
  }
  context.stroke();
  if (style.dash) {
    context.setLineDash([]);
  }

  const lastSegment = { from: points[points.length - 2], to: points[points.length - 1] };
  const angle = Math.atan2(lastSegment.to.y - lastSegment.from.y, lastSegment.to.x - lastSegment.from.x);
  const arrowLength = 15;
  const arrowAngle = Math.PI / 6;

  const drawHead = (at: Vec2, reverse: boolean) => {
    const dir = reverse ? angle + Math.PI : angle;
    context.beginPath();
    context.moveTo(at.x, at.y);
    context.lineTo(at.x - arrowLength * Math.cos(dir - arrowAngle), at.y - arrowLength * Math.sin(dir - arrowAngle));
    context.moveTo(at.x, at.y);
    context.lineTo(at.x - arrowLength * Math.cos(dir + arrowAngle), at.y - arrowLength * Math.sin(dir + arrowAngle));
    context.strokeStyle = style.stroke;
    context.lineWidth = style.width;
    context.stroke();
  };

  if (style.headEnd !== false) {
    drawHead(lastSegment.to, false);
  }

  if (style.headStart) {
    const firstSegment = { from: points[0], to: points[1] };
    const startAngle = Math.atan2(firstSegment.to.y - firstSegment.from.y, firstSegment.to.x - firstSegment.from.x);
    const startDir = startAngle + Math.PI;
    context.beginPath();
    context.moveTo(firstSegment.from.x, firstSegment.from.y);
    context.lineTo(
      firstSegment.from.x - arrowLength * Math.cos(startDir - arrowAngle),
      firstSegment.from.y - arrowLength * Math.sin(startDir - arrowAngle),
    );
    context.moveTo(firstSegment.from.x, firstSegment.from.y);
    context.lineTo(
      firstSegment.from.x - arrowLength * Math.cos(startDir + arrowAngle),
      firstSegment.from.y - arrowLength * Math.sin(startDir + arrowAngle),
    );
    context.strokeStyle = style.stroke;
    context.lineWidth = style.width;
    context.stroke();
  }

  const label = shape.props.label;
  if (label) {
    drawArrowLabel(context, state, points, label);
  }
}

/**
 * Draw an arrow label
 */
function drawArrowLabel(
  context: CanvasRenderingContext2D,
  state: EditorState,
  points: Vec2[],
  label: { text: string; align: string; offset: number },
) {
  if (!label.text) return;

  let labelPos: Vec2;
  const totalLength = computePolylineLength(points);
  let targetDist: number;

  if (label.align === "start") {
    targetDist = label.offset;
  } else if (label.align === "end") {
    targetDist = totalLength - label.offset;
  } else {
    targetDist = totalLength / 2 + label.offset;
  }

  labelPos = getPointAtDistance(points, targetDist);

  context.save();
  context.font = "14px sans-serif";
  context.fillStyle = "#000";
  context.textAlign = "center";
  context.textBaseline = "bottom";
  const metrics = context.measureText(label.text);
  const padding = 4;
  const bgWidth = metrics.width + padding * 2;
  const bgHeight = 18;

  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  context.fillRect(labelPos.x - bgWidth / 2, labelPos.y - bgHeight - 5, bgWidth, bgHeight);
  context.strokeStyle = "#ccc";
  context.lineWidth = 1 / state.camera.zoom;
  context.strokeRect(labelPos.x - bgWidth / 2, labelPos.y - bgHeight - 5, bgWidth, bgHeight);

  context.fillStyle = "#000";
  context.fillText(label.text, labelPos.x, labelPos.y - 5);
  context.restore();
}

function computePolylineLength(points: Vec2[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}

function getPointAtDistance(points: Vec2[], targetDist: number): Vec2 {
  let accum = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (accum + segLen >= targetDist) {
      const t = (targetDist - accum) / segLen;
      return { x: points[i - 1].x + dx * t, y: points[i - 1].y + dy * t };
    }
    accum += segLen;
  }
  return points[points.length - 1];
}

/**
 * Draw a text shape
 */
function drawText(context: CanvasRenderingContext2D, shape: TextShape) {
  const { text, fontSize, fontFamily, color, w } = shape.props;

  context.font = `${fontSize}px ${fontFamily}`;
  context.fillStyle = color;
  context.textBaseline = "top";

  if (w === undefined) {
    context.fillText(text, 0, 0);
  } else {
    const lines = wrapText(context, text, w);
    for (const [index, line] of lines.entries()) {
      context.fillText(line, 0, index * fontSize * 1.2);
    }
  }
}

/**
 * Draw a stroke shape (freehand drawing)
 */
function drawStroke(context: CanvasRenderingContext2D, shape: StrokeShape) {
  const { points, brush, style } = shape.props;

  if (points.length < 2) {
    return;
  }

  const outline = computeOutline(points, brush);

  if (outline.length === 0) {
    return;
  }

  context.globalAlpha = style.opacity;
  context.fillStyle = style.color;
  context.beginPath();
  context.moveTo(outline[0].x, outline[0].y);

  for (let i = 1; i < outline.length; i++) {
    context.lineTo(outline[i].x, outline[i].y);
  }

  context.closePath();
  context.fill();
  context.globalAlpha = 1.0;
}

/**
 * Wrap text to fit within a given width
 */
function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = context.measureText(testLine);

    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Draw selection outlines for selected shapes
 */
function drawSelection(
  context: CanvasRenderingContext2D,
  state: EditorState,
  shapes: ShapeRecord[],
  handleState?: HandleRenderState,
) {
  const selectedIds = new Set(state.ui.selectionIds);
  const singleSelectionId = state.ui.selectionIds.length === 1 ? state.ui.selectionIds[0] : null;

  for (const shape of shapes) {
    if (!selectedIds.has(shape.id)) continue;

    context.save();
    context.translate(shape.x, shape.y);
    if (shape.rot !== 0) {
      context.rotate(shape.rot);
    }

    context.strokeStyle = "#0066ff";
    context.lineWidth = 2 / state.camera.zoom;
    context.setLineDash([4 / state.camera.zoom, 4 / state.camera.zoom]);

    switch (shape.type) {
      case "rect": {
        const { w, h } = shape.props;
        context.strokeRect(0, 0, w, h);
        break;
      }
      case "ellipse": {
        const { w, h } = shape.props;
        context.strokeRect(0, 0, w, h);
        break;
      }
      case "line": {
        const { a, b } = shape.props;
        const minX = Math.min(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxX = Math.max(a.x, b.x);
        const maxY = Math.max(a.y, b.y);
        const padding = 5;
        context.strokeRect(minX - padding, minY - padding, maxX - minX + padding * 2, maxY - minY + padding * 2);
        break;
      }
      case "arrow": {
        const bounds = shapeBounds(shape);
        const localBounds = {
          minX: bounds.min.x - shape.x,
          minY: bounds.min.y - shape.y,
          maxX: bounds.max.x - shape.x,
          maxY: bounds.max.y - shape.y,
        };
        const padding = 5;
        context.strokeRect(
          localBounds.minX - padding,
          localBounds.minY - padding,
          localBounds.maxX - localBounds.minX + padding * 2,
          localBounds.maxY - localBounds.minY + padding * 2,
        );
        break;
      }
      case "text": {
        const { fontSize, fontFamily, text, w } = shape.props;
        context.font = `${fontSize}px ${fontFamily}`;
        const metrics = context.measureText(text);
        const width = w ?? metrics.width;
        const height = fontSize * 1.2;
        context.strokeRect(0, 0, width, height);
        break;
      }
      case "stroke": {
        const { points, brush } = shape.props;
        if (points.length >= 2) {
          const outline = computeOutline(points, brush);
          if (outline.length > 0) {
            let minX = outline[0].x;
            let maxX = outline[0].x;
            let minY = outline[0].y;
            let maxY = outline[0].y;

            for (const point of outline) {
              minX = Math.min(minX, point.x);
              maxX = Math.max(maxX, point.x);
              minY = Math.min(minY, point.y);
              maxY = Math.max(maxY, point.y);
            }

            context.strokeRect(minX, minY, maxX - minX, maxY - minY);
          }
        }
        break;
      }
    }

    context.restore();

    if (singleSelectionId === shape.id) {
      drawHandles(context, state, shape, handleState);
    }
  }
}

type HandleVisual = { id: string; position: Vec2; connectorFrom?: Vec2 };
const ROTATE_HANDLE_OFFSET = 40;

function drawHandles(
  context: CanvasRenderingContext2D,
  state: EditorState,
  shape: ShapeRecord,
  handleState?: HandleRenderState,
) {
  if (!handleState) {
    return;
  }
  const handles = getHandlesForShape(state, shape);
  if (handles.length === 0) {
    return;
  }

  for (const handle of handles) {
    if (handle.connectorFrom) {
      context.save();
      context.strokeStyle = "rgba(37, 99, 235, 0.6)";
      context.lineWidth = 1 / state.camera.zoom;
      context.beginPath();
      context.moveTo(handle.connectorFrom.x, handle.connectorFrom.y);
      context.lineTo(handle.position.x, handle.position.y);
      context.stroke();
      context.restore();
    }

    context.save();
    const isActive = handleState.active === handle.id;
    const isHover = handleState.hover === handle.id;
    const fill = isActive ? "#2563eb" : (isHover ? "#3b82f6" : "#ffffff");
    const stroke = isActive || isHover ? "#2563eb" : "#1f2933";
    const size = handle.id === "rotate" ? 6 / state.camera.zoom : 5 / state.camera.zoom;

    context.translate(handle.position.x, handle.position.y);
    context.lineWidth = 1 / state.camera.zoom;
    context.strokeStyle = stroke;
    context.fillStyle = fill;

    if (handle.id === "rotate") {
      context.beginPath();
      context.arc(0, 0, size, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    } else {
      const d = size;
      context.beginPath();
      context.rect(-d, -d, d * 2, d * 2);
      context.fill();
      context.stroke();
    }

    context.restore();
  }
}

function getHandlesForShape(state: EditorState, shape: ShapeRecord): HandleVisual[] {
  const handles: HandleVisual[] = [];
  if (shape.type === "rect" || shape.type === "ellipse" || shape.type === "text") {
    const bounds = shapeBounds(shape);
    const minX = bounds.min.x;
    const maxX = bounds.max.x;
    const minY = bounds.min.y;
    const maxY = bounds.max.y;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    handles.push(
      { id: "nw", position: { x: minX, y: minY } },
      { id: "n", position: { x: centerX, y: minY } },
      { id: "ne", position: { x: maxX, y: minY } },
      { id: "e", position: { x: maxX, y: centerY } },
      { id: "se", position: { x: maxX, y: maxY } },
      { id: "s", position: { x: centerX, y: maxY } },
      { id: "sw", position: { x: minX, y: maxY } },
      { id: "w", position: { x: minX, y: centerY } },
      {
        id: "rotate",
        position: { x: centerX, y: minY - ROTATE_HANDLE_OFFSET },
        connectorFrom: { x: centerX, y: minY },
      },
    );
    return handles;
  }

  if (shape.type === "line") {
    const start = localToWorld(shape, shape.props.a);
    const end = localToWorld(shape, shape.props.b);
    handles.push({ id: "line-start", position: start }, { id: "line-end", position: end });
    return handles;
  }

  if (shape.type === "arrow") {
    const resolved = resolveArrowEndpoints(state, shape.id);
    if (resolved) {
      handles.push({ id: "line-start", position: resolved.a }, { id: "line-end", position: resolved.b });
    }
    return handles;
  }

  return handles;
}

function localToWorld(shape: ShapeRecord, point: Vec2): Vec2 {
  if (shape.rot === 0) {
    return { x: shape.x + point.x, y: shape.y + point.y };
  }
  const cos = Math.cos(shape.rot);
  const sin = Math.sin(shape.rot);
  return { x: shape.x + point.x * cos - point.y * sin, y: shape.y + point.x * sin + point.y * cos };
}
