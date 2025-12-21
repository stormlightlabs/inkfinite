import type {
  ArrowShape,
  Camera,
  EditorState,
  EllipseShape,
  LineShape,
  RectShape,
  ShapeRecord,
  Store,
  TextShape,
  Viewport,
} from "inkfinite-core";
import { getShapesOnCurrentPage } from "inkfinite-core";

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

/**
 * Create a canvas renderer
 *
 * The renderer subscribes to the store and redraws the canvas
 * whenever the state changes. It uses requestAnimationFrame with
 * a dirty flag to optimize rendering.
 *
 * @param canvas - The HTMLCanvasElement to render to
 * @param store - The editor state store
 * @returns Renderer instance with dispose method
 */
export function createRenderer(canvas: HTMLCanvasElement, store: Store): Renderer {
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

    drawScene(context, state, viewport);
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
function drawScene(context: CanvasRenderingContext2D, state: EditorState, viewport: Viewport) {
  context.clearRect(0, 0, viewport.width, viewport.height);

  context.save();

  applyCameraTransform(context, state.camera, viewport);

  const shapes = getShapesOnCurrentPage(state);
  for (const shape of shapes) {
    drawShape(context, shape);
  }

  drawSelection(context, state, shapes);

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
 * Draw a single shape
 */
function drawShape(context: CanvasRenderingContext2D, shape: ShapeRecord) {
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
      drawArrow(context, shape);
      break;
    }
    case "text": {
      drawText(context, shape);
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
function drawArrow(context: CanvasRenderingContext2D, shape: ArrowShape) {
  const { a, b, stroke, width } = shape.props;

  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);

  context.strokeStyle = stroke;
  context.lineWidth = width;
  context.stroke();

  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const arrowLength = 15;
  const arrowAngle = Math.PI / 6;

  context.beginPath();
  context.moveTo(b.x, b.y);
  context.lineTo(b.x - arrowLength * Math.cos(angle - arrowAngle), b.y - arrowLength * Math.sin(angle - arrowAngle));
  context.moveTo(b.x, b.y);
  context.lineTo(b.x - arrowLength * Math.cos(angle + arrowAngle), b.y - arrowLength * Math.sin(angle + arrowAngle));

  context.strokeStyle = stroke;
  context.lineWidth = width;
  context.stroke();
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
function drawSelection(context: CanvasRenderingContext2D, state: EditorState, shapes: ShapeRecord[]) {
  const selectedIds = new Set(state.ui.selectionIds);

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
      case "line":
      case "arrow": {
        const { a, b } = shape.props;
        const minX = Math.min(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxX = Math.max(a.x, b.x);
        const maxY = Math.max(a.y, b.y);
        const padding = 5;
        context.strokeRect(minX - padding, minY - padding, maxX - minX + padding * 2, maxY - minY + padding * 2);
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
    }

    context.restore();
  }
}
