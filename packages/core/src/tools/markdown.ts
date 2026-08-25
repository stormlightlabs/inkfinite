import type { Action } from "../actions";
import { createId, EditorShapeRecord } from "../editor-model";
import type { EditorState, ToolId } from "../reactivity";
import { canCreateShapeOnActiveLayer, getCurrentPage } from "../reactivity";
import type { Tool } from "./base";
import { creationStylePolicy, type CanvasAppearance } from "../style-policy";

export class MarkdownTool implements Tool {
  readonly id: ToolId = "markdown";

  constructor(private readonly getAppearance: () => CanvasAppearance = () => "light") {}

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
    if (!canCreateShapeOnActiveLayer(state)) return state;

    const currentPage = getCurrentPage(state);
    if (!currentPage) return state;

    const shapeId = createId("shape");

    const shape = EditorShapeRecord.createMarkdown(currentPage.id, action.world.x, action.world.y, {
      md: "# Markdown\n\nEdit me...",
      w: 300,
      h: 200,
      ...creationStylePolicy(this.getAppearance()).markdown,
    }, shapeId);

    const newPage = { ...currentPage, shapeIds: [...currentPage.shapeIds, shapeId] };

    return {
      ...state,
      doc: {
        ...state.doc,
        shapes: { ...state.doc.shapes, [shapeId]: shape },
        pages: { ...state.doc.pages, [currentPage.id]: newPage },
      },
      ui: { ...state.ui, selectionIds: [shapeId], toolId: "select" },
    };
  }
}
