import { Store } from "inkfinite-core";
import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";
import Toolbar from "../components/Toolbar.svelte";
import { createBrushStore } from "../status";

// TODO: reuse this pattern
function renderToolbar(store: Store) {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const brushStore = createBrushStore();
  return render(Toolbar, {
    target,
    props: {
      currentTool: "select",
      onToolChange: () => {},
      store,
      getViewport: () => ({ width: 800, height: 600 }),
      brushStore,
    },
  });
}

describe("Toolbar accessibility", () => {
  beforeEach(() => {
    cleanup();
  });

  it("should have proper ARIA labels on tool buttons", () => {
    const store = new Store();
    const { container } = renderToolbar(store);

    const selectButton = container.querySelector("[data-tool-id=\"select\"]");
    expect(selectButton?.getAttribute("aria-label")).toBe("Select");
    expect(selectButton?.getAttribute("aria-pressed")).toBe("true");

    const rectButton = container.querySelector("[data-tool-id=\"rect\"]");
    expect(rectButton?.getAttribute("aria-label")).toBe("Rectangle");
    expect(rectButton?.getAttribute("aria-pressed")).toBe("false");
  });

  it("should have ARIA attributes on zoom button", () => {
    const store = new Store();
    const { container } = renderToolbar(store);

    const zoomButton = container.querySelector(".toolbar__zoom-button");
    expect(zoomButton?.getAttribute("aria-label")).toBe("Zoom level");
    expect(zoomButton?.getAttribute("aria-haspopup")).toBe("true");
    expect(zoomButton?.getAttribute("aria-expanded")).toBe("false");
  });

  it("should have proper menu roles when zoom menu is open", async () => {
    const store = new Store();
    const { container } = renderToolbar(store);

    const zoomButton = container.querySelector(".toolbar__zoom-button") as HTMLButtonElement;
    zoomButton.click();

    await new Promise((resolve) => setTimeout(resolve, 0));

    const zoomMenu = container.querySelector(".toolbar__zoom-menu");
    expect(zoomMenu?.getAttribute("role")).toBe("menu");
    expect(zoomMenu?.getAttribute("aria-label")).toBe("Zoom options");

    const menuItems = container.querySelectorAll(".toolbar__zoom-menu .toolbar__menu-item");
    menuItems.forEach((item) => {
      expect(item.getAttribute("role")).toBe("menuitem");
      expect(item.getAttribute("aria-label")).toBeTruthy();
    });
  });

  it("should have ARIA attributes on export button", () => {
    const store = new Store();
    const { container } = renderToolbar(store);

    const exportButton = container.querySelector(".toolbar__export-button");
    expect(exportButton?.getAttribute("aria-label")).toBe("Export drawing");
    expect(exportButton?.getAttribute("aria-haspopup")).toBe("true");
    expect(exportButton?.getAttribute("aria-expanded")).toBe("false");
  });

  it("should have proper menu roles when export menu is open", async () => {
    const store = new Store();
    const { container } = renderToolbar(store);

    const exportButton = container.querySelector(".toolbar__export-button") as HTMLButtonElement;
    exportButton.click();

    await new Promise((resolve) => setTimeout(resolve, 0));

    const exportMenu = container.querySelector(".toolbar__export-menu");
    expect(exportMenu?.getAttribute("role")).toBe("menu");
    expect(exportMenu?.getAttribute("aria-label")).toBe("Export options");

    const menuItems = container.querySelectorAll(".toolbar__export-menu .toolbar__menu-item");
    expect(menuItems.length).toBe(3);
    menuItems.forEach((item) => {
      expect(item.getAttribute("role")).toBe("menuitem");
      expect(item.getAttribute("aria-label")).toBeTruthy();
    });
  });

  it("should have visible focus states on buttons", () => {
    const store = new Store();
    const { container } = renderToolbar(store);

    const selectButton = container.querySelector(".toolbar__tool-button") as HTMLElement;
    selectButton.focus();

    expect(document.activeElement).toBe(selectButton);
  });

  it("should update aria-expanded when menus are toggled", async () => {
    const store = new Store();
    const { container } = renderToolbar(store);

    const zoomButton = container.querySelector(".toolbar__zoom-button") as HTMLButtonElement;

    expect(zoomButton.getAttribute("aria-expanded")).toBe("false");

    zoomButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(zoomButton.getAttribute("aria-expanded")).toBe("true");

    zoomButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(zoomButton.getAttribute("aria-expanded")).toBe("false");
  });
});
