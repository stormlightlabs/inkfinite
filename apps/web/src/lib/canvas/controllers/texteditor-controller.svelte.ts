import { Camera, EditorState, SnapshotCommand, type Store, type Viewport } from "inkfinite-core";

export class TextEditorController {
  current = $state<{ shapeId: string; value: string } | null>(null);
  private textEditorEl: HTMLTextAreaElement | null = null;

  constructor(
    private store: Store,
    private getViewport: () => Viewport,
    private refreshCursor: () => void,
  ) {}

  get isEditing() {
    return this.current !== null;
  }

  setRef = (el: HTMLTextAreaElement | null) => {
    this.textEditorEl = el;
  };

  getLayout = () => {
    if (!this.current) {
      return null;
    }
    const state = this.store.getState();
    const shape = state.doc.shapes[this.current.shapeId];
    if (!shape || shape.type !== "text") {
      return null;
    }
    const viewport = this.getViewport();
    const screenPos = Camera.worldToScreen(state.camera, { x: shape.x, y: shape.y }, viewport);
    const widthWorld = shape.props.w ?? 240;
    const zoom = state.camera.zoom;
    return {
      left: screenPos.x,
      top: screenPos.y,
      width: widthWorld * zoom,
      height: shape.props.fontSize * 1.4 * zoom,
      fontSize: shape.props.fontSize * zoom,
    };
  };

  start = (shapeId: string) => {
    const state = this.store.getState();
    const shape = state.doc.shapes[shapeId];
    if (!shape || shape.type !== "text") {
      return;
    }
    this.current = { shapeId, value: shape.props.text };
    this.refreshCursor();
    queueMicrotask(() => {
      this.textEditorEl?.focus();
      this.textEditorEl?.select();
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
    if (!shape || shape.type !== "text" || shape.props.text === value) {
      return;
    }
    const before = EditorState.clone(currentState);
    const updatedShape = { ...shape, props: { ...shape.props, text: value } };
    const newShapes = { ...currentState.doc.shapes, [shapeId]: updatedShape };
    const after = { ...currentState, doc: { ...currentState.doc, shapes: newShapes } };
    const command = new SnapshotCommand("Edit text", "doc", before, EditorState.clone(after));
    this.store.executeCommand(command);
  };

  cancel = () => {
    this.current = null;
    this.refreshCursor();
  };
}
