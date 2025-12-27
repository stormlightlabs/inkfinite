import { Vec2 } from "../math";
import { ShapeRecord } from "../model";

export type StencilCategory = "Flowchart" | "Diagrams" | "UI" | "Etc";

export interface Stencil {
  id: string;
  name: string;
  category: StencilCategory;
  tags: string[];
  preview: { kind: "svg" | "canvas"; data: string };
  /**
   * Create the shapes for this stencil at the given position.
   * If multiple shapes are returned, they should ideally share a groupId.
   */
  spawn: (atPoint: Vec2) => ShapeRecord[];
}
