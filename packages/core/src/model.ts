import { v4 } from "uuid";
import type { Vec2 } from "./math";
/**
 * Generate a unique ID with an optional prefix
 * @param prefix - Optional prefix for the ID (e.g., 'shape', 'page', 'binding')
 * @returns A unique ID string (UUID v4 format with prefix)
 */
export function createId(prefix?: string): string {
  const id = v4();
  return prefix ? `${prefix}:${id}` : id;
}

export type PageRecord = { id: string; name: string; shapeIds: string[] };

export const PageRecord = {
  /**
   * Create a new page record
   */
  create(name: string, id?: string): PageRecord {
    return { id: id ?? createId("page"), name, shapeIds: [] };
  },

  /**
   * Clone a page record
   */
  clone(page: PageRecord): PageRecord {
    return { id: page.id, name: page.name, shapeIds: [...page.shapeIds] };
  },
};

export type RectProps = { w: number; h: number; fill: string; stroke: string; radius: number };
export type EllipseProps = { w: number; h: number; fill: string; stroke: string };
export type LineProps = { a: Vec2; b: Vec2; stroke: string; width: number };

/**
 * Arrow endpoint binding metadata
 */
export type ArrowEndpoint = { kind: "free" | "bound"; bindingId?: string };

/**
 * Arrow style configuration
 */
export type ArrowStyle = { stroke: string; width: number; headStart?: boolean; headEnd?: boolean; dash?: number[] };

/**
 * Arrow routing configuration
 */
export type ArrowRouting = { kind: "straight" | "orthogonal"; cornerRadius?: number };

/**
 * Arrow label configuration
 */
export type ArrowLabel = { text: string; align: "center" | "start" | "end"; offset: number };

/**
 * Arrow properties using modern format
 * Modern format: { points, start, end, style, routing?, label? }
 */
export type ArrowProps = {
  points: Vec2[];
  start: ArrowEndpoint;
  end: ArrowEndpoint;
  style: ArrowStyle;
  routing?: ArrowRouting;
  label?: ArrowLabel;
};

export type TextProps = { text: string; fontSize: number; fontFamily: string; color: string; w?: number };

/**
 * Point with optional pressure value (0-1)
 * Format: [x, y, pressure?]
 */
export type StrokePoint = [number, number, number?];

/**
 * Brush configuration for stroke rendering
 * Maps to perfect-freehand options
 */
export type BrushConfig = {
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  simulatePressure: boolean;
};

/**
 * Style properties for stroke appearance
 */
export type StrokeStyle = { color: string; opacity: number };

/**
 * Properties for freehand stroke shapes
 * Points are in world coordinates
 * Outline and bounds are computed lazily and not persisted
 */
export type StrokeProps = { points: StrokePoint[]; style: StrokeStyle; brush: BrushConfig };

export type ShapeType = "rect" | "ellipse" | "line" | "arrow" | "text" | "stroke";

export type BaseShape = { id: string; type: ShapeType; pageId: string; x: number; y: number; rot: number };
export type RectShape = BaseShape & { type: "rect"; props: RectProps };
export type EllipseShape = BaseShape & { type: "ellipse"; props: EllipseProps };
export type LineShape = BaseShape & { type: "line"; props: LineProps };
export type ArrowShape = BaseShape & { type: "arrow"; props: ArrowProps };
export type TextShape = BaseShape & { type: "text"; props: TextProps };
export type StrokeShape = BaseShape & { type: "stroke"; props: StrokeProps };

export type ShapeRecord = RectShape | EllipseShape | LineShape | ArrowShape | TextShape | StrokeShape;

export const ShapeRecord = {
  /**
   * Create a rectangle shape
   */
  createRect(pageId: string, x: number, y: number, properties: RectProps, id?: string): RectShape {
    return { id: id ?? createId("shape"), type: "rect", pageId, x, y, rot: 0, props: properties };
  },

  /**
   * Create an ellipse shape
   */
  createEllipse(pageId: string, x: number, y: number, properties: EllipseProps, id?: string): EllipseShape {
    return { id: id ?? createId("shape"), type: "ellipse", pageId, x, y, rot: 0, props: properties };
  },

  /**
   * Create a line shape
   */
  createLine(pageId: string, x: number, y: number, properties: LineProps, id?: string): LineShape {
    return { id: id ?? createId("shape"), type: "line", pageId, x, y, rot: 0, props: properties };
  },

  /**
   * Create an arrow shape
   */
  createArrow(pageId: string, x: number, y: number, properties: ArrowProps, id?: string): ArrowShape {
    return { id: id ?? createId("shape"), type: "arrow", pageId, x, y, rot: 0, props: properties };
  },

  /**
   * Create a text shape
   */
  createText(pageId: string, x: number, y: number, properties: TextProps, id?: string): TextShape {
    return { id: id ?? createId("shape"), type: "text", pageId, x, y, rot: 0, props: properties };
  },

  /**
   * Create a stroke shape
   */
  createStroke(pageId: string, x: number, y: number, properties: StrokeProps, id?: string): StrokeShape {
    return { id: id ?? createId("shape"), type: "stroke", pageId, x, y, rot: 0, props: properties };
  },

  /**
   * Clone a shape record
   */
  clone(shape: ShapeRecord): ShapeRecord {
    if (shape.type === "stroke") {
      return {
        ...shape,
        props: {
          ...shape.props,
          points: shape.props.points.map((p) => [...p] as StrokePoint),
          style: { ...shape.props.style },
          brush: { ...shape.props.brush },
        },
      };
    }
    if (shape.type === "arrow") {
      return {
        ...shape,
        props: {
          points: shape.props.points.map((p) => ({ ...p })),
          start: { ...shape.props.start },
          end: { ...shape.props.end },
          style: { ...shape.props.style, dash: shape.props.style.dash ? [...shape.props.style.dash] : undefined },
          routing: shape.props.routing ? { ...shape.props.routing } : undefined,
          label: shape.props.label ? { ...shape.props.label } : undefined,
        },
      };
    }
    return { ...shape, props: { ...shape.props } } as ShapeRecord;
  },
};

export type BindingType = "arrow-end";
export type BindingHandle = "start" | "end";

/**
 * Binding anchor configuration
 * - center: bind to shape center
 * - edge: bind to shape edge with normalized coordinates (nx, ny in [-1, 1])
 */
export type BindingAnchor = { kind: "center" } | { kind: "edge"; nx: number; ny: number };

export type BindingRecord = {
  id: string;
  type: BindingType;
  fromShapeId: string;
  toShapeId: string;
  handle: BindingHandle;
  anchor: BindingAnchor;
};

export const BindingRecord = {
  /**
   * Create a binding record for arrow endpoints
   */
  create(
    fromShapeId: string,
    toShapeId: string,
    handle: BindingHandle,
    anchor?: BindingAnchor,
    id?: string,
  ): BindingRecord {
    if (!anchor) {
      anchor = { kind: "center" };
    }
    return { id: id ?? createId("binding"), type: "arrow-end", fromShapeId, toShapeId, handle, anchor };
  },

  /**
   * Clone a binding record
   */
  clone(binding: BindingRecord): BindingRecord {
    return { ...binding, anchor: binding.anchor.kind === "edge" ? { ...binding.anchor } : { kind: "center" } };
  },
};

export type Document = {
  pages: Record<string, PageRecord>;
  shapes: Record<string, ShapeRecord>;
  bindings: Record<string, BindingRecord>;
};

export const Document = {
  /**
   * Create an empty document
   */
  create(): Document {
    return { pages: {}, shapes: {}, bindings: {} };
  },

  /**
   * Clone a document
   */
  clone(document: Document): Document {
    return {
      pages: Object.fromEntries(Object.entries(document.pages).map(([id, page]) => [id, PageRecord.clone(page)])),
      shapes: Object.fromEntries(Object.entries(document.shapes).map(([id, shape]) => [id, ShapeRecord.clone(shape)])),
      bindings: Object.fromEntries(
        Object.entries(document.bindings).map(([id, binding]) => [id, BindingRecord.clone(binding)]),
      ),
    };
  },
};

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Validate a document for consistency and referential integrity
 * @param doc - The document to validate
 * @returns ValidationResult with ok status and any errors found
 */
export function validateDoc(document: Document): ValidationResult {
  const errors: string[] = [];

  if (Object.keys(document.pages).length === 0 && Object.keys(document.shapes).length > 0) {
    errors.push("Document has shapes but no pages");
  }

  for (const [shapeId, shape] of Object.entries(document.shapes)) {
    if (shape.id !== shapeId) {
      errors.push(`Shape key '${shapeId}' does not match shape.id '${shape.id}'`);
    }

    if (!document.pages[shape.pageId]) {
      errors.push(`Shape '${shapeId}' references non-existent page '${shape.pageId}'`);
    }

    const page = document.pages[shape.pageId];
    if (page && !page.shapeIds.includes(shapeId)) {
      errors.push(`Shape '${shapeId}' not listed in page '${shape.pageId}' shapeIds`);
    }

    switch (shape.type) {
      case "rect": {
        if (shape.props.w < 0) errors.push(`Rect shape '${shapeId}' has negative width`);
        if (shape.props.h < 0) errors.push(`Rect shape '${shapeId}' has negative height`);
        if (shape.props.radius < 0) errors.push(`Rect shape '${shapeId}' has negative radius`);

        break;
      }
      case "ellipse": {
        if (shape.props.w < 0) errors.push(`Ellipse shape '${shapeId}' has negative width`);
        if (shape.props.h < 0) errors.push(`Ellipse shape '${shapeId}' has negative height`);

        break;
      }
      case "line": {
        if (shape.props.width < 0) errors.push(`Line shape '${shapeId}' has negative width`);

        break;
      }
      case "arrow": {
        const props = shape.props;

        if (!props.points || props.points.length < 2) {
          errors.push(`Arrow shape '${shapeId}' points array must have at least 2 points`);
        }
        if (!props.style) {
          errors.push(`Arrow shape '${shapeId}' missing style`);
        } else if (props.style.width < 0) {
          errors.push(`Arrow shape '${shapeId}' has negative width in style`);
        }
        if (props.routing) {
          if (props.routing.cornerRadius !== undefined && props.routing.cornerRadius < 0) {
            errors.push(`Arrow shape '${shapeId}' has negative cornerRadius`);
          }
        }
        if (props.label) {
          if (!["center", "start", "end"].includes(props.label.align)) {
            errors.push(`Arrow shape '${shapeId}' has invalid label alignment`);
          }
        }

        break;
      }
      case "text": {
        if (shape.props.fontSize <= 0) errors.push(`Text shape '${shapeId}' has invalid fontSize`);
        if (shape.props.w !== undefined && shape.props.w < 0) {
          errors.push(`Text shape '${shapeId}' has negative width`);
        }

        break;
      }
      case "stroke": {
        if (shape.props.points.length < 2) {
          errors.push(`Stroke shape '${shapeId}' has fewer than 2 points`);
        }
        if (shape.props.brush.size <= 0) {
          errors.push(`Stroke shape '${shapeId}' has invalid brush size`);
        }
        if (shape.props.style.opacity < 0 || shape.props.style.opacity > 1) {
          errors.push(`Stroke shape '${shapeId}' has invalid opacity`);
        }

        break;
      }
    }
  }

  for (const [pageId, page] of Object.entries(document.pages)) {
    if (page.id !== pageId) {
      errors.push(`Page key '${pageId}' does not match page.id '${page.id}'`);
    }

    for (const shapeId of page.shapeIds) {
      if (!document.shapes[shapeId]) {
        errors.push(`Page '${pageId}' references non-existent shape '${shapeId}'`);
      }
    }

    const uniqueIds = new Set(page.shapeIds);
    if (uniqueIds.size !== page.shapeIds.length) {
      errors.push(`Page '${pageId}' has duplicate shape IDs`);
    }
  }

  for (const [bindingId, binding] of Object.entries(document.bindings)) {
    if (binding.id !== bindingId) {
      errors.push(`Binding key '${bindingId}' does not match binding.id '${binding.id}'`);
    }

    const fromShape = document.shapes[binding.fromShapeId];
    if (!fromShape) {
      errors.push(`Binding '${bindingId}' references non-existent fromShape '${binding.fromShapeId}'`);
    } else if (fromShape.type !== "arrow") {
      errors.push(`Binding '${bindingId}' fromShape '${binding.fromShapeId}' is not an arrow`);
    }

    if (!document.shapes[binding.toShapeId]) {
      errors.push(`Binding '${bindingId}' references non-existent toShape '${binding.toShapeId}'`);
    }

    if (binding.handle !== "start" && binding.handle !== "end") {
      errors.push(`Binding '${bindingId}' has invalid handle '${binding.handle}'`);
    }

    if (binding.anchor.kind === "edge") {
      if (binding.anchor.nx < -1 || binding.anchor.nx > 1) {
        errors.push(`Binding '${bindingId}' has invalid nx '${binding.anchor.nx}' (must be in [-1, 1])`);
      }
      if (binding.anchor.ny < -1 || binding.anchor.ny > 1) {
        errors.push(`Binding '${bindingId}' has invalid ny '${binding.anchor.ny}' (must be in [-1, 1])`);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true };
}
