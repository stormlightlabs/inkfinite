import Sheet from "$lib/components/Sheet.svelte";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";

describe("Sheet", () => {
  describe("visibility", () => {
    it("should render when open is true", async () => {
      render(Sheet, { open: true, title: "Test Sheet" });
      const sheet = page.getByRole("dialog");
      await expect.element(sheet).toBeInTheDocument();
    });

    it("should not render when open is false", async () => {
      render(Sheet, { open: false, title: "Test Sheet" });
      const sheet = page.getByRole("dialog");
      await expect.element(sheet).not.toBeInTheDocument();
    });
  });

  describe("positioning", () => {
    it("should apply right side class", async () => {
      render(Sheet, { open: true, side: "right", title: "Test" });

      const sheet = page.getByRole("dialog");
      await expect.element(sheet).toHaveClass("sheet-right");
    });

    it("should apply left side class", async () => {
      render(Sheet, { open: true, side: "left", title: "Test" });

      const sheet = page.getByRole("dialog");
      await expect.element(sheet).toHaveClass("sheet-left");
    });

    it("should apply top side class", async () => {
      render(Sheet, { open: true, side: "top", title: "Test" });

      const sheet = page.getByRole("dialog");
      await expect.element(sheet).toHaveClass("sheet-top");
    });

    it("should apply bottom side class", async () => {
      render(Sheet, { open: true, side: "bottom", title: "Test" });

      const sheet = page.getByRole("dialog");
      await expect.element(sheet).toHaveClass("sheet-bottom");
    });

    it("should default to right side when no side is specified", async () => {
      render(Sheet, { open: true, title: "Test" });

      const sheet = page.getByRole("dialog");
      await expect.element(sheet).toHaveClass("sheet-right");
    });
  });

  describe("accessibility", () => {
    it("should have correct ARIA attributes", async () => {
      render(Sheet, { open: true, title: "Test Sheet" });

      const sheet = page.getByRole("dialog");
      await expect.element(sheet).toHaveAttribute("aria-modal", "true");
      await expect.element(sheet).toHaveAttribute("aria-label", "Test Sheet");
    });

    it("should be focusable", async () => {
      render(Sheet, { open: true, title: "Test Sheet" });

      const sheet = page.getByRole("dialog");
      await expect.element(sheet).toHaveAttribute("tabindex", "-1");
    });
  });

  describe("close behavior", () => {
    it("should call onClose when backdrop is clicked and closeOnBackdrop is true", async () => {
      const onClose = vi.fn();

      render(Sheet, { open: true, onClose, closeOnBackdrop: true, title: "Test" });

      const backdrop = page.getByRole("presentation");
      await backdrop.click({ position: { x: 5, y: 5 } });

      expect(onClose).toHaveBeenCalledOnce();
    });

    it("should call onClose when Escape key is pressed and closeOnEscape is true", async () => {
      const onClose = vi.fn();

      render(Sheet, { open: true, onClose, closeOnEscape: true, title: "Test" });

      const sheet = document.querySelector<HTMLElement>("[role=\"dialog\"]")!;

      sheet.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(onClose).toHaveBeenCalledOnce();
    });

    it("should not call onClose when backdrop is clicked and closeOnBackdrop is false", async () => {
      const onClose = vi.fn();

      render(Sheet, { open: true, onClose, closeOnBackdrop: false, title: "Test" });

      const backdrop = page.getByRole("presentation");
      await backdrop.click({ position: { x: 5, y: 5 } });

      expect(onClose).not.toHaveBeenCalled();
    });

    it("should not call onClose when Escape key is pressed and closeOnEscape is false", async () => {
      const onClose = vi.fn();

      render(Sheet, { open: true, onClose, closeOnEscape: false, title: "Test" });

      const sheet = document.querySelector<HTMLElement>("[role=\"dialog\"]")!;

      sheet.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("styling", () => {
    it("should apply custom class to sheet content", async () => {
      render(Sheet, { open: true, title: "Test", class: "custom-class" });

      const sheet = page.getByRole("dialog");
      await expect.element(sheet).toHaveClass("custom-class");
    });
  });
});
