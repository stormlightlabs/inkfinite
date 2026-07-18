import {
  Action,
  EditorState,
  SnapshotCommand,
  Store,
  type Tool,
} from "@inkfinite/core";
import { EditorRuntime, type RuntimeTransactionDraft, type SelectionTool } from "@inkfinite/runtime";
import { describe, expect, it } from "vitest";

const modifiers = { ctrl: false, shift: false, alt: false, meta: false };
const leftDown = { left: true, middle: false, right: false };
const buttonsUp = { left: false, middle: false, right: false };

class DragTool implements Tool {
  readonly id = "select" as const;
  private origin: { x: number; y: number } | null = null;

  onEnter(state: EditorState) { return state; }
  onExit(state: EditorState) { return state; }

  onAction(state: EditorState, action: import("@inkfinite/core").Action): EditorState {
    if (action.type === "pointer-down") {
      this.origin = action.world;
      return state;
    }
    if (action.type !== "pointer-move" || !this.origin) return state;
    const shape = state.doc.shapes["shape:1"];
    if (!shape) return state;
    return {
      ...state,
      doc: {
        ...state.doc,
        shapes: {
          ...state.doc.shapes,
          [shape.id]: {
            ...shape,
            x: action.world.x - this.origin.x,
            y: action.world.y - this.origin.y,
          },
        },
      },
    };
  }
}

describe("editor runtime Rust commit boundary", () => {
  it("keeps drag movement local, applies one committed patch, redraws, and restores the original on undo", () => {
    const initial = EditorState.create();
    initial.doc.pages["page:1"] = { id: "page:1", name: "Page 1", shapeIds: ["shape:1"] };
    initial.doc.shapes["shape:1"] = {
      id: "shape:1",
      type: "rect",
      pageId: "page:1",
      x: 0,
      y: 0,
      rot: 0,
      props: { w: 20, h: 20, fill: "#000", stroke: "#000", radius: 0 },
    };
    initial.ui.currentPageId = "page:1";
    initial.ui.selectionIds = ["shape:1"];
    const originalDocument = structuredClone(initial.doc);
    const store = new Store(initial);
    const tool = new DragTool();
    const drafts: RuntimeTransactionDraft[] = [];
    let redraws = 0;
    store.subscribe(() => redraws++);

    const runtime = new EditorRuntime({
      store,
      tools: new Map([[tool.id, tool]]),
      selectionTool: Object.assign(tool, {
        getHandleAtPoint: () => null,
      }) satisfies SelectionTool,
      getSnapSettings: () => ({ snapEnabled: false, gridEnabled: false, gridSize: 25 }),
      onTransactionDraft: (draft) => {
        drafts.push(draft);
        // The fake Rust boundary accepts the draft and returns its materialized
        // document as the patch applied by the frontend adapter.
        store.setState(() => draft.before);
        store.executeCommand(new SnapshotCommand(draft.name, draft.kind, draft.before, draft.after));
      },
    });

    runtime.handleAction(Action.pointerDown({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, leftDown, modifiers));
    runtime.handleAction(Action.pointerMove({ x: 10, y: 8 }, { x: 10, y: 8 }, leftDown, modifiers));

    expect(drafts).toHaveLength(0);
    expect(store.getState().doc.shapes["shape:1"]?.x).toBe(10);

    runtime.handleAction(Action.pointerUp({ x: 10, y: 8 }, { x: 10, y: 8 }, 0, buttonsUp, modifiers));

    expect(drafts).toHaveLength(1);
    expect(store.getState().doc.shapes["shape:1"]?.y).toBe(8);
    expect(redraws).toBeGreaterThan(1);
    expect(store.undo()).toBe(true);
    expect(store.getState().doc).toEqual(originalDocument);
  });
});
