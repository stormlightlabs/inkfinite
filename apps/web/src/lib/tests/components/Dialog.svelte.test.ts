import Dialog from "$lib/components/Dialog.svelte";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";

describe("Dialog", () => {
  describe("visibility", () => {
    it("should render when open is true", async () => {
      render(Dialog, { open: true, title: "Test Dialog" });

      const dialog = page.getByRole("dialog");
      await expect.element(dialog).toBeInTheDocument();
    });

    it("should not render when open is false", async () => {
      render(Dialog, { open: false, title: "Test Dialog" });

      const dialog = page.getByRole("dialog");
      await expect.element(dialog).not.toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("should have correct ARIA attributes", async () => {
      render(Dialog, { open: true, title: "Test Dialog" });

      const dialog = page.getByRole("dialog");
      await expect.element(dialog).toHaveAttribute("aria-modal", "true");
      await expect.element(dialog).toHaveAttribute("aria-label", "Test Dialog");
    });

    it("should be focusable", async () => {
      render(Dialog, { open: true, title: "Test Dialog" });

      const dialog = page.getByRole("dialog");
      await expect.element(dialog).toHaveAttribute("tabindex", "-1");
    });
  });

  describe("close behavior", () => {
    it("should call onClose when backdrop is clicked and closeOnBackdrop is true", async () => {
      const onClose = vi.fn();

      render(Dialog, { open: true, onClose, closeOnBackdrop: true, title: "Test" });

      const backdrop = page.getByRole("presentation");
      await backdrop.click();

      expect(onClose).toHaveBeenCalledOnce();
    });

    it("should call onClose when Escape key is pressed and closeOnEscape is true", async () => {
      const onClose = vi.fn();

      render(Dialog, { open: true, onClose, closeOnEscape: true, title: "Test" });

      const dialog = document.querySelector<HTMLElement>("[role=\"dialog\"]")!;

      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(onClose).toHaveBeenCalledOnce();
    });

    it("should not call onClose when backdrop is clicked and closeOnBackdrop is false", async () => {
      const onClose = vi.fn();

      render(Dialog, { open: true, onClose, closeOnBackdrop: false, title: "Test" });

      const backdrop = page.getByRole("presentation");
      await backdrop.click();

      expect(onClose).not.toHaveBeenCalled();
    });

    it("should not call onClose when Escape key is pressed and closeOnEscape is false", async () => {
      const onClose = vi.fn();

      render(Dialog, { open: true, onClose, closeOnEscape: false, title: "Test" });

      const dialog = document.querySelector<HTMLElement>("[role=\"dialog\"]")!;

      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("styling", () => {
    it("should apply custom class to dialog content", async () => {
      render(Dialog, { open: true, title: "Test", class: "custom-class" });

      const dialog = page.getByRole("dialog");
      await expect.element(dialog).toHaveClass("custom-class");
    });
  });
});
