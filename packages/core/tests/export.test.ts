import { describe, expect, it } from "vitest";
import { exportToSVG } from "../src/export";
import { PageRecord, ShapeRecord } from "../src/model";
import { EditorState } from "../src/reactivity";

function createTestState() {
  const state = EditorState.create();
  const page = PageRecord.create("Test Page");
  state.doc.pages[page.id] = page;
  state.ui.currentPageId = page.id;
  return { state, pageId: page.id };
}

describe("exportToSVG", () => {
  it("should export an empty SVG when no shapes exist", () => {
    const { state } = createTestState();
    const svg = exportToSVG(state);

    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("should export SVG with a rectangle shape", () => {
    const { state, pageId } = createTestState();

    const rect = ShapeRecord.createRect(pageId, 10, 20, { w: 100, h: 50, fill: "red", stroke: "black", radius: 0 });

    state.doc.shapes[rect.id] = rect;
    state.doc.pages[pageId].shapeIds.push(rect.id);

    const svg = exportToSVG(state);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("<rect");
    expect(svg).toContain("width=\"100\"");
    expect(svg).toContain("height=\"50\"");
    expect(svg).toContain("fill=\"red\"");
    expect(svg).toContain("stroke=\"black\"");
  });

  it("should export semantic metadata for ordinary shapes", () => {
    const { state, pageId } = createTestState();
    const rect = ShapeRecord.createRect(pageId, 10, 20, { w: 100, h: 50, fill: "red", stroke: "black", radius: 0 });
    rect.metadata = {
      name: "Gateway",
      title: null,
      role: "architecture.service",
      description: "Routes requests",
      body: null,
      tags: ["api", "critical"],
      source: "architecture.md",
      link: "https://example.com/gateway",
      customMetadata: { owner: "platform" },
      locked: false,
      agentEditable: true,
      provenance: {
        actorId: "actor:test",
        origin: "human",
        timestamp: 42,
        source: "seed",
      },
    };
    state.doc.shapes[rect.id] = rect;
    state.doc.pages[pageId].shapeIds.push(rect.id);

    const svg = exportToSVG(state);
    expect(svg).toContain('data-name="Gateway"');
    expect(svg).toContain('data-role="architecture.service"');
    expect(svg).toContain('data-description="Routes requests"');
    expect(svg).toContain('data-tags="api,critical"');
    expect(svg).toContain('data-metadata="{&quot;owner&quot;:&quot;platform&quot;}"');
  });

  it("should export SVG with an ellipse shape", () => {
    const { state, pageId } = createTestState();

    const ellipse = ShapeRecord.createEllipse(pageId, 10, 20, { w: 100, h: 50, fill: "blue", stroke: "green" });

    state.doc.shapes[ellipse.id] = ellipse;
    state.doc.pages[pageId].shapeIds.push(ellipse.id);

    const svg = exportToSVG(state);
    expect(svg).toContain("<ellipse");
    expect(svg).toContain("rx=\"50\"");
    expect(svg).toContain("ry=\"25\"");
    expect(svg).toContain("fill=\"blue\"");
    expect(svg).toContain("stroke=\"green\"");
  });

  it("should export SVG with a line shape", () => {
    const { state, pageId } = createTestState();

    const line = ShapeRecord.createLine(pageId, 0, 0, {
      a: { x: 0, y: 0 },
      b: { x: 100, y: 100 },
      stroke: "red",
      width: 2,
    });

    state.doc.shapes[line.id] = line;
    state.doc.pages[pageId].shapeIds.push(line.id);

    const svg = exportToSVG(state);
    expect(svg).toContain("<line");
    expect(svg).toContain("x1=\"0\"");
    expect(svg).toContain("y1=\"0\"");
    expect(svg).toContain("x2=\"100\"");
    expect(svg).toContain("y2=\"100\"");
    expect(svg).toContain("stroke=\"red\"");
    expect(svg).toContain("stroke-width=\"2\"");
  });

  it("should export SVG with an arrow shape", () => {
    const { state, pageId } = createTestState();

    const arrow = ShapeRecord.createArrow(pageId, 0, 0, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      start: { kind: "free" },
      end: { kind: "free" },
      style: { stroke: "black", width: 2, headEnd: true },
      routing: { kind: "straight" },
    });

    state.doc.shapes[arrow.id] = arrow;
    state.doc.pages[pageId].shapeIds.push(arrow.id);

    const svg = exportToSVG(state);
    expect(svg).toContain("<g");
    expect(svg).toContain("<line");
    expect(svg).toContain("stroke=\"black\"");
  });

  it("should export curved arrows as native quadratic commands", () => {
    const { state, pageId } = createTestState();
    const arrow = ShapeRecord.createArrow(pageId, 0, 0, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      start: { kind: "free" },
      end: { kind: "free" },
      style: { stroke: "black", width: 2 },
      routing: { kind: "curved", bend: 20 },
    });

    state.doc.shapes[arrow.id] = arrow;
    state.doc.pages[pageId].shapeIds.push(arrow.id);

    const svg = exportToSVG(state);
    expect(svg).toContain('<path d="M 0 0 Q 50 20 100 0"');
    expect(svg).not.toContain('<line x1="0" y1="0" x2="100" y2="0"');
  });

  it("should export SVG with a text shape", () => {
    const { state, pageId } = createTestState();

    const text = ShapeRecord.createText(pageId, 10, 20, {
      text: "Hello World",
      fontSize: 16,
      fontFamily: "Arial",
      color: "black",
    });

    state.doc.shapes[text.id] = text;
    state.doc.pages[pageId].shapeIds.push(text.id);

    const svg = exportToSVG(state);
    expect(svg).toContain("<text");
    expect(svg).toContain("font-size=\"16\"");
    expect(svg).toContain("font-family=\"Arial\"");
    expect(svg).toContain("fill=\"black\"");
    expect(svg).toContain(">Hello World</text>");
  });

  it("should export native path commands and fill rules", () => {
    const { state, pageId } = createTestState();
    const path = ShapeRecord.createPath(pageId, 10, 20, {
      subpaths: [{
        segments: [
          { type: "move", to: { x: 0, y: 0 } },
          { type: "line", to: { x: 40, y: 0 } },
          { type: "quadratic", control: { x: 50, y: 10 }, to: { x: 40, y: 20 } },
          { type: "cubic", control_1: { x: 40, y: 30 }, control_2: { x: 0, y: 30 }, to: { x: 0, y: 20 } }
        ],
        closed: true
      }],
      fill_rule: "evenodd",
      fill: "#fff",
      stroke: "#000",
      stroke_width: 3
    }, "path:1");
    state.doc.shapes[path.id] = path;
    state.doc.pages[pageId].shapeIds.push(path.id);

    const svg = exportToSVG(state);
    expect(svg).toContain("<path");
    expect(svg).toContain("Q 50 10 40 20");
    expect(svg).toContain("C 40 30 0 30 0 20");
    expect(svg).toContain("fill-rule=\"evenodd\"");
    expect(svg).toContain("stroke-width=\"3\"");
  });

  it("should export only selected shapes when selectedOnly is true", () => {
    const { state, pageId } = createTestState();

    const rect1 = ShapeRecord.createRect(pageId, 0, 0, { w: 50, h: 50, fill: "red", stroke: "black", radius: 0 });
    const rect2 = ShapeRecord.createRect(pageId, 100, 100, { w: 50, h: 50, fill: "blue", stroke: "black", radius: 0 });

    state.doc.shapes[rect1.id] = rect1;
    state.doc.shapes[rect2.id] = rect2;
    state.doc.pages[pageId].shapeIds.push(rect1.id, rect2.id);

    state.ui.selectionIds = [rect1.id];

    const svg = exportToSVG(state, { selectedOnly: true });
    expect(svg).toContain("fill=\"red\"");
    expect(svg).not.toContain("fill=\"blue\"");
  });

  it("should escape XML special characters in shape properties", () => {
    const { state, pageId } = createTestState();

    const text = ShapeRecord.createText(pageId, 0, 0, {
      text: "<script>alert('XSS')</script>",
      fontSize: 16,
      fontFamily: "Arial",
      color: "black",
    });

    state.doc.shapes[text.id] = text;
    state.doc.pages[pageId].shapeIds.push(text.id);

    const svg = exportToSVG(state);
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("<script>");
  });
});
