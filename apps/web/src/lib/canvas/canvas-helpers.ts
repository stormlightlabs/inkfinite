import type { Action, CommandKind, EditorState } from "inkfinite-core";

export const handleCursorMap: Record<string, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  rotate: "alias",
  "line-start": "crosshair",
  "line-end": "crosshair",
};

export function computeCursor(
  textEditing: boolean,
  pan: { isPanning: boolean; spaceHeld: boolean },
  handle: { hover: string | null; active: string | null },
  pointerDown: boolean,
): string {
  if (textEditing) {
    return "text";
  }
  if (pan.isPanning) {
    return "grabbing";
  }
  if (pan.spaceHeld) {
    return "grab";
  }
  const targetHandle = handle.active ?? handle.hover;
  if (targetHandle) {
    return handleCursorMap[targetHandle] ?? "default";
  }
  if (pointerDown) {
    return "grabbing";
  }
  return "default";
}

export function statesEqual(a: EditorState, b: EditorState): boolean {
  return a.doc === b.doc && a.camera === b.camera && a.ui === b.ui;
}

export function getCommandKind(before: EditorState, after: EditorState): CommandKind {
  if (before.doc !== after.doc) {
    return "doc";
  }
  if (before.camera !== after.camera) {
    return "camera";
  }
  return "ui";
}

export function describeAction(action: Action, kind: CommandKind): string {
  switch (action.type) {
    case "key-down": {
      if (action.key.startsWith("Arrow")) {
        return "Nudge";
      }
      const primaryModifier = action.modifiers.meta || action.modifiers.ctrl;
      if (primaryModifier && (action.key === "d" || action.key === "D")) {
        return "Duplicate";
      }
      if (primaryModifier && action.key === "]") {
        return "Bring Forward";
      }
      if (primaryModifier && action.key === "[") {
        return "Send Backward";
      }
      return "Key down";
    }
    case "pointer-down":
      return "Pointer down";
    case "pointer-move":
      return "Pointer move";
    case "pointer-up":
      return "Pointer up";
    case "wheel":
      return "Wheel";
    case "key-up":
      return "Key up";
    default:
      return kind === "doc" ? "Edit" : kind === "camera" ? "Camera change" : "UI change";
  }
}

export function isUserCancelled(error: unknown) {
  return error instanceof Error && /cancel/i.test(error.message);
}
