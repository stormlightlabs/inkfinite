import {
  type ArrowShape,
  Camera,
  computePolylineLength,
  EditorState,
  getPointAtDistance,
  SnapshotCommand,
  type Store,
  type Viewport,
} from "inkfinite-core";

export class ArrowLabelEditorController {
  current = $state<{ shapeId: string; value: string } | null>(null);
  private inputEl: HTMLInputElement | null = null;

  constructor(private store: Store, private getViewport: () => Viewport, private refreshCursor: () => void) {}

  get isEditing() {
    return this.current !== null;
  }

  setRef = (el: HTMLInputElement | null) => {
    this.inputEl = el;
  };

  getLayout = () => {
    if (!this.current) {
      return null;
    }
    const state = this.store.getState();
    const shape = state.doc.shapes[this.current.shapeId];
    if (!shape || shape.type !== "arrow") {
      return null;
    }
    const arrow = shape as ArrowShape;

    const points = arrow.props.points;
    if (points.length < 2) {
      return null;
    }

    const polylineLength = computePolylineLength(points);
    const align = arrow.props.label?.align ?? "center";
    const offset = arrow.props.label?.offset ?? 0;

    let distance: number;
    if (align === "center") {
      distance = polylineLength / 2 + offset;
    } else if (align === "start") {
      distance = offset;
    } else {
      distance = polylineLength - offset;
    }

    distance = Math.max(0, Math.min(distance, polylineLength));
    const labelPos = getPointAtDistance(points, distance);

    const viewport = this.getViewport();
    const screenPos = Camera.worldToScreen(state.camera, labelPos, viewport);
    const zoom = state.camera.zoom;

    return { left: screenPos.x - 100, top: screenPos.y - 10, width: 200, fontSize: 14 * zoom };
  };

  start = (shapeId: string) => {
    const state = this.store.getState();
    const shape = state.doc.shapes[shapeId];
    if (!shape || shape.type !== "arrow") {
      return;
    }
    const arrow = shape as ArrowShape;
    this.current = { shapeId, value: arrow.props.label?.text ?? "" };
    this.refreshCursor();
    queueMicrotask(() => {
      this.inputEl?.focus();
      this.inputEl?.select();
    });
  };

  handleInput = (event: Event) => {
    if (!this.current) {
      return;
    }
    const target = event.currentTarget as HTMLInputElement;
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
    if (!shape || shape.type !== "arrow") {
      return;
    }
    const arrow = shape as ArrowShape;
    const trimmedValue = value.trim();

    const currentLabel = arrow.props.label?.text ?? "";
    if (currentLabel === trimmedValue) {
      return;
    }

    const before = EditorState.clone(currentState);
    const updatedArrow: ArrowShape = {
      ...arrow,
      props: {
        ...arrow.props,
        label: trimmedValue
          ? { text: trimmedValue, align: arrow.props.label?.align ?? "center", offset: arrow.props.label?.offset ?? 0 }
          : undefined,
      },
    };
    const newShapes = { ...currentState.doc.shapes, [shapeId]: updatedArrow };
    const after = { ...currentState, doc: { ...currentState.doc, shapes: newShapes } };
    const command = new SnapshotCommand("Edit arrow label", "doc", before, EditorState.clone(after));
    this.store.executeCommand(command);
  };

  cancel = () => {
    this.current = null;
    this.refreshCursor();
  };
}
