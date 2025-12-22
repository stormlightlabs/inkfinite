import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";
import TitleBar from "../components/TitleBar.svelte";

describe("TitleBar", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders title/logo and info button", () => {
    const { container } = render(TitleBar);
    expect(container.querySelector(".titlebar")).toBeTruthy();
    expect(container.querySelector(".titlebar__logo")?.textContent).toContain("∞");
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
});
