import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { localSupabase } from "../support/localSupabase";

test.describe.configure({ mode: "serial" });
let email: string;
let password: string;
let userId: string | undefined;
let backend: ReturnType<typeof localSupabase> | undefined;
test.beforeAll(async () => {
  if (process.env.PLAYWRIGHT_BASE_URL) {
    email = process.env.FIGCRAFT_E2E_EMAIL ?? "";
    password = process.env.FIGCRAFT_E2E_PASSWORD ?? "";
    if (!email || !password) throw new Error("Hosted verification requires FIGCRAFT_E2E_EMAIL and FIGCRAFT_E2E_PASSWORD in the environment");
  } else {
    backend = localSupabase();
    email = `figcraft-browser-${randomUUID()}@example.test`;
    password = `Figcraft-${randomUUID()}!`;
    const result = await backend.admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (result.error) throw new Error("Could not create local Auth fixture");
    userId = result.data.user?.id;
  }
});
test.afterAll(async () => { if (backend && userId) await backend.admin.auth.admin.deleteUser(userId); });
async function login(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Untitled", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create rectangle", exact: true })).toBeEnabled();
}
async function geometry(page: Page, expected: number[]) {
  await expect(page.getByRole("region", { name: "Selected rectangle" }).locator("dd")).toHaveText(expected.map(String));
}

test("protected host, failed login, callback failure and safe redirects", async ({ page }) => {
  await page.goto("/?destination=preserved");
  await expect(page).toHaveURL(/login\?next=%2F%3Fdestination%3Dpreserved/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("main [role=alert]")).toContainText("Sign-in failed");
  await page.goto("/auth/callback?code=invalid&next=https://example.invalid");
  await expect(page).toHaveURL(/\/login\?/);
  await expect(page.locator("main [role=alert]")).toContainText("could not be verified");
  await page.goto("/login?next=//example.invalid");
  await expect(page.locator('input[name="next"]')).toHaveValue("/");
  const denied = await page.request.post("/auth/logout", { headers: { origin: "https://example.invalid" } });
  expect(denied.status()).toBe(403);
});

test("authenticated rectangle command, pixels, keyboard undo/redo and resize", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("requestfailed", request => { if (!request.failure()?.errorText.includes("ERR_ABORTED")) errors.push(request.failure()?.errorText ?? "Request failed"); });
  await login(page);
  const inputs = page.locator('fieldset input');
  for (const [index, value] of [10, 20, 30, 40].entries()) await inputs.nth(index).fill(String(value));
  await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
  await geometry(page, [10, 20, 30, 40]);
  const canvas = page.getByLabel("Design canvas", { exact: true });
  await expect.poll(async () => canvas.evaluate((node: HTMLCanvasElement) => Array.from(node.getContext("2d")!.getImageData(25 * devicePixelRatio, 45 * devicePixelRatio, 1, 1).data))).toEqual([217, 217, 217, 255]);
  await expect(canvas).toHaveScreenshot("rectangle-canvas.png", { animations: "disabled", maxDiffPixels: 0 });
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByText("0 layers", { exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await geometry(page, [10, 20, 30, 40]);
  await page.setViewportSize({ width: 700, height: 700 });
  await geometry(page, [10, 20, 30, 40]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await geometry(page, [10, 20, 30, 40]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/rectangle-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("pointer reverse drag, square and centre modifiers, click, cancellation and no React frame updates", async ({ page }) => {
  await login(page);
  const canvas = page.getByLabel("Design canvas", { exact: true });
  await canvas.focus();
  await page.keyboard.press("r");
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 240, bounds.y + 220);
  await page.mouse.down();
  const commits = await page.locator("[data-figcraft-editor]").getAttribute("data-commits");
  expect(Number(commits)).toBeGreaterThan(0);
  await page.mouse.move(bounds.x + 140, bounds.y + 160, { steps: 40 });
  await expect(page.locator("[data-figcraft-editor]")).toHaveAttribute("data-commits", commits!);
  await page.mouse.up();
  await geometry(page, [140, 160, 100, 60]);
  await expect.poll(async () => Number(await page.locator("[data-figcraft-editor]").getAttribute("data-commits"))).toBeGreaterThan(Number(commits));
  await expect(page.getByRole("button", { name: "Move", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("r");
  await page.mouse.move(bounds.x + 300, bounds.y + 300);
  await page.keyboard.down("Shift"); await page.keyboard.down("Alt");
  await page.mouse.down(); await page.mouse.move(bounds.x + 340, bounds.y + 320, { steps: 8 }); await page.mouse.up();
  await page.keyboard.up("Alt"); await page.keyboard.up("Shift");
  await geometry(page, [260, 260, 80, 80]);
  await page.keyboard.press("r");
  await page.mouse.click(bounds.x + 400, bounds.y + 180);
  await geometry(page, [400, 180, 100, 100]);
  await page.keyboard.press("r");
  await page.mouse.move(bounds.x + 120, bounds.y + 320); await page.mouse.down();
  await page.mouse.move(bounds.x + 200, bounds.y + 380); await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(page.getByText("3 layers", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("2 layers", { exact: true })).toBeVisible();
  const measures = await page.evaluate(() => Object.fromEntries(["figcraft:pointer", "figcraft:render"].map(name => {
    const values = performance.getEntriesByName(name).map(entry => entry.duration).sort((a,b) => a-b);
    return [name, { count: values.length, p95: values[Math.floor(values.length * .95)] ?? 0 }];
  })));
  expect(measures["figcraft:pointer"].p95).toBeLessThan(4);
  expect(measures["figcraft:render"].p95).toBeLessThan(16.7);
  await test.info().attach("interaction-performance", { body: JSON.stringify(measures), contentType: "application/json" });
});

test("session persists across reload, refreshes and logout protects the editor", async ({ page }) => {
  await login(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Untitled", exact: true })).toBeVisible();
  // Force the browser's SSR cookie expiry metadata; proxy must refresh using its refresh token.
  const cookies = await page.context().cookies();
  const auth = cookies.filter(cookie => /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name)).sort((a,b) => a.name.localeCompare(b.name));
  expect(auth.length).toBeGreaterThan(0);
  {
    const encoded = auth.map(cookie => cookie.value).join("");
    const session = JSON.parse(Buffer.from(encoded.replace(/^base64-/, ""), "base64url").toString());
    session.expires_at = 1;
    const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
    await page.context().clearCookies({ name: /^sb-.*-auth-token/ });
    await page.context().addCookies([{ ...auth[0], name: auth[0].name.replace(/\.\d+$/, ""), value }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Untitled", exact: true })).toBeVisible();
    const renewedCookies = (await page.context().cookies()).filter(cookie => /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name)).sort((a,b) => a.name.localeCompare(b.name));
    const renewed = JSON.parse(Buffer.from(renewedCookies.map(cookie => cookie.value).join("").replace(/^base64-/, ""), "base64url").toString());
    expect(renewed.expires_at > Date.now() / 1000).toBe(true);
    expect(renewed.refresh_token !== session.refresh_token).toBe(true);
  }
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=/);
});


test("unavailable Canvas 2D reports an accessible error", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      if (String(args[0]) === "2d") return null;
      return getContext.apply(this, args);
    } as typeof getContext;
  });
  await login(page);
  await expect(page.locator("main [role=alert]")).toContainText("Canvas 2D is unavailable");
});

test("native download, cancelled replacement, reopen and recovery after reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("requestfailed", request => { if (!request.failure()?.errorText.includes("ERR_ABORTED")) errors.push(request.failure()?.errorText ?? "Request failed"); });
  await login(page);
  await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save as", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("Untitled.figcraft");
  expect(await download.failure()).toBeNull();
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  await expect(page.getByText("Downloaded · Local document", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
  const input = page.getByLabel("Open Figcraft file", { exact: true });
  const file = { name: "roundtrip.figcraft", mimeType: "application/octet-stream", buffer: bytes };
  await input.setInputFiles(file);
  await expect(page.getByRole("dialog", { name: "Replace unsaved document" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("2 layers", { exact: true })).toBeVisible();
  await input.setInputFiles(file);
  await page.getByRole("button", { name: "Replace document", exact: true }).click();
  await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  await expect(page.getByText("Unsaved · Local document", { exact: true })).toBeVisible();
  await input.setInputFiles({ name: "invalid.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from("broken") });
  await page.getByRole("button", { name: "Replace document", exact: true }).click();
  await expect(page.locator("main [role=alert]")).toContainText("Cannot open Figcraft file");
  await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("unavailable recovery storage reports the failure without blocking editing or download", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "indexedDB", { get() { throw new Error("Storage access denied"); } }); });
  await login(page);
  await expect(page.locator("main [role=alert]")).toContainText("Recovery unavailable: Storage access denied");
  await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
  await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save as", exact: true }).click();
  expect(await (await download).failure()).toBeNull();
});

test("page lifecycle, dividers, undo, native recovery and narrow-screen access", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await login(page);
  const pages = page.getByRole("region", { name: "Pages", exact: true });
  await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
  await pages.getByLabel("New page name").fill("Flows");
  await pages.getByRole("button", { name: "Add page", exact: true }).click();
  await expect(pages.getByRole("button", { name: "Flows", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("0 layers", { exact: true })).toBeVisible();
  await pages.getByLabel("New page name").fill("- Designs");
  await pages.getByRole("button", { name: "Add page", exact: true }).click();
  await expect(pages.getByRole("separator", { name: "Divider: - Designs" })).toBeVisible();
  await expect(pages.getByRole("button", { name: "Flows", exact: true })).toHaveAttribute("aria-current", "page");
  const original = pages.locator("li").filter({ has: page.getByRole("button", { name: "Page 1", exact: true }) });
  await original.getByLabel("Actions for page Page 1").click();
  await original.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(pages.getByRole("button", { name: "Copy of Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  const copy = pages.locator("li").filter({ has: page.getByRole("button", { name: "Copy of Page 1", exact: true }) });
  await copy.getByLabel("Actions for page Copy of Page 1").click();
  await copy.getByRole("button", { name: "Move up", exact: true }).click();
  await expect(pages.locator(".figcraft-page-select").first()).toHaveText("Copy of Page 1");
  await copy.getByRole("button", { name: "Rename", exact: true }).click();
  await copy.getByLabel("Rename page", { exact: true }).fill("Review");
  await copy.getByRole("button", { name: "Apply name", exact: true }).click();
  await expect(pages.getByRole("button", { name: "Review", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(pages.getByRole("button", { name: "Copy of Page 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  await page.reload();
  await expect(pages.getByRole("button", { name: "Review", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".figcraft-mobile-pages > summary").click();
  const mobile = page.locator(".figcraft-mobile-pages");
  await mobile.getByRole("button", { name: "Flows", exact: true }).click();
  await expect(mobile.getByRole("button", { name: "Flows", exact: true })).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("last-page deletion and divider rename fail without losing the page", async ({ page }) => {
  await login(page);
  const pages = page.getByRole("region", { name: "Pages", exact: true });
  await pages.getByLabel("Actions for page Page 1").click();
  await pages.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator("main [role=alert]")).toContainText("a file needs a page");
  await expect(pages.getByRole("button", { name: "Page 1", exact: true })).toBeVisible();
  await pages.getByRole("button", { name: "Rename", exact: true }).click();
  await pages.getByLabel("Rename page", { exact: true }).fill("-");
  await pages.getByRole("button", { name: "Apply name", exact: true }).click();
  await expect(page.locator("main [role=alert]")).toContainText("a file needs a page");
  await expect(pages.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("rotation edits preserve centre, pixels, undo and native recovery with pointer selection", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await login(page);
  const creation = page.getByRole("group", { name: "Create rectangle", exact: true });
  for (const [label, value] of [["X", "100"], ["Y", "100"], ["Width", "100"], ["Height", "50"]]) await creation.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
  await page.getByLabel("Rotation", { exact: true }).fill("90");
  await page.getByRole("button", { name: "Apply geometry", exact: true }).click();
  await geometry(page, [125, 175, 100, 50]);
  const canvas = page.getByLabel("Design canvas", { exact: true });
  await expect.poll(async () => canvas.evaluate((node: HTMLCanvasElement) => Array.from(node.getContext("2d")!.getImageData(150, 90, 1, 1).data))).toEqual([217, 217, 217, 255]);
  await expect.poll(async () => canvas.evaluate((node: HTMLCanvasElement) => Array.from(node.getContext("2d")!.getImageData(110, 110, 1, 1).data))).toEqual([245, 245, 245, 255]);
  await expect.poll(async () => canvas.evaluate((node: HTMLCanvasElement) => {
    const context = node.getContext("2d")!;
    const edge = context.getImageData(125, 120, 1, 1).data;
    const inside = context.getImageData(126, 120, 1, 1).data;
    return { blueEdge: edge[2] - edge[0] > 80, halfPixelCoverage: edge[0] > 60 && edge[0] < 180, unexpandedInterior: Array.from(inside) };
  })).toEqual({ blueEdge: true, halfPixelCoverage: true, unexpandedInterior: [217, 217, 217, 255] });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await geometry(page, [100, 100, 100, 50]);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Create rectangle", exact: true })).toBeEnabled();
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.click(bounds.x + 150, bounds.y + 90);
  await expect(page.getByLabel("Rotation", { exact: true })).toHaveValue("90");
  await geometry(page, [125, 175, 100, 50]);
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByRole("region", { name: "Selected rectangle" })).toBeVisible();
  expect(errors).toEqual([]);
});
