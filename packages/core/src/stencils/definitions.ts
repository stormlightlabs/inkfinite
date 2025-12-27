import { Vec2 } from "../math";
import { ShapeRecord } from "../model";

import { registry } from "./registry";
import type { Stencil } from "./types";

const processStencil: Stencil = {
  id: "flowchart:process",
  name: "Process",
  category: "Flowchart",
  tags: ["rect", "box", "action"],
  preview: {
    kind: "svg",
    data:
      `<svg viewBox="0 0 100 60"><rect x="2" y="2" width="96" height="56" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  },
  spawn: (
    at: Vec2,
  ) => [
    ShapeRecord.createRect("placeholder_page", at.x, at.y, {
      w: 120,
      h: 80,
      fill: "#ffffff",
      stroke: "#000000",
      radius: 0,
    }),
  ],
};

const decisionStencil: Stencil = {
  id: "flowchart:decision",
  name: "Decision",
  category: "Flowchart",
  tags: ["diamond", "if", "branch"],
  preview: {
    kind: "svg",
    data:
      `<svg viewBox="0 0 100 60"><path d="M50 2 L98 30 L50 58 L2 30 Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  },
  spawn: (at: Vec2) => {
    const shape = ShapeRecord.createRect("placeholder_page", at.x, at.y, {
      w: 80,
      h: 80,
      fill: "#ffffff",
      stroke: "#000000",
      radius: 0,
    });
    shape.rot = Math.PI / 4;
    return [shape];
  },
};

const terminatorStencil: Stencil = {
  id: "flowchart:terminator",
  name: "Terminator",
  category: "Flowchart",
  tags: ["ellipse", "start", "end"],
  preview: {
    kind: "svg",
    data:
      `<svg viewBox="0 0 100 60"><rect x="2" y="2" width="96" height="56" rx="28" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  },
  spawn: (
    at: Vec2,
  ) => [
    ShapeRecord.createRect("placeholder_page", at.x, at.y, {
      w: 120,
      h: 60,
      fill: "#ffffff",
      stroke: "#000000",
      radius: 30,
    }),
  ],
};

const stickyNoteStencil: Stencil = {
  id: "etc:stickynote",
  name: "Sticky Note",
  category: "Etc",
  tags: ["note", "memo", "yellow"],
  preview: {
    kind: "svg",
    data: `<svg viewBox="0 0 100 100"><rect x="2" y="2" width="96" height="96" fill="#fff740" stroke="none"/></svg>`,
  },
  spawn: (
    at: Vec2,
  ) => [
    ShapeRecord.createRect("placeholder_page", at.x, at.y, {
      w: 200,
      h: 200,
      fill: "#fff740",
      stroke: "transparent",
      radius: 0,
    }),
  ],
};

const cardStencil: Stencil = {
  id: "ui:card",
  name: "Card",
  category: "UI",
  tags: ["container", "panel"],
  preview: {
    kind: "svg",
    data:
      `<svg viewBox="0 0 100 80"><rect x="2" y="2" width="96" height="76" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><line x1="2" y1="20" x2="98" y2="20" stroke="currentColor" stroke-width="1"/></svg>`,
  },
  spawn: (
    at: Vec2,
  ) => [
    ShapeRecord.createRect("placeholder_page", at.x, at.y, {
      w: 300,
      h: 200,
      fill: "#ffffff",
      stroke: "#dddddd",
      radius: 8,
    }),
  ],
};

export function registerBuiltinStencils() {
  registry.register(processStencil);
  registry.register(decisionStencil);
  registry.register(terminatorStencil);
  registry.register(stickyNoteStencil);
  registry.register(cardStencil);
}
