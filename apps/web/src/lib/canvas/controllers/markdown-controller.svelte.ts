import { Camera, EditorState, SnapshotCommand, type Store, type Viewport } from "inkfinite-core";

/**
 * Controller for markdown block editing
 *
 * Handles:
 * - Opening/closing markdown editor overlay
 * - Cmd/Ctrl+Enter to toggle edit/view
 * - Tab key inserts spaces (not focus change)
 * - Commit on blur
 */
export class MarkdownEditorController {
  current = $state<{ shapeId: string; value: string } | null>(null);
  private markdownEditorEl: HTMLTextAreaElement | null = null;

  constructor(private store: Store, private getViewport: () => Viewport, private refreshCursor: () => void) {}

  get isEditing() {
    return this.current !== null;
  }

  setRef = (el: HTMLTextAreaElement | null) => {
    this.markdownEditorEl = el;
  };

  getLayout = () => {
    if (!this.current) {
      return null;
    }
    const state = this.store.getState();
    const shape = state.doc.shapes[this.current.shapeId];
    if (!shape || shape.type !== "markdown") {
      return null;
    }
    const viewport = this.getViewport();
    const screenPos = Camera.worldToScreen(state.camera, { x: shape.x, y: shape.y }, viewport);
    const zoom = state.camera.zoom;
    const widthWorld = shape.props.w;
    const heightWorld = shape.props.h ?? shape.props.fontSize * 10;
    return {
      left: screenPos.x,
      top: screenPos.y,
      width: widthWorld * zoom,
      height: heightWorld * zoom,
      fontSize: shape.props.fontSize * zoom,
    };
  };

  start = (shapeId: string) => {
    const state = this.store.getState();
    const shape = state.doc.shapes[shapeId];
    if (!shape || shape.type !== "markdown") {
      return;
    }
    this.current = { shapeId, value: shape.props.md };
    this.refreshCursor();
    queueMicrotask(() => {
      this.markdownEditorEl?.focus();
      this.markdownEditorEl?.select();
    });
  };

  handleInput = (event: Event) => {
    if (!this.current) {
      return;
    }
    const target = event.currentTarget as HTMLTextAreaElement;
    this.current = { ...this.current, value: target.value };
  };

  handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const target = event.currentTarget as HTMLTextAreaElement;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const spaces = "  ";
      const newValue = this.current!.value.substring(0, start) + spaces + this.current!.value.substring(end);
      this.current = { ...this.current!, value: newValue };
      queueMicrotask(() => {
        target.selectionStart = target.selectionEnd = start + spaces.length;
      });
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.cancel();
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.commit();
    }
  };

  handleBlur = () => {
    this.commit();
  };

  commit = () => {
    if (!this.current) {
      return;
    }
    const { shapeId, value } = this.current;
    const currentState = this.store.getState();
    const shape = currentState.doc.shapes[shapeId];
    this.current = null;
    this.refreshCursor();
    if (!shape || shape.type !== "markdown" || shape.props.md === value) {
      return;
    }
    const before = EditorState.clone(currentState);
    const updatedShape = { ...shape, props: { ...shape.props, md: value } };
    const newShapes = { ...currentState.doc.shapes, [shapeId]: updatedShape };
    const after = { ...currentState, doc: { ...currentState.doc, shapes: newShapes } };
    const command = new SnapshotCommand("Edit markdown", "doc", before, EditorState.clone(after));
    this.store.executeCommand(command);
  };

  cancel = () => {
    this.current = null;
    this.refreshCursor();
  };
}
