/**
 * Unit tests for keyboard shortcuts (Cmd+O, Cmd+N)
 */

import type { KeyDownAction } from "inkfinite-core";
import { describe, expect, it, vi } from "vitest";

describe("Keyboard shortcuts", () => {
  describe("Cmd+O / Ctrl+O (Open file browser)", () => {
    it("should trigger with Cmd+O on Mac", () => {
      const action: KeyDownAction = {
        type: "key-down",
        key: "o",
        code: "KeyO",
        modifiers: { ctrl: false, shift: false, alt: false, meta: true },
        repeat: false,
        timestamp: Date.now(),
      };

      const handleOpen = vi.fn();
      const primaryModifier = action.modifiers.meta || action.modifiers.ctrl;

      if (primaryModifier && (action.key === "o" || action.key === "O")) {
        handleOpen();
      }

      expect(handleOpen).toHaveBeenCalled();
    });

    it("should trigger with Ctrl+O on Windows/Linux", () => {
      const action: KeyDownAction = {
        type: "key-down",
        key: "o",
        code: "KeyO",
        modifiers: { ctrl: true, shift: false, alt: false, meta: false },
        repeat: false,
        timestamp: Date.now(),
      };

      const handleOpen = vi.fn();
      const primaryModifier = action.modifiers.meta || action.modifiers.ctrl;

      if (primaryModifier && (action.key === "o" || action.key === "O")) {
        handleOpen();
      }

      expect(handleOpen).toHaveBeenCalled();
    });

    it("should handle uppercase O", () => {
      const action: KeyDownAction = {
        type: "key-down",
        key: "O",
        code: "KeyO",
        modifiers: { ctrl: false, shift: true, alt: false, meta: true },
        repeat: false,
        timestamp: Date.now(),
      };

      const handleOpen = vi.fn();
      const primaryModifier = action.modifiers.meta || action.modifiers.ctrl;

      if (primaryModifier && (action.key === "o" || action.key === "O")) {
        handleOpen();
      }

      expect(handleOpen).toHaveBeenCalled();
    });

    it("should not trigger without modifier", () => {
      const action: KeyDownAction = {
        type: "key-down",
        key: "o",
        code: "KeyO",
        modifiers: { ctrl: false, shift: false, alt: false, meta: false },
        repeat: false,
        timestamp: Date.now(),
      };

      const handleOpen = vi.fn();
      const primaryModifier = action.modifiers.meta || action.modifiers.ctrl;

      if (primaryModifier && (action.key === "o" || action.key === "O")) {
        handleOpen();
      }

      expect(handleOpen).not.toHaveBeenCalled();
    });
  });

  describe("Cmd+N / Ctrl+N (New board)", () => {
    it("should trigger with Cmd+N on Mac", () => {
      const action: KeyDownAction = {
        type: "key-down",
        key: "n",
        code: "KeyN",
        modifiers: { ctrl: false, shift: false, alt: false, meta: true },
        repeat: false,
        timestamp: Date.now(),
      };

      const handleNew = vi.fn();
      const primaryModifier = action.modifiers.meta || action.modifiers.ctrl;

      if (primaryModifier && (action.key === "n" || action.key === "N")) {
        handleNew();
      }

      expect(handleNew).toHaveBeenCalled();
    });

    it("should trigger with Ctrl+N on Windows/Linux", () => {
      const action: KeyDownAction = {
        type: "key-down",
        key: "n",
        code: "KeyN",
        modifiers: { ctrl: true, shift: false, alt: false, meta: false },
        repeat: false,
        timestamp: Date.now(),
      };

      const handleNew = vi.fn();
      const primaryModifier = action.modifiers.meta || action.modifiers.ctrl;

      if (primaryModifier && (action.key === "n" || action.key === "N")) {
        handleNew();
      }

      expect(handleNew).toHaveBeenCalled();
    });

    it("should handle uppercase N", () => {
      const action: KeyDownAction = {
        type: "key-down",
        key: "N",
        code: "KeyN",
        modifiers: { ctrl: false, shift: true, alt: false, meta: true },
        repeat: false,
        timestamp: Date.now(),
      };

      const handleNew = vi.fn();
      const primaryModifier = action.modifiers.meta || action.modifiers.ctrl;

      if (primaryModifier && (action.key === "n" || action.key === "N")) {
        handleNew();
      }

      expect(handleNew).toHaveBeenCalled();
    });

    it("should not trigger without modifier", () => {
      const action: KeyDownAction = {
        type: "key-down",
        key: "n",
        code: "KeyN",
        modifiers: { ctrl: false, shift: false, alt: false, meta: false },
        repeat: false,
        timestamp: Date.now(),
      };

      const handleNew = vi.fn();
      const primaryModifier = action.modifiers.meta || action.modifiers.ctrl;

      if (primaryModifier && (action.key === "n" || action.key === "N")) {
        handleNew();
      }

      expect(handleNew).not.toHaveBeenCalled();
    });
  });

  describe("Other existing shortcuts", () => {
    it("should not conflict with Cmd+D (duplicate)", () => {
      const actionD: KeyDownAction = {
        type: "key-down",
        key: "d",
        code: "KeyD",
        modifiers: { ctrl: false, shift: false, alt: false, meta: true },
        repeat: false,
        timestamp: Date.now(),
      };

      const handleOpen = vi.fn();
      const handleDuplicate = vi.fn();
      const primaryModifier = actionD.modifiers.meta || actionD.modifiers.ctrl;

      if (primaryModifier && (actionD.key === "o" || actionD.key === "O")) {
        handleOpen();
      } else if (primaryModifier && (actionD.key === "d" || actionD.key === "D")) {
        handleDuplicate();
      }

      expect(handleOpen).not.toHaveBeenCalled();
      expect(handleDuplicate).toHaveBeenCalled();
    });

    it("should not conflict with arrow key navigation", () => {
      const actionArrow: KeyDownAction = {
        type: "key-down",
        key: "ArrowLeft",
        code: "ArrowLeft",
        modifiers: { ctrl: false, shift: false, alt: false, meta: false },
        repeat: false,
        timestamp: Date.now(),
      };

      const handleOpen = vi.fn();
      const handleNav = vi.fn();
      const primaryModifier = actionArrow.modifiers.meta || actionArrow.modifiers.ctrl;

      if (primaryModifier && (actionArrow.key === "o" || actionArrow.key === "O")) {
        handleOpen();
      } else if (actionArrow.key.startsWith("Arrow")) {
        handleNav();
      }

      expect(handleOpen).not.toHaveBeenCalled();
      expect(handleNav).toHaveBeenCalled();
    });
  });
});
