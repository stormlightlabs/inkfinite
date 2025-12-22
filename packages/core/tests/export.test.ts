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
      a: { x: 0, y: 0 },
      b: { x: 100, y: 0 },
      stroke: "black",
      width: 2,
    });

    state.doc.shapes[arrow.id] = arrow;
    state.doc.pages[pageId].shapeIds.push(arrow.id);

    const svg = exportToSVG(state);
    expect(svg).toContain("<g");
    expect(svg).toContain("<line");
    expect(svg).toContain("stroke=\"black\"");
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
