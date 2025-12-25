import { describe, expect, it } from "vitest";
import { pointInMarkdown, shapeBounds } from "../src/geom";
import type { MarkdownProps } from "../src/model";
import { Document, PageRecord, ShapeRecord, validateDoc } from "../src/model";
import { EditorState as EditorStateOps } from "../src/reactivity";

const createProps = (overrides?: Partial<MarkdownProps>) => ({
  md: "# Hello World",
  w: 300,
  h: 200,
  fontSize: 16,
  fontFamily: "sans-serif",
  color: "#1f2933",
  ...overrides,
});

describe("MarkdownShape", () => {
  const pageId = "page:test";

  describe("createMarkdown", () => {
    it("should create a markdown shape with generated ID", () => {
      const props = createProps();
      const shape = ShapeRecord.createMarkdown(pageId, 10, 20, props);

      expect(shape.id).toMatch(/^shape:/);
      expect(shape.type).toBe("markdown");
      expect(shape.pageId).toBe(pageId);
      expect(shape.x).toBe(10);
      expect(shape.y).toBe(20);
      expect(shape.rot).toBe(0);
      expect(shape.props).toEqual(props);
    });

    it("should create a markdown shape with custom ID", () => {
      const props = createProps({ md: "# Test", color: "#000" });
      const shape = ShapeRecord.createMarkdown(pageId, 10, 20, props, "shape:custom");
      expect(shape.id).toBe("shape:custom");
    });

    it("should create a markdown shape with optional bg and border", () => {
      const props = createProps({ md: "# Styled", color: "#000", bg: "#ffffff", border: "#cccccc" });
      const shape = ShapeRecord.createMarkdown(pageId, 0, 0, props);
      expect(shape.props.bg).toBe("#ffffff");
      expect(shape.props.border).toBe("#cccccc");
    });

    it("should create a markdown shape without height (auto-computed)", () => {
      const props = createProps({ md: "# Auto Height", w: 300, h: undefined, color: "#000" });
      const shape = ShapeRecord.createMarkdown(pageId, 0, 0, props);
      expect(shape.props.h).toBeUndefined();
    });

    it.each([{ md: "# Heading\n\nParagraph", w: 400, h: 300, fontSize: 18 }, {
      md: "- List item 1\n- List item 2",
      w: 200,
      h: 150,
      fontSize: 14,
    }, { md: "```\ncode block\n```", w: 350, h: 250, fontSize: 12 }])(
      "should create markdown with various content: %o",
      ({ md, w, h, fontSize }) => {
        const props: MarkdownProps = { md, w, h, fontSize, fontFamily: "sans-serif", color: "#000" };
        const shape = ShapeRecord.createMarkdown(pageId, 0, 0, props);

        expect(shape.props.md).toBe(md);
        expect(shape.props.w).toBe(w);
        expect(shape.props.h).toBe(h);
      },
    );
  });

  describe("clone", () => {
    it("should clone a markdown shape", () => {
      const props = createProps({ md: "# Clone Test", color: "#000" });
      const shape = ShapeRecord.createMarkdown(pageId, 10, 20, props);
      const cloned = ShapeRecord.clone(shape);

      expect(cloned).toEqual(shape);
      expect(cloned).not.toBe(shape);
      expect(cloned.props).not.toBe(shape.props);
    });

    it("should deep clone props", () => {
      const props = createProps({ md: "# Original", fontFamily: "sans-serif", color: "#000" });
      const shape = ShapeRecord.createMarkdown(pageId, 10, 20, props);
      const cloned = ShapeRecord.clone(shape);

      if (cloned.type === "markdown") {
        cloned.props.md = "# Modified";
        cloned.props.w = 400;
      }

      expect(shape.props.md).toBe("# Original");
      expect(shape.props.w).toBe(300);
    });
  });

  describe("geometry", () => {
    describe("shapeBounds", () => {
      it("should compute bounds for markdown shape without rotation", () => {
        const shape = ShapeRecord.createMarkdown(pageId, 10, 20, createProps({ md: "# Test", color: "#000" }));
        const bounds = shapeBounds(shape);
        expect(bounds.min.x).toBe(10);
        expect(bounds.min.y).toBe(20);
        expect(bounds.max.x).toBe(310);
        expect(bounds.max.y).toBe(220);
      });

      it("should compute bounds for markdown shape with auto height", () => {
        const shape = ShapeRecord.createMarkdown(
          pageId,
          0,
          0,
          createProps({ md: "# Test", h: undefined, color: "#000" }),
        );
        const bounds = shapeBounds(shape);
        expect(bounds.min.x).toBe(0);
        expect(bounds.min.y).toBe(0);
        expect(bounds.max.x).toBe(300);
        expect(bounds.max.y).toBe(160);
      });

      it("should compute rotated bounds correctly", () => {
        const shape = ShapeRecord.createMarkdown(
          pageId,
          100,
          100,
          createProps({ md: "# Test", w: 200, h: 100, color: "#000" }),
        );
        shape.rot = Math.PI / 4;

        const bounds = shapeBounds(shape);

        expect(bounds.min.x).toBeLessThan(101);
        expect(bounds.min.y).toBeLessThan(101);
        expect(bounds.max.x).toBeGreaterThan(200);
        expect(bounds.max.y).toBeGreaterThan(150);
      });
    });

    describe("pointInMarkdown", () => {
      it("should return true for point inside markdown block", () => {
        const shape = ShapeRecord.createMarkdown(pageId, 10, 20, createProps({ md: "# Test", color: "#000" }));
        expect(pointInMarkdown({ x: 100, y: 100 }, shape)).toBe(true);
      });

      it("should return false for point outside markdown block", () => {
        const shape = ShapeRecord.createMarkdown(pageId, 10, 20, createProps({ md: "# Test", color: "#000" }));
        expect(pointInMarkdown({ x: 400, y: 100 }, shape)).toBe(false);
        expect(pointInMarkdown({ x: 100, y: 300 }, shape)).toBe(false);
      });

      it("should handle edge cases on bounds", () => {
        const shape = ShapeRecord.createMarkdown(pageId, 10, 20, createProps({ md: "# Test", color: "#000" }));
        expect(pointInMarkdown({ x: 10, y: 20 }, shape)).toBe(true);
        expect(pointInMarkdown({ x: 310, y: 220 }, shape)).toBe(true);
        expect(pointInMarkdown({ x: 9, y: 20 }, shape)).toBe(false);
        expect(pointInMarkdown({ x: 311, y: 220 }, shape)).toBe(false);
      });
    });
  });

  describe("validation", () => {
    it("should validate markdown shape with all required fields", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createMarkdown("page1", 0, 0, createProps({ md: "# Valid", color: "#000" }), "shape1");

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);
      expect(result.ok).toBe(true);
    });

    it("should reject markdown with invalid fontSize", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createMarkdown(
        "page1",
        0,
        0,
        createProps({ md: "# Test", fontSize: 0, color: "#000" }),
        "shape1",
      );

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Markdown shape 'shape1' has invalid fontSize");
      }
    });

    it("should reject markdown with invalid width", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createMarkdown(
        "page1",
        0,
        0,
        createProps({ md: "# Test", w: 0, h: 200, color: "#000" }),
        "shape1",
      );

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Markdown shape 'shape1' has invalid width");
      }
    });

    it("should reject markdown with negative height", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createMarkdown(
        "page1",
        0,
        0,
        createProps({ md: "# Test", h: -100, color: "#000" }),
        "shape1",
      );

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Markdown shape 'shape1' has invalid height");
      }
    });

    it("should accept markdown with undefined height (auto-computed)", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createMarkdown(
        "page1",
        0,
        0,
        createProps({ md: "# Test", h: undefined, color: "#000" }),
        "shape1",
      );

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const result = validateDoc(doc);

      expect(result.ok).toBe(true);
    });
  });

  describe("JSON serialization", () => {
    it("should round-trip markdown shape", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createMarkdown(
        "page1",
        10,
        20,
        createProps({
          md: "# Hello World\n\nThis is a **markdown** block.",
          color: "#1f2933",
          bg: "#ffffff",
          border: "#e0e0e0",
        }),
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

    it("should round-trip markdown shape with complex markdown content", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");
      const markdown = `# Markdown Test

## Features

- **Bold text**
- *Italic text*
- \`code\`

### Code Block

\`\`\`javascript
const hello = "world";
\`\`\`

1. Ordered
2. List
3. Items`;

      const shape = ShapeRecord.createMarkdown("page1", 0, 0, {
        md: markdown,
        w: 400,
        h: 500,
        fontSize: 14,
        fontFamily: "system-ui",
        color: "#000000",
      }, "shape1");

      page.shapeIds = ["shape1"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: shape };

      const json = JSON.stringify(doc);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual(doc);
      expect(validateDoc(parsed).ok).toBe(true);
    });

    it("should round-trip document with markdown and other shapes", () => {
      const doc = Document.create();
      const page = PageRecord.create("Page 1", "page1");

      const rect = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 5 },
        "shape1",
      );

      const markdown = ShapeRecord.createMarkdown("page1", 150, 100, {
        md: "# Markdown\n\nNext to a rectangle",
        w: 300,
        h: 200,
        fontSize: 16,
        fontFamily: "sans-serif",
        color: "#000",
      }, "shape2");

      const text = ShapeRecord.createText("page1", 500, 200, {
        text: "Plain text",
        fontSize: 18,
        fontFamily: "Arial",
        color: "#333",
      }, "shape3");

      page.shapeIds = ["shape1", "shape2", "shape3"];
      doc.pages = { page1: page };
      doc.shapes = { shape1: rect, shape2: markdown, shape3: text };

      const json = JSON.stringify(doc);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual(doc);
      expect(validateDoc(parsed).ok).toBe(true);
    });
  });

  describe("integration with EditorState", () => {
    it("should work in EditorState with markdown shapes", () => {
      const state = EditorStateOps.create();
      const page = PageRecord.create("Test Page", "page1");
      const markdown = ShapeRecord.createMarkdown(
        "page1",
        0,
        0,
        createProps({ md: "# Test", color: "#000" }),
        "shape1",
      );

      page.shapeIds = ["shape1"];
      state.doc.pages = { page1: page };
      state.doc.shapes = { shape1: markdown };
      state.ui.currentPageId = "page1";

      const cloned = EditorStateOps.clone(state);

      expect(cloned).toEqual(state);
      expect(cloned).not.toBe(state);
      expect(cloned.doc.shapes.shape1).not.toBe(state.doc.shapes.shape1);
    });
  });
});
