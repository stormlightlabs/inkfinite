import { describe, expect, it } from "vitest";
import {
  type ArrowProps,
  type ArrowStyle,
  BindingRecord,
  createId,
  Document,
  type EllipseProps,
  type LineProps,
  PageRecord,
  type RectProps,
  ShapeRecord,
  type TextProps,
  validateDoc,
} from "../src/model";

describe("createId", () => {
  it("should generate a valid UUID without prefix", () => {
    const id = createId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("should generate a UUID with prefix", () => {
    const id = createId("shape");
    expect(id).toMatch(/^shape:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it.each([{ prefix: "page" }, { prefix: "shape" }, { prefix: "binding" }, { prefix: "custom" }])(
    "should handle prefix: $prefix",
    ({ prefix }) => {
      const id = createId(prefix);
      expect(id).toContain(`${prefix}:`);
    },
  );

  it("should generate unique IDs", () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      ids.add(createId());
    }
    expect(ids.size).toBe(1000);
  });

  it("should generate unique IDs with prefix", () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      ids.add(createId("test"));
    }
    expect(ids.size).toBe(1000);
  });
});

describe("PageRecord", () => {
  describe("create", () => {
    it("should create a page with generated ID", () => {
      const page = PageRecord.create("My Page");
      expect(page.id).toMatch(/^page:/);
      expect(page.name).toBe("My Page");
      expect(page.shapeIds).toEqual([]);
    });

    it("should create a page with custom ID", () => {
      const page = PageRecord.create("Test Page", "page:123");
      expect(page.id).toBe("page:123");
      expect(page.name).toBe("Test Page");
    });

    it.each([{ name: "Untitled" }, { name: "Page 1" }, { name: "" }, {
      name: "A very long page name with special chars !@#$%",
    }])("should create page with name: \"$name\"", ({ name }) => {
      const page = PageRecord.create(name);
      expect(page.name).toBe(name);
      expect(page.shapeIds).toEqual([]);
    });
  });

  describe("clone", () => {
    it("should create a copy of the page", () => {
      const page = PageRecord.create("Test");
      page.shapeIds = ["shape1", "shape2"];

      const cloned = PageRecord.clone(page);

      expect(cloned).toEqual(page);
      expect(cloned).not.toBe(page);
      expect(cloned.shapeIds).not.toBe(page.shapeIds);
    });

    it("should deep clone shapeIds array", () => {
      const page = PageRecord.create("Test");
      page.shapeIds = ["shape1", "shape2"];

      const cloned = PageRecord.clone(page);
      cloned.shapeIds.push("shape3");

      expect(page.shapeIds).toEqual(["shape1", "shape2"]);
      expect(cloned.shapeIds).toEqual(["shape1", "shape2", "shape3"]);
    });
  });
});

describe("ShapeRecord", () => {
  const pageId = "page:test";

  describe("createRect", () => {
    it("should create a rectangle shape with generated ID", () => {
      const props: RectProps = { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 5 };
      const shape = ShapeRecord.createRect(pageId, 10, 20, props);

      expect(shape.id).toMatch(/^shape:/);
      expect(shape.type).toBe("rect");
      expect(shape.pageId).toBe(pageId);
      expect(shape.x).toBe(10);
      expect(shape.y).toBe(20);
      expect(shape.rot).toBe(0);
      expect(shape.props).toEqual(props);
    });

    it("should create a rectangle with custom ID", () => {
      const props: RectProps = { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 5 };
      const shape = ShapeRecord.createRect(pageId, 10, 20, props, "shape:custom");

      expect(shape.id).toBe("shape:custom");
    });

    it.each([{ w: 0, h: 0, fill: "transparent", stroke: "none", radius: 0 }, {
      w: 1000,
      h: 500,
      fill: "#ff0000",
      stroke: "#00ff00",
      radius: 10,
    }, { w: 50.5, h: 25.3, fill: "rgba(0,0,0,0.5)", stroke: "#123456", radius: 2.5 }])(
      "should create rect with props: %o",
      (props) => {
        const shape = ShapeRecord.createRect(pageId, 0, 0, props as RectProps);
        expect(shape.props).toEqual(props);
      },
    );
  });

  describe("createEllipse", () => {
    it("should create an ellipse shape", () => {
      const props: EllipseProps = { w: 100, h: 50, fill: "#fff", stroke: "#000" };
      const shape = ShapeRecord.createEllipse(pageId, 10, 20, props);

      expect(shape.id).toMatch(/^shape:/);
      expect(shape.type).toBe("ellipse");
      expect(shape.pageId).toBe(pageId);
      expect(shape.x).toBe(10);
      expect(shape.y).toBe(20);
      expect(shape.rot).toBe(0);
      expect(shape.props).toEqual(props);
    });
  });

  describe("createLine", () => {
    it("should create a line shape", () => {
      const props: LineProps = { a: { x: 0, y: 0 }, b: { x: 100, y: 50 }, stroke: "#000", width: 2 };
      const shape = ShapeRecord.createLine(pageId, 10, 20, props);

      expect(shape.id).toMatch(/^shape:/);
      expect(shape.type).toBe("line");
      expect(shape.props).toEqual(props);
    });

    it("should handle negative coordinates in line endpoints", () => {
      const props: LineProps = { a: { x: -50, y: -30 }, b: { x: 100, y: 200 }, stroke: "#000", width: 1 };
      const shape = ShapeRecord.createLine(pageId, 0, 0, props);

      expect(shape.props.a).toEqual({ x: -50, y: -30 });
      expect(shape.props.b).toEqual({ x: 100, y: 200 });
    });
  });

  describe("createArrow", () => {
    it("should create an arrow with modern format (points only)", () => {
      const props: ArrowProps = {
        points: [{ x: 0, y: 0 }, { x: 100, y: 50 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
      };
      const shape = ShapeRecord.createArrow(pageId, 10, 20, props);

      expect(shape.id).toMatch(/^shape:/);
      expect(shape.type).toBe("arrow");
      expect(shape.props.points).toEqual(props.points);
      expect(shape.props.start).toEqual({ kind: "free" });
      expect(shape.props.end).toEqual({ kind: "free" });
      expect(shape.props.style).toEqual({ stroke: "#000", width: 2 });
    });

    it("should create an arrow with polyline (3+ points)", () => {
      const props: ArrowProps = {
        points: [{ x: 0, y: 0 }, { x: 50, y: 25 }, { x: 100, y: 50 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#ff0000", width: 3 },
      };
      const shape = ShapeRecord.createArrow(pageId, 0, 0, props);

      expect(shape.props.points?.length).toBe(3);
      expect(shape.props.points).toEqual(props.points);
    });

    it("should create an arrow with bound endpoints", () => {
      const props: ArrowProps = {
        points: [{ x: 0, y: 0 }, { x: 100, y: 50 }],
        start: { kind: "bound", bindingId: "binding:1" },
        end: { kind: "bound", bindingId: "binding:2" },
        style: { stroke: "#000", width: 2 },
      };
      const shape = ShapeRecord.createArrow(pageId, 0, 0, props);

      expect(shape.props.start).toEqual({ kind: "bound", bindingId: "binding:1" });
      expect(shape.props.end).toEqual({ kind: "bound", bindingId: "binding:2" });
    });

    it("should create an arrow with arrowheads", () => {
      const style: ArrowStyle = { stroke: "#000", width: 2, headStart: true, headEnd: true };
      const props: ArrowProps = {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style,
      };
      const shape = ShapeRecord.createArrow(pageId, 0, 0, props);

      expect(shape.props.style?.headStart).toBe(true);
      expect(shape.props.style?.headEnd).toBe(true);
    });

    it("should create an arrow with dash pattern", () => {
      const style: ArrowStyle = { stroke: "#000", width: 2, dash: [5, 3] };
      const props: ArrowProps = {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style,
      };
      const shape = ShapeRecord.createArrow(pageId, 0, 0, props);

      expect(shape.props.style?.dash).toEqual([5, 3]);
    });

    it("should create an arrow with orthogonal routing", () => {
      const props: ArrowProps = {
        points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 50 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
        routing: { kind: "orthogonal", cornerRadius: 5 },
      };
      const shape = ShapeRecord.createArrow(pageId, 0, 0, props);

      expect(shape.props.routing).toEqual({ kind: "orthogonal", cornerRadius: 5 });
    });

    it("should create an arrow with label", () => {
      const props: ArrowProps = {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
        label: { text: "Connection", align: "center", offset: 0 },
      };
      const shape = ShapeRecord.createArrow(pageId, 0, 0, props);

      expect(shape.props.label).toEqual({ text: "Connection", align: "center", offset: 0 });
    });

    it.each([{ align: "center" as const, offset: 0 }, { align: "start" as const, offset: 10 }, {
      align: "end" as const,
      offset: -10,
    }])("should create arrow with label alignment: $align", ({ align, offset }) => {
      const props: ArrowProps = {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
        label: { text: "Test", align, offset },
      };
      const shape = ShapeRecord.createArrow(pageId, 0, 0, props);

      expect(shape.props.label?.align).toBe(align);
      expect(shape.props.label?.offset).toBe(offset);
    });
  });

  describe("createText", () => {
    it("should create a text shape without width", () => {
      const props: TextProps = { text: "Hello", fontSize: 16, fontFamily: "Arial", color: "#000" };
      const shape = ShapeRecord.createText(pageId, 10, 20, props);

      expect(shape.id).toMatch(/^shape:/);
      expect(shape.type).toBe("text");
      expect(shape.props.text).toBe("Hello");
      expect(shape.props.w).toBeUndefined();
    });

    it("should create a text shape with width", () => {
      const props: TextProps = { text: "Hello", fontSize: 16, fontFamily: "Arial", color: "#000", w: 200 };
      const shape = ShapeRecord.createText(pageId, 10, 20, props);

      expect(shape.props.w).toBe(200);
    });

    it.each([{ text: "", fontSize: 12, fontFamily: "Arial", color: "#000" }, {
      text: "Multi\nline\ntext",
      fontSize: 24,
      fontFamily: "Helvetica",
      color: "#ff0000",
    }, { text: "Special chars: !@#$%^&*()", fontSize: 14, fontFamily: "Courier", color: "rgb(0,0,0)" }])(
      "should create text with props: %o",
      (props) => {
        const shape = ShapeRecord.createText(pageId, 0, 0, props as TextProps);
        expect(shape.props.text).toBe(props.text);
        expect(shape.props.fontSize).toBe(props.fontSize);
      },
    );
  });

  describe("clone", () => {
    it("should clone a rect shape", () => {
      const props: RectProps = { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 5 };
      const shape = ShapeRecord.createRect(pageId, 10, 20, props);

      const cloned = ShapeRecord.clone(shape);

      expect(cloned).toEqual(shape);
      expect(cloned).not.toBe(shape);
      expect(cloned.props).not.toBe(shape.props);
    });

    it("should deep clone props", () => {
      const props: RectProps = { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 5 };
      const shape = ShapeRecord.createRect(pageId, 10, 20, props);

      const cloned = ShapeRecord.clone(shape);
      if (cloned.type === "rect") {
        cloned.props.w = 200;
      }

      expect(shape.props.w).toBe(100);
    });

    it("should clone line shape with Vec2 props", () => {
      const props: LineProps = { a: { x: 0, y: 0 }, b: { x: 100, y: 50 }, stroke: "#000", width: 2 };
      const shape = ShapeRecord.createLine(pageId, 0, 0, props);

      const cloned = ShapeRecord.clone(shape);

      expect(cloned).toEqual(shape);
      expect(cloned.props).not.toBe(shape.props);
    });

    it("should clone modern arrow shape with points", () => {
      const props: ArrowProps = {
        points: [{ x: 0, y: 0 }, { x: 50, y: 25 }, { x: 100, y: 50 }],
        start: { kind: "free" },
        end: { kind: "bound", bindingId: "binding:1" },
        style: { stroke: "#000", width: 2, dash: [5, 3] },
        routing: { kind: "orthogonal", cornerRadius: 5 },
        label: { text: "Test", align: "center", offset: 0 },
      };
      const shape = ShapeRecord.createArrow(pageId, 0, 0, props);

      const cloned = ShapeRecord.clone(shape);

      expect(cloned).toEqual(shape);
      expect(cloned.props).not.toBe(shape.props);
      if (cloned.type === "arrow" && shape.type === "arrow") {
        expect(cloned.props.points).not.toBe(shape.props.points);
        expect(cloned.props.start).not.toBe(shape.props.start);
        expect(cloned.props.end).not.toBe(shape.props.end);
        expect(cloned.props.style).not.toBe(shape.props.style);
        expect(cloned.props.routing).not.toBe(shape.props.routing);
        expect(cloned.props.label).not.toBe(shape.props.label);
      }
    });

    it("should deep clone arrow points array", () => {
      const props: ArrowProps = {
        points: [{ x: 0, y: 0 }, { x: 100, y: 50 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
      };
      const shape = ShapeRecord.createArrow(pageId, 0, 0, props);

      const cloned = ShapeRecord.clone(shape);

      if (cloned.type === "arrow" && shape.type === "arrow" && cloned.props.points && shape.props.points) {
        cloned.props.points[0].x = 999;
        expect(shape.props.points[0].x).toBe(0);
      }
    });

    it("should deep clone arrow style dash array", () => {
      const props: ArrowProps = {
        points: [{ x: 0, y: 0 }, { x: 100, y: 50 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2, dash: [5, 3] },
      };
      const shape = ShapeRecord.createArrow(pageId, 0, 0, props);

      const cloned = ShapeRecord.clone(shape);

      if (cloned.type === "arrow" && shape.type === "arrow" && cloned.props.style?.dash && shape.props.style?.dash) {
        cloned.props.style.dash[0] = 999;
        expect(shape.props.style.dash[0]).toBe(5);
      }
    });
  });

  describe("position and rotation", () => {
    it("should create shapes at different positions", () => {
      const props: RectProps = { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 };

      const shape1 = ShapeRecord.createRect(pageId, 0, 0, props);
      const shape2 = ShapeRecord.createRect(pageId, 100, 200, props);
      const shape3 = ShapeRecord.createRect(pageId, -50, -30, props);

      expect(shape1.x).toBe(0);
      expect(shape1.y).toBe(0);
      expect(shape2.x).toBe(100);
      expect(shape2.y).toBe(200);
      expect(shape3.x).toBe(-50);
      expect(shape3.y).toBe(-30);
    });

    it("should initialize rotation to 0", () => {
      const props: RectProps = { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 };
      const shape = ShapeRecord.createRect(pageId, 0, 0, props);

      expect(shape.rot).toBe(0);
    });
  });
});

describe("BindingRecord", () => {
  describe("create", () => {
    it("should create a binding with default anchor", () => {
      const binding = BindingRecord.create("arrow1", "shape1", "start");

      expect(binding.id).toMatch(/^binding:/);
      expect(binding.type).toBe("arrow-end");
      expect(binding.fromShapeId).toBe("arrow1");
      expect(binding.toShapeId).toBe("shape1");
      expect(binding.handle).toBe("start");
      expect(binding.anchor).toEqual({ kind: "center" });
    });

    it("should create a binding with custom ID", () => {
      const binding = BindingRecord.create("arrow1", "shape1", "end", { kind: "center" }, "binding:custom");

      expect(binding.id).toBe("binding:custom");
    });

    it.each([{ handle: "start" as const }, { handle: "end" as const }])(
      "should create binding with handle: $handle",
      ({ handle }) => {
        const binding = BindingRecord.create("arrow1", "shape1", handle);
        expect(binding.handle).toBe(handle);
      },
    );

    it("should create binding with custom anchor", () => {
      const anchor = { kind: "center" as const };
      const binding = BindingRecord.create("arrow1", "shape1", "start", anchor);

      expect(binding.anchor).toEqual(anchor);
    });
  });

  describe("clone", () => {
    it("should create a copy of the binding with center anchor", () => {
      const binding = BindingRecord.create("arrow1", "shape1", "start");

      const cloned = BindingRecord.clone(binding);

      expect(cloned).toEqual(binding);
      expect(cloned).not.toBe(binding);
      expect(cloned.anchor).not.toBe(binding.anchor);
    });

    it("should deep clone center anchor", () => {
      const binding = BindingRecord.create("arrow1", "shape1", "start");

      const cloned = BindingRecord.clone(binding);

      expect(cloned.anchor).toEqual(binding.anchor);
      expect(cloned.anchor).not.toBe(binding.anchor);
    });

    it("should clone binding with edge anchor", () => {
      const binding = BindingRecord.create("arrow1", "shape1", "end", { kind: "edge", nx: 0.5, ny: -0.5 });

      const cloned = BindingRecord.clone(binding);

      expect(cloned).toEqual(binding);
      expect(cloned).not.toBe(binding);
      expect(cloned.anchor).not.toBe(binding.anchor);
    });

    it("should deep clone edge anchor", () => {
      const binding = BindingRecord.create("arrow1", "shape1", "start", { kind: "edge", nx: 1, ny: 0 });

      const cloned = BindingRecord.clone(binding);

      expect(cloned.anchor).toEqual({ kind: "edge", nx: 1, ny: 0 });
      expect(cloned.anchor).not.toBe(binding.anchor);
    });
  });

  describe("edge anchors", () => {
    it("should create binding with edge anchor at right edge", () => {
      const anchor = { kind: "edge" as const, nx: 1, ny: 0 };
      const binding = BindingRecord.create("arrow1", "shape1", "start", anchor);

      expect(binding.anchor).toEqual({ kind: "edge", nx: 1, ny: 0 });
    });

    it("should create binding with edge anchor at top-left corner", () => {
      const anchor = { kind: "edge" as const, nx: -1, ny: -1 };
      const binding = BindingRecord.create("arrow1", "shape1", "end", anchor);

      expect(binding.anchor).toEqual({ kind: "edge", nx: -1, ny: -1 });
    });

    it.each([
      { nx: 0, ny: 0, desc: "center" },
      { nx: 1, ny: 0, desc: "right edge" },
      { nx: -1, ny: 0, desc: "left edge" },
      { nx: 0, ny: 1, desc: "bottom edge" },
      { nx: 0, ny: -1, desc: "top edge" },
      { nx: 0.5, ny: 0.5, desc: "bottom-right quadrant" },
      { nx: -0.5, ny: -0.5, desc: "top-left quadrant" },
    ])("should create binding with edge anchor at $desc", ({ nx, ny }) => {
      const anchor = { kind: "edge" as const, nx, ny };
      const binding = BindingRecord.create("arrow1", "shape1", "start", anchor);

      expect(binding.anchor).toEqual({ kind: "edge", nx, ny });
    });
  });
});

describe("Document", () => {
  describe("create", () => {
    it("should create an empty document", () => {
      const doc = Document.create();

      expect(doc.pages).toEqual({});
      expect(doc.shapes).toEqual({});
      expect(doc.bindings).toEqual({});
    });
  });

  describe("clone", () => {
    it("should clone an empty document", () => {
      const doc = Document.create();
      const cloned = Document.clone(doc);

      expect(cloned).toEqual(doc);
      expect(cloned).not.toBe(doc);
    });

    it("should deep clone document with pages and shapes", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const cloned = Document.clone(doc);

      expect(cloned).toEqual(doc);
      expect(cloned.pages).not.toBe(doc.pages);
      expect(cloned.shapes).not.toBe(doc.shapes);
      expect(cloned.pages.page1).not.toBe(doc.pages.page1);
      expect(cloned.shapes.shape1).not.toBe(doc.shapes.shape1);
    });

    it("should deep clone bindings", () => {
      const doc = Document.create();
      const binding = BindingRecord.create("arrow1", "shape1", "start", { kind: "center" }, "binding1");
      doc.bindings = { binding1: binding };

      const cloned = Document.clone(doc);

      expect(cloned.bindings).not.toBe(doc.bindings);
      expect(cloned.bindings.binding1).not.toBe(doc.bindings.binding1);
      expect(cloned.bindings.binding1).toEqual(doc.bindings.binding1);
    });
  });
});

describe("validateDoc", () => {
  describe("valid documents", () => {
    it("should validate empty document", () => {
      const doc = Document.create();
      const result = validateDoc(doc);

      expect(result.ok).toBe(true);
    });

    it("should validate document with page and shape", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(true);
    });

    it("should validate document with multiple shapes", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape1 = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );
      const shape2 = ShapeRecord.createEllipse(
        "page1",
        50,
        50,
        { w: 75, h: 75, fill: "#000", stroke: "#fff" },
        "shape2",
      );

      page.shapeIds = ["shape1", "shape2"];
      doc.pages = { page1: page };
      doc.shapes = { shape1, shape2 };

      const result = validateDoc(doc);

      expect(result.ok).toBe(true);
    });

    it("should validate document with binding", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const arrow = ShapeRecord.createArrow("page1", 0, 0, {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
      }, "arrow1");
      const rect = ShapeRecord.createRect(
        "page1",
        100,
        0,
        { w: 50, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "rect1",
      );
      const binding = BindingRecord.create("arrow1", "rect1", "end", { kind: "center" }, "binding1");

      page.shapeIds = ["arrow1", "rect1"];
      doc.pages = { page1: page };
      doc.shapes = { arrow1: arrow, rect1: rect };
      doc.bindings = { binding1: binding };

      const result = validateDoc(doc);

      expect(result.ok).toBe(true);
    });
  });

  describe("invalid documents", () => {
    it("should reject document with shapes but no pages", () => {
      const doc = Document.create();
      const shape = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Document has shapes but no pages");
      }
    });

    it("should reject shape with mismatched ID", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { wrongId: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Shape key 'wrongId' does not match shape.id 'shape1'");
      }
    });

    it("should reject shape referencing non-existent page", () => {
      const doc = Document.create();
      const shape = ShapeRecord.createRect("nonexistent", 0, 0, {
        w: 100,
        h: 50,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      }, "shape1");

      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Shape 'shape1' references non-existent page 'nonexistent'");
      }
    });

    it("should reject shape not listed in page shapeIds", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Shape 'shape1' not listed in page 'page1' shapeIds");
      }
    });

    it("should reject page referencing non-existent shape", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");

      page.shapeIds = ["nonexistent"];
      doc.pages = { page1: page };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Page 'page1' references non-existent shape 'nonexistent'");
      }
    });

    it("should reject page with duplicate shape IDs", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      page.shapeIds = ["shape1", "shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Page 'page1' has duplicate shape IDs");
      }
    });

    it("should reject binding to non-existent fromShape", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const rect = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 50, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "rect1",
      );
      const binding = BindingRecord.create("nonexistent", "rect1", "end", { kind: "center" }, "binding1");

      page.shapeIds = ["rect1"];
      doc.pages = { page1: page };
      doc.shapes = { rect1: rect };
      doc.bindings = { binding1: binding };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Binding 'binding1' references non-existent fromShape 'nonexistent'");
      }
    });

    it("should reject binding to non-existent toShape", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const arrow = ShapeRecord.createArrow("page1", 0, 0, {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
      }, "arrow1");
      const binding = BindingRecord.create("arrow1", "nonexistent", "end", { kind: "center" }, "binding1");

      page.shapeIds = ["arrow1"];
      doc.pages = { page1: page };
      doc.shapes = { arrow1: arrow };
      doc.bindings = { binding1: binding };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Binding 'binding1' references non-existent toShape 'nonexistent'");
      }
    });

    it("should reject binding from non-arrow shape", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const rect1 = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 50, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "rect1",
      );
      const rect2 = ShapeRecord.createRect(
        "page1",
        100,
        0,
        { w: 50, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "rect2",
      );
      const binding = BindingRecord.create("rect1", "rect2", "start", { kind: "center" }, "binding1");

      page.shapeIds = ["rect1", "rect2"];
      doc.pages = { page1: page };
      doc.shapes = { rect1, rect2 };
      doc.bindings = { binding1: binding };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Binding 'binding1' fromShape 'rect1' is not an arrow");
      }
    });

    it("should reject rect with negative width", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: -100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Rect shape 'shape1' has negative width");
      }
    });

    it("should reject rect with negative height", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: -50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Rect shape 'shape1' has negative height");
      }
    });

    it("should reject rect with negative radius", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: -5 },
        "shape1",
      );

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Rect shape 'shape1' has negative radius");
      }
    });

    it("should reject ellipse with negative dimensions", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createEllipse(
        "page1",
        0,
        0,
        { w: -100, h: 50, fill: "#fff", stroke: "#000" },
        "shape1",
      );

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Ellipse shape 'shape1' has negative width");
      }
    });

    it("should reject line with negative width", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createLine("page1", 0, 0, {
        a: { x: 0, y: 0 },
        b: { x: 100, y: 0 },
        stroke: "#000",
        width: -2,
      }, "shape1");

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Line shape 'shape1' has negative width");
      }
    });

    it("should reject text with invalid fontSize", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createText("page1", 0, 0, {
        text: "Test",
        fontSize: 0,
        fontFamily: "Arial",
        color: "#000",
      }, "shape1");

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Text shape 'shape1' has invalid fontSize");
      }
    });

    it("should reject text with negative width", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createText("page1", 0, 0, {
        text: "Test",
        fontSize: 12,
        fontFamily: "Arial",
        color: "#000",
        w: -100,
      }, "shape1");

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Text shape 'shape1' has negative width");
      }
    });

    it("should collect multiple errors", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape1 = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: -100, h: -50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );
      const shape2 = ShapeRecord.createRect("nonexistent", 0, 0, {
        w: 100,
        h: 50,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      }, "shape2");

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1, shape2 };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(1);
      }
    });

    it("should reject arrow with missing required fields", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createArrow("page1", 0, 0, {} as any, "arrow1");

      page.shapeIds = ["arrow1"];
      doc.pages = { page1: page };
      doc.shapes = { arrow1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      // Arrow is invalid because it has no points or style
    });

    it("should reject arrow with too few points in modern format", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createArrow("page1", 0, 0, {
        points: [{ x: 0, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
      }, "arrow1");

      page.shapeIds = ["arrow1"];
      doc.pages = { page1: page };
      doc.shapes = { arrow1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Arrow shape 'arrow1' points array must have at least 2 points");
      }
    });

    it("should reject arrow with negative width in modern format", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createArrow("page1", 0, 0, {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: -2 },
      }, "arrow1");

      page.shapeIds = ["arrow1"];
      doc.pages = { page1: page };
      doc.shapes = { arrow1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Arrow shape 'arrow1' has negative width in style");
      }
    });

    it("should reject arrow with negative cornerRadius", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createArrow("page1", 0, 0, {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
        routing: { kind: "orthogonal", cornerRadius: -5 },
      }, "arrow1");

      page.shapeIds = ["arrow1"];
      doc.pages = { page1: page };
      doc.shapes = { arrow1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Arrow shape 'arrow1' has negative cornerRadius");
      }
    });

    it("should reject arrow with invalid label alignment", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createArrow("page1", 0, 0, {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
        label: { text: "Test", align: "invalid" as any, offset: 0 },
      }, "arrow1");

      page.shapeIds = ["arrow1"];
      doc.pages = { page1: page };
      doc.shapes = { arrow1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Arrow shape 'arrow1' has invalid label alignment");
      }
    });

    it("should reject binding with edge anchor nx out of range", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const arrow = ShapeRecord.createArrow("page1", 0, 0, {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
      }, "arrow1");
      const rect = ShapeRecord.createRect(
        "page1",
        100,
        0,
        { w: 50, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "rect1",
      );
      const binding = BindingRecord.create("arrow1", "rect1", "end", { kind: "edge", nx: 1.5, ny: 0 }, "binding1");

      page.shapeIds = ["arrow1", "rect1"];
      doc.pages = { page1: page };
      doc.shapes = { arrow1: arrow, rect1: rect };
      doc.bindings = { binding1: binding };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Binding 'binding1' has invalid nx '1.5' (must be in [-1, 1])");
      }
    });

    it("should reject binding with edge anchor ny out of range", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const arrow = ShapeRecord.createArrow("page1", 0, 0, {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
      }, "arrow1");
      const rect = ShapeRecord.createRect(
        "page1",
        100,
        0,
        { w: 50, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "rect1",
      );
      const binding = BindingRecord.create("arrow1", "rect1", "start", { kind: "edge", nx: 0, ny: -2 }, "binding1");

      page.shapeIds = ["arrow1", "rect1"];
      doc.pages = { page1: page };
      doc.shapes = { arrow1: arrow, rect1: rect };
      doc.bindings = { binding1: binding };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Binding 'binding1' has invalid ny '-2' (must be in [-1, 1])");
      }
    });

    it("should accept valid modern arrow format", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const arrow = ShapeRecord.createArrow("page1", 0, 0, {
        points: [{ x: 0, y: 0 }, { x: 50, y: 25 }, { x: 100, y: 50 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2, headStart: false, headEnd: true, dash: [5, 3] },
        routing: { kind: "orthogonal", cornerRadius: 5 },
        label: { text: "Connection", align: "center", offset: 0 },
      }, "arrow1");

      page.shapeIds = ["arrow1"];
      doc.pages = { page1: page };
      doc.shapes = { arrow1: arrow };

      const result = validateDoc(doc);

      expect(result.ok).toBe(true);
    });

    it("should accept binding with valid edge anchor", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const arrow = ShapeRecord.createArrow("page1", 0, 0, {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "bound", bindingId: "binding1" },
        style: { stroke: "#000", width: 2 },
      }, "arrow1");
      const rect = ShapeRecord.createRect(
        "page1",
        100,
        0,
        { w: 50, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "rect1",
      );
      const binding = BindingRecord.create("arrow1", "rect1", "end", { kind: "edge", nx: 0.5, ny: -0.5 }, "binding1");

      page.shapeIds = ["arrow1", "rect1"];
      doc.pages = { page1: page };
      doc.shapes = { arrow1: arrow, rect1: rect };
      doc.bindings = { binding1: binding };

      const result = validateDoc(doc);

      expect(result.ok).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should accept zero-sized shapes", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 0, h: 0, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(true);
    });

    it("should accept text with undefined width", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createText("page1", 0, 0, {
        text: "Test",
        fontSize: 12,
        fontFamily: "Arial",
        color: "#000",
      }, "shape1");

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(true);
    });

    it("should accept empty page name", () => {
      const doc = Document.create();
      const page = PageRecord.create("", "page1");
      doc.pages = { page1: page };

      const result = validateDoc(doc);

      expect(result.ok).toBe(true);
    });
  });
});

describe("JSON serialization", () => {
  it("should round-trip empty document", () => {
    const doc = Document.create();
    const json = JSON.stringify(doc);
    const parsed = JSON.parse(json);

    expect(parsed).toEqual(doc);
    expect(validateDoc(parsed).ok).toBe(true);
  });

  it("should round-trip document with page and shape", () => {
    const doc = Document.create();
    const page = PageRecord.create("Page 1", "page1");
    const shape = ShapeRecord.createRect(
      "page1",
      10,
      20,
      { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 5 },
      "shape1",
    );

    page.shapeIds = ["shape1"];
    doc.pages = { page1: page };
    doc.shapes = { shape1: shape };

    const json = JSON.stringify(doc);
    const parsed = JSON.parse(json);

    expect(parsed).toEqual(doc);
    expect(validateDoc(parsed).ok).toBe(true);
  });

  it("should round-trip document with all shape types", () => {
    const doc = Document.create();
    const page = PageRecord.create("Page 1", "page1");

    const rect = ShapeRecord.createRect(
      "page1",
      0,
      0,
      { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 5 },
      "shape1",
    );
    const ellipse = ShapeRecord.createEllipse(
      "page1",
      100,
      100,
      { w: 75, h: 75, fill: "#f00", stroke: "#000" },
      "shape2",
    );
    const line = ShapeRecord.createLine("page1", 200, 200, {
      a: { x: 0, y: 0 },
      b: { x: 100, y: 50 },
      stroke: "#000",
      width: 2,
    }, "shape3");
    const arrow = ShapeRecord.createArrow("page1", 300, 300, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      start: { kind: "free" },
      end: { kind: "free" },
      style: { stroke: "#000", width: 2 },
    }, "shape4");
    const text = ShapeRecord.createText("page1", 400, 400, {
      text: "Hello World",
      fontSize: 16,
      fontFamily: "Arial",
      color: "#000",
      w: 200,
    }, "shape5");

    page.shapeIds = ["shape1", "shape2", "shape3", "shape4", "shape5"];
    doc.pages = { page1: page };
    doc.shapes = { shape1: rect, shape2: ellipse, shape3: line, shape4: arrow, shape5: text };

    const json = JSON.stringify(doc);
    const parsed = JSON.parse(json);

    expect(parsed).toEqual(doc);
    expect(validateDoc(parsed).ok).toBe(true);
  });

  it("should round-trip document with bindings", () => {
    const doc = Document.create();
    const page = PageRecord.create("Page 1", "page1");
    const arrow = ShapeRecord.createArrow("page1", 0, 0, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      start: { kind: "free" },
      end: { kind: "free" },
      style: { stroke: "#000", width: 2 },
    }, "arrow1");
    const rect = ShapeRecord.createRect(
      "page1",
      100,
      0,
      { w: 50, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
      "rect1",
    );
    const binding = BindingRecord.create("arrow1", "rect1", "end", { kind: "center" }, "binding1");

    page.shapeIds = ["arrow1", "rect1"];
    doc.pages = { page1: page };
    doc.shapes = { arrow1: arrow, rect1: rect };
    doc.bindings = { binding1: binding };

    const json = JSON.stringify(doc);
    const parsed = JSON.parse(json);

    expect(parsed).toEqual(doc);
    expect(validateDoc(parsed).ok).toBe(true);
  });

  it("should round-trip complex document", () => {
    const doc = Document.create();
    const page1 = PageRecord.create("Page 1", "page1");
    const page2 = PageRecord.create("Page 2", "page2");

    const shape1 = ShapeRecord.createRect(
      "page1",
      0,
      0,
      { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 5 },
      "shape1",
    );
    const shape2 = ShapeRecord.createEllipse(
      "page1",
      100,
      100,
      { w: 75, h: 75, fill: "#f00", stroke: "#000" },
      "shape2",
    );
    const shape3 = ShapeRecord.createArrow("page2", 0, 0, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      start: { kind: "free" },
      end: { kind: "free" },
      style: { stroke: "#000", width: 2 },
    }, "shape3");
    const shape4 = ShapeRecord.createRect(
      "page2",
      100,
      0,
      { w: 50, h: 50, fill: "#0f0", stroke: "#000", radius: 0 },
      "shape4",
    );

    const binding = BindingRecord.create("shape3", "shape4", "end", { kind: "center" }, "binding1");

    page1.shapeIds = ["shape1", "shape2"];
    page2.shapeIds = ["shape3", "shape4"];

    doc.pages = { page1, page2 };
    doc.shapes = { shape1, shape2, shape3, shape4 };
    doc.bindings = { binding1: binding };

    const json = JSON.stringify(doc);
    const parsed = JSON.parse(json);

    expect(parsed).toEqual(doc);
    expect(validateDoc(parsed).ok).toBe(true);
  });

  it("should round-trip arrow with modern format", () => {
    const doc = Document.create();
    const page = PageRecord.create("Page 1", "page1");
    const arrow = ShapeRecord.createArrow("page1", 0, 0, {
      points: [{ x: 0, y: 0 }, { x: 50, y: 25 }, { x: 100, y: 50 }],
      start: { kind: "free" },
      end: { kind: "free" },
      style: { stroke: "#ff0000", width: 3, headStart: true, headEnd: true, dash: [5, 3] },
      routing: { kind: "orthogonal", cornerRadius: 5 },
      label: { text: "Connection", align: "center", offset: 0 },
    }, "arrow1");

    page.shapeIds = ["arrow1"];
    doc.pages = { page1: page };
    doc.shapes = { arrow1: arrow };

    const json = JSON.stringify(doc);
    const parsed = JSON.parse(json);

    expect(parsed).toEqual(doc);
    expect(validateDoc(parsed).ok).toBe(true);
  });

  it("should round-trip arrow with bound endpoints", () => {
    const doc = Document.create();
    const page = PageRecord.create("Page 1", "page1");
    const arrow = ShapeRecord.createArrow("page1", 0, 0, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      start: { kind: "bound", bindingId: "binding1" },
      end: { kind: "bound", bindingId: "binding2" },
      style: { stroke: "#000", width: 2 },
    }, "arrow1");
    const rect1 = ShapeRecord.createRect(
      "page1",
      -50,
      -25,
      { w: 50, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
      "rect1",
    );
    const rect2 = ShapeRecord.createRect(
      "page1",
      100,
      -25,
      { w: 50, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
      "rect2",
    );
    const binding1 = BindingRecord.create("arrow1", "rect1", "start", { kind: "edge", nx: 1, ny: 0 }, "binding1");
    const binding2 = BindingRecord.create("arrow1", "rect2", "end", { kind: "edge", nx: -1, ny: 0 }, "binding2");

    page.shapeIds = ["arrow1", "rect1", "rect2"];
    doc.pages = { page1: page };
    doc.shapes = { arrow1: arrow, rect1: rect1, rect2: rect2 };
    doc.bindings = { binding1, binding2 };

    const json = JSON.stringify(doc);
    const parsed = JSON.parse(json);

    expect(parsed).toEqual(doc);
    expect(validateDoc(parsed).ok).toBe(true);
  });

  it("should round-trip binding with edge anchor", () => {
    const doc = Document.create();
    const page = PageRecord.create("Page 1", "page1");
    const arrow = ShapeRecord.createArrow("page1", 0, 0, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      start: { kind: "free" },
      end: { kind: "free" },
      style: { stroke: "#000", width: 2 },
    }, "arrow1");
    const rect = ShapeRecord.createRect(
      "page1",
      100,
      0,
      { w: 50, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
      "rect1",
    );
    const binding = BindingRecord.create("arrow1", "rect1", "end", { kind: "edge", nx: -0.5, ny: 0.5 }, "binding1");

    page.shapeIds = ["arrow1", "rect1"];
    doc.pages = { page1: page };
    doc.shapes = { arrow1: arrow, rect1: rect };
    doc.bindings = { binding1: binding };

    const json = JSON.stringify(doc);
    const parsed = JSON.parse(json);

    expect(parsed).toEqual(doc);
    expect(validateDoc(parsed).ok).toBe(true);
  });
});
