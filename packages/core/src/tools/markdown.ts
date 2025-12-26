import type { Action } from "../actions";
import { createId, ShapeRecord } from "../model";
import type { EditorState, ToolId } from "../reactivity";
import { getCurrentPage } from "../reactivity";
import type { Tool } from "./base";

export class MarkdownTool implements Tool {
  readonly id: ToolId = "markdown";

  onEnter(state: EditorState): EditorState {
    return state;
  }

  onExit(state: EditorState): EditorState {
    return state;
  }

  onAction(state: EditorState, action: Action): EditorState {
    switch (action.type) {
      case "pointer-down": {
        return this.handlePointerDown(state, action);
      }
      default: {
        return state;
      }
    }
  }

  private handlePointerDown(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-down") return state;

    const currentPage = getCurrentPage(state);
    if (!currentPage) return state;

    const shapeId = createId("shape");

    const shape = ShapeRecord.createMarkdown(currentPage.id, action.world.x, action.world.y, {
      md: "# Markdown\n\nEdit me...",
      w: 300,
      h: 200,
      fontSize: 16,
      fontFamily: "Inter",
      color: "#1f2933",
    }, shapeId);

    const newPage = { ...currentPage, shapeIds: [...currentPage.shapeIds, shapeId] };

    return {
      ...state,
      doc: {
        ...state.doc,
        shapes: { ...state.doc.shapes, [shapeId]: shape },
        pages: { ...state.doc.pages, [currentPage.id]: newPage },
      },
      ui: { ...state.ui, selectionIds: [shapeId] },
    };
  }
}
