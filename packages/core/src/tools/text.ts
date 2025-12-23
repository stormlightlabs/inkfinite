import type { Action } from "../actions";
import { createId, ShapeRecord } from "../model";
import type { EditorState, ToolId } from "../reactivity";
import { getCurrentPage } from "../reactivity";
import type { Tool } from "./base";

/**
 * Text tool - creates text shapes on click
 *
 * Features:
 * - Click to create a text shape at the pointer position
 * - Text is created with default content "Text"
 * - Shape is immediately selected after creation
 */
export class TextTool implements Tool {
  readonly id: ToolId = "text";

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

    const shape = ShapeRecord.createText(currentPage.id, action.world.x, action.world.y, {
      text: "Text",
      fontSize: 16,
      fontFamily: "sans-serif",
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
