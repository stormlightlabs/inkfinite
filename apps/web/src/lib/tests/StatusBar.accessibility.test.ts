import { CursorStore, Store } from "inkfinite-core";
import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";
import StatusBar from "../components/StatusBar.svelte";

const createMockStatusStore = () => ({
  get: () => ({ backend: "indexeddb" as const, state: "saved" as const, pendingWrites: 0 }),
  subscribe: () => () => {},
  update: () => {},
});

const createMockSnapStore = () => ({
  get: () => ({ snapEnabled: false, gridEnabled: true, gridSize: 25 }),
  subscribe: () => () => {},
  update: () => {},
  set: () => {},
});

describe("StatusBar accessibility", () => {
  beforeEach(() => {
    cleanup();
  });

  it("should have ARIA labels on snap checkboxes", () => {
    const store = new Store();
    const cursor = new CursorStore();
    const persistence = createMockStatusStore();
    const snap = createMockSnapStore();

    const { container } = render(StatusBar, { store, cursor, persistence, snap });

    const checkboxes = container.querySelectorAll(".status-bar__toggle input[type=\"checkbox\"]");
    expect(checkboxes.length).toBe(2);

    const mainSnapCheckbox = checkboxes[0];
    expect(mainSnapCheckbox.getAttribute("aria-label")).toBe("Enable main snapping");

    const gridSnapCheckbox = checkboxes[1];
    expect(gridSnapCheckbox.getAttribute("aria-label")).toBe("Enable grid snapping");
  });

  it("should have proper checkbox states", () => {
    const store = new Store();
    const cursor = new CursorStore();
    const persistence = createMockStatusStore();
    const snap = {
      get: () => ({ snapEnabled: true, gridEnabled: false, gridSize: 25 }),
      subscribe: () => () => {},
      update: () => {},
      set: () => {},
    };

    const { container } = render(StatusBar, { store, cursor, persistence, snap });

    const checkboxes = container.querySelectorAll(".status-bar__toggle input[type=\"checkbox\"]") as NodeListOf<
      HTMLInputElement
    >;

    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
  });

  it("should have visible focus states on checkboxes", () => {
    const store = new Store();
    const cursor = new CursorStore();
    const persistence = createMockStatusStore();
    const snap = createMockSnapStore();

    const { container } = render(StatusBar, { store, cursor, persistence, snap });

    const checkbox = container.querySelector(".status-bar__toggle input[type=\"checkbox\"]") as HTMLInputElement;
    checkbox.focus();

    expect(document.activeElement).toBe(checkbox);
  });

  it("should display error state with proper styling", () => {
    const store = new Store();
    const cursor = new CursorStore();
    const persistence = {
      get: () => ({ backend: "indexeddb" as const, state: "error" as const, pendingWrites: 0, errorMsg: "Test error" }),
      subscribe: () => () => {},
      update: () => {},
    };

    const snap = createMockSnapStore();
    const { container } = render(StatusBar, { store, cursor, persistence, snap });
    const persistenceValue = container.querySelector(".status-bar__section--persistence .status-bar__value");
    expect(persistenceValue).toBeTruthy();
    expect(persistenceValue?.textContent).toContain("Error");
    expect(persistenceValue?.classList.contains("status-bar__value--error")).toBe(true);
  });

  it("should use semantic HTML structure", () => {
    const store = new Store();
    const cursor = new CursorStore();
    const persistence = createMockStatusStore();
    const snap = createMockSnapStore();

    const { container } = render(StatusBar, { store, cursor, persistence, snap });
    const labels = container.querySelectorAll(".status-bar__toggle");
    expect(labels.length).toBe(2);

    labels.forEach((label) => {
      const input = label.querySelector("input[type=\"checkbox\"]");
      expect(input).toBeTruthy();
    });
  });
});
