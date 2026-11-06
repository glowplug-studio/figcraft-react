import { expect, test } from "@playwright/test";

test("loads the Figcraft package inside the Next.js host", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Figcraft React Preview");
  await expect(page.getByRole("heading", { name: "Figcraft React" })).toBeVisible();

  const root = page.locator("[data-figcraft-root]");
  await expect(root).toBeVisible();
  await expect(root).toContainText("No Figcraft features have been ported yet.");
});
