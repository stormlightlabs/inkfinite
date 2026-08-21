import {
  arrowPath,
  computePolylineLength,
  getPointAtDistance,
  localToWorld,
  resolveArrowEndpoints,
  shapeBounds,
  worldToLocal,
} from "./geom";
import type { Box2 } from "./math";
import { Box2 as Box2Ops } from "./math";
import type { ArrowShape, ContainerShape, EllipseShape, LineShape, MarkdownShape, PathShape, RectShape, ShapeRecord, TextShape } from "./model";
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

  const bounds = combineBounds(shapes.map((shape) => exportBounds(state, shape)));
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
  const shapes = options.selectedOnly ? getExportSelection(state) : getShapesOnCurrentPage(state);

  if (shapes.length === 0) {
    return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\"></svg>";
  }

  const bounds = combineBounds(shapes.map((shape) => exportBounds(state, shape)));
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
    case "container": {
      return containerToSVG(shape, transform);
    }
    case "text": {
      return textToSVG(shape, transform);
    }
    case "path": {
      return pathToSVG(shape, transform);
    }
    case "image": {
      const asset = state.doc.assets?.[shape.props.assetId];
      if (!asset) return null;
      const crop = shape.props.crop;
      const preserve = crop
        ? ` preserveAspectRatio="none" viewBox="${crop.left ?? 0} ${crop.top ?? 0} ${1 - (crop.left ?? 0) - (crop.right ?? 0)} ${1 - (crop.top ?? 0) - (crop.bottom ?? 0)}"`
        : '';
      const encoded = encodeBase64(asset.bytes);
      return `<image transform="${transform}" width="${shape.props.w}" height="${shape.props.h}" opacity="${shape.opacity ?? 1}" href="data:${escapeXML(asset.mediaType)};base64,${encoded}"${preserve}/>`;
    }
    case "markdown": {
      return markdownToSVG(shape, transform);
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

function arrowToSVG(shape: ArrowShape, transform: string, state: EditorState): string {
  const resolved = resolveArrowEndpoints(state, shape.id);
  if (!resolved || shape.props.points.length < 2) return "";
  const endpoints = [worldToLocal(resolved.a, shape), ...shape.props.points.slice(1, -1), worldToLocal(resolved.b, shape)];
  const routing = shape.props.routing?.automatic ? "orthogonal" : shape.props.routing?.kind ?? "straight";
  const points = arrowPath(endpoints, routing);
  const stroke = escapeXML(shape.props.style.stroke);
  const width = svgNumber(shape.props.style.width);
  const last = points.at(-1)!;
  const previous = points.at(-2)!;
  const angle = Math.atan2(last.y - previous.y, last.x - previous.x);
  const head = (at: { x: number; y: number }, direction: number) => {
    const length = 15;
    const spread = Math.PI / 6;
    const left = { x: at.x - length * Math.cos(direction - spread), y: at.y - length * Math.sin(direction - spread) };
    const right = { x: at.x - length * Math.cos(direction + spread), y: at.y - length * Math.sin(direction + spread) };
    return `<path d="M ${svgNumber(at.x)} ${svgNumber(at.y)} L ${svgNumber(left.x)} ${svgNumber(left.y)} M ${svgNumber(at.x)} ${svgNumber(at.y)} L ${svgNumber(right.x)} ${svgNumber(right.y)}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`;
  };
  const pathData = routing === "curved"
    ? curvedPathData(endpoints)
    : points.map((point, index) => `${index === 0 ? "M" : "L"} ${svgNumber(point.x)} ${svgNumber(point.y)}`).join(" ");
  const elements = routing === "straight"
    ? points.slice(1).map((point, index) => `<line x1="${svgNumber(points[index].x)}" y1="${svgNumber(points[index].y)}" x2="${svgNumber(point.x)}" y2="${svgNumber(point.y)}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`)
    : [`<path d="${pathData}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`];
  if (shape.props.style.headEnd !== false) elements.push(head(last, angle));
  if (shape.props.style.headStart) elements.push(head(points[0], angle + Math.PI));
  const label = shape.props.label;
  if (label?.text) {
    const length = computePolylineLength(points);
    const distance = label.align === "start" ? label.offset : label.align === "end" ? length - label.offset : length / 2 + label.offset;
    const at = getPointAtDistance(points, Math.max(0, Math.min(length, distance)));
    elements.push(`<text x="${svgNumber(at.x)}" y="${svgNumber(at.y - 7)}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="${stroke}">${escapeXML(label.text)}</text>`);
  }
  return `<g transform="${transform}">${elements.join("")}</g>`;
}

function curvedPathData(points: Array<{ x: number; y: number }>): string {
  if (points.length < 3) return points.map((point, index) => `${index === 0 ? "M" : "L"} ${svgNumber(point.x)} ${svgNumber(point.y)}`).join(" ");
  const midpoint = (left: { x: number; y: number }, right: { x: number; y: number }) => ({
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
  });
  let path = `M ${svgNumber(points[0].x)} ${svgNumber(points[0].y)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const end = midpoint(points[index], points[index + 1]);
    path += ` Q ${svgNumber(points[index].x)} ${svgNumber(points[index].y)} ${svgNumber(end.x)} ${svgNumber(end.y)}`;
  }
  const control = points[points.length - 2];
  const end = points[points.length - 1];
  return `${path} Q ${svgNumber(control.x)} ${svgNumber(control.y)} ${svgNumber(end.x)} ${svgNumber(end.y)}`;
}

function containerToSVG(shape: ContainerShape, transform: string): string {
  const { w = 0, h = 0, title, fill, stroke, radius = 0 } = shape.props;
  const elements = [`<rect transform="${transform}" width="${svgNumber(w)}" height="${svgNumber(h)}" rx="${svgNumber(Math.min(radius, w / 2, h / 2))}" fill="${escapeXML(fill ?? "none")}" stroke="${escapeXML(stroke ?? "none")}"/>`];
  if (title) elements.push(`<text transform="${transform}" x="8" y="18" font-family="sans-serif" font-size="14" font-weight="600" fill="#1f2937">${escapeXML(title)}</text>`);
  return elements.join("");
}

function textToSVG(shape: TextShape, transform: string): string {
  const { text, fontSize, fontFamily, color } = shape.props;

  return `<text transform="${transform}" font-size="${fontSize}" font-family="${escapeXML(fontFamily)}" fill="${
    escapeXML(color)
  }">${escapeXML(text)}</text>`;
}

function pathToSVG(shape: PathShape, transform: string): string {
  const commands = shape.props.subpaths.map((subpath) => {
    const segments = subpath.segments.map((segment) => {
      switch (segment.type) {
        case "move": return `M ${svgNumber(segment.to.x)} ${svgNumber(segment.to.y)}`;
        case "line": return `L ${svgNumber(segment.to.x)} ${svgNumber(segment.to.y)}`;
        case "quadratic": return `Q ${svgNumber(segment.control.x)} ${svgNumber(segment.control.y)} ${svgNumber(segment.to.x)} ${svgNumber(segment.to.y)}`;
        case "cubic": return `C ${svgNumber(segment.control_1.x)} ${svgNumber(segment.control_1.y)} ${svgNumber(segment.control_2.x)} ${svgNumber(segment.control_2.y)} ${svgNumber(segment.to.x)} ${svgNumber(segment.to.y)}`;
      }
    });
    if (subpath.closed) segments.push("Z");
    return segments.join(" ");
  }).join(" ");
  const fill = shape.props.fill ? escapeXML(shape.props.fill) : "none";
  const stroke = shape.props.stroke ? ` stroke="${escapeXML(shape.props.stroke)}" stroke-width="${svgNumber(shape.props.stroke_width ?? 2)}"` : "";
  return `<path transform="${transform}" d="${commands}" fill="${fill}" fill-rule="${shape.props.fill_rule}"${stroke}/>`;
}

function svgNumber(value: number): string {
  if (Object.is(value, -0) || value === 0) return "0";
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Export markdown shape as SVG foreignObject
 *
 * Uses foreignObject to embed HTML for markdown rendering.
 *
 * For broader interoperability, the markdown is exported as plain text with basic formatting preserved.
 */
function markdownToSVG(shape: MarkdownShape, transform: string): string {
  const { md, w, h, fontSize, fontFamily, color, bg, border } = shape.props;
  const width = w;
  const height = h ?? fontSize * 10;

  const bgStyle = bg ? `background: ${escapeXML(bg)};` : "background: white;";
  const borderStyle = border ? `border: 1px solid ${escapeXML(border)};` : "";

  const escapedMarkdown = escapeXML(md);

  return [
    `<foreignObject transform="${transform}" width="${width}" height="${height}">`,
    `  <div xmlns="http://www.w3.org/1999/xhtml" style="${bgStyle}${borderStyle} padding: 8px; font-size: ${fontSize}px; font-family: ${
      escapeXML(fontFamily)
    }; color: ${
      escapeXML(color)
    }; width: 100%; height: 100%; overflow: auto; white-space: pre-wrap; box-sizing: border-box;">`,
    `    ${escapedMarkdown}`,
    `  </div>`,
    `</foreignObject>`,
  ].join("\n");
}

function encodeBase64(bytes: number[]): string {
  if (typeof btoa !== 'function') return '';
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Escape special XML characters in strings.
 */
function escapeXML(string_: string): string {
  return string_.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function exportBounds(state: EditorState, shape: ShapeRecord): Box2 {
  if (shape.type !== "arrow") return shapeBounds(shape);
  const resolved = resolveArrowEndpoints(state, shape.id);
  if (!resolved || shape.props.points.length < 2) return shapeBounds(shape);
  const endpoints = [worldToLocal(resolved.a, shape), ...shape.props.points.slice(1, -1), worldToLocal(resolved.b, shape)];
  const routing = shape.props.routing?.automatic ? "orthogonal" : shape.props.routing?.kind ?? "straight";
  return Box2Ops.fromPoints(arrowPath(endpoints, routing).map((point) => localToWorld(shape, point)));
}

function getExportSelection(state: EditorState): ShapeRecord[] {
  const selected = new Set(state.ui.selectionIds);
  return getShapesOnCurrentPage(state).filter((shape) => selected.has(shape.id) || hasSelectedAncestor(shape, selected, state));
}

function hasSelectedAncestor(shape: ShapeRecord, selected: ReadonlySet<string>, state: EditorState): boolean {
  let parentId = shape.groupId;
  while (parentId) {
    if (selected.has(parentId)) return true;
    parentId = state.doc.shapes[parentId]?.groupId;
  }
  return false;
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
