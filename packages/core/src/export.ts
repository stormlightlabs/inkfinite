import { shapeBounds } from "./geom";
import type { Box2 } from "./math";
import { Box2 as Box2Ops } from "./math";
import type { ArrowShape, EllipseShape, LineShape, RectShape, ShapeRecord, TextShape } from "./model";
import type { EditorState } from "./reactivity";
import { getSelectedShapes, getShapesOnCurrentPage } from "./reactivity";

export type ExportOptions = {
  /**
   * Export only selected shapes (default: false - export all)
   */
  selectedOnly?: boolean;

  /**
   * Include camera transform in the SVG (default: false - export in world coordinates)
   *
   * When false, shapes are exported in their natural world coordinates.
   * When true, the camera transform is baked into the SVG viewBox.
   */
  includeCamera?: boolean;
};

/**
 * Export the current viewport as a PNG blob.
 *
 * This captures whatever is currently visible on the canvas.
 *
 * @param canvas - The canvas element to export
 * @returns Promise resolving to PNG blob
 */
export async function exportViewportToPNG(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Failed to export canvas to PNG"));
      }
    }, "image/png");
  });
}

/**
 * Export selected shapes as a PNG blob.
 *
 * This creates a temporary canvas, renders only the selected shapes
 * with their bounds, and exports it as PNG.
 *
 * @param state - Editor state containing shapes
 * @param renderFn - Function to render shapes to a canvas context
 * @returns Promise resolving to PNG blob, or null if no selection
 */
export async function exportSelectionToPNG(
  state: EditorState,
  renderFunction: (context: CanvasRenderingContext2D, shapes: ShapeRecord[], bounds: Box2) => void,
): Promise<Blob | null> {
  const shapes = getSelectedShapes(state);
  if (shapes.length === 0) {
    return null;
  }

  const bounds = combineBounds(shapes.map((s) => shapeBounds(s)));
  if (!bounds) {
    return null;
  }

  const padding = 20;
  const width = Box2Ops.width(bounds) + padding * 2;
  const height = Box2Ops.height(bounds) + padding * 2;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to get 2D context");
  }

  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);

  context.save();
  context.translate(-bounds.min.x + padding, -bounds.min.y + padding);

  renderFunction(context, shapes, bounds);

  context.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Failed to export selection to PNG"));
      }
    }, "image/png");
  });
}

/**
 * Export shapes to SVG format.
 *
 * By default, shapes are exported in world coordinates (camera transform is NOT applied).
 * Set `includeCamera: true` to bake the camera transform into the SVG viewBox.
 *
 * @param state - Editor state containing shapes and camera
 * @param options - Export options
 * @returns SVG string
 */
export function exportToSVG(state: EditorState, options: ExportOptions = {}): string {
  const shapes = options.selectedOnly ? getSelectedShapes(state) : getShapesOnCurrentPage(state);

  if (shapes.length === 0) {
    return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\"></svg>";
  }

  const bounds = combineBounds(shapes.map((s) => shapeBounds(s)));
  if (!bounds) {
    return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\"></svg>";
  }

  const padding = 20;
  const width = Box2Ops.width(bounds) + padding * 2;
  const height = Box2Ops.height(bounds) + padding * 2;
  const offsetX = bounds.min.x - padding;
  const offsetY = bounds.min.y - padding;

  const elements: string[] = [`<rect x="${offsetX}" y="${offsetY}" width="${width}" height="${height}" fill="white"/>`];

  for (const shape of shapes) {
    const svg = shapeToSVG(shape, state);
    if (svg) {
      elements.push(svg);
    }
  }

  const viewBox = `${offsetX} ${offsetY} ${width} ${height}`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">`,
    ...elements,
    `</svg>`,
  ].join("\n");
}

/**
 * Convert a single shape to SVG markup.
 */
function shapeToSVG(shape: ShapeRecord, state: EditorState): string | null {
  const transform = `translate(${shape.x},${shape.y})${
    shape.rot === 0 ? "" : ` rotate(${(shape.rot * 180) / Math.PI})`
  }`;

  switch (shape.type) {
    case "rect": {
      return rectToSVG(shape, transform);
    }
    case "ellipse": {
      return ellipseToSVG(shape, transform);
    }
    case "line": {
      return lineToSVG(shape, transform);
    }
    case "arrow": {
      return arrowToSVG(shape, transform, state);
    }
    case "text": {
      return textToSVG(shape, transform);
    }
    default: {
      return null;
    }
  }
}

function rectToSVG(shape: RectShape, transform: string): string {
  const { w, h, fill, stroke, radius } = shape.props;
  const fillAttribute = fill ? `fill="${escapeXML(fill)}"` : "fill=\"none\"";
  const strokeAttribute = stroke ? `stroke="${escapeXML(stroke)}" stroke-width="2"` : "";
  const radiusAttribute = radius > 0 ? `rx="${radius}" ry="${radius}"` : "";

  return `<rect transform="${transform}" width="${w}" height="${h}" ${fillAttribute} ${strokeAttribute} ${radiusAttribute}/>`;
}

function ellipseToSVG(shape: EllipseShape, transform: string): string {
  const { w, h, fill, stroke } = shape.props;
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const fillAttribute = fill ? `fill="${escapeXML(fill)}"` : "fill=\"none\"";
  const strokeAttribute = stroke ? `stroke="${escapeXML(stroke)}" stroke-width="2"` : "";

  return `<ellipse transform="${transform}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${fillAttribute} ${strokeAttribute}/>`;
}

function lineToSVG(shape: LineShape, transform: string): string {
  const { a, b, stroke, width } = shape.props;

  return `<line transform="${transform}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${
    escapeXML(stroke)
  }" stroke-width="${width}"/>`;
}

function arrowToSVG(shape: ArrowShape, transform: string, _state: EditorState): string {
  const { a, b, stroke, width } = shape.props;

  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const arrowLength = 15;
  const arrowAngle = Math.PI / 6;

  const arrowPoint1 = {
    x: b.x - arrowLength * Math.cos(angle - arrowAngle),
    y: b.y - arrowLength * Math.sin(angle - arrowAngle),
  };

  const arrowPoint2 = {
    x: b.x - arrowLength * Math.cos(angle + arrowAngle),
    y: b.y - arrowLength * Math.sin(angle + arrowAngle),
  };

  const strokeAttribute = `stroke="${escapeXML(stroke)}" stroke-width="${width}"`;

  return [
    `<g transform="${transform}">`,
    `  <line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${strokeAttribute}/>`,
    `  <line x1="${b.x}" y1="${b.y}" x2="${arrowPoint1.x}" y2="${arrowPoint1.y}" ${strokeAttribute}/>`,
    `  <line x1="${b.x}" y1="${b.y}" x2="${arrowPoint2.x}" y2="${arrowPoint2.y}" ${strokeAttribute}/>`,
    `</g>`,
  ].join("\n");
}

function textToSVG(shape: TextShape, transform: string): string {
  const { text, fontSize, fontFamily, color } = shape.props;

  return `<text transform="${transform}" font-size="${fontSize}" font-family="${escapeXML(fontFamily)}" fill="${
    escapeXML(color)
  }">${escapeXML(text)}</text>`;
}

/**
 * Escape special XML characters in strings.
 */
function escapeXML(string_: string): string {
  return string_.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Combine multiple bounding boxes into a single bounding box.
 */
function combineBounds(boxes: Box2[]): Box2 | null {
  if (boxes.length === 0) {
    return null;
  }

  let combined = Box2Ops.clone(boxes[0]);
  for (let index = 1; index < boxes.length; index++) {
    const box = boxes[index];
    combined = {
      min: { x: Math.min(combined.min.x, box.min.x), y: Math.min(combined.min.y, box.min.y) },
      max: { x: Math.max(combined.max.x, box.max.x), y: Math.max(combined.max.y, box.max.y) },
    };
  }
  return combined;
}
