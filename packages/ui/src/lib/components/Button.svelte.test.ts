import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import Button from "./Button.svelte";

describe("Button", () => {
  it("runs its action from the accessible button", async () => {
    const user = userEvent.setup();
    const onclick = vi.fn();
    render(Button, { label: "Save drawing", onclick });

    await user.click(screen.getByRole("button", { name: "Save drawing" }));

    expect(onclick).toHaveBeenCalledOnce();
  });

  it("prevents actions while busy", async () => {
    const user = userEvent.setup();
    const onclick = vi.fn();
    render(Button, { busy: true, label: "Saving", onclick });

    const button = screen.getByRole("button", { name: "Saving" });
    await user.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(onclick).not.toHaveBeenCalled();
  });
});
