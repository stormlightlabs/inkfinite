import type {
  ArrowShape,
  Camera,
  CursorState,
  EditorState,
  EllipseShape,
  LineShape,
  MarkdownShape,
  RectShape,
  ShapeRecord,
  Store,
  StrokeShape,
  TextShape,
  Vec2,
  Viewport,
} from "inkfinite-core";
import {
  computeOrthogonalPath,
  computeOutline,
  computePolylineLength,
  getPointAtDistance,
  getShapesOnCurrentPage,
  resolveArrowEndpoints,
  shapeBounds,
} from "inkfinite-core";

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
  themeProvider?: { get(): "light" | "dark" };
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
    const theme = options?.themeProvider?.get() ?? "light";
    drawScene(context, state, viewport, snapSettings, cursorState, pointerState, handleState, theme);
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
  theme: "light" | "dark" = "light",
) {
  context.clearRect(0, 0, viewport.width, viewport.height);

  context.save();

  applyCameraTransform(context, state.camera, viewport);

  drawGrid(context, state.camera, viewport, snapSettings);

  const shapes = getShapesOnCurrentPage(state);
  for (const shape of shapes) {
    drawShape(context, state, shape, theme);
  }

  drawSelection(context, state, shapes, handleState);

  drawBindingPreview(context, state);

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
 * Default grid size in world units
 * This must match the default in the snap store to ensure grid lines and snapping align
 */
const DEFAULT_GRID_SIZE = 25;

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
  const gridSize = snapSettings?.gridSize ?? DEFAULT_GRID_SIZE;
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

  const gridSize = snapSettings?.gridSize ?? DEFAULT_GRID_SIZE;
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
 * Draw binding preview indicator when dragging arrow endpoints
 */
function drawBindingPreview(context: CanvasRenderingContext2D, state: EditorState) {
  if (!state.ui.bindingPreview) return;

  const targetShape = state.doc.shapes[state.ui.bindingPreview.targetShapeId];
  if (!targetShape) return;

  const bounds = shapeBounds(targetShape);

  context.save();
  context.strokeStyle = "rgba(59, 130, 246, 0.8)";
  context.lineWidth = 3 / state.camera.zoom;
  context.setLineDash([8 / state.camera.zoom, 4 / state.camera.zoom]);

  const padding = 4;
  context.strokeRect(
    bounds.min.x - padding,
    bounds.min.y - padding,
    bounds.max.x - bounds.min.x + padding * 2,
    bounds.max.y - bounds.min.y + padding * 2,
  );

  context.setLineDash([]);
  context.restore();
}

/**
 * Draw a single shape
 */
function drawShape(
  context: CanvasRenderingContext2D,
  state: EditorState,
  shape: ShapeRecord,
  theme: "light" | "dark" = "light",
) {
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
    case "markdown": {
      drawMarkdown(context, shape, theme);
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
  const style = shape.props.style;

  const resolved = resolveArrowEndpoints(state, shape.id);
  if (!resolved) return;

  const a = { x: resolved.a.x - shape.x, y: resolved.a.y - shape.y };
  const b = { x: resolved.b.x - shape.x, y: resolved.b.y - shape.y };

  let points: Vec2[];

  if (shape.props.routing?.kind === "orthogonal") {
    points = computeOrthogonalPath(a, b);
  } else {
    points = shape.props.points.map((p: Vec2, index: number) => {
      if (index === 0) return a;
      if (index === shape.props.points.length - 1) return b;
      return p;
    });
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
 * Parse and render markdown to canvas
 *
 * Renders markdown with basic formatting:
 * - Headings (h1-h6) with appropriate sizes
 * - Bold (**text** or __text__)
 * - Italic (*text* or _text_)
 * - Code (`code`)
 * - Paragraphs with line wrapping
 * - Lists (ordered and unordered)
 * - Code blocks (```)
 */
function drawMarkdown(context: CanvasRenderingContext2D, shape: MarkdownShape, theme: "light" | "dark" = "light") {
  const { md, w, h, fontSize, fontFamily, color, bg, border } = shape.props;

  const width = w;
  const height = h ?? fontSize * 10;

  context.fillStyle = bg ?? "#ffffff";
  context.fillRect(0, 0, width, height);

  if (border) {
    context.strokeStyle = border;
    context.lineWidth = 1;
    context.strokeRect(0, 0, width, height);
  }

  context.fillStyle = color;
  context.textBaseline = "top";

  const padding = 8;
  let yOffset = padding;
  const lineHeight = fontSize * 1.4;

  const lines = md.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let line = lines[lineIndex];

    if (yOffset + lineHeight > height - padding) break;

    let currentFontSize = fontSize;
    let currentStyle = "normal";
    let currentWeight = "normal";
    let prefix = "";

    if (line.startsWith("```")) {
      context.fillStyle = theme === "dark" ? "#2e3440" : "#f4f4f4";
      const codeBlockLines = [];
      lineIndex++;
      while (lineIndex < lines.length && !lines[lineIndex].startsWith("```")) {
        codeBlockLines.push(lines[lineIndex]);
        lineIndex++;
      }

      const codeBlockHeight = codeBlockLines.length * lineHeight + padding * 2;
      if (yOffset + codeBlockHeight <= height - padding) {
        context.fillRect(padding, yOffset, width - padding * 2, codeBlockHeight);

        context.fillStyle = theme === "dark" ? "#e5e9f0" : "#333";
        context.font = `normal normal ${fontSize}px monospace`;

        for (const [index, codeLine] of codeBlockLines.entries()) {
          context.fillText(codeLine, padding + 4, yOffset + padding + index * lineHeight);
        }

        yOffset += codeBlockHeight + padding;
      }

      context.fillStyle = color;
      context.font = `${currentWeight} ${currentStyle} ${currentFontSize}px ${fontFamily}`;
      continue;
    }

    if (line.match(/^#{1,6}\s/)) {
      const match = line.match(/^(#{1,6})\s(.*)$/);
      if (match) {
        const level = match[1].length;
        line = match[2];
        currentFontSize = fontSize * (2 - level * 0.15);
        currentWeight = "bold";
      }
    } else if (line.match(/^[-*+]\s/)) {
      prefix = "• ";
      line = line.replace(/^[-*+]\s/, "");
    } else if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+)\.\s(.*)$/);
      if (match) {
        prefix = `${match[1]}. `;
        line = match[2];
      }
    }

    line = prefix + line;

    line = line.replace(/`([^`]+)`/g, "$1");

    context.font = `${currentWeight} ${currentStyle} ${currentFontSize}px ${fontFamily}`;

    const wrappedLines = wrapText(context, line, width - padding * 2);

    for (const wrappedLine of wrappedLines) {
      if (yOffset + currentFontSize * 1.4 > height - padding) break;

      const styledLine = wrappedLine;
      let xOffset = padding;

      const segments = parseInlineStyles(styledLine);

      for (const segment of segments) {
        const { text: segmentText, bold, italic, code } = segment;

        if (code) {
          context.fillStyle = theme === "dark" ? "#2e3440" : "#f4f4f4";
          const metrics = context.measureText(segmentText);
          context.fillRect(xOffset, yOffset, metrics.width + 4, currentFontSize * 1.2);

          context.fillStyle = theme === "dark" ? "#e5e9f0" : "#333";
          context.font = `normal normal ${currentFontSize * 0.9}px monospace`;
          context.fillText(segmentText, xOffset + 2, yOffset);
          xOffset += metrics.width + 4;
          context.fillStyle = color;
          context.font = `${currentWeight} ${currentStyle} ${currentFontSize}px ${fontFamily}`;
        } else {
          const weight = bold ? "bold" : currentWeight;
          const style = italic ? "italic" : currentStyle;
          context.font = `${weight} ${style} ${currentFontSize}px ${fontFamily}`;
          context.fillText(segmentText, xOffset, yOffset);
          const metrics = context.measureText(segmentText);
          xOffset += metrics.width;
          context.font = `${currentWeight} ${currentStyle} ${currentFontSize}px ${fontFamily}`;
        }
      }

      yOffset += currentFontSize * 1.4;
    }
  }
}

/**
 * Parse inline markdown styles (bold, italic, code) into segments
 */
function parseInlineStyles(text: string): Array<{ text: string; bold: boolean; italic: boolean; code: boolean }> {
  const segments: Array<{ text: string; bold: boolean; italic: boolean; code: boolean }> = [];

  const codeRegex = /`([^`]+)`/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = codeRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), code: false });
    }
    parts.push({ text: match[1], code: true });
    lastIndex = codeRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), code: false });
  }

  for (const part of parts) {
    if (part.code) {
      segments.push({ text: part.text, bold: false, italic: false, code: true });
    } else {
      const boldItalicRegex = /(\*\*\*|___)([^*_]+)(\*\*\*|___)|(\*\*|__)([^*_]+)(\*\*|__)|(\*|_)([^*_]+)(\*|_)/g;
      let lastPartIndex = 0;
      let partMatch;

      while ((partMatch = boldItalicRegex.exec(part.text)) !== null) {
        if (partMatch.index > lastPartIndex) {
          segments.push({
            text: part.text.slice(lastPartIndex, partMatch.index),
            bold: false,
            italic: false,
            code: false,
          });
        }

        if (partMatch[1]) {
          segments.push({ text: partMatch[2], bold: true, italic: true, code: false });
        } else if (partMatch[4]) {
          segments.push({ text: partMatch[5], bold: true, italic: false, code: false });
        } else if (partMatch[7]) {
          segments.push({ text: partMatch[8], bold: false, italic: true, code: false });
        }

        lastPartIndex = boldItalicRegex.lastIndex;
      }

      if (lastPartIndex < part.text.length) {
        segments.push({ text: part.text.slice(lastPartIndex), bold: false, italic: false, code: false });
      }

      if (segments.length === 0 || lastPartIndex === 0) {
        if (segments.length === 0) {
          segments.push({ text: part.text, bold: false, italic: false, code: false });
        }
      }
    }
  }

  if (segments.length === 0) {
    segments.push({ text, bold: false, italic: false, code: false });
  }

  return segments;
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
      case "markdown": {
        const { w, h, fontSize } = shape.props;
        const width = w;
        const height = h ?? fontSize * 10;
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
  if (shape.type === "rect" || shape.type === "ellipse" || shape.type === "text" || shape.type === "markdown") {
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
    if (resolved && shape.props.points && shape.props.points.length >= 2) {
      handles.push({ id: "line-start", position: resolved.a });

      for (let i = 1; i < shape.props.points.length - 1; i++) {
        const point = shape.props.points[i];
        const worldPos = localToWorld(shape, point);
        handles.push({ id: `arrow-point-${i}`, position: worldPos });
      }

      handles.push({ id: "line-end", position: resolved.b });

      if (shape.props.label) {
        const polylineLength = computePolylineLength(shape.props.points);
        const align = shape.props.label.align ?? "center";
        const offset = shape.props.label.offset ?? 0;

        let distance: number;
        if (align === "center") {
          distance = polylineLength / 2 + offset;
        } else if (align === "start") {
          distance = offset;
        } else {
          distance = polylineLength - offset;
        }

        distance = Math.max(0, Math.min(distance, polylineLength));
        const labelPos = getPointAtDistance(shape.props.points, distance);
        const worldLabelPos = localToWorld(shape, labelPos);
        handles.push({ id: "arrow-label", position: worldLabelPos });
      }
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
