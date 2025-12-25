import { createBrushStore } from "$lib/status";
import { type ComponentProps, tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";
import Toolbar from "../components/Toolbar.svelte";
import { createStoreWithRect } from "./Toolbar.colors.test";

const renderToolbar = (overrides: Partial<ComponentProps<typeof Toolbar>> = {}) => {
  const onOpen = vi.fn();
  const onNew = vi.fn();
  const onSaveAs = vi.fn();
  const onSelectBoard = vi.fn();
  const recentBoards = [{ id: "board-1", name: "Board 1", createdAt: Date.now(), updatedAt: Date.now() }];
  const brushStore = createBrushStore();

  const { container } = render(Toolbar, {
    currentTool: "select",
    onToolChange: () => {},
    store: createStoreWithRect(),
    getViewport: () => ({ width: 800, height: 600 }),
    brushStore,
    platform: "web",
    desktop: { fileName: "Board 1", recentBoards, onOpen, onNew, onSaveAs, onSelectBoard },
    ...overrides,
  });

  return { container, onNew, onOpen, onSaveAs, onSelectBoard, recentBoards };
};

describe("TitleBar (merged into Toolbar)", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders title/logo and info button", () => {
    const { container } = renderToolbar();
    expect(container.querySelector(".toolbar")).toBeTruthy();
    expect(container.querySelector(".toolbar__logo img")).toBeTruthy();
    expect(container.querySelector(".toolbar__info")).toBeTruthy();
  });

  it("opens info dialog when button clicked", async () => {
    const { container } = renderToolbar();
    const button = container.querySelector(".toolbar__info") as HTMLButtonElement;
    expect(button).toBeTruthy();

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector(".about")).toBeTruthy();
  });

  it("shows desktop controls when running on desktop", async () => {
    const { container, onNew, onOpen, onSaveAs, onSelectBoard, recentBoards } = renderToolbar({ platform: "desktop" });
    const buttons = container.querySelectorAll(".toolbar__desktop-button");
    expect(buttons).toHaveLength(3);

    (buttons[0] as HTMLButtonElement).click();
    await tick();
    expect(onNew).toHaveBeenCalled();

    (buttons[1] as HTMLButtonElement).click();
    await tick();
    expect(onOpen).toHaveBeenCalled();

    (buttons[2] as HTMLButtonElement).click();
    await tick();
    expect(onSaveAs).toHaveBeenCalled();

    const select = container.querySelector(".toolbar__recent select") as HTMLSelectElement;
    select.value = recentBoards[0].id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(onSelectBoard).toHaveBeenCalledWith(recentBoards[0].id);
  });
});
