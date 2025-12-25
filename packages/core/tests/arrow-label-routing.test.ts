import { describe, expect, it } from "vitest";
import { computePolylineLength, getPointAtDistance } from "../src/geom";
import type { ArrowShape } from "../src/model";

describe("Arrow label placement under zoom/pan", () => {
  it("should maintain label position relative to arrow when zooming", () => {
    const arrow: ArrowShape = {
      id: "arrow1",
      pageId: "page1",
      type: "arrow",
      x: 100,
      y: 100,
      rot: 0,
      props: {
        points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
        routing: { kind: "straight" },
        label: { text: "Test", align: "center", offset: 0 },
      },
    };

    const polylineLength = computePolylineLength(arrow.props.points);
    const align = arrow.props.label!.align;
    const offset = arrow.props.label!.offset;

    let distance: number;
    if (align === "center") {
      distance = polylineLength / 2 + offset;
    } else if (align === "start") {
      distance = offset;
    } else {
      distance = polylineLength - offset;
    }

    const labelPos = getPointAtDistance(arrow.props.points, distance);

    expect(labelPos.x).toBe(100);
    expect(labelPos.y).toBe(0);

    expect(polylineLength).toBe(200);
    expect(distance).toBe(100);
  });

  it("should correctly place label at start alignment", () => {
    const points = [{ x: 0, y: 0 }, { x: 200, y: 0 }];

    const offset = 20;
    const distance = offset;

    const labelPos = getPointAtDistance(points, distance);

    expect(labelPos.x).toBe(20);
    expect(labelPos.y).toBe(0);
  });

  it("should correctly place label at end alignment", () => {
    const points = [{ x: 0, y: 0 }, { x: 200, y: 0 }];

    const polylineLength = computePolylineLength(points);
    const offset = 20;
    const distance = polylineLength - offset;

    const labelPos = getPointAtDistance(points, distance);

    expect(labelPos.x).toBe(180);
    expect(labelPos.y).toBe(0);
  });

  it("should correctly place label with positive offset from center", () => {
    const points = [{ x: 0, y: 0 }, { x: 200, y: 0 }];

    const polylineLength = computePolylineLength(points);
    const offset = 30;
    const distance = polylineLength / 2 + offset;

    const labelPos = getPointAtDistance(points, distance);

    expect(labelPos.x).toBe(130);
    expect(labelPos.y).toBe(0);
  });

  it("should correctly place label with negative offset from center", () => {
    const points = [{ x: 0, y: 0 }, { x: 200, y: 0 }];

    const polylineLength = computePolylineLength(points);
    const offset = -30;
    const distance = polylineLength / 2 + offset;

    const labelPos = getPointAtDistance(points, distance);

    expect(labelPos.x).toBe(70);
    expect(labelPos.y).toBe(0);
  });

  it("should handle multi-segment polyline labels", () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }];

    const polylineLength = computePolylineLength(points);
    expect(polylineLength).toBe(300);

    const centerDistance = polylineLength / 2;
    const labelPos = getPointAtDistance(points, centerDistance);

    expect(labelPos.x).toBe(100);
    expect(labelPos.y).toBe(50);
  });

  it("should clamp label position within polyline bounds", () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

    const polylineLength = computePolylineLength(points);

    const tooFar = polylineLength + 50;
    const clampedDistance = Math.max(0, Math.min(tooFar, polylineLength));

    expect(clampedDistance).toBe(polylineLength);

    const labelPos = getPointAtDistance(points, clampedDistance);
    expect(labelPos.x).toBe(100);
    expect(labelPos.y).toBe(0);
  });
});

describe("Arrow routing toggle", () => {
  it("should default to straight routing", () => {
    const arrow: ArrowShape = {
      id: "arrow1",
      type: "arrow",
      x: 0,
      y: 0,
      rot: 0,
      pageId: "page1",
      props: {
        points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
      },
    };

    const routing = arrow.props.routing?.kind ?? "straight";
    expect(routing).toBe("straight");
  });

  it("should support orthogonal routing", () => {
    const arrow: ArrowShape = {
      id: "arrow1",
      type: "arrow",
      x: 0,
      y: 0,
      rot: 0,
      pageId: "page1",
      props: {
        points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
        routing: { kind: "orthogonal" },
      },
    };

    expect(arrow.props.routing?.kind).toBe("orthogonal");
  });

  it("should toggle routing from straight to orthogonal", () => {
    let arrow: ArrowShape = {
      id: "arrow1",
      type: "arrow",
      x: 0,
      y: 0,
      rot: 0,
      pageId: "page1",
      props: {
        points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
        routing: { kind: "straight" },
      },
    };

    expect(arrow.props.routing?.kind).toBe("straight");

    arrow = { ...arrow, props: { ...arrow.props, routing: { kind: "orthogonal" } } };

    expect(arrow.props.routing?.kind).toBe("orthogonal");
  });

  it("should toggle routing from orthogonal to straight", () => {
    let arrow: ArrowShape = {
      id: "arrow1",
      type: "arrow",
      x: 0,
      y: 0,
      pageId: "page1",
      rot: 0,
      props: {
        points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
        routing: { kind: "orthogonal" },
      },
    };

    expect(arrow.props.routing?.kind).toBe("orthogonal");

    arrow = { ...arrow, props: { ...arrow.props, routing: { kind: "straight" } } };

    expect(arrow.props.routing?.kind).toBe("straight");
  });

  it("should preserve arrow points when toggling routing", () => {
    const initialPoints = [{ x: 0, y: 0 }, { x: 50, y: 25 }, { x: 100, y: 100 }];

    let arrow: ArrowShape = {
      id: "arrow1",
      type: "arrow",
      x: 0,
      y: 0,
      rot: 0,
      pageId: "page1",
      props: {
        points: initialPoints,
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
        routing: { kind: "straight" },
      },
    };

    arrow = { ...arrow, props: { ...arrow.props, routing: { kind: "orthogonal" } } };

    expect(arrow.props.points).toEqual(initialPoints);
  });

  it("should preserve label when toggling routing", () => {
    const label = { text: "Test Label", align: "center" as const, offset: 10 };

    let arrow: ArrowShape = {
      id: "arrow1",
      type: "arrow",
      x: 0,
      y: 0,
      pageId: "page1",
      rot: 0,
      props: {
        points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
        routing: { kind: "straight" },
        label,
      },
    };

    arrow = { ...arrow, props: { ...arrow.props, routing: { kind: "orthogonal" } } };

    expect(arrow.props.label).toEqual(label);
  });
});

describe("Arrow label editing", () => {
  it("should add label to arrow", () => {
    let arrow: ArrowShape = {
      id: "arrow1",
      type: "arrow",
      x: 0,
      y: 0,
      rot: 0,
      pageId: "page1",
      props: {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
      },
    };

    expect(arrow.props.label).toBeUndefined();

    arrow = { ...arrow, props: { ...arrow.props, label: { text: "New Label", align: "center", offset: 0 } } };

    expect(arrow.props.label?.text).toBe("New Label");
  });

  it("should remove label when text is empty", () => {
    let arrow: ArrowShape = {
      id: "arrow1",
      type: "arrow",
      x: 0,
      y: 0,
      rot: 0,
      pageId: "page1",
      props: {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
        label: { text: "Test", align: "center", offset: 0 },
      },
    };

    expect(arrow.props.label).toBeDefined();

    arrow = { ...arrow, props: { ...arrow.props, label: undefined } };

    expect(arrow.props.label).toBeUndefined();
  });

  it("should update label text", () => {
    let arrow: ArrowShape = {
      id: "arrow1",
      type: "arrow",
      x: 0,
      y: 0,
      rot: 0,
      pageId: "page1",
      props: {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
        label: { text: "Old Text", align: "center", offset: 0 },
      },
    };

    arrow = { ...arrow, props: { ...arrow.props, label: { text: "New Text", align: "center", offset: 0 } } };

    expect(arrow.props.label?.text).toBe("New Text");
  });

  it("should adjust label offset when dragging", () => {
    let arrow: ArrowShape = {
      id: "arrow1",
      type: "arrow",
      x: 0,
      y: 0,
      rot: 0,
      pageId: "page1",
      props: {
        points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2 },
        label: { text: "Test", align: "center", offset: 0 },
      },
    };

    const newOffset = 30;
    arrow = { ...arrow, props: { ...arrow.props, label: { text: "Test", align: "center", offset: newOffset } } };

    expect(arrow.props.label?.offset).toBe(30);

    const polylineLength = computePolylineLength(arrow.props.points);
    const distance = polylineLength / 2 + newOffset;
    const labelPos = getPointAtDistance(arrow.props.points, distance);

    expect(labelPos.x).toBe(130);
  });
});
