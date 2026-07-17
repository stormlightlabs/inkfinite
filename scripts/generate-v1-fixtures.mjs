import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(root, "fixtures/v1");
const generatedAt = "2026-07-17T00:00:00.000Z";
const timestamp = Date.parse(generatedAt);
const seed = 0x1a2b3c4d;

function writeJson(relativePath, value) {
  const path = resolve(fixtureRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function page(id, name, shapeIds) {
  return { id, name, shapeIds };
}

function baseShape(id, type, pageId, x, y, extra = {}) {
  return { id, type, pageId, x, y, rot: 0, ...extra };
}

function makeFeatureDocument() {
  const pageOne = "page:fixtures";
  const pageTwo = "page:ordering";
  const shapes = {
    "shape:stencil-process": baseShape("shape:stencil-process", "rect", pageOne, 40, 40, {
      props: { w: 120, h: 80, fill: "#ffffff", stroke: "#000000", radius: 0 },
    }),
    "shape:stencil-decision": baseShape("shape:stencil-decision", "rect", pageOne, 220, 40, {
      rot: Math.PI / 4,
      props: { w: 80, h: 80, fill: "#ffffff", stroke: "#000000", radius: 0 },
    }),
    "shape:stencil-terminator": baseShape("shape:stencil-terminator", "rect", pageOne, 380, 40, {
      props: { w: 120, h: 60, fill: "#ffffff", stroke: "#000000", radius: 30 },
    }),
    "shape:stencil-sticky": baseShape("shape:stencil-sticky", "rect", pageOne, 560, 40, {
      props: { w: 200, h: 200, fill: "#fff740", stroke: "transparent", radius: 0 },
    }),
    "shape:stencil-card": baseShape("shape:stencil-card", "rect", pageOne, 40, 220, {
      groupId: "group:card",
      props: { w: 300, h: 200, fill: "#ffffff", stroke: "#333333", radius: 8 },
    }),
    "shape:stencil-card-divider": baseShape("shape:stencil-card-divider", "line", pageOne, 40, 270, {
      groupId: "group:card",
      props: { a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, stroke: "#333333", width: 1 },
    }),
    "shape:ellipse": baseShape("shape:ellipse", "ellipse", pageOne, 400, 280, {
      props: { w: 150, h: 100, fill: "#dbeafe", stroke: "#1d4ed8" },
    }),
    "shape:line": baseShape("shape:line", "line", pageOne, 400, 430, {
      props: { a: { x: 0, y: 0 }, b: { x: 180, y: 60 }, stroke: "#334155", width: 3 },
    }),
    "shape:arrow": baseShape("shape:arrow", "arrow", pageOne, 0, 0, {
      props: {
        points: [{ x: 160, y: 80 }, { x: 350, y: 160 }, { x: 475, y: 330 }],
        start: { kind: "bound", bindingId: "binding:arrow-start" },
        end: { kind: "bound", bindingId: "binding:arrow-end" },
        style: { stroke: "#7c3aed", width: 2, headStart: true, headEnd: true, dash: [8, 4] },
        routing: { kind: "orthogonal", cornerRadius: 8 },
        label: { text: "bound route", align: "center", offset: 12 },
      },
    }),
    "shape:text": baseShape("shape:text", "text", pageOne, 620, 300, {
      groupId: "group:content",
      props: { text: "Inkfinite v1 fixture", fontSize: 18, fontFamily: "Inter", color: "#111827", w: 180 },
    }),
    "shape:stroke": baseShape("shape:stroke", "stroke", pageOne, 0, 0, {
      props: {
        points: [[620, 390, 0.2], [650, 410, 0.6], [690, 395, 0.9], [730, 430, 0.5]],
        style: { color: "#dc2626", opacity: 0.75 },
        brush: { size: 12, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: false },
      },
    }),
    "shape:markdown": baseShape("shape:markdown", "markdown", pageOne, 40, 500, {
      groupId: "group:content",
      props: {
        md: "# Frozen Markdown\n\n- **bold** item\n- `code` item\n\n```ts\nconst version = 1;\n```",
        w: 360,
        h: 240,
        fontSize: 16,
        fontFamily: "Inter",
        color: "#0f172a",
        bg: "#f8fafc",
        border: "#94a3b8",
      },
    }),
    "shape:ordering-back": baseShape("shape:ordering-back", "rect", pageTwo, 100, 100, {
      props: { w: 180, h: 180, fill: "#ef4444", stroke: "#7f1d1d", radius: 0 },
    }),
    "shape:ordering-middle": baseShape("shape:ordering-middle", "ellipse", pageTwo, 130, 130, {
      props: { w: 180, h: 180, fill: "#22c55e", stroke: "#14532d" },
    }),
    "shape:ordering-front": baseShape("shape:ordering-front", "rect", pageTwo, 160, 160, {
      props: { w: 180, h: 180, fill: "#3b82f6", stroke: "#1e3a8a", radius: 16 },
    }),
  };

  const fixtureOrder = [
    "shape:stencil-sticky",
    "shape:stencil-process",
    "shape:stencil-decision",
    "shape:stencil-terminator",
    "shape:stencil-card",
    "shape:stencil-card-divider",
    "shape:ellipse",
    "shape:line",
    "shape:arrow",
    "shape:text",
    "shape:stroke",
    "shape:markdown",
  ];
  const orderingOrder = ["shape:ordering-back", "shape:ordering-middle", "shape:ordering-front"];

  return {
    pages: {
      [pageOne]: page(pageOne, "All features", fixtureOrder),
      [pageTwo]: page(pageTwo, "Persisted ordering", orderingOrder),
    },
    shapes,
    bindings: {
      "binding:arrow-start": {
        id: "binding:arrow-start",
        type: "arrow-end",
        fromShapeId: "shape:arrow",
        toShapeId: "shape:stencil-process",
        handle: "start",
        anchor: { kind: "edge", nx: 1, ny: 0 },
      },
      "binding:arrow-end": {
        id: "binding:arrow-end",
        type: "arrow-end",
        fromShapeId: "shape:arrow",
        toShapeId: "shape:ellipse",
        handle: "end",
        anchor: { kind: "center" },
      },
    },
  };
}

function makeLargeDocument() {
  let randomState = seed >>> 0;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  const pageId = "page:10000";
  const shapeIds = [];
  const shapes = {};

  for (let index = 0; index < 10_000; index++) {
    const id = `shape:perf:${String(index).padStart(5, "0")}`;
    const column = index % 100;
    const row = Math.floor(index / 100);
    const width = 24 + Math.floor(random() * 24);
    const height = 24 + Math.floor(random() * 24);
    shapeIds.push(id);
    shapes[id] = baseShape(id, "rect", pageId, column * 64, row * 64, {
      props: {
        w: width,
        h: height,
        fill: `hsl(${Math.floor(random() * 360)} 70% 80%)`,
        stroke: "#334155",
        radius: index % 5,
      },
    });
  }

  return { pages: { [pageId]: page(pageId, "10,000 shapes", shapeIds) }, shapes, bindings: {} };
}

const board = { id: "board:v1-fixtures", name: "V1 compatibility fixtures", createdAt: timestamp, updatedAt: timestamp };
const document = makeFeatureDocument();
const order = {
  pageIds: ["page:ordering", "page:fixtures"],
  shapeOrder: Object.fromEntries(Object.values(document.pages).map((entry) => [entry.id, [...entry.shapeIds]])),
};
const desktopFixture = { board, doc: document, order };

writeJson("desktop/all-features.inkfinite.json", desktopFixture);
writeJson("web/all-features.web.json", desktopFixture);
writeJson("rendering/all-shapes.json", {
  state: {
    doc: document,
    ui: { currentPageId: "page:fixtures", selectionIds: ["shape:markdown"], toolId: "select" },
    camera: { x: 400, y: 300, zoom: 1 },
  },
  expected: {
    shapeTypes: ["arrow", "ellipse", "line", "markdown", "rect", "stroke", "text"],
    orderedShapeIds: document.pages["page:fixtures"].shapeIds,
  },
});
writeJson("history/history-edits.json", {
  initialState: {
    doc: {
      pages: { "page:history": page("page:history", "History", ["shape:history"]) },
      shapes: {
        "shape:history": baseShape("shape:history", "rect", "page:history", 20, 30, {
          props: { w: 100, h: 60, fill: "#ffffff", stroke: "#000000", radius: 4 },
        }),
      },
      bindings: {},
    },
    ui: { currentPageId: "page:history", selectionIds: ["shape:history"], toolId: "select" },
    camera: { x: 0, y: 0, zoom: 1 },
  },
  edits: [
    { kind: "update-shape", shapeId: "shape:history", patch: { x: 220, y: 180, rot: 0.25 } },
    { kind: "update-shape", shapeId: "shape:history", patch: { props: { fill: "#f59e0b" } } },
    { kind: "delete-shape", shapeId: "shape:history" },
  ],
  expectedAfterUndoAll: { shapeId: "shape:history", x: 20, y: 30, fill: "#ffffff" },
});
writeJson("invalid/missing-envelope-fields.json", { board });
writeJson("invalid/dangling-references.inkfinite.json", {
  board: { ...board, id: "board:invalid-dangling" },
  doc: {
    pages: { "page:invalid": page("page:invalid", "Invalid", ["shape:missing"]) },
    shapes: {
      "shape:dangling": baseShape("shape:dangling", "rect", "page:missing", 0, 0, {
        props: { w: 10, h: 10, fill: "#fff", stroke: "#000", radius: 0 },
      }),
    },
    bindings: {},
  },
  order: { pageIds: ["page:invalid"], shapeOrder: { "page:invalid": ["shape:missing"] } },
});
writeJson("invalid/duplicate-order.inkfinite.json", {
  board: { ...board, id: "board:invalid-order" },
  doc: {
    pages: { "page:invalid": page("page:invalid", "Invalid", ["shape:one", "shape:one"]) },
    shapes: {
      "shape:one": baseShape("shape:one", "rect", "page:invalid", 0, 0, {
        props: { w: 10, h: 10, fill: "#fff", stroke: "#000", radius: 0 },
      }),
    },
    bindings: {},
  },
  order: { pageIds: ["page:invalid"], shapeOrder: { "page:invalid": ["shape:one", "shape:one"] } },
});
const malformedPath = resolve(fixtureRoot, "invalid/malformed-json.inkfinite.json");
mkdirSync(dirname(malformedPath), { recursive: true });
writeFileSync(malformedPath, "{\n  \"board\":\n");

const largeDocument = makeLargeDocument();
writeJson("performance/board-10000.inkfinite.json", {
  board: { id: "board:10000", name: "10,000 shape baseline", createdAt: timestamp, updatedAt: timestamp },
  doc: largeDocument,
  order: {
    pageIds: ["page:10000"],
    shapeOrder: { "page:10000": largeDocument.pages["page:10000"].shapeIds },
  },
  fixture: { seed, generator: "scripts/generate-v1-fixtures.mjs", generatedAt },
});
writeJson("manifest.json", {
  format: "inkfinite-v1-compatibility-fixtures",
  generatedAt,
  generator: "scripts/generate-v1-fixtures.mjs",
  performanceSeed: seed,
  coverage: {
    shapeTypes: ["rect", "ellipse", "line", "arrow", "text", "stroke", "markdown"],
    stencilIds: ["flowchart:process", "flowchart:decision", "flowchart:terminator", "etc:stickynote", "ui:card"],
    groupIds: ["group:card", "group:content"],
    bindingIds: ["binding:arrow-start", "binding:arrow-end"],
    pageIds: ["page:fixtures", "page:ordering"],
  },
});
