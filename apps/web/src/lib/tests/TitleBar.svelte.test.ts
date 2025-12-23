import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";
import TitleBar from "../components/TitleBar.svelte";

describe("TitleBar", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders title/logo and info button", () => {
    const { container } = render(TitleBar);
    expect(container.querySelector(".titlebar")).toBeTruthy();
    expect(container.querySelector(".titlebar__logo img")).toBeTruthy();
    expect(container.querySelector(".titlebar__info")).toBeTruthy();
  });

  it("opens info dialog when button clicked", async () => {
    const { container } = render(TitleBar);
    const button = container.querySelector(".titlebar__info") as HTMLButtonElement;
    expect(button).toBeTruthy();

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector(".about")).toBeTruthy();
  });

  it("shows desktop controls when running on desktop", async () => {
    const onOpen = vi.fn();
    const onNew = vi.fn();
    const onSaveAs = vi.fn();
    const onSelectBoard = vi.fn();
    const recentBoards = [{ id: "board-1", name: "Board 1", createdAt: Date.now(), updatedAt: Date.now() }];

    const { container } = render(TitleBar, {
      platform: "desktop",
      desktop: { fileName: "Board 1", recentBoards, onOpen, onNew, onSaveAs, onSelectBoard },
    });

    const buttons = container.querySelectorAll(".titlebar__desktop-button");
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

    const select = container.querySelector(".titlebar__recent select") as HTMLSelectElement;
    select.value = recentBoards[0].id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(onSelectBoard).toHaveBeenCalledWith(recentBoards[0].id);
  });
});
