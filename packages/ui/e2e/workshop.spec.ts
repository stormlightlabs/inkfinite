import { expect, test } from "@playwright/test";

test("the workshop exercises theme and component interactions", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /ideas should still look unfinished/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(
    page.getByRole("button", { name: "Save draft (1)" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator("main")).toHaveAttribute("data-ink-theme", "dark");
});
