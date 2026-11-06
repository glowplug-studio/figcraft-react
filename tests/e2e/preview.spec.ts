import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { localSupabase } from "../support/localSupabase";
import { decodeFigcraft } from "../../src/engine/file-format";
import { rectanglePaints, type RectangleNode } from "../../src/engine/document";

test.describe.configure({ mode: "serial" });
let email: string;
let password: string;
let userId: string | undefined;
let backend: ReturnType<typeof localSupabase> | undefined;
const browserFailures = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const failures: string[] = []; browserFailures.set(page, failures);
  page.on("pageerror", error => failures.push(error.message));
  page.on("requestfailed", request => {
    const reason = request.failure()?.errorText;
    if (reason && !reason.includes("ERR_ABORTED")) failures.push(reason);
  });
});
test.afterEach(({ page }) => { expect(browserFailures.get(page)).toEqual([]); });
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
async function login(page: Page, normaliseView = true) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Untitled", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create rectangle", exact: true })).toBeEnabled();
  if (normaliseView) await resetCanvasOrigin(page);
}
/** Legacy pixel fixtures use origin0; reach it through real viewport controls and captured pan. */
async function resetCanvasOrigin(page: Page) {
  const canvas = page.getByLabel("Design canvas", { exact: true });
  await expect(canvas).toHaveAttribute("data-view-zoom", /.+/);
  await expect(page.locator(".figcraft-recovery")).not.toHaveText("Restoring local recovery…");
  await page.getByRole("button", { name: "Zoom to 100%", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-view-zoom", "1");
  const origin = await canvas.evaluate((node: HTMLCanvasElement) => ({ x: Number(node.dataset.viewOriginX), y: Number(node.dataset.viewOriginY) }));
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(bounds.x + bounds.width / 2 + origin.x, bounds.y + bounds.height / 2 + origin.y, { steps: 2 });
  await page.mouse.up({ button: "middle" });
  await expect.poll(async () => canvas.evaluate((node: HTMLCanvasElement) => Math.abs(Number(node.dataset.viewOriginX)) + Math.abs(Number(node.dataset.viewOriginY)))).toBeLessThan(0.01);
}
async function geometry(page: Page, expected: number[]) {
  await expect(page.getByRole("region", { name: "Selected rectangle" }).locator("dd")).toHaveText(expected.map(String));
}
async function expectCanvasPixel(page: Page, x: number, y: number, rgba: readonly number[]) {
  const canvas = page.getByLabel("Design canvas", { exact: true });
  await expect.poll(async () => canvas.evaluate((node: HTMLCanvasElement, point) => {
    const scale = window.devicePixelRatio || 1;
    const actual = node.getContext("2d")!.getImageData(Math.round((point.x - Number(node.dataset.viewOriginX)) * Number(node.dataset.viewZoom) * scale), Math.round((point.y - Number(node.dataset.viewOriginY)) * Number(node.dataset.viewZoom) * scale), 1, 1).data;
    return point.rgba.every((channel, index) => Math.abs(actual[index] - channel) <= 2);
  }, { x, y, rgba })).toBe(true);
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
  await page.reload(); await resetCanvasOrigin(page);
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
    await page.reload(); await resetCanvasOrigin(page);
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
  await login(page, false);
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
  await page.reload(); await resetCanvasOrigin(page);
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
  await page.reload(); await resetCanvasOrigin(page);
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

test("CSS fill alpha, invalid input, undo and recovery retain the visible colour", async ({ page }) => {
  await login(page);
  const appearance = page.getByRole("region", { name: "Appearance" });
  await appearance.getByLabel("Background CSS colour").fill("white");
  await appearance.getByRole("button", { name: "Apply background" }).click();
  await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
  await appearance.getByLabel("Fill 1 CSS colour").fill("rgba(255, 0, 0, 0.5)");
  await appearance.getByRole("button", { name: "Apply fill 1" }).click();
  await expectCanvasPixel(page, 80, 80, [255, 127, 127, 255]);
  await appearance.getByLabel("Fill 1 CSS colour").fill("not-a-colour");
  await appearance.getByRole("button", { name: "Apply fill 1" }).click();
  await expect(appearance.getByRole("alert")).toHaveText("Enter a valid CSS colour.");
  await expectCanvasPixel(page, 80, 80, [255, 127, 127, 255]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectCanvasPixel(page, 80, 80, [217, 217, 217, 255]);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expectCanvasPixel(page, 80, 80, [255, 127, 127, 255]);
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  await page.reload(); await resetCanvasOrigin(page);
  await expectCanvasPixel(page, 80, 80, [255, 127, 127, 255]);
});

test("native paint colour and opacity edits retain independent metadata", async ({ page }) => {
  await login(page);
  const native = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8"));
  native.nodes["2"].fills = [{
    type: "solid", color: { r: 0.12345, g: 0.25, b: 0.5, a: 0.5 },
    opacity: 0.5, colorAlpha: 0.4, visible: true, blend: "normal",
  }];
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({
    name: "native-appearance.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(native)),
  });
  await expect(page.getByRole("heading", { name: "Native rectangle", exact: true })).toBeVisible();
  await page.locator('aside.figcraft-layers [aria-label="Page layers"] button').first().click();
  const appearance = page.getByRole("region", { name: "Appearance" });
  const colour = appearance.getByLabel("Fill 1 CSS colour");
  const paintOpacity = appearance.getByLabel("Fill 1 opacity");
  async function savedPaint() {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save as", exact: true }).click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    const decoded = await decodeFigcraft(new Uint8Array(await readFile((await download.path())!)));
    return rectanglePaints(decoded.document.nodes["2"] as RectangleNode)[0];
  }

  await expect(colour).toHaveValue(/,0\.25\)$/);
  await colour.fill("rgba(51,63.75,127.5,0.25)");
  await appearance.getByRole("button", { name: "Apply fill 1" }).click();
  const rgbEdit = await savedPaint();
  expect(rgbEdit.color.r).toBe(Math.fround(0.2));
  expect(rgbEdit.color.a).toBe(0.5);
  expect(rgbEdit.opacity).toBe(0.5);
  expect(rgbEdit.colorAlpha).toBe(Math.fround(0.4));

  await paintOpacity.fill("0.7");
  await appearance.getByRole("button", { name: "Apply fill 1" }).click();
  const opacityEdit = await savedPaint();
  expect(opacityEdit.color.a).toBe(0.5);
  expect(opacityEdit.opacity).toBe(Math.fround(0.7));
  expect(opacityEdit.colorAlpha).toBe(1);

  await colour.fill("rgba(51,63.75,127.5,0.4)");
  await paintOpacity.fill("0.6");
  await appearance.getByRole("button", { name: "Apply fill 1" }).click();
  const combinedEdit = await savedPaint();
  expect(combinedEdit.color.a).toBe(1);
  expect(combinedEdit.opacity).toBe(Math.fround(0.6));
  expect(combinedEdit.colorAlpha).toBe(1);
});

test("fill stack order, visibility and node opacity composite once", async ({ page }) => {
  await login(page);
  const appearance = page.getByRole("region", { name: "Appearance" });
  await appearance.getByLabel("Background CSS colour").fill("white");
  await appearance.getByRole("button", { name: "Apply background" }).click();
  await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
  await appearance.getByLabel("Fill 1 CSS colour").fill("red");
  await appearance.getByRole("button", { name: "Apply fill 1" }).click();
  await appearance.getByRole("button", { name: "Add fill" }).click();
  await appearance.getByLabel("Fill 1 CSS colour").fill("blue");
  await appearance.getByLabel("Fill 1 opacity").fill("0.5");
  await appearance.getByRole("button", { name: "Apply fill 1" }).click();
  await appearance.getByLabel("Node opacity").fill("0.5");
  await appearance.getByRole("button", { name: "Apply layer" }).click();
  await expectCanvasPixel(page, 80, 80, [191, 127, 191, 255]);
  await page.screenshot({ path: "test-results/solid-paint-stack.png", fullPage: true });
  await appearance.getByRole("button", { name: "Move fill 1 down" }).click();
  await expectCanvasPixel(page, 80, 80, [255, 127, 127, 255]);
  await appearance.getByLabel("Fill 1 visible").uncheck();
  await expectCanvasPixel(page, 80, 80, [191, 191, 255, 255]);
  await appearance.getByRole("button", { name: "Remove fill 1" }).click();
  await expect(appearance.getByLabel("Fill 2 CSS colour")).toHaveCount(0);
  await expectCanvasPixel(page, 80, 80, [191, 191, 255, 255]);
});

test("transparent page redraw and hidden or locked layers bypass pointer and select all", async ({ page }) => {
  await login(page);
  const appearance = page.getByRole("region", { name: "Appearance" });
  await appearance.getByLabel("Background CSS colour").fill("rgba(0, 0, 0, 0)");
  await appearance.getByRole("button", { name: "Apply background" }).click();
  await expectCanvasPixel(page, 5, 5, [0, 0, 0, 0]);
  await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
  await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
  const layers = page.locator('[aria-label="Page layers"] li');
  await expect(layers).toHaveCount(2);
  await appearance.getByLabel("Locked", { exact: true }).check();
  const canvas = page.getByLabel("Design canvas", { exact: true });
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.click(bounds.x + 80, bounds.y + 80);
  await expect(layers.nth(1)).toHaveAttribute("aria-current", "true");
  await appearance.getByLabel("Visible", { exact: true }).uncheck();
  await page.mouse.click(bounds.x + 80, bounds.y + 80);
  await expect(page.getByRole("region", { name: "Selected rectangle" })).toHaveCount(0);
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByRole("region", { name: "Selected rectangle" })).toHaveCount(0);
  await expectCanvasPixel(page, 5, 5, [0, 0, 0, 0]);
  await appearance.getByLabel("Background CSS colour").fill("white");
  await appearance.getByRole("button", { name: "Apply background" }).click();
  await appearance.getByLabel("Background CSS colour").fill("rgba(0, 0, 0, 0)");
  await appearance.getByRole("button", { name: "Apply background" }).click();
  await expectCanvasPixel(page, 5, 5, [0, 0, 0, 0]);
});

test("rotation edits preserve centre, pixels, undo and native recovery with pointer selection", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await login(page);
  const creation = page.getByRole("group", { name: "Create layer", exact: true });
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
  await page.reload(); await resetCanvasOrigin(page);
  await expect(page.getByRole("button", { name: "Create rectangle", exact: true })).toBeEnabled();
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.click(bounds.x + 150, bounds.y + 90);
  await expect(page.getByLabel("Rotation", { exact: true })).toHaveValue("90");
  await geometry(page, [125, 175, 100, 50]);
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByRole("region", { name: "Selected rectangle" })).toBeVisible();
  expect(errors).toEqual([]);
});

async function createNamedRectangle(page: Page, name: string, x: number, y: number, width = 60, height = 40) {
  const creation = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [label, value] of [["X", x], ["Y", y], ["Width", width], ["Height", height]] as const) {
    await creation.getByLabel(label, { exact: true }).fill(String(value));
  }
  await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
  const appearance = page.getByRole("region", { name: "Appearance" });
  await appearance.getByLabel("Name", { exact: true }).fill(name);
  await appearance.getByRole("button", { name: "Apply layer" }).click();
}

test("layer tree groups named rectangles, composites opacity once, and survives undo, native save and recovery", async ({ page }) => {
  await login(page);
  await createNamedRectangle(page, "Back", 40, 40);
  await createNamedRectangle(page, "Front", 70, 40);
  const layers = page.getByRole("region", { name: "Layers" });
  await expect(layers.getByRole("button", { name: "Front", exact: true })).toBeVisible();
  await page.getByLabel("Design canvas", { exact: true }).focus();
  await page.keyboard.press("ControlOrMeta+a");
  await layers.getByRole("button", { name: "Group", exact: true }).click();
  const group = layers.locator('li[data-layer-id]').filter({ has: page.getByRole("button", { name: "Group 1", exact: true }) }).first();
  await expect(group).toHaveAttribute("aria-current", "true");
  await expect(group.getByRole("list", { name: "Children of Group 1" }).locator('li[data-layer-id] button:not([aria-label])')).toHaveText(["Front", "Back"]);
  const appearance = page.getByRole("region", { name: "Appearance" });
  await appearance.getByLabel("Node opacity").fill("0.5");
  await appearance.getByRole("button", { name: "Apply layer" }).click();
  await expectCanvasPixel(page, 80, 60, [231, 231, 231, 255]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectCanvasPixel(page, 80, 60, [217, 217, 217, 255]);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expectCanvasPixel(page, 80, 60, [231, 231, 231, 255]);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save as", exact: true }).click();
  const bytes = await readFile((await (await downloadEvent).path())!);
  const native = await decodeFigcraft(bytes);
  const root = native.document.nodes[native.document.currentPage];
  if (root.kind !== "page") throw new Error("Expected page");
  expect(root.children).toHaveLength(1);
  const savedGroup = native.document.nodes[root.children[0]];
  expect(savedGroup.kind).toBe("group");
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  await page.reload(); await resetCanvasOrigin(page);
  await expect(layers.getByRole("button", { name: "Group 1", exact: true })).toBeVisible();
  await expectCanvasPixel(page, 80, 60, [231, 231, 231, 255]);
  await page.screenshot({ path: "test-results/nested-groups-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".figcraft-mobile-layers > summary").click();
  await expect(page.locator(".figcraft-mobile-layers").getByRole("button", { name: "Group 1", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("nested group editing, ungrouping and move validation preserve the layer tree", async ({ page }) => {
  await login(page);
  await createNamedRectangle(page, "Inner", 40, 40, 50, 30);
  const layers = page.getByRole("region", { name: "Layers" });
  await layers.getByRole("button", { name: "Group", exact: true }).click();
  await layers.getByRole("button", { name: "Group", exact: true }).click();
  await expect(layers.getByRole("list", { name: "Children of Group 2" }).getByRole("button", { name: "Group 1", exact: true })).toBeVisible();
  await layers.getByRole("button", { name: "Group 2", exact: true }).click();
  await page.getByLabel("Rotation", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Apply geometry", exact: true }).click();
  await layers.getByRole("button", { name: "Inner", exact: true }).click();
  const x = Number(await page.getByLabel("Edit X", { exact: true }).inputValue());
  await page.getByLabel("Edit X", { exact: true }).fill(String(x + 20));
  await page.getByRole("button", { name: "Apply geometry", exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel("Edit X", { exact: true }).inputValue())).toBeCloseTo(x + 20, 9);
  const canvas = page.getByLabel("Design canvas", { exact: true });
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.click(bounds.x + 300, bounds.y + 300);
  const pixels = await canvas.evaluate((node: HTMLCanvasElement) => [[70, 55], [80, 65], [100, 75]].map(([x, y]) => Array.from(node.getContext("2d")!.getImageData(x, y, 1, 1).data)));
  await layers.getByRole("button", { name: "Group 2", exact: true }).click();
  await layers.getByRole("button", { name: "Ungroup", exact: true }).click();
  await expect(layers.getByRole("button", { name: "Group 2", exact: true })).toHaveCount(0);
  await page.mouse.click(bounds.x + 300, bounds.y + 300);
  const after = await canvas.evaluate((node: HTMLCanvasElement) => [[70, 55], [80, 65], [100, 75]].map(([x, y]) => Array.from(node.getContext("2d")!.getImageData(x, y, 1, 1).data)));
  expect(after).toEqual(pixels);
  await layers.getByRole("button", { name: "Group 1", exact: true }).click();
  const groupId = await layers.locator('li[data-layer-id]').filter({ has: page.getByRole("button", { name: "Group 1", exact: true }) }).first().getAttribute("data-layer-id");
  await layers.getByLabel("Move selection into").selectOption(groupId!);
  await layers.getByRole("button", { name: "Move selection", exact: true }).click();
  await expect(page.locator("main [role=alert]")).toContainText("Cyclic node hierarchy");
  await expect(layers.getByRole("button", { name: "Inner", exact: true })).toBeVisible();
  await layers.getByRole("button", { name: "Inner", exact: true }).click();
  await layers.getByLabel("Move selection into").selectOption("1");
  await layers.getByRole("button", { name: "Move selection", exact: true }).click();
  await expect(layers.getByRole("button", { name: "Group 1", exact: true })).toHaveCount(0);
  await expect(layers.getByRole("button", { name: "Inner", exact: true })).toBeVisible();
});

test("duplicating and deleting a page copies and removes the full group subtree", async ({ page }) => {
  await login(page);
  await createNamedRectangle(page, "Nested", 40, 40);
  const layers = page.getByRole("region", { name: "Layers" });
  await layers.getByRole("button", { name: "Group", exact: true }).click();
  const pages = page.getByRole("region", { name: "Pages", exact: true });
  await pages.getByLabel("Actions for page Page 1").click();
  await pages.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(pages.getByRole("button", { name: "Copy of Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(layers.getByRole("button", { name: "Group 1", exact: true })).toBeVisible();
  await expect(layers.getByRole("button", { name: "Nested", exact: true })).toBeVisible();
  await pages.getByLabel("Actions for page Copy of Page 1").click();
  await pages.locator("li[data-page-id]").filter({ has: page.getByRole("button", { name: "Copy of Page 1", exact: true }) }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(pages.getByRole("button", { name: "Copy of Page 1", exact: true })).toHaveCount(0);
  await expect(pages.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(layers.getByRole("button", { name: "Group 1", exact: true })).toBeVisible();
  await expect(layers.getByRole("button", { name: "Nested", exact: true })).toBeVisible();
});

test("frames clip children, resize with constraints, isolate opacity and retain native recovery", async ({ page }) => {
  await login(page);
  const creation = page.getByRole("group", { name: "Create layer", exact: true });
  await creation.getByLabel("Height", { exact: true }).fill("80");
  await creation.getByRole("button", { name: "Create frame", exact: true }).click();
  const layers = page.getByRole("region", { name: "Layers" });
  await expect(page.getByLabel("Clip content", { exact: true })).toBeChecked();
  await expectCanvasPixel(page, 50, 50, [255, 255, 255, 255]);
  await creation.getByLabel("Create in", { exact: true }).selectOption({ label: "Frame 1" });
  await createNamedRectangle(page, "Overflow", 80, 10, 40, 30);
  const appearance = page.getByRole("region", { name: "Appearance" });
  await appearance.getByLabel("Fill 1 CSS colour").fill("red");
  await appearance.getByRole("button", { name: "Apply fill 1" }).click();
  await expectCanvasPixel(page, 130, 60, [255, 0, 0, 255]);
  await expectCanvasPixel(page, 150, 60, [245, 245, 245, 255]);
  const canvas = page.getByLabel("Design canvas", { exact: true }), bounds = (await canvas.boundingBox())!;
  await page.mouse.click(bounds.x + 130, bounds.y + 60);
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("80");
  await page.getByLabel("Horizontal constraint").selectOption("right");
  await page.getByRole("button", { name: "Apply constraints" }).click();
  await layers.getByRole("button", { name: "Frame 1", exact: true }).click();
  await page.getByLabel("Rotation", { exact: true }).fill("90");
  await page.getByRole("button", { name: "Apply geometry" }).click();
  await expectCanvasPixel(page, 70, 40, [255, 0, 0, 255]);
  await expectCanvasPixel(page, 70, 20, [245, 245, 245, 255]);
  await page.getByLabel("Clip content", { exact: true }).uncheck();
  await expectCanvasPixel(page, 70, 20, [255, 0, 0, 255]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByLabel("Clip content", { exact: true }).uncheck();
  await expectCanvasPixel(page, 150, 60, [255, 0, 0, 255]);
  await page.getByLabel("Edit Width", { exact: true }).fill("200");
  await page.getByRole("button", { name: "Apply geometry" }).click();
  await layers.getByRole("button", { name: "Overflow", exact: true }).click();
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("180");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await layers.getByRole("button", { name: "Frame 1", exact: true }).click();
  await appearance.getByLabel("Node opacity").fill("0.5");
  await appearance.getByRole("button", { name: "Apply layer" }).click();
  await expectCanvasPixel(page, 130, 60, [250, 122, 122, 255]);
  await expectCanvasPixel(page, 150, 60, [250, 122, 122, 255]);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save as", exact: true }).click();
  const native = await decodeFigcraft(await readFile((await (await downloaded).path())!));
  const frame = Object.values(native.document.nodes).find(node => node.kind === "frame");
  expect(frame).toMatchObject({ clip: false, width: 100, opacity: 0.5 });
  expect(Object.values(native.document.nodes).find(node => node.name === "Overflow")).toMatchObject({ constraints: { horizontal: "right", vertical: "top" } });
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  await page.reload(); await resetCanvasOrigin(page);
  await expect(layers.getByRole("button", { name: "Frame 1", exact: true })).toBeVisible();
  await expectCanvasPixel(page, 150, 60, [250, 122, 122, 255]);
  await page.screenshot({ path: "test-results/frame-constraints-desktop.png", fullPage: true });
});

test("frame conversion preserves children and refuses an empty frame atomically", async ({ page }) => {
  await login(page);
  const layers = page.getByRole("region", { name: "Layers" });
  await page.getByRole("button", { name: "Create frame", exact: true }).click();
  await layers.getByRole("button", { name: "Convert to group", exact: true }).click();
  await expect(page.locator("main [role=alert]")).toContainText("empty: a group needs layers");
  await expect(page.getByRole("region", { name: "Selected frame", exact: true })).toBeVisible();
  await layers.getByRole("button", { name: "Delete layers", exact: true }).click();
  await createNamedRectangle(page, "Inside", 40, 40, 60, 40);
  await layers.getByRole("button", { name: "Frame selection", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selected frame", exact: true })).toBeVisible();
  await layers.getByRole("button", { name: "Convert to group", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selected group", exact: true })).toBeVisible();
  await layers.getByRole("button", { name: "Convert to frame", exact: true }).click();
  await expect(page.getByLabel("Clip content", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("Fill 1 CSS colour")).toHaveCount(0);
  await layers.getByRole("button", { name: "Remove frame", exact: true }).click();
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("40");
  await expectCanvasPixel(page, 60, 60, [217, 217, 217, 255]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".figcraft-mobile-layers > summary").click();
  await expect(page.locator(".figcraft-mobile-layers").getByRole("button", { name: "Inside", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("viewport pan, wheel and anchored zoom preserve document state without root React updates", async ({ page }) => {
  await login(page, false);
  const canvas = page.getByLabel("Design canvas", { exact: true });
  await expect(canvas).toHaveAttribute("data-view-origin-x", "-100");
  await expect(canvas).toHaveAttribute("data-view-origin-y", "-100");
  await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
  const bounds = (await canvas.boundingBox())!;
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  const root = page.locator("[data-figcraft-editor]"), commits = (await root.getAttribute("data-commits"))!;
  await canvas.focus(); await page.keyboard.down("Space");
  await page.mouse.move(bounds.x + 300, bounds.y + 300); await page.mouse.down();
  await page.mouse.move(bounds.x + 380, bounds.y + 340, { steps: 30 }); await page.mouse.up(); await page.keyboard.up("Space");
  await expect(canvas).toHaveAttribute("data-view-origin-x", "-180");
  await expect(canvas).toHaveAttribute("data-view-origin-y", "-140");
  await expect(root).toHaveAttribute("data-commits", commits);
  await page.mouse.move(bounds.x + 260, bounds.y + 220);
  await page.mouse.wheel(0, 60);
  await expect(canvas).toHaveAttribute("data-view-origin-y", "-80");
  const before = await canvas.evaluate((node: HTMLCanvasElement) => ({ x: Number(node.dataset.viewOriginX), y: Number(node.dataset.viewOriginY), zoom: Number(node.dataset.viewZoom) }));
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -120); await page.keyboard.up("Control");
  await expect.poll(async () => Number(await canvas.getAttribute("data-view-zoom"))).toBeGreaterThan(1);
  const after = await canvas.evaluate((node: HTMLCanvasElement) => ({ x: Number(node.dataset.viewOriginX), y: Number(node.dataset.viewOriginY), zoom: Number(node.dataset.viewZoom) }));
  expect(after.x + 260 / after.zoom).toBeCloseTo(before.x + 260 / before.zoom, 6);
  expect(after.y + 220 / after.zoom).toBeCloseTo(before.y + 220 / before.zoom, 6);
  await expect(root).toHaveAttribute("data-commits", commits);
  await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("0 layers", { exact: true })).toBeVisible();
});

test("zoom tool and view shortcuts map drawing coordinates and keep the selection outline thin", async ({ page }) => {
  await login(page);
  const canvas = page.getByLabel("Design canvas", { exact: true }), bounds = (await canvas.boundingBox())!;
  await canvas.focus(); await page.keyboard.down("z");
  await page.mouse.click(bounds.x + 200, bounds.y + 200);
  await expect(canvas).toHaveAttribute("data-view-zoom", "2");
  await page.keyboard.down("Alt"); await page.mouse.click(bounds.x + 200, bounds.y + 200); await page.keyboard.up("Alt");
  await expect(canvas).toHaveAttribute("data-view-zoom", "1");
  await page.mouse.move(bounds.x + 100, bounds.y + 100); await page.mouse.down();
  await page.mouse.move(bounds.x + 400, bounds.y + 300, { steps: 10 }); await page.mouse.up(); await page.keyboard.up("z");
  await expect.poll(async () => Number(await canvas.getAttribute("data-view-zoom"))).toBeCloseTo(Math.min((bounds.width - 128) / 300, (bounds.height - 128) / 200), 6);
  await page.keyboard.press("Shift+Digit0"); await expect(canvas).toHaveAttribute("data-view-zoom", "1");
  await page.keyboard.press("="); await expect(canvas).toHaveAttribute("data-view-zoom", "2");
  await page.keyboard.press("-"); await expect(canvas).toHaveAttribute("data-view-zoom", "1");
  await page.keyboard.press("ControlOrMeta+="); await expect(canvas).toHaveAttribute("data-view-zoom", "2");
  await page.keyboard.press("ControlOrMeta+Digit0"); await expect(canvas).toHaveAttribute("data-view-zoom", "1");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-view-zoom", "2");
  const view = await canvas.evaluate((node: HTMLCanvasElement) => ({ x: Number(node.dataset.viewOriginX), y: Number(node.dataset.viewOriginY), zoom: Number(node.dataset.viewZoom) }));
  await canvas.focus(); await page.keyboard.press("r");
  await page.mouse.move(bounds.x + 100, bounds.y + 100); await page.mouse.down();
  await page.mouse.move(bounds.x + 180, bounds.y + 160, { steps: 8 }); await page.mouse.up();
  await geometry(page, [Math.sign(view.x + 50) * Math.floor(Math.abs(view.x + 50) + 0.5), Math.sign(view.y + 50) * Math.floor(Math.abs(view.y + 50) + 0.5), 40, 30]);
  await page.keyboard.press("Shift+Digit2");
  await expect.poll(async () => Number(await canvas.getAttribute("data-view-zoom"))).toBeGreaterThan(2);
  await expect.poll(async () => canvas.evaluate((node: HTMLCanvasElement) => {
    const context = node.getContext("2d")!, y = Math.floor(node.height / 2);
    const edge = context.getImageData(64, y, 1, 1).data, inside = context.getImageData(66, y, 1, 1).data;
    return edge[2] > edge[0] && inside[0] === 217 && inside[1] === 217 && inside[2] === 217;
  })).toBe(true);
  await page.getByRole("button", { name: "Zoom to 100%", exact: true }).click();
  await page.screenshot({ path: "test-results/viewport-desktop.png", fullPage: true });
});

test("frame presets place beside content and keyboard navigation follows reading order", async ({ page }) => {
  await login(page);
  const canvas = page.getByLabel("Design canvas", { exact: true });
  const bounds = (await canvas.boundingBox())!;
  const x = Math.round((bounds.width - 297) / 2), y = Math.round((bounds.height - 420) / 2);
  await page.getByText("Frame presets", { exact: true }).click();
  await page.getByLabel("Frame preset", { exact: true }).selectOption("A6");
  await page.getByRole("button", { name: "Create preset frame", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selected frame" }).locator("dd")).toHaveText([String(x), String(y), "297", "420"]);
  await page.getByLabel("Frame preset", { exact: true }).selectOption("A5");
  await page.getByRole("button", { name: "Create preset frame", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selected frame" }).locator("dd")).toHaveText([String(x + 397), String(y), "420", "595"]);
  await canvas.focus();
  await page.keyboard.press("n");
  await expect(page.getByRole("region", { name: "Selected frame" }).getByRole("heading", { name: "A6", exact: true })).toBeVisible();
  await page.keyboard.press("Shift+n");
  await expect(page.getByRole("region", { name: "Selected frame" }).getByRole("heading", { name: "A5", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("group", { name: "Canvas view", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("arrangement controls align, distribute, nudge and stack with native recovery", async ({ page }) => {
  await login(page);
  await createNamedRectangle(page, "A", 0, 0, 10, 10);
  await createNamedRectangle(page, "B", 30, 20, 10, 10);
  await createNamedRectangle(page, "C", 100, 5, 10, 10);
  const canvas = page.getByLabel("Design canvas", { exact: true }), layers = page.getByRole("region", { name: "Layers" });
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+a");
  await page.getByText("Arrange", { exact: true }).click();
  const arrange = page.locator(".figcraft-arrange");
  await arrange.getByRole("button", { name: "Align top", exact: true }).click();
  await arrange.getByRole("button", { name: "Distribute horizontally", exact: true }).click();
  await layers.getByRole("button", { name: "B", exact: true }).click(); await geometry(page, [50, 0, 10, 10]);
  await expect(arrange.getByRole("button", { name: "Align right", exact: true })).toBeDisabled();
  await canvas.focus(); await page.keyboard.press("Shift+ArrowRight"); await page.keyboard.press("ArrowDown");
  await geometry(page, [60, 1, 10, 10]);
  await page.keyboard.press("ControlOrMeta+z"); await geometry(page, [60, 0, 10, 10]);
  await arrange.getByLabel("Move X", { exact: true }).fill("10"); await arrange.getByLabel("Move Y", { exact: true }).fill("20");
  await arrange.getByRole("button", { name: "Move by", exact: true }).click(); await geometry(page, [70, 20, 10, 10]);
  await arrange.getByRole("button", { name: "Move to", exact: true }).click(); await geometry(page, [10, 20, 10, 10]);
  await arrange.getByRole("button", { name: "Send to back", exact: true }).click();
  await expect(layers.locator('li[data-layer-id] > button:not([aria-label])')).toHaveText(["C", "A", "B"]);
  await expectCanvasPixel(page, 15, 25, [217, 217, 217, 255]);
  const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const decoded = await decodeFigcraft(await readFile((await (await downloading).path())!));
  const stored = Object.values(decoded.document.nodes).find(node => node.name === "B");
  expect(stored).toMatchObject({ x: 10, y: 20 });
  const storedPage = decoded.document.nodes[decoded.document.currentPage];
  if (storedPage.kind !== "page") throw new Error("Expected page");
  expect(storedPage.children[0]).toBe(stored!.id);
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  await page.reload(); await resetCanvasOrigin(page);
  await layers.getByRole("button", { name: "B", exact: true }).click(); await geometry(page, [10, 20, 10, 10]);
  await expect(layers.locator('li[data-layer-id] > button:not([aria-label])')).toHaveText(["C", "A", "B"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("Arrange", { exact: true }).click();
  await expect(arrange.getByRole("button", { name: "Move by", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/arrangement-mobile.png", fullPage: true });
});

test("rotated frame child uses parent-space nudges and page-space numeric movement", async ({ page }) => {
  await login(page);
  const creation = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [label, value] of [["X", "0"], ["Y", "0"], ["Width", "200"], ["Height", "200"]]) await creation.getByLabel(label, { exact: true }).fill(value);
  await creation.getByRole("button", { name: "Create frame", exact: true }).click();
  await creation.getByLabel("Create in", { exact: true }).selectOption({ label: "Frame 1" });
  await createNamedRectangle(page, "Child", 20, 30, 10, 10);
  const layers = page.getByRole("region", { name: "Layers" });
  await layers.getByRole("button", { name: "Frame 1", exact: true }).click();
  await page.getByLabel("Rotation", { exact: true }).fill("90");
  await page.getByRole("button", { name: "Apply geometry", exact: true }).click();
  await layers.getByRole("button", { name: "Child", exact: true }).click();
  await page.getByLabel("Design canvas", { exact: true }).focus(); await page.keyboard.press("Shift+ArrowRight");
  await geometry(page, [30, 30, 10, 10]);
  await page.getByText("Arrange", { exact: true }).click();
  const arrange = page.locator(".figcraft-arrange");
  await arrange.getByLabel("Move X", { exact: true }).fill("10");
  await arrange.getByRole("button", { name: "Move by", exact: true }).click();
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("30");
  await expect.poll(async () => Number(await page.getByLabel("Edit Y", { exact: true }).inputValue())).toBeCloseTo(40, 8);
  await arrange.getByRole("button", { name: "Align right", exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel("Edit Y", { exact: true }).inputValue())).toBeCloseTo(190, 8);
  await expectCanvasPixel(page, 195, 165, [217, 217, 217, 255]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel("Edit Y", { exact: true }).inputValue())).toBeCloseTo(40, 8);
});

test("anchored sizing, keyboard resize and uniform scale retain native recovery", async ({ page }) => {
  await login(page); await createNamedRectangle(page, "Sized", 200, 200, 100, 50);
  await page.getByText("Resize and scale", { exact: true }).click();
  const sizing = page.locator(".figcraft-sizing"), canvas = page.getByLabel("Design canvas", { exact: true });
  await sizing.getByLabel("Resize width", { exact: true }).fill("200");
  await sizing.getByLabel("Resize height", { exact: true }).fill("100");
  await sizing.getByLabel("Resize anchor", { exact: true }).selectOption("br");
  await sizing.getByRole("button", { name: "Resize selection", exact: true }).click(); await geometry(page, [100, 150, 200, 100]);
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+ArrowRight"); await page.keyboard.press("ControlOrMeta+Shift+ArrowDown");
  await geometry(page, [100, 150, 201, 110]);
  await page.keyboard.press("ControlOrMeta+z"); await geometry(page, [100, 150, 201, 100]);
  await sizing.getByLabel("Scale factor", { exact: true }).fill("0");
  await sizing.getByRole("button", { name: "Scale selection", exact: true }).click();
  await expect(page.locator("[data-figcraft-editor]").getByRole("alert")).toContainText("factor must be positive"); await geometry(page, [100, 150, 201, 100]);
  await sizing.getByLabel("Scale factor", { exact: true }).fill("2");
  await sizing.getByLabel("Scale pivot X", { exact: true }).fill("0"); await sizing.getByLabel("Scale pivot Y", { exact: true }).fill("0");
  await sizing.getByRole("button", { name: "Scale selection", exact: true }).click(); await geometry(page, [200, 300, 402, 200]);
  await expectCanvasPixel(page, 205, 305, [217, 217, 217, 255]);
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const decoded = await decodeFigcraft(await readFile((await (await download).path())!));
  expect(Object.values(decoded.document.nodes).find(node => node.name === "Sized")).toMatchObject({ x: 200, y: 300, width: 402, height: 200 });
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  await page.reload(); await resetCanvasOrigin(page);
  await page.getByRole("region", { name: "Layers" }).getByRole("button", { name: "Sized", exact: true }).click();
  await geometry(page, [200, 300, 402, 200]);
  await page.screenshot({ path: "test-results/sizing-desktop.png", fullPage: true });
});

test("uniform frame scale ignores child constraints while anchored resize honours them", async ({ page }) => {
  await login(page);
  const creation = page.getByRole("group", { name: "Create layer", exact: true });
  await creation.getByRole("button", { name: "Create frame", exact: true }).click();
  await creation.getByLabel("Create in", { exact: true }).selectOption({ label: "Frame 1" });
  await createNamedRectangle(page, "Pinned", 10, 20, 20, 10);
  await page.getByLabel("Horizontal constraint", { exact: true }).selectOption("right");
  await page.getByRole("button", { name: "Apply constraints", exact: true }).click();
  const layers = page.getByRole("region", { name: "Layers" }), sizing = page.locator(".figcraft-sizing");
  await layers.getByRole("button", { name: "Frame 1", exact: true }).click();
  await page.getByText("Resize and scale", { exact: true }).click();
  await sizing.getByRole("button", { name: "Scale selection", exact: true }).click();
  await layers.getByRole("button", { name: "Pinned", exact: true }).click(); await geometry(page, [20, 40, 40, 20]);
  await layers.getByRole("button", { name: "Frame 1", exact: true }).click();
  await sizing.getByLabel("Resize width", { exact: true }).fill("300");
  await sizing.getByLabel("Resize anchor", { exact: true }).selectOption("br");
  await sizing.getByRole("button", { name: "Resize selection", exact: true }).click();
  await layers.getByRole("button", { name: "Pinned", exact: true }).click(); await geometry(page, [120, 40, 40, 20]);
  await expectCanvasPixel(page, 65, 85, [217, 217, 217, 255]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sizing.getByRole("button", { name: "Scale selection", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
