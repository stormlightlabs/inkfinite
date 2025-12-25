import type { ToolId } from "inkfinite-core";

export const HELP_LINKS = [{
  label: "Project README",
  href: "https://github.com/stormlightlabs/inkfinite",
  external: true,
}, { label: "Issue Tracker", href: "https://github.com/stormlightlabs/inkfinite/issues", external: true }];

export const KEYBOARD_TIPS = [
  "⌘/Ctrl + Z to undo, ⇧ + ⌘/Ctrl + Z to redo",
  "Hold space to pan the canvas",
  "Scroll to zoom, double-click to reset view",
];

export const DEFAULT_FILL_COLOR = "#4a90e2";
export const DEFAULT_STROKE_COLOR = "#2e5c8a";

export const TOOLS: Array<{ id: ToolId; label: string; icon: string }> = [
  { id: "select", label: "Select", icon: "⌖" },
  { id: "rect", label: "Rectangle", icon: "▭" },
  { id: "ellipse", label: "Ellipse", icon: "○" },
  { id: "line", label: "Line", icon: "╱" },
  { id: "arrow", label: "Arrow", icon: "→" },
  { id: "text", label: "Text", icon: "T" },
  { id: "markdown", label: "Markdown", icon: "M↓" },
  { id: "pen", label: "Pen", icon: "✎" },
];

export const ZOOM_PRESETS = [{ label: "50%", value: 50 }, { label: "100%", value: 100 }, { label: "200%", value: 200 }];
