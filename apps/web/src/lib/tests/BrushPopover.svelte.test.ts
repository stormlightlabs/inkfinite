import BrushPopover from "$lib/components/BrushPopover.svelte";
import type { BrushConfig } from "inkfinite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";

describe("BrushPopover", () => {
  const defaultBrush: BrushConfig = {
    size: 16,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: true,
  };

  beforeEach(async () => {
    document.body.innerHTML = "";
  });

  describe("Rendering", () => {
    it("renders the brush button", async () => {
      const onBrushChange = vi.fn();
      render(BrushPopover, { brush: defaultBrush, onBrushChange });

      const button = page.getByRole("button", { name: /brush settings/i });
      await expect.element(button).toBeInTheDocument();
    });

    it("does not show popover by default", async () => {
      const onBrushChange = vi.fn();
      render(BrushPopover, { brush: defaultBrush, onBrushChange });

      const dialog = page.getByRole("dialog");
      await expect.element(dialog).not.toBeInTheDocument();
    });

    it("disables button when disabled prop is true", async () => {
      const onBrushChange = vi.fn();
      render(BrushPopover, { brush: defaultBrush, onBrushChange, disabled: true });

      const button = page.getByRole("button", { name: /brush settings/i });
      await expect.element(button).toBeDisabled();
    });
  });

  describe("Interaction", () => {
    it("opens popover when button is clicked", async () => {
      const onBrushChange = vi.fn();
      render(BrushPopover, { brush: defaultBrush, onBrushChange });

      const button = page.getByRole("button", { name: /brush settings/i });
      await button.click();

      const dialog = page.getByRole("dialog");
      await expect.element(dialog).toBeInTheDocument();
    });

    it("closes popover when button is clicked again", async () => {
      const onBrushChange = vi.fn();
      render(BrushPopover, { brush: defaultBrush, onBrushChange });

      const button = page.getByRole("button", { name: /brush settings/i });
      await button.click();

      const dialog = page.getByRole("dialog");
      await expect.element(dialog).toBeInTheDocument();

      await button.click();
      await expect.element(dialog).not.toBeInTheDocument();
    });

    it("does not show dialog when disabled", async () => {
      const onBrushChange = vi.fn();
      render(BrushPopover, { brush: defaultBrush, onBrushChange, disabled: true });

      const dialog = page.getByRole("dialog");
      await expect.element(dialog).not.toBeInTheDocument();
    });
  });

  describe("Brush Controls", () => {
    it("displays all brush sliders when open", async () => {
      const onBrushChange = vi.fn();
      render(BrushPopover, { brush: defaultBrush, onBrushChange });

      const button = page.getByRole("button", { name: /brush settings/i });
      await button.click();

      await expect.element(page.getByLabelText(/brush size/i)).toBeInTheDocument();
      await expect.element(page.getByLabelText(/brush thinning/i)).toBeInTheDocument();
      await expect.element(page.getByLabelText(/brush smoothing/i)).toBeInTheDocument();
      await expect.element(page.getByLabelText(/brush streamline/i)).toBeInTheDocument();
      await expect.element(page.getByLabelText(/simulate pressure/i)).toBeInTheDocument();
    });

    it("displays current brush values", async () => {
      const customBrush: BrushConfig = {
        size: 20,
        thinning: 0.7,
        smoothing: 0.3,
        streamline: 0.9,
        simulatePressure: false,
      };
      const onBrushChange = vi.fn();
      render(BrushPopover, { brush: customBrush, onBrushChange });

      const button = page.getByRole("button", { name: /brush settings/i });
      await button.click();

      const sizeSlider = page.getByLabelText(/brush size/i);
      await expect.element(sizeSlider).toHaveValue("20");

      const thinningSlider = page.getByLabelText(/brush thinning/i);
      await expect.element(thinningSlider).toHaveValue("0.7");

      const checkbox = page.getByLabelText(/simulate pressure/i);
      await expect.element(checkbox).not.toBeChecked();
    });

    it("calls onBrushChange when size slider changes", async () => {
      const onBrushChange = vi.fn();
      render(BrushPopover, { brush: defaultBrush, onBrushChange });

      const button = page.getByRole("button", { name: /brush settings/i });
      await button.click();

      const sizeSlider = page.getByLabelText(/brush size/i);
      await sizeSlider.fill("25");

      expect(onBrushChange).toHaveBeenCalledWith({ ...defaultBrush, size: 25 });
    });

    it("calls onBrushChange when simulate pressure checkbox changes", async () => {
      const onBrushChange = vi.fn();
      render(BrushPopover, { brush: defaultBrush, onBrushChange });

      const button = page.getByRole("button", { name: /brush settings/i });
      await button.click();

      const checkbox = page.getByLabelText(/simulate pressure/i);
      await checkbox.click();

      expect(onBrushChange).toHaveBeenCalledWith({ ...defaultBrush, simulatePressure: false });
    });
  });
});
