import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { localSupabase } from "../support/localSupabase";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { rectanglePaints, type RectangleNode, type VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { freezeNetwork } from "../../src/engine/vector-network";
import { transformPoint } from "../../src/engine/affine";
import { worldTransform } from "../../src/engine/hierarchy";
import { starPoints } from "../../src/engine/polygon";
import { strFromU8, unzipSync } from "fflate";

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
    // Local Docker/CLI discovery is infrastructure setup, outside interaction timeouts.
    test.setTimeout(60_000);
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
  const signIn = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/login");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await (await signIn).finished();
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
async function canvasPoint(page: Page, x: number, y: number) {
  return page.getByLabel("Design canvas", { exact: true }).evaluate(async (node: HTMLCanvasElement, point) => {
    // View diagnostics are published by the canvas frame, including after responsive resize/fit.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const bounds = node.getBoundingClientRect(), zoom = Number(node.dataset.viewZoom);
    return { x: bounds.x + (point.x - Number(node.dataset.viewOriginX)) * zoom, y: bounds.y + (point.y - Number(node.dataset.viewOriginY)) * zoom };
  }, { x, y });
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
  // Native move_down retains an already-selected hidden layer through its own-box fallback.
  await expect(page.getByRole("region", { name: "Selected rectangle" })).toHaveCount(1);
  await page.mouse.click(bounds.x + 300, bounds.y + 300);
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
    return { greenEdge: edge[1] - edge[0] > 60, halfPixelCoverage: edge[0] > 60 && edge[0] < 180, unexpandedInterior: Array.from(inside) };
  })).toEqual({ greenEdge: true, halfPixelCoverage: true, unexpandedInterior: [217, 217, 217, 255] });
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
  await expectCanvasPixel(page, 220, 320, [217, 217, 217, 255]);
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

test("rotation origin canvas drag snaps without root renders, resets and follows undo", async ({ page }) => {
  await login(page); await createNamedRectangle(page, "Pivot", 200, 200, 100, 100);
  await page.getByText("Rotation and flips", { exact: true }).click();
  const panel = page.locator(".figcraft-rotation"), canvas = page.getByLabel("Design canvas", { exact: true }), root = page.locator("[data-figcraft-editor]");
  const point = async (x: number, y: number) => canvas.evaluate((node: HTMLCanvasElement, p) => {
    const box = node.getBoundingClientRect(), z = Number(node.dataset.viewZoom);
    return { x: box.x + (p.x - Number(node.dataset.viewOriginX)) * z, y: box.y + (p.y - Number(node.dataset.viewOriginY)) * z };
  }, { x, y });
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  await canvas.focus(); await page.keyboard.press("Alt+r");
  await expect(panel.getByRole("button", { name: "Move rotation origin", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByLabel("Current rotation origin", { exact: true })).toHaveText("250, 250 (centre)");
  const commits = await root.getAttribute("data-commits"), start = await point(250, 250), end = await point(202, 202);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 12 }); await page.mouse.up();
  await expect(panel.getByLabel("Current rotation origin", { exact: true })).toHaveText("200, 200 (moved)");
  expect(await root.getAttribute("data-commits")).toBe(commits); await geometry(page, [200, 200, 100, 100]);
  await canvas.focus(); await page.keyboard.press("ArrowRight");
  await expect(panel.getByLabel("Current rotation origin", { exact: true })).toHaveText("201, 200 (moved)");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(panel.getByLabel("Current rotation origin", { exact: true })).toHaveText("200, 200 (moved)");
  await panel.getByRole("button", { name: "Rotate 90° left", exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel("Rotation", { exact: true }).inputValue())).toBeCloseTo(90, 8);
  await expectCanvasPixel(page, 220, 120, [217, 217, 217, 255]);
  await page.screenshot({ path: "test-results/rotation-origin-handle.png", fullPage: true });
  const pivot = await point(200, 200); await page.mouse.dblclick(pivot.x, pivot.y);
  await expect(panel.getByLabel("Current rotation origin", { exact: true })).toHaveText("250, 150 (centre)");
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button", { name: "Move rotation origin", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("region", { name: "Selected rectangle" })).toBeVisible();
  await page.screenshot({ path: "test-results/rotation-origin-desktop.png", fullPage: true });
});

test("numeric origins pin rotation fields, flips and native recovery", async ({ page }) => {
  await login(page); await createNamedRectangle(page, "Turned", 200, 200, 100, 50);
  await page.getByText("Rotation and flips", { exact: true }).click();
  const panel = page.locator(".figcraft-rotation"), origin = panel.getByLabel("Current rotation origin", { exact: true });
  await panel.getByLabel("Origin X", { exact: true }).fill("200"); await panel.getByLabel("Origin Y", { exact: true }).fill("200");
  await panel.getByRole("button", { name: "Set rotation origin", exact: true }).click();
  await page.getByLabel("Rotation", { exact: true }).fill("90"); await page.getByRole("button", { name: "Apply geometry", exact: true }).click();
  await expect(origin).toHaveText("200, 200 (moved)"); await expectCanvasPixel(page, 220, 120, [217, 217, 217, 255]);
  await panel.getByRole("button", { name: "Rotate 90° right", exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel("Rotation", { exact: true }).inputValue())).toBeCloseTo(0, 8);
  await panel.getByRole("button", { name: "Rotate 180°", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await panel.getByLabel("Turn by degrees", { exact: true }).fill("90"); await panel.getByRole("button", { name: "Rotate selection", exact: true }).click();
  await page.getByLabel("Design canvas", { exact: true }).focus();
  await page.keyboard.press("Shift+h"); await page.keyboard.press("Shift+v");
  await panel.getByRole("button", { name: "Flip horizontal", exact: true }).click();
  await panel.getByRole("button", { name: "Flip horizontal", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const decoded = await decodeFigcraft(await readFile((await (await download).path())!));
  const node = Object.values(decoded.document.nodes).find(node => node.name === "Turned")!;
  const corner = transformPoint(worldTransform(decoded.document, node.id), { x: 0, y: 0 });
  expect(corner.x).toBeCloseTo(250, 8); expect(corner.y).toBeCloseTo(100, 8);
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  await page.reload(); await resetCanvasOrigin(page);
  await page.getByRole("region", { name: "Layers" }).getByRole("button", { name: "Turned", exact: true }).click();
  await page.getByText("Rotation and flips", { exact: true }).click();
  await expect(origin).toHaveText("225, 150 (centre)");
  await expect(panel.getByRole("button", { name: "Move rotation origin", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByRole("button", { name: "Reset rotation origin", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Flip horizontal", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function smartRow(page: Page) {
  await login(page);
  for (const [name, x] of [["A", 200], ["B", 280], ["C", 360]] as const) await createNamedRectangle(page, name, x, 200, 50, 60);
  await page.getByLabel("Design canvas", { exact: true }).focus(); await page.keyboard.press("ControlOrMeta+a");
  await page.getByText("Smart selection", { exact: true }).click();
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
}

test("smart spacing fields and scrubs retain tracks, one undo and native recovery", async ({ page }) => {
  await smartRow(page);
  const panel = page.locator(".figcraft-smart-selection"), gap = panel.getByLabel("Horizontal spacing", { exact: true });
  await expect(gap).toHaveValue("30"); await gap.fill("45.5");
  await panel.getByRole("button", { name: "Set horizontal spacing", exact: true }).click();
  await expectCanvasPixel(page, 297, 220, [217, 217, 217, 255]);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(gap).toHaveValue("30");
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  const scrub = panel.getByRole("button", { name: "Scrub horizontal spacing", exact: true });
  await scrub.scrollIntoViewIfNeeded(); const area = (await scrub.boundingBox())!, root = page.locator("[data-figcraft-editor]");
  const commits = await root.getAttribute("data-commits");
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2); await page.mouse.down();
  await page.mouse.move(area.x + area.width / 2 + 16, area.y + area.height / 2, { steps: 8 });
  await expect(gap).toHaveValue("46"); expect(await root.getAttribute("data-commits")).toBe(commits);
  await page.mouse.up();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const decoded = await decodeFigcraft(await readFile((await (await download).path())!));
  expect(Object.values(decoded.document.nodes).find(node => node.name === "B")).toMatchObject({ x: 296, y: 200, width: 50 });
  expect(Object.values(decoded.document.nodes).find(node => node.name === "C")).toMatchObject({ x: 392 });
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(gap).toHaveValue("30");
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await expect(gap).toHaveValue("46");
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible(); await page.reload(); await resetCanvasOrigin(page);
  await page.getByLabel("Design canvas", { exact: true }).focus(); await page.keyboard.press("ControlOrMeta+a");
  await page.getByText("Smart selection", { exact: true }).click(); await expect(gap).toHaveValue("46");
  await page.setViewportSize({ width: 390, height: 844 }); await expect(panel.getByRole("button", { name: "Reorder selection", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("smart canvas gaps preview without root renders and cancel on Escape", async ({ page }) => {
  await smartRow(page);
  const root = page.locator("[data-figcraft-editor]"), gap = page.getByLabel("Horizontal spacing", { exact: true });
  const start = await canvasPoint(page, 265, 230), end = await canvasPoint(page, 285, 230), commits = await root.getAttribute("data-commits");
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 12 });
  await expect(gap).toHaveValue("50"); expect(await root.getAttribute("data-commits")).toBe(commits);
  await expectCanvasPixel(page, 301, 220, [217, 217, 217, 255]);
  await page.keyboard.press("Escape"); await page.mouse.up(); await expect(gap).toHaveValue("30");
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.keyboard.down("Shift");
  await page.mouse.move(start.x + 14, start.y, { steps: 4 }); await page.mouse.up(); await page.keyboard.up("Shift");
  await expect(gap).toHaveValue("40");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(gap).toHaveValue("30");
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.keyboard.down("Alt");
  await page.mouse.move(start.x + 3.5, start.y, { steps: 3 }); await page.mouse.up(); await page.keyboard.up("Alt");
  await expect(gap).toHaveValue("33.5");
  await page.screenshot({ path: "test-results/smart-spacing-desktop.png", fullPage: true });
});

test("smart reorder rings insert, swap, cancel undo and commit outside the canvas", async ({ page }) => {
  await smartRow(page);
  const panel = page.locator(".figcraft-smart-selection"), canvas = page.getByLabel("Design canvas", { exact: true });
  const a = await canvasPoint(page, 225, 230), c = await canvasPoint(page, 385, 230);
  const root = page.locator("[data-figcraft-editor]"), commits = await root.getAttribute("data-commits");
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(c.x, c.y, { steps: 12 });
  expect(await root.getAttribute("data-commits")).toBe(commits);
  await page.keyboard.press("ControlOrMeta+z"); await page.mouse.up();
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("200");
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(c.x, c.y, { steps: 12 });
  const bounds = (await canvas.boundingBox())!; await page.mouse.move(bounds.x + bounds.width + 20, c.y); await page.mouse.up();
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("360");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.keyboard.down("ControlOrMeta"); await page.mouse.move(c.x, c.y, { steps: 10 });
  await page.mouse.up(); await page.keyboard.up("ControlOrMeta");
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("360");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await panel.getByLabel("Source layer", { exact: true }).selectOption({ label: "A" }); await panel.getByLabel("Target slot", { exact: true }).selectOption({ label: "C" });
  await panel.getByLabel("Swap only these two", { exact: true }).check(); await panel.getByRole("button", { name: "Reorder selection", exact: true }).click();
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("360");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.mouse.click(a.x, a.y); await expect(panel.getByLabel("Horizontal spacing", { exact: true })).toHaveCount(0);
  await page.getByLabel("Edit X", { exact: true }).fill("200.5"); await page.getByRole("button", { name: "Apply geometry", exact: true }).click();
  await panel.getByRole("button", { name: "Round to pixels", exact: true }).click(); await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("201");
});

test("duplicate shortcut repeats movement, forgets changed selection and survives native recovery", async ({ page }) => {
  await login(page); await createNamedRectangle(page, "Repeated", 200, 200, 50, 40);
  const canvas = page.getByLabel("Design canvas", { exact: true }), layers = page.getByRole("region", { name: "Layers" });
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+d");
  await expect(layers.getByRole("button", { name: "Repeated", exact: true })).toHaveCount(2);
  await page.keyboard.press("Shift+ArrowRight"); await page.keyboard.press("ControlOrMeta+d");
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("220");
  await page.keyboard.press("ControlOrMeta+d"); await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("230");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(layers.getByRole("button", { name: "Repeated", exact: true })).toHaveCount(3);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await layers.getByRole("button", { name: "Repeated", exact: true }).last().click();
  await layers.getByRole("button", { name: "Repeated", exact: true }).first().click();
  await layers.getByRole("button", { name: "Duplicate layers", exact: true }).click();
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("230");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const decoded = await decodeFigcraft(await readFile((await (await download).path())!));
  expect(Object.values(decoded.document.nodes).filter(node => node.kind === "rectangle").map(node => node.x)).toEqual([200, 210, 220, 230, 230]);
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible(); await page.reload(); await resetCanvasOrigin(page);
  await expect(layers.getByRole("button", { name: "Repeated", exact: true })).toHaveCount(5);
  await expect(layers.getByRole("button", { name: "Duplicate layers", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".figcraft-mobile-layers > summary").click();
  await layers.getByRole("button", { name: "Repeated", exact: true }).first().click();
  await layers.getByRole("button", { name: "Duplicate layers", exact: true }).click();
  await expect(layers.getByRole("button", { name: "Repeated", exact: true })).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("duplicate frame retains its subtree, clipping and100-unit gap", async ({ page }) => {
  await login(page);
  const creation = page.getByRole("group", { name: "Create layer", exact: true });
  await creation.getByRole("button", { name: "Create frame", exact: true }).click();
  await creation.getByLabel("Create in", { exact: true }).selectOption({ label: "Frame 1" });
  await createNamedRectangle(page, "Contained", 10, 20, 40, 30);
  const layers = page.getByRole("region", { name: "Layers" });
  await layers.getByRole("button", { name: "Frame 1", exact: true }).click();
  await layers.getByRole("button", { name: "Duplicate layers", exact: true }).click();
  await expect(layers.getByRole("button", { name: "Contained", exact: true })).toHaveCount(2);
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("240");
  await expect(page.getByLabel("Clip content", { exact: true })).toBeChecked();
  await expectCanvasPixel(page, 255, 65, [217, 217, 217, 255]);
  await page.screenshot({ path: "test-results/duplicate-frame-desktop.png", fullPage: true });
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const decoded = await decodeFigcraft(await readFile((await (await download).path())!));
  const copies = Object.values(decoded.document.nodes).filter(node => node.kind === "frame");
  expect(copies).toHaveLength(2);
  for (const frame of copies) {
    expect(frame.kind === "frame" && frame.children).toHaveLength(1);
    if (frame.kind === "frame") expect(decoded.document.nodes[frame.children[0]]).toMatchObject({ parent: frame.id, name: "Contained", x: 10, y: 20 });
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(layers.getByRole("button", { name: "Contained", exact: true })).toHaveCount(1);
});

test("canvas move previews cancel without root updates and release-only Alt copies repeat", async ({ page }) => {
  await login(page); await createNamedRectangle(page, "Dragged", 200, 200, 50, 40);
  const canvas = page.getByLabel("Design canvas", { exact: true }), root = page.locator("[data-figcraft-editor]");
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  const start = await canvasPoint(page, 210, 210), end = await canvasPoint(page, 280, 230);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  const commits = await root.getAttribute("data-commits");
  await page.mouse.move(end.x, end.y, { steps: 15 });
  expect(await root.getAttribute("data-commits")).toBe(commits); await expectCanvasPixel(page, 280, 230, [217, 217, 217, 255]);
  await page.keyboard.press("Escape"); await page.mouse.up(); await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("200");
  await expectCanvasPixel(page, 210, 210, [217, 217, 217, 255]);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.keyboard.down("Shift");
  await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up(); await page.keyboard.up("Shift");
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("270"); await expect(page.getByLabel("Edit Y", { exact: true })).toHaveValue("200");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const copyEnd = await canvasPoint(page, 340, 210);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(copyEnd.x, copyEnd.y, { steps: 10 });
  await page.keyboard.down("Alt"); await page.mouse.up(); await page.keyboard.up("Alt");
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("330");
  await expect(page.getByRole("region", { name: "Layers" }).getByRole("button", { name: "Dragged", exact: true })).toHaveCount(2);
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+d"); await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("460");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const decoded = await decodeFigcraft(await readFile((await (await download).path())!));
  expect(Object.values(decoded.document.nodes).filter(n => n.kind === "rectangle").map(n => n.x)).toEqual([200, 330, 460]);
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible(); await page.reload(); await resetCanvasOrigin(page);
  await expect(page.getByRole("region", { name: "Layers" }).getByRole("button", { name: "Dragged", exact: true })).toHaveCount(3);
});

test("canvas marquee selects and toggles layers without root frame updates", async ({ page }) => {
  await login(page); await createNamedRectangle(page, "Marquee A", 200, 200, 50, 40); await createNamedRectangle(page, "Marquee B", 300, 200, 50, 40);
  const root = page.locator("[data-figcraft-editor]"), layers = page.getByRole("region", { name: "Layers" });
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  const start = await canvasPoint(page, 180, 180), end = await canvasPoint(page, 360, 250);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); const commits = await root.getAttribute("data-commits");
  await page.mouse.move(end.x, end.y, { steps: 12 }); expect(await root.getAttribute("data-commits")).toBe(commits);
  await page.screenshot({ path: "test-results/marquee-preview-desktop.png", fullPage: true }); await page.mouse.up();
  await expect(layers.locator('li[aria-current="true"]')).toHaveCount(2);
  await page.keyboard.down("Shift"); await page.mouse.move(start.x, start.y); await page.mouse.down();
  const toggleEnd = await canvasPoint(page, 260, 250); await page.mouse.move(toggleEnd.x, toggleEnd.y, { steps: 8 }); await page.mouse.up(); await page.keyboard.up("Shift");
  await expect(layers.locator('li[aria-current="true"]')).toHaveCount(1);
  await expect(layers.locator('li[aria-current="true"]')).toContainText("Marquee B");
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("button", { name: "Fit page", exact: true }).click();
  const mobileStart = await canvasPoint(page, 180, 180), mobileEnd = await canvasPoint(page, 360, 250);
  await page.mouse.move(mobileStart.x, mobileStart.y); await page.mouse.down(); await page.mouse.move(mobileEnd.x, mobileEnd.y, { steps: 8 }); await page.mouse.up();
  await page.locator(".figcraft-mobile-layers > summary").click(); await expect(layers.locator('li[aria-current="true"]')).toHaveCount(2);
});

test("canvas drops enter and leave Frames while preserving world geometry", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [label, value] of [["X", 400], ["Y", 100], ["Width", 250], ["Height", 250]] as const) await creation.getByLabel(label, { exact: true }).fill(String(value));
  await creation.getByRole("button", { name: "Create frame", exact: true }).click(); await createNamedRectangle(page, "Traveller", 200, 200, 40, 30);
  const start = await canvasPoint(page, 210, 210), inside = await canvasPoint(page, 450, 170);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.keyboard.down("ControlOrMeta");
  await page.mouse.move(inside.x, inside.y, { steps: 10 }); await page.mouse.up(); await page.keyboard.up("ControlOrMeta");
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("40"); await expect(page.getByLabel("Edit Y", { exact: true })).toHaveValue("60");
  const children = page.getByRole("list", { name: "Children of Frame 1", exact: true }); await expect(children.getByRole("button", { name: "Traveller", exact: true })).toBeVisible();
  await expectCanvasPixel(page, 450, 170, [217, 217, 217, 255]);
  const outside = await canvasPoint(page, 750, 400);
  await page.mouse.move(inside.x, inside.y); await page.mouse.down(); await page.keyboard.down("ControlOrMeta");
  await page.mouse.move(outside.x, outside.y, { steps: 10 }); await page.mouse.up(); await page.keyboard.up("ControlOrMeta");
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("740"); await expect(page.getByLabel("Edit Y", { exact: true })).toHaveValue("390");
  await expect(children.getByRole("button", { name: "Traveller", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(children.getByRole("button", { name: "Traveller", exact: true })).toBeVisible();
});

test("Alt-drag snaps equal gaps to its source and draws native measurement guides", async ({ page }) => {
  await login(page); await createNamedRectangle(page, "Gap A", 200, 200, 100, 100); await createNamedRectangle(page, "Gap B", 400, 200, 100, 100);
  const start = await canvasPoint(page, 450, 250), end = await canvasPoint(page, 648, 252);
  await page.keyboard.down("Alt"); await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 12 });
  const canvas = page.getByLabel("Design canvas", { exact: true });
  await expect.poll(() => canvas.evaluate((node: HTMLCanvasElement) => {
    const pixel = node.getContext("2d")!.getImageData(520, 250, 1, 1).data;
    return pixel[0] > 200 && pixel[1] < 180 && pixel[2] < 180;
  })).toBe(true);
  await page.screenshot({ path: "test-results/alt-drag-guides-desktop.png", fullPage: true });
  await page.mouse.up(); await page.keyboard.up("Alt");
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("600"); await expect(page.getByLabel("Edit Y", { exact: true })).toHaveValue("200");
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+d"); await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("800");
});

test("transform handles resize, flip and cancel without root frame updates", async ({ page }) => {
  await login(page); await createNamedRectangle(page, "Resize me", 200, 200, 100, 50);
  const canvas = page.getByLabel("Design canvas", { exact: true }), root = page.locator("[data-figcraft-editor]");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  const from = await canvasPoint(page, 300, 250), to = await canvasPoint(page, 350, 280);
  await page.mouse.move(from.x, from.y); await expect(canvas).toHaveCSS("cursor", "nwse-resize"); await page.mouse.down();
  const commits = await root.getAttribute("data-commits"); await page.mouse.move(to.x, to.y, { steps: 12 }); await expect(root).toHaveAttribute("data-commits", commits!);
  await expect(page.getByLabel("Edit Width", { exact: true })).toHaveValue("100");
  await page.keyboard.press("Escape"); await page.mouse.up(); await expect(page.getByLabel("Edit Width", { exact: true })).toHaveValue("100");
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
  await geometry(page, [200, 200, 150, 80]);
  await page.screenshot({ path: "test-results/resize-handles-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await geometry(page, [200, 200, 100, 50]);
  const right = await canvasPoint(page, 300, 225), left = await canvasPoint(page, 160, 225);
  await page.keyboard.down("ControlOrMeta"); await page.mouse.move(right.x, right.y); await page.mouse.down(); await page.mouse.move(left.x, left.y, { steps: 8 }); await page.mouse.up(); await page.keyboard.up("ControlOrMeta");
  await expect(page.getByLabel("Edit Width", { exact: true })).toHaveValue("40");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click(); const file = await download;
  const decoded = await decodeFigcraft(new Uint8Array(await readFile((await file.path())!))); const node = Object.values(decoded.document.nodes).find(n => n.name === "Resize me")!;
  expect(node.kind !== "page" && node.transform?.[0]).toBe(-1);
  await page.reload(); await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
});

test("rotation handles respect Shift steps and proportion locks survive recovery", async ({ page }) => {
  await login(page); await createNamedRectangle(page, "Turn me", 200, 200, 100, 100);
  const from = await canvasPoint(page, 310, 190), angle = -Math.PI / 4 + 37 * Math.PI / 180, to = await canvasPoint(page, 250 + Math.cos(angle) * 80, 250 + Math.sin(angle) * 80);
  await page.keyboard.down("Shift"); await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up(); await page.keyboard.up("Shift");
  await expect.poll(async () => Number(await page.getByLabel("Rotation", { exact: true }).inputValue())).toBeCloseTo(-30, 6);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await page.getByLabel("Constrain proportions", { exact: true }).check();
  const corner = await canvasPoint(page, 300, 300), end = await canvasPoint(page, 350, 320);
  await page.mouse.move(corner.x, corner.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up(); await geometry(page, [200, 200, 150, 150]);
  await page.getByLabel("Edit Width", { exact: true }).fill("200"); await page.getByRole("button", { name: "Apply geometry", exact: true }).click(); await geometry(page, [200, 200, 200, 200]);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload(); await page.getByRole("button", { name: "Turn me", exact: true }).click();
  await expect(page.getByLabel("Constrain proportions", { exact: true })).toBeChecked(); await geometry(page, [200, 200, 200, 200]);
});

test("Scale tool keyboard, anchors, dimension scrubs and mobile controls preserve one-step undo", async ({ page }) => {
  await login(page); await createNamedRectangle(page, "Scale me", 200, 200, 100, 50);
  const canvas = page.getByLabel("Design canvas", { exact: true }); await canvas.focus(); await page.keyboard.press("k"); await expect(page.getByRole("button", { name: "Scale", exact: true })).toHaveAttribute("aria-pressed", "true");
  const from = await canvasPoint(page, 300, 250), to = await canvasPoint(page, 400, 300);
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.screenshot({ path: "test-results/scale-tool-preview-desktop.png", fullPage: true }); await page.mouse.up(); await geometry(page, [200, 200, 200, 100]);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await geometry(page, [200, 200, 100, 50]);
  await page.getByRole("button", { name: "Centre scale anchor", exact: true }).click();
  await page.getByLabel("Tool scale factor", { exact: true }).fill("2"); await page.getByRole("button", { name: "Apply scale factor", exact: true }).click(); await geometry(page, [150, 175, 200, 100]);
  const scrub = page.getByRole("button", { name: "Scrub scale width", exact: true }); await scrub.scrollIntoViewIfNeeded(); const rect = (await scrub.boundingBox())!;
  await page.mouse.move(rect.x + 5, rect.y + 5); await page.mouse.down(); await page.mouse.move(rect.x + 45, rect.y + 5, { steps: 8 }); await page.mouse.up(); await geometry(page, [130, 165, 240, 120]);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await geometry(page, [150, 175, 200, 100]);
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByLabel("Scale width", { exact: true }).fill("100"); await page.getByRole("button", { name: "Set scale width", exact: true }).click(); await geometry(page, [200, 200, 100, 50]);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload(); await page.locator(".figcraft-mobile-layers > summary").click(); await page.locator(".figcraft-mobile-layers").getByRole("button", { name: "Scale me", exact: true }).click(); await geometry(page, [200, 200, 100, 50]);
});

test("Frame handles distinguish constraints, primary preservation and uniform subtree scaling", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [label, value] of [["X", "200"], ["Y", "200"], ["Width", "200"], ["Height", "100"]]) await creation.getByLabel(label, { exact: true }).fill(value);
  await creation.getByRole("button", { name: "Create frame", exact: true }).click(); await creation.getByLabel("Create in", { exact: true }).selectOption({ label: "Frame 1" });
  await createNamedRectangle(page, "Pinned child", 150, 60, 40, 30); await page.getByLabel("Horizontal constraint").selectOption("right"); await page.getByLabel("Vertical constraint").selectOption("bottom"); await page.getByRole("button", { name: "Apply constraints", exact: true }).click();
  const layers = page.getByRole("region", { name: "Layers" });
  const selectFrame = () => layers.getByRole("button", { name: "Frame 1", exact: true }).click();
  const drag = async (x: number, y: number, dx: number, dy: number) => { const a = await canvasPoint(page, x, y), b = await canvasPoint(page, dx, dy); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); };
  await selectFrame(); await drag(400, 300, 500, 350); await layers.getByRole("button", { name: "Pinned child", exact: true }).click(); await geometry(page, [250, 110, 40, 30]);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await selectFrame();
  await page.keyboard.down("ControlOrMeta"); await drag(200, 250, 150, 250); await page.keyboard.up("ControlOrMeta");
  await layers.getByRole("button", { name: "Pinned child", exact: true }).click(); await geometry(page, [200, 60, 40, 30]); await expectCanvasPixel(page, 360, 270, [217, 217, 217, 255]);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await selectFrame(); await page.getByRole("button", { name: "Scale", exact: true }).click();
  await drag(400, 300, 500, 350); await layers.getByRole("button", { name: "Pinned child", exact: true }).click(); await geometry(page, [225, 90, 60, 45]);
});

test("rounded corners preview, Alt individual edits, smoothing and native recovery", async ({ page }) => {
  await login(page); await createNamedRectangle(page, "Rounded", 200, 200, 200, 120);
  const canvas = page.getByLabel("Design canvas", { exact: true }), root = page.locator("[data-figcraft-editor]");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  const start = await canvasPoint(page, 207.071, 207.071), end = await canvasPoint(page, 230, 228);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); const commits = await root.getAttribute("data-commits");
  await page.mouse.move(end.x, end.y, { steps: 10 }); await expect(root).toHaveAttribute("data-commits", commits!);
  await expectCanvasPixel(page, 210, 201, [245, 245, 245, 255]);
  await page.screenshot({ path: "test-results/corner-drag-desktop.png", fullPage: true });
  await page.mouse.up(); await expect(page.getByLabel("Corner radius", { exact: true })).toHaveValue("29");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(page.getByLabel("Corner radius", { exact: true })).toHaveValue("0");
  const br = await canvasPoint(page, 392.929, 312.929), to = await canvasPoint(page, 390, 310);
  await page.keyboard.down("Alt"); await page.mouse.move(br.x, br.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up(); await page.keyboard.up("Alt");
  await page.getByRole("button", { name: "Individual corners", exact: true }).click();
  await expect(page.getByLabel("Bottom right radius", { exact: true })).toHaveValue("10"); await expect(page.getByLabel("Top left radius", { exact: true })).toHaveValue("0");
  await page.getByLabel("Corner radius", { exact: true }).fill("40"); await page.getByRole("button", { name: "Apply corner radius", exact: true }).click();
  await page.getByRole("button", { name: "iOS", exact: true }).click(); await expect(page.getByLabel("Corner smoothing", { exact: true })).toHaveValue("60");
  await expect(canvas).toHaveScreenshot("rounded-corners.png", { animations: "disabled", maxDiffPixels: 0 });
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const decoded = await decodeFigcraft(await readFile((await (await download).path())!));
  expect((Object.values(decoded.document.nodes).find(n => n.name === "Rounded") as RectangleNode).corners).toEqual({ radii: [40, 40, 40, 40], smoothing: .6 });
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload();
  await page.getByRole("button", { name: "Rounded", exact: true }).click(); await expect(page.getByLabel("Corner radius", { exact: true })).toHaveValue("40");
  await page.setViewportSize({ width: 390, height: 844 }); await expect(page.getByLabel("Corner radius", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Individual corners", exact: true }).click(); await page.getByLabel("Top left radius", { exact: true }).fill("17"); await page.getByRole("button", { name: "Apply top left radius", exact: true }).click();
  await expect(page.getByLabel("Top left radius", { exact: true })).toHaveValue("17");
  await expect(canvas).toBeVisible();
});

test("rounded Frame clips child paint while preserving rectangular hit selection", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [label, value] of [["X", 200], ["Y", 200], ["Width", 200], ["Height", 120]] as const) await creation.getByLabel(label, { exact: true }).fill(String(value));
  await creation.getByRole("button", { name: "Create frame", exact: true }).click();
  await page.getByLabel("Corner radius", { exact: true }).fill("50"); await page.getByRole("button", { name: "Apply corner radius", exact: true }).click();
  await creation.getByLabel("Create in", { exact: true }).selectOption({ label: "Frame 1" });
  await createNamedRectangle(page, "Clipped child", 0, 0, 200, 120);
  await page.getByLabel("Fill 1 CSS colour", { exact: true }).fill("#ff0000"); await page.getByRole("button", { name: "Apply fill 1", exact: true }).click();
  await expectCanvasPixel(page, 210, 202, [245, 245, 245, 255]); await expectCanvasPixel(page, 280, 240, [255, 0, 0, 255]);
  await page.getByRole("button", { name: "Frame 1", exact: true }).click();
  const outside = await canvasPoint(page, 650, 500); await page.mouse.click(outside.x, outside.y);
  const corner = await canvasPoint(page, 210, 202); await page.keyboard.down("ControlOrMeta"); await page.mouse.click(corner.x, corner.y); await page.keyboard.up("ControlOrMeta");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Clipped child");
  await page.screenshot({ path: "test-results/rounded-frame-clipping.png", fullPage: true });
});

test("corner controls edit mixed selections, preserve resize radii and scale them", async ({ page }) => {
  await login(page); await createNamedRectangle(page, "Corner A", 200, 200, 200, 120);
  await page.getByLabel("Corner radius", { exact: true }).fill("20"); await page.getByRole("button", { name: "Apply corner radius", exact: true }).click();
  await createNamedRectangle(page, "Corner B", 450, 200, 200, 120);
  await page.getByRole("button", { name: "Corner A", exact: true }).click({ modifiers: ["Shift"] });
  await expect(page.getByLabel("Corner radius", { exact: true })).toHaveAttribute("placeholder", "Mixed");
  await page.getByLabel("Corner radius", { exact: true }).fill("30"); await page.getByRole("button", { name: "Apply corner radius", exact: true }).click();
  for (const name of ["Corner A", "Corner B"]) { await page.getByRole("button", { name, exact: true }).click(); await expect(page.getByLabel("Corner radius", { exact: true })).toHaveValue("30"); }
  await page.getByLabel("Edit Width", { exact: true }).fill("100"); await page.getByRole("button", { name: "Apply geometry", exact: true }).click(); await expect(page.getByLabel("Corner radius", { exact: true })).toHaveValue("30");
  const canvas = page.getByLabel("Design canvas", { exact: true }); await canvas.focus(); await page.keyboard.press("k");
  await page.getByLabel("Tool scale factor", { exact: true }).fill("2"); await page.getByRole("button", { name: "Apply scale factor", exact: true }).click(); await expect(page.getByLabel("Corner radius", { exact: true })).toHaveValue("60");
  await canvas.focus(); await page.keyboard.press("v");
  const from = await canvasPoint(page, 510, 260), to = await canvasPoint(page, 525, 275);
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 6 }); await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(page.getByLabel("Corner radius", { exact: true })).toHaveValue("60");
});

async function createEllipse(page: Page, name: string, x = 200, y = 200, width = 200, height = 200) {
  const creation = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [label, value] of [["X", x], ["Y", y], ["Width", width], ["Height", height]] as const) await creation.getByLabel(label, { exact: true }).fill(String(value));
  await creation.getByRole("button", { name: "Create ellipse", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(name); await page.getByRole("button", { name: "Apply layer", exact: true }).click();
}

test("ellipse arc handles preview signed sweep, ratio and cancel with one undo", async ({ page }) => {
  await login(page); await createEllipse(page, "Arc");
  const canvas = page.getByLabel("Design canvas", { exact: true }), root = page.locator("[data-figcraft-editor]");
  await expect(page.getByLabel("Corner radius", { exact: true })).toHaveCount(0);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  const start = await canvasPoint(page, 390, 300); await page.mouse.move(start.x, start.y); await page.mouse.down(); const commits = await root.getAttribute("data-commits");
  for (const deg of [-20, -60, -90]) { const p = await canvasPoint(page, 300 + 100 * Math.cos(deg * Math.PI / 180), 300 + 100 * Math.sin(deg * Math.PI / 180)); await page.mouse.move(p.x, p.y, { steps: 4 }); }
  await expect(root).toHaveAttribute("data-commits", commits!); await expect(page.getByLabel("Arc sweep", { exact: true })).toHaveValue("100");
  await page.screenshot({ path: "test-results/ellipse-sweep-preview.png", fullPage: true }); await page.mouse.up();
  await expect(page.getByLabel("Arc sweep", { exact: true })).toHaveValue("75");
  const centre = await canvasPoint(page, 300, 300), inner = await canvasPoint(page, 300 - Math.SQRT1_2 * 50, 300 + Math.SQRT1_2 * 50);
  await page.mouse.move(centre.x, centre.y); await page.mouse.down(); await page.mouse.move(inner.x, inner.y, { steps: 8 }); await page.mouse.up();
  await expect(page.getByLabel("Arc ratio", { exact: true })).toHaveValue("50"); await expectCanvasPixel(page, 300, 300, [245, 245, 245, 255]);
  await expectCanvasPixel(page, 370, 330, [217, 217, 217, 255]); await expectCanvasPixel(page, 365, 235, [245, 245, 245, 255]);
  await expect(canvas).toHaveScreenshot("ellipse-arc-ring.png", { animations: "disabled", maxDiffPixels: 0 });
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(page.getByLabel("Arc ratio", { exact: true })).toHaveValue("0");
  const sweep = await canvasPoint(page, 300, 210), end = await canvasPoint(page, 200, 300);
  await page.mouse.move(sweep.x, sweep.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 8 }); await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(page.getByLabel("Arc sweep", { exact: true })).toHaveValue("75");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(page.getByLabel("Arc sweep", { exact: true })).toHaveValue("100");
});

test("ellipse controls support mixed arcs, native save/recovery, ring hits and mobile editing", async ({ page }) => {
  await login(page); await createEllipse(page, "Ring");
  await page.getByLabel("Arc ratio", { exact: true }).fill("50"); await page.getByRole("button", { name: "Apply arc ratio", exact: true }).click();
  const outside = await canvasPoint(page, 650, 500), hole = await canvasPoint(page, 300, 300), body = await canvasPoint(page, 370, 330);
  await page.mouse.click(outside.x, outside.y); await page.mouse.click(hole.x, hole.y); await expect(page.getByRole("group", { name: "Arc", exact: true })).toHaveCount(0);
  await page.mouse.click(body.x, body.y); await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Ring");
  await createEllipse(page, "Other", 450); await page.getByRole("button", { name: "Ring", exact: true }).click({ modifiers: ["Shift"] });
  await expect(page.getByLabel("Arc ratio", { exact: true })).toHaveAttribute("placeholder", "Mixed");
  await page.getByLabel("Arc sweep", { exact: true }).fill("-50"); await page.getByRole("button", { name: "Apply arc sweep", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const decoded = await decodeFigcraft(await readFile((await (await download).path())!)); const ellipses = Object.values(decoded.document.nodes).filter(n => n.kind === "ellipse");
  expect(ellipses).toHaveLength(2); expect(ellipses.every(n => Math.abs(n.sweep + Math.PI) < 1e-9)).toBe(true);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload();
  await page.getByRole("button", { name: "Ring", exact: true }).click(); await expect(page.getByLabel("Arc sweep", { exact: true })).toHaveValue("-50");
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByLabel("Arc start", { exact: true }).fill("45"); await page.getByRole("button", { name: "Apply arc start", exact: true }).click();
  await expect(page.getByLabel("Arc start", { exact: true })).toHaveValue("45"); await expect(page.getByLabel("Arc ratio", { exact: true })).toHaveValue("50");
  await page.screenshot({ path: "test-results/ellipse-mobile-controls.png", fullPage: true });
});

test("Ellipse shortcut draws inside Frames, previews outside React and preserves Shift Alt drawing", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [label, value] of [["X", 100], ["Y", 100], ["Width", 400], ["Height", 400]] as const) await creation.getByLabel(label, { exact: true }).fill(String(value));
  await creation.getByRole("button", { name: "Create frame", exact: true }).click();
  const canvas = page.getByLabel("Design canvas", { exact: true }); await canvas.focus(); await page.keyboard.press("o");
  await expect(page.getByRole("button", { name: "Ellipse", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  const start = await canvasPoint(page, 250, 250), end = await canvasPoint(page, 310, 290);
  await page.keyboard.down("Shift"); await page.keyboard.down("Alt"); await page.mouse.move(start.x, start.y); await page.mouse.down();
  const root = page.locator("[data-figcraft-editor]"), commits = await root.getAttribute("data-commits"); await page.mouse.move(end.x, end.y, { steps: 12 });
  await expect(root).toHaveAttribute("data-commits", commits!); await page.mouse.up(); await page.keyboard.up("Alt"); await page.keyboard.up("Shift");
  await expect(page.getByRole("button", { name: "Move", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Selected ellipse", exact: true }).locator("dd")).toHaveText(["90", "90", "120", "120"]);
  await expect(page.getByRole("list", { name: "Children of Frame 1", exact: true }).getByRole("button", { name: "Ellipse", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
});

async function createPointShape(page: Page, kind: "polygon" | "star", name: string, x = 200) {
  const creation = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [label, value] of [["X", x], ["Y", 200], ["Width", 200], ["Height", 200]] as const) await creation.getByLabel(label, { exact: true }).fill(String(value));
  await creation.getByRole("button", { name: `Create ${kind}`, exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(name); await page.getByRole("button", { name: "Apply layer", exact: true }).click();
}

test("Star ratio and Polygon radius handles preview, cancel and undo without React frame updates", async ({ page }) => {
  await login(page); await createPointShape(page, "star", "Star handles");
  const root = page.locator("[data-figcraft-editor]"), canvas = page.getByLabel("Design canvas", { exact: true });
  const ratioPoint = async (ratio: number) => { const p = starPoints(200, 200, 5, ratio)[1]; return canvasPoint(page, 200 + p.x, 200 + p.y); };
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  const a = await ratioPoint(.38), b = await ratioPoint(.5); await page.mouse.move(a.x, a.y); await page.mouse.down(); const commits = await root.getAttribute("data-commits");
  await page.mouse.move(b.x, b.y, { steps: 8 }); await expect(root).toHaveAttribute("data-commits", commits!); await expect(page.getByLabel("Star ratio", { exact: true })).toHaveValue("38");
  await page.screenshot({ path: "test-results/star-ratio-preview.png", fullPage: true }); await page.mouse.up(); await expect(page.getByLabel("Star ratio", { exact: true })).toHaveValue("50");
  const c = await ratioPoint(.7); await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.mouse.move(c.x, c.y, { steps: 6 }); await page.keyboard.press("Escape"); await page.mouse.up(); await expect(page.getByLabel("Star ratio", { exact: true })).toHaveValue("50");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(page.getByLabel("Star ratio", { exact: true })).toHaveValue("38");
  await createPointShape(page, "polygon", "Polygon handles", 450);
  const from = await canvasPoint(page, 550, 210), to = await canvasPoint(page, 550, 240);
  await page.keyboard.down("Alt"); await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up(); await page.keyboard.up("Alt");
  await expect(page.getByLabel("Corner radius", { exact: true })).toHaveValue("20");
  await page.getByRole("button", { name: "Corner smoothing", exact: true }).click(); await page.getByRole("button", { name: "iOS", exact: true }).click(); await expect(page.getByLabel("Corner smoothing", { exact: true })).toHaveValue("60");
  await expect(page.getByLabel("Top left radius", { exact: true })).toHaveCount(0); await expect(page.getByLabel("Star ratio", { exact: true })).toHaveCount(0);
  await expectCanvasPixel(page, 550, 290, [217, 217, 217, 255]); await expectCanvasPixel(page, 455, 205, [245, 245, 245, 255]);
  await expect(canvas).toHaveScreenshot("polygon-star-smoothed.png", { animations: "disabled", maxDiffPixels: 0 });
});

test("Polygon Star controls preserve mixed counts, native save, recovery and mobile access", async ({ page }) => {
  await login(page); await createPointShape(page, "star", "Saved star");
  await page.getByLabel("Point count", { exact: true }).fill("120"); await page.getByRole("button", { name: "Apply point count", exact: true }).click(); await expect(page.getByLabel("Point count", { exact: true })).toHaveValue("60");
  await page.getByLabel("Star ratio", { exact: true }).fill("50"); await page.getByRole("button", { name: "Apply star ratio", exact: true }).click();
  await createPointShape(page, "polygon", "Saved polygon", 450); await page.getByRole("button", { name: "Saved star", exact: true }).click({ modifiers: ["Shift"] });
  await expect(page.getByLabel("Point count", { exact: true })).toHaveAttribute("placeholder", "Mixed"); await expect(page.getByLabel("Star ratio", { exact: true })).toHaveCount(0);
  await page.getByLabel("Point count", { exact: true }).fill("7"); await page.getByRole("button", { name: "Apply point count", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const opened = await decodeFigcraft(await readFile((await (await download).path())!));
  const shapes = Object.values(opened.document.nodes).filter(n => n.kind === "star" || n.kind === "polygon"); expect(shapes).toHaveLength(2); expect(shapes.every(n => n.count === 7)).toBe(true); expect(shapes.find(n => n.kind === "star")).toMatchObject({ innerRatio: .5 });
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload(); await page.getByRole("button", { name: "Saved star", exact: true }).click();
  await expect(page.getByLabel("Star ratio", { exact: true })).toHaveValue("50"); await expect(page.getByLabel("Point count", { exact: true })).toHaveValue("7");
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByLabel("Star ratio", { exact: true }).fill("25"); await page.getByRole("button", { name: "Apply star ratio", exact: true }).click(); await expect(page.getByLabel("Star ratio", { exact: true })).toHaveValue("25");
  const toolbar = page.getByRole("toolbar", { name: "Tools", exact: true }); const bounds = (await toolbar.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await toolbar.getByRole("button", { name: "Polygon", exact: true }).click(); await expect(toolbar.getByRole("button", { name: "Polygon", exact: true })).toHaveAttribute("aria-pressed", "true");
  await toolbar.getByRole("button", { name: "Star", exact: true }).click(); await expect(toolbar.getByRole("button", { name: "Star", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/polygon-star-mobile.png", fullPage: true });
});

test("Polygon Star tools share constrained Frame drawing and shape-aware selection", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [label, value] of [["X", 100], ["Y", 100], ["Width", 500], ["Height", 400]] as const) await creation.getByLabel(label, { exact: true }).fill(String(value));
  await creation.getByRole("button", { name: "Create frame", exact: true }).click();
  for (const [kind, x] of [["Polygon", 250], ["Star", 450]] as const) {
    await page.getByRole("toolbar", { name: "Tools", exact: true }).getByRole("button", { name: kind, exact: true }).click();
    const a = await canvasPoint(page, x, 250), b = await canvasPoint(page, x + 60, 290);
    await page.keyboard.down("Shift"); await page.keyboard.down("Alt"); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); await page.keyboard.up("Alt"); await page.keyboard.up("Shift");
    await expect(page.getByRole("region", { name: `Selected ${kind.toLowerCase()}`, exact: true }).locator("dd")).toHaveText([String(x - 160), "90", "120", "120"]);
    await expect(page.getByRole("list", { name: "Children of Frame 1", exact: true }).getByRole("button", { name: kind, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move", exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  const outside = await canvasPoint(page, 650, 500), empty = await canvasPoint(page, 391, 191), inside = await canvasPoint(page, 450, 250);
  await page.mouse.click(outside.x, outside.y); await page.keyboard.down("ControlOrMeta"); await page.mouse.click(empty.x, empty.y); await page.keyboard.up("ControlOrMeta"); await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Frame 1");
  await page.keyboard.down("ControlOrMeta"); await page.mouse.click(inside.x, inside.y); await page.keyboard.up("ControlOrMeta"); await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Star");
});

test("Line Arrow stroke controls preserve native save, recovery and mobile tools", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [label, value] of [["X", 200], ["Y", 250], ["Width", 250], ["Height", 100]] as const) await creation.getByLabel(label, { exact: true }).fill(String(value));
  await creation.getByRole("button", { name: "Create arrow", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selected line", exact: true }).locator("dd")).toHaveText(["200", "250", "250", "0"]);
  await expect(page.getByLabel("Corner radius", { exact: true })).toHaveCount(0);
  const stroke = page.getByRole("group", { name: "Stroke", exact: true });
  await stroke.getByLabel("Stroke weight", { exact: true }).fill("12"); await stroke.getByRole("button", { name: "Apply stroke weight", exact: true }).click();
  await stroke.getByText("Advanced stroke", { exact: true }).click();
  for (const cap of ["none", "round", "square", "lineArrow", "triangleArrow", "reversedTriangle", "circleFilled", "diamondFilled"]) {
    await stroke.getByLabel("End cap", { exact: true }).selectOption(cap); await expect(stroke.getByLabel("End cap", { exact: true })).toHaveValue(cap);
  }
  await stroke.getByLabel("Start cap", { exact: true }).selectOption("circleFilled"); await stroke.getByLabel("End cap", { exact: true }).selectOption("triangleArrow");
  await stroke.getByLabel("Stroke style", { exact: true }).selectOption("custom");
  await stroke.getByLabel("Dashes", { exact: true }).fill("-1,3"); await stroke.getByRole("button", { name: "Apply dashes", exact: true }).click(); await expect(stroke.getByRole("alert")).toContainText("non-negative");
  await stroke.getByLabel("Dashes", { exact: true }).fill("8,4,2,4"); await stroke.getByRole("button", { name: "Apply dashes", exact: true }).click(); await expect(stroke.getByRole("alert")).toHaveCount(0);
  await stroke.getByLabel("Dash cap", { exact: true }).selectOption("round");
  await stroke.getByLabel("Stroke 1 CSS colour", { exact: true }).fill("#0088cc"); await stroke.getByLabel("Stroke 1 opacity", { exact: true }).fill("0.8"); await stroke.getByRole("button", { name: "Apply stroke 1", exact: true }).click();
  await expect(page.getByLabel("Design canvas", { exact: true })).toHaveScreenshot("line-arrow-dashes.png", { animations: "disabled", maxDiffPixels: 0 });
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const opened = await decodeFigcraft(await readFile((await (await download).path())!)), line = Object.values(opened.document.nodes).find(n => n.kind === "line")!;
  expect(line).toMatchObject({ kind: "line", height: 0, stroke: { weight: 12, capStart: "circleFilled", capEnd: "triangleArrow", dashes: [8, 4, 2, 4], dashCap: "round" } });
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload(); await page.getByRole("region", { name: "Layers", exact: true }).getByRole("button", { name: "Arrow", exact: true }).click();
  await expect(stroke.getByLabel("Stroke weight", { exact: true })).toHaveValue("12");
  await page.setViewportSize({ width: 390, height: 844 });
  const toolbar = page.getByRole("toolbar", { name: "Tools", exact: true });
  for (const tool of ["Line", "Arrow"]) { await toolbar.getByRole("button", { name: tool, exact: true }).click(); await expect(toolbar.getByRole("button", { name: tool, exact: true })).toHaveAttribute("aria-pressed", "true"); }
  const bounds = (await toolbar.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/line-arrow-mobile.png", fullPage: true });
});

test("Line Arrow keyboard drawing and endpoint previews preserve Frame geometry and undo", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [label, value] of [["X", 100], ["Y", 100], ["Width", 500], ["Height", 400]] as const) await creation.getByLabel(label, { exact: true }).fill(String(value));
  await creation.getByRole("button", { name: "Create frame", exact: true }).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  const canvas = page.getByLabel("Design canvas", { exact: true }); await canvas.focus(); await page.keyboard.press("Shift+L");
  await expect(page.getByRole("toolbar", { name: "Tools", exact: true }).getByRole("button", { name: "Arrow", exact: true })).toHaveAttribute("aria-pressed", "true");
  const a = await canvasPoint(page, 300, 250), b = await canvasPoint(page, 360, 290);
  await page.keyboard.down("Control"); await page.keyboard.down("Shift"); await page.keyboard.down("Alt");
  await page.mouse.move(a.x, a.y); await page.mouse.down(); const root = page.locator("[data-figcraft-editor]"), commits = await root.getAttribute("data-commits");
  await page.mouse.move(b.x, b.y, { steps: 8 }); await expect(root).toHaveAttribute("data-commits", commits!); await page.mouse.up();
  await page.keyboard.up("Alt"); await page.keyboard.up("Shift"); await page.keyboard.up("Control");
  await expect(page.getByRole("list", { name: "Children of Frame 1", exact: true }).getByRole("button", { name: "Arrow", exact: true })).toBeVisible();
  const save = async () => { const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click(); return decodeFigcraft(await readFile((await (await download).path())!)); };
  const first = await save(), line = Object.values(first.document.nodes).find(n => n.kind === "line")!;
  // Recovery writes debounce independently of pointer previews; settle that chrome update first.
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await expect(page.getByRole("button", { name: "Save as", exact: true })).toBeEnabled();
  if (line.kind !== "line") throw new Error("Expected Line");
  expect(line.width).toBeCloseTo(2 * Math.hypot(60, 40)); expect(line.height).toBe(0);
  const matrix = worldTransform(first.document, line.id), end = transformPoint(matrix, { x: line.width, y: 0 });
  const p = await canvasPoint(page, end.x, end.y), q = await canvasPoint(page, end.x + 50, end.y + 20);
  await page.keyboard.down("Control"); await page.mouse.move(p.x, p.y); await page.mouse.down(); const before = await root.getAttribute("data-commits"); await page.mouse.move(q.x, q.y, { steps: 8 }); await expect(root).toHaveAttribute("data-commits", before!);
  await page.keyboard.press("Escape"); await page.mouse.up(); await page.keyboard.up("Control");
  const cancelled = await save(); expect(cancelled.document.nodes[line.id]).toEqual(line);
  await page.keyboard.down("Control"); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 8 }); await page.mouse.up(); await page.keyboard.up("Control");
  const moved = await save(), movedLine = moved.document.nodes[line.id]; if (movedLine.kind !== "line") throw new Error("Expected Line");
  const movedEnd = transformPoint(worldTransform(moved.document, line.id), { x: movedLine.width, y: 0 }); expect(movedEnd.x).toBeCloseTo(end.x + 50, 0); expect(movedEnd.y).toBeCloseTo(end.y + 20, 0);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); expect((await save()).document.nodes[line.id]).toEqual(line);
});

test("stroke stacks support mixed selection, ordering and one-step multi-layer undo", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true });
  await creation.getByRole("button", { name: "Create line", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("First line"); await page.getByRole("button", { name: "Apply layer", exact: true }).click();
  await creation.getByRole("button", { name: "Create rectangle", exact: true }).click();
  await page.getByRole("button", { name: "First line", exact: true }).click({ modifiers: ["Shift"] });
  const stroke = page.getByRole("group", { name: "Stroke", exact: true }); await expect(stroke.getByText("Mixed strokes", { exact: true })).toBeVisible();
  await stroke.getByRole("button", { name: "Add stroke", exact: true }).click(); await expect(stroke.getByText("Mixed strokes", { exact: true })).toBeVisible();
  const save = async () => { const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click(); return decodeFigcraft(await readFile((await (await download).path())!)); };
  const saved = await save(), layers = Object.values(saved.document.nodes).filter(n => n.kind !== "page"); expect(layers.map(n => n.strokes?.length).sort()).toEqual([1, 2]);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); const undone = await save(); expect(Object.values(undone.document.nodes).filter(n => n.kind !== "page").map(n => n.strokes?.length ?? 0).sort()).toEqual([0, 1]);
  await page.getByRole("button", { name: "First line", exact: true }).click(); await stroke.getByRole("button", { name: "Add stroke", exact: true }).click();
  await stroke.getByLabel("Stroke 1 CSS colour", { exact: true }).fill("red"); await stroke.getByRole("button", { name: "Apply stroke 1", exact: true }).click();
  await stroke.getByRole("button", { name: "Move stroke 1 down", exact: true }).click(); await expect(stroke.getByLabel("Stroke 2 CSS colour", { exact: true })).toHaveValue("rgba(255,0,0,1)");
  await stroke.getByRole("button", { name: "Remove stroke 1", exact: true }).click(); await expect(stroke.getByRole("button", { name: "Apply stroke 2", exact: true })).toHaveCount(0);
});

test("advanced stroke fields use the native whole-stroke mixed state", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true }), stroke = page.getByRole("group", { name: "Stroke", exact: true });
  await creation.getByRole("button", { name: "Create line", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Mixed first"); await page.getByRole("button", { name: "Apply layer", exact: true }).click();
  await creation.getByRole("button", { name: "Create line", exact: true }).click();
  await stroke.getByLabel("Stroke weight", { exact: true }).fill("2"); await stroke.getByRole("button", { name: "Apply stroke weight", exact: true }).click();
  await page.getByRole("button", { name: "Mixed first", exact: true }).click({ modifiers: ["Shift"] });
  await expect(stroke.getByLabel("Stroke weight", { exact: true })).toHaveAttribute("placeholder", "Mixed");
  await expect(stroke.getByLabel("Stroke alignment", { exact: true })).toHaveValue("center");
  await stroke.getByText("Advanced stroke", { exact: true }).click();
  for (const label of ["Stroke join", "Start cap", "End cap"]) await expect(stroke.getByLabel(label, { exact: true })).toHaveValue("");
  await expect(stroke.getByLabel("Miter angle", { exact: true })).toHaveCount(0);
  await stroke.getByLabel("Stroke weight", { exact: true }).fill("2"); await stroke.getByRole("button", { name: "Apply stroke weight", exact: true }).click();
  await expect(stroke.getByLabel("Stroke join", { exact: true })).toHaveValue("miter"); await expect(stroke.getByLabel("Start cap", { exact: true })).toHaveValue("none");
  await expect(stroke.getByLabel("Miter angle", { exact: true })).toHaveValue("28.96");
});

test("individual stroke presets and fields survive undo, native files, recovery and mobile layout", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [label, value] of [["X", 100], ["Y", 100], ["Width", 240], ["Height", 160]] as const) await creation.getByLabel(label, { exact: true }).fill(String(value));
  await creation.getByRole("button", { name: "Create rectangle", exact: true }).click();
  const stroke = page.getByRole("group", { name: "Stroke", exact: true }); await stroke.getByRole("button", { name: "Add stroke", exact: true }).click();
  await stroke.getByLabel("Stroke weight", { exact: true }).fill("8"); await stroke.getByRole("button", { name: "Apply stroke weight", exact: true }).click();
  const labels = ["Top", "Right", "Bottom", "Left"];
  for (let side = 0; side < 4; side++) {
    await stroke.getByLabel("Individual strokes", { exact: true }).selectOption(String(side));
    for (let i = 0; i < 4; i++) await expect(stroke.getByLabel(`${labels[i]} stroke weight`, { exact: true })).toHaveValue(i === side ? "8" : "0");
  }
  await stroke.getByLabel("Individual strokes", { exact: true }).selectOption("custom");
  await stroke.getByLabel("Bottom stroke weight", { exact: true }).fill("12"); await stroke.getByRole("button", { name: "Apply bottom stroke weight", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(stroke.getByLabel("Bottom stroke weight", { exact: true })).toHaveValue("8");
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await expect(stroke.getByLabel("Bottom stroke weight", { exact: true })).toHaveValue("12");
  await stroke.getByLabel("Top stroke weight", { exact: true }).fill("-1"); await stroke.getByRole("button", { name: "Apply top stroke weight", exact: true }).click();
  expect(await stroke.getByLabel("Top stroke weight", { exact: true }).evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)).toBe(true);
  await stroke.getByLabel("Top stroke weight", { exact: true }).fill("0"); await stroke.getByRole("button", { name: "Apply top stroke weight", exact: true }).click();
  await page.getByLabel("Corner radius", { exact: true }).fill("32"); await page.getByRole("button", { name: "Apply corner radius", exact: true }).click();
  await page.getByRole("button", { name: "Individual corners", exact: true }).click();
  await page.getByRole("button", { name: "iOS", exact: true }).click();
  await expect(page.getByLabel("Design canvas", { exact: true })).toHaveScreenshot("individual-strokes.png", { animations: "disabled", maxDiffPixels: 0 });
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const path = (await (await download).path())!, opened = await decodeFigcraft(await readFile(path));
  expect(Object.values(opened.document.nodes).find(n => n.kind === "rectangle")).toMatchObject({ stroke: { sides: [0, 8, 12, 8] } });
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload();
  await page.getByRole("region", { name: "Layers", exact: true }).getByRole("button", { name: "Rectangle", exact: true }).click();
  await expect(stroke.getByLabel("Bottom stroke weight", { exact: true })).toHaveValue("12");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const label of labels) {
    const field = stroke.getByLabel(`${label} stroke weight`, { exact: true }); await field.scrollIntoViewIfNeeded();
    const bounds = (await field.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: "test-results/individual-strokes-mobile.png", fullPage: true });
  await stroke.getByLabel("Individual strokes", { exact: true }).selectOption("all");
  await expect(stroke.getByLabel("Top stroke weight", { exact: true })).toHaveCount(0);
});

test("individual strokes preserve mixed selection and one-step multi-layer undo", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true }), stroke = page.getByRole("group", { name: "Stroke", exact: true });
  await creation.getByRole("button", { name: "Create rectangle", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Side first"); await page.getByRole("button", { name: "Apply layer", exact: true }).click();
  await stroke.getByRole("button", { name: "Add stroke", exact: true }).click(); await stroke.getByLabel("Individual strokes", { exact: true }).selectOption("0");
  await creation.getByRole("button", { name: "Create rectangle", exact: true }).click();
  await stroke.getByRole("button", { name: "Add stroke", exact: true }).click(); await stroke.getByLabel("Individual strokes", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Side first", exact: true }).click({ modifiers: ["Shift"] });
  await expect(stroke.getByLabel("Top stroke weight", { exact: true })).toHaveCount(0);
  await stroke.getByLabel("Individual strokes", { exact: true }).selectOption("custom");
  await expect(stroke.getByLabel("Top stroke weight", { exact: true })).toHaveValue("1");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(stroke.getByLabel("Top stroke weight", { exact: true })).toHaveCount(0);
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const opened = await decodeFigcraft(await readFile((await (await download).path())!));
  expect(Object.values(opened.document.nodes).filter(n => n.kind === "rectangle").map(n => n.stroke?.sides)).toEqual([[1, 0, 0, 0], [0, 1, 0, 0]]);
});

test("width profile presets and flip survive native files, recovery, invalid input and mobile", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [label, value] of [["X", 200], ["Y", 250], ["Width", 300]] as const) await creation.getByLabel(label, { exact: true }).fill(String(value));
  await creation.getByRole("button", { name: "Create line", exact: true }).click();
  const stroke = page.getByRole("group", { name: "Stroke", exact: true }), profile = stroke.getByLabel("Width profile", { exact: true });
  await stroke.getByLabel("Stroke weight", { exact: true }).fill("40"); await stroke.getByRole("button", { name: "Apply stroke weight", exact: true }).click();
  await stroke.getByText("Advanced stroke", { exact: true }).click();
  for (const preset of ["uniform", "wedge", "taper", "eye", "rounded", "pinch"]) { await profile.selectOption(preset); await expect(profile).toHaveValue(preset); }
  await profile.selectOption("wedge"); await stroke.getByRole("button", { name: "Flip width profile", exact: true }).click(); await expect(profile).toHaveValue("custom");
  await page.getByLabel("Design canvas", { exact: true }).focus(); await page.keyboard.press("ControlOrMeta+z"); await expect(profile).toHaveValue("wedge");
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await expect(profile).toHaveValue("custom");
  await expect(page.getByLabel("Design canvas", { exact: true })).toHaveScreenshot("width-profile-flipped.png", { animations: "disabled", maxDiffPixels: 0 });
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const bytes = await readFile((await (await download).path())!), opened = await decodeFigcraft(bytes);
  expect(Object.values(opened.document.nodes).find(n => n.kind === "line")).toMatchObject({ stroke: { widthProfile: { points: [{ t: 0, scale: 0, bias: 0 }, { t: 1, scale: 1, bias: 0 }] } } });
  await profile.selectOption("uniform"); await expect(profile).toHaveValue("uniform");
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "profile.figcraft", mimeType: "application/octet-stream", buffer: bytes });
  await page.getByRole("button", { name: "Replace document", exact: true }).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload();
  await page.getByRole("region", { name: "Layers", exact: true }).getByRole("button", { name: "Line", exact: true }).click();
  await stroke.getByText("Advanced stroke", { exact: true }).click(); await expect(profile).toHaveValue("custom");
  const malformed = JSON.parse(strFromU8(unzipSync(bytes)["document.json"]), (key, value: unknown) => key === "width_profile" ? { points: null } : value) as unknown;
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "invalid-profile.figcraft", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(malformed)) });
  await page.getByRole("button", { name: "Replace document", exact: true }).click();
  await expect(page.locator("main [role=alert]")).toContainText("Width profile points must be an array"); await expect(profile).toHaveValue("custom");
  await page.setViewportSize({ width: 390, height: 844 });
  await profile.scrollIntoViewIfNeeded(); const bounds = (await profile.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await profile.selectOption("eye"); await expect(profile).toHaveValue("eye");
  await page.screenshot({ path: "test-results/width-profile-mobile.png", fullPage: true });
});

test("width profiles preserve whole-stroke mixed selection and atomic undo", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true }), stroke = page.getByRole("group", { name: "Stroke", exact: true });
  await creation.getByRole("button", { name: "Create line", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Profile first"); await page.getByRole("button", { name: "Apply layer", exact: true }).click();
  await stroke.getByText("Advanced stroke", { exact: true }).click(); await stroke.getByLabel("Width profile", { exact: true }).selectOption("wedge");
  await creation.getByRole("button", { name: "Create line", exact: true }).click();
  await page.getByRole("button", { name: "Profile first", exact: true }).click({ modifiers: ["Shift"] });
  await stroke.getByText("Advanced stroke", { exact: true }).click(); const profile = stroke.getByLabel("Width profile", { exact: true });
  await expect(profile).toHaveValue("mixed"); await stroke.getByRole("button", { name: "Flip width profile", exact: true }).click(); await expect(profile).toHaveValue("mixed");
  await profile.selectOption("eye"); await expect(profile).toHaveValue("eye");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(profile).toHaveValue("mixed");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const opened = await decodeFigcraft(await readFile((await (await download).path())!));
  const lines = Object.values(opened.document.nodes).filter(n => n.kind === "line");
  expect(lines[0].stroke?.widthProfile?.points.map(p => p.scale)).toEqual([1, 0]); expect(lines[1].stroke?.widthProfile).toBeUndefined();
});

test("brush presets and scatter controls preserve profiles, files, recovery and mobile access", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [label, value] of [["X", 200], ["Y", 250], ["Width", 300]] as const) await creation.getByLabel(label, { exact: true }).fill(String(value));
  await creation.getByRole("button", { name: "Create line", exact: true }).click();
  const stroke = page.getByRole("group", { name: "Stroke", exact: true }), brush = stroke.getByLabel("Brush", { exact: true });
  await stroke.getByLabel("Stroke weight", { exact: true }).fill("20"); await stroke.getByRole("button", { name: "Apply stroke weight", exact: true }).click();
  await stroke.getByText("Advanced stroke", { exact: true }).click();
  for (const preset of ["taper", "ink", "ribbon", "bristle", "dots", "stars", "confetti", "leaves"]) {
    await brush.selectOption(preset); await expect(brush).toHaveValue(preset);
    await expect(stroke.getByLabel("Brush spacing", { exact: true })).toHaveCount(["dots", "stars", "confetti", "leaves"].includes(preset) ? 1 : 0);
  }
  await brush.selectOption("dots");
  const fields = [["Brush spacing", "2"], ["Brush scatter", "0.5"], ["Brush size jitter (%)", "25"], ["Brush rotation jitter (%)", "40"]] as const;
  for (const [label, value] of fields) { await stroke.getByLabel(label, { exact: true }).fill(value); await stroke.getByRole("button", { name: `Apply ${label.toLowerCase()}`, exact: true }).click(); }
  await stroke.getByLabel("Width profile", { exact: true }).selectOption("eye");
  await brush.selectOption("none"); await expect(stroke.getByLabel("Width profile", { exact: true })).toHaveValue("eye");
  await page.getByLabel("Design canvas", { exact: true }).focus(); await page.keyboard.press("ControlOrMeta+z"); await expect(brush).toHaveValue("dots");
  await expect(page.getByLabel("Design canvas", { exact: true })).toHaveScreenshot("brush-scatter-profile.png", { animations: "disabled", maxDiffPixels: 0 });
  await stroke.getByLabel("Brush spacing", { exact: true }).fill("0"); await stroke.getByRole("button", { name: "Apply brush spacing", exact: true }).click();
  expect(await stroke.getByLabel("Brush spacing", { exact: true }).evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)).toBe(true);
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const bytes = await readFile((await (await download).path())!), opened = await decodeFigcraft(bytes);
  expect(Object.values(opened.document.nodes).find(n => n.kind === "line")).toMatchObject({ stroke: { brush: { preset: "dots", spacing: 2, scatter: .5, sizeJitter: .25, rotationJitter: .4, seed: 0 }, widthProfile: { points: [{ t: 0, scale: 0, bias: 0 }, { t: .5, scale: 1, bias: 0 }, { t: 1, scale: 0, bias: 0 }] } } });
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload();
  await page.getByRole("region", { name: "Layers", exact: true }).getByRole("button", { name: "Line", exact: true }).click(); await stroke.getByText("Advanced stroke", { exact: true }).click();
  await expect(brush).toHaveValue("dots"); for (const [label, value] of fields) await expect(stroke.getByLabel(label, { exact: true })).toHaveValue(value);
  const malformed = JSON.parse(strFromU8(unzipSync(bytes)["document.json"]), (key, value: unknown) => key === "brush" ? { preset: "dots", seed: -1 } : value) as unknown;
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "invalid-brush.figcraft", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(malformed)) });
  await page.getByRole("button", { name: "Replace document", exact: true }).click(); await expect(page.locator("main [role=alert]")).toContainText("Brush seed"); await expect(brush).toHaveValue("dots");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [label] of fields) { const input = stroke.getByLabel(label, { exact: true }); await input.scrollIntoViewIfNeeded(); const bounds = (await input.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390); }
  await brush.selectOption("taper"); await expect(stroke.getByLabel("Brush spacing", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/brush-mobile.png", fullPage: true });
});

test("brush controls preserve Mixed and multi-layer undo", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true }), stroke = page.getByRole("group", { name: "Stroke", exact: true });
  await creation.getByRole("button", { name: "Create line", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Brush first"); await page.getByRole("button", { name: "Apply layer", exact: true }).click();
  await stroke.getByText("Advanced stroke", { exact: true }).click(); await stroke.getByLabel("Brush", { exact: true }).selectOption("dots");
  await creation.getByRole("button", { name: "Create line", exact: true }).click(); await stroke.getByText("Advanced stroke", { exact: true }).click(); await stroke.getByLabel("Brush", { exact: true }).selectOption("ink");
  await page.getByRole("button", { name: "Brush first", exact: true }).click({ modifiers: ["Shift"] }); await stroke.getByText("Advanced stroke", { exact: true }).click();
  const brush = stroke.getByLabel("Brush", { exact: true }); await expect(brush).toHaveValue("mixed"); await expect(stroke.getByLabel("Brush spacing", { exact: true })).toHaveCount(0);
  await brush.selectOption("stars"); await expect(brush).toHaveValue("stars"); await expect(stroke.getByLabel("Brush spacing", { exact: true })).toHaveValue("1.5");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(brush).toHaveValue("mixed");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const opened = await decodeFigcraft(await readFile((await (await download).path())!));
  expect(Object.values(opened.document.nodes).filter(n => n.kind === "line").map(n => n.stroke?.brush?.preset)).toEqual(["dots", "ink"]);
});

test("Flatten and Reverse preserve geometry, shortcuts, undo, native files and recovery", async ({ page }) => {
  await login(page); const creation = page.getByRole("group", { name: "Create layer", exact: true }), layers = page.getByRole("region", { name: "Layers", exact: true });
  for (const [label, value] of [["X", 200], ["Y", 200], ["Width", 160], ["Height", 100]] as const) await creation.getByLabel(label, { exact: true }).fill(String(value));
  await creation.getByRole("button", { name: "Create rectangle", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Vector source"); await page.getByRole("button", { name: "Apply layer", exact: true }).click();
  await creation.getByLabel("X", { exact: true }).fill("320"); await creation.getByLabel("Y", { exact: true }).fill("240"); await creation.getByRole("button", { name: "Create ellipse", exact: true }).click();
  await layers.getByRole("button", { name: "Vector source", exact: true }).click({ modifiers: ["Shift"] });
  await layers.getByRole("button", { name: "Flatten", exact: true }).click();
  const selected = page.getByRole("region", { name: "Selected vector", exact: true }); await expect(selected).toBeVisible();
  await expect(selected.getByLabel("Edit Width", { exact: true })).toHaveValue("280");
  // Flatten bounds the native0.01-tolerance ellipse cubics, not the original rectangular frame.
  expect(Number(await selected.getByLabel("Edit Height", { exact: true }).inputValue())).toBeCloseTo(140, 2);
  const canvas = page.getByLabel("Design canvas", { exact: true }); await canvas.focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect(layers.getByRole("button", { name: "Ellipse", exact: true })).toBeVisible();
  await page.keyboard.press("Alt+Shift+f"); await expect(selected).toBeVisible(); await expect(layers.getByRole("button", { name: "Ellipse", exact: true })).toHaveCount(0);
  await expect(canvas).toHaveScreenshot("vector-flatten.png", { animations: "disabled", maxDiffPixels: 0 });
  await selected.getByLabel("Edit Width", { exact: true }).fill("350"); await selected.getByRole("button", { name: "Apply geometry", exact: true }).click();
  await expect(selected.getByLabel("Edit Width", { exact: true })).toHaveValue("350");
  const save = async () => { const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click(); return decodeFigcraft(await readFile((await (await download).path())!)); };
  const before = await save(), original = Object.values(before.document.nodes).find(n => n.kind === "vector") as VectorNode;
  expect(original.network.regions).toHaveLength(2); expect(original.network.regions.every(r => r.paintSpace)).toBe(true);
  await layers.getByRole("button", { name: "Reverse path direction", exact: true }).click();
  const after = await save(), reversed = Object.values(after.document.nodes).find(n => n.kind === "vector") as VectorNode;
  expect(reversed.network.segments).toEqual(original.network.segments.map(s => ({ a: s.b, b: s.a, ta: s.tb, tb: s.ta })));
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+e"); await expect(selected).toBeVisible();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload();
  await layers.getByRole("button", { name: "Vector source", exact: true }).click(); await expect(selected.getByLabel("Edit Width", { exact: true })).toHaveValue("350");
  await expect(page.getByRole("button", { name: "Corner smoothing", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".figcraft-mobile-layers > summary").click();
  const mobile = page.locator(".figcraft-mobile-layers");
  for (const label of ["Flatten", "Reverse path direction"]) { const button = mobile.getByRole("button", { name: label, exact: true }); await button.scrollIntoViewIfNeeded(); const box = (await button.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390); }
  await page.screenshot({ path: "test-results/vector-mobile.png", fullPage: true });
});

test("vector point authoring supports captured drag, one undo, controls, native recovery and mobile", async ({ page }) => {
  await login(page);
  const creation = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [label, value] of [["X", 200], ["Y", 180], ["Width", 160], ["Height", 120]] as const) await creation.getByLabel(label, { exact: true }).fill(String(value));
  await creation.getByRole("button", { name: "Create rectangle", exact: true }).click();
  await page.getByRole("button", { name: "Edit vector", exact: true }).click();
  const panel = page.getByRole("group", { name: "Vector points", exact: true }), canvas = page.getByLabel("Design canvas", { exact: true });
  await expect(panel).toContainText("Select points to edit");
  await expect(page.getByRole("toolbar", { name: "Vector tools", exact: true })).toBeVisible();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  const start = await canvasPoint(page, 280, 180), end = await canvasPoint(page, 280, 140);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  const commits = await page.locator("[data-figcraft-editor]").getAttribute("data-commits");
  await page.mouse.move(end.x, end.y, { steps: 12 });
  expect(await page.locator("[data-figcraft-editor]").getAttribute("data-commits")).toBe(commits);
  await page.mouse.up(); await expect(panel.getByLabel("Point X", { exact: true })).toHaveValue("280");
  await expect(panel.getByLabel("Point Y", { exact: true })).toHaveValue("140");
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+z"); await expect(panel).toContainText("Select points to edit");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  const moved = await canvasPoint(page, 280, 140); await page.mouse.click(moved.x, moved.y);
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("Shift+ArrowDown");
  await expect(panel.getByLabel("Point X", { exact: true })).toHaveValue("281"); await expect(panel.getByLabel("Point Y", { exact: true })).toHaveValue("150");
  await panel.getByLabel("Point X", { exact: true }).fill("290"); await panel.getByLabel("Point Y", { exact: true }).fill("160");
  await panel.getByRole("button", { name: "Apply point position", exact: true }).click();
  await panel.getByRole("button", { name: "Smooth points", exact: true }).click();
  await panel.getByLabel("Handle mirroring", { exact: true }).selectOption("angleAndLength");
  await panel.getByLabel("Point corner radius", { exact: true }).fill("5"); await panel.getByRole("button", { name: "Apply point radius", exact: true }).click();
  await panel.getByLabel("Point end cap", { exact: true }).selectOption("round"); await panel.getByLabel("Point stroke join", { exact: true }).selectOption("bevel");
  await page.mouse.move(10, 10); await expect(canvas).toHaveScreenshot("vector-point-authoring.png", { animations: "disabled", maxDiffPixels: 0 });
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const saved = await decodeFigcraft(await readFile((await (await download).path())!)), node = Object.values(saved.document.nodes).find(n => n.kind === "vector") as VectorNode;
  expect(node.network.vertices).toHaveLength(5); expect(node.network.vertices[4]).toMatchObject({ radius: 5, cap: "round", join: "bevel", mirror: "angleAndLength" });
  const p = transformPoint(worldTransform(saved.document, node.id), node.network.vertices[4]); expect(p.x).toBeCloseTo(290, 8); expect(p.y).toBeCloseTo(160, 8);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload();
  await page.getByRole("region", { name: "Layers", exact: true }).getByRole("button", { name: "Rectangle", exact: true }).click();
  await canvas.focus(); await page.keyboard.press("Enter"); await expect(panel).toBeVisible();
  const recovered = await canvasPoint(page, 290, 160); await page.mouse.click(recovered.x, recovered.y);
  await expect(panel.getByLabel("Handle mirroring", { exact: true })).toHaveValue("angleAndLength");
  await expect(panel.getByLabel("Point corner radius", { exact: true })).toHaveValue("5");
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded(); await expect(panel).toBeVisible();
  for (const label of ["Point X", "Handle mirroring", "Point end cap"]) {
    const input = panel.getByLabel(label, { exact: true }); await input.scrollIntoViewIfNeeded(); const box = (await input.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: "test-results/vector-points-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Done editing", exact: true }).click(); await expect(panel).toHaveCount(0);
});

test("Pen creates one undoable path, continues in the same vector, saves and recovers", async ({ page }) => {
  await login(page); const canvas = page.getByLabel("Design canvas", { exact: true });
  const click = async (x: number, y: number) => { const p = await canvasPoint(page, x, y); await page.mouse.click(p.x, p.y); };
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Local recovery ready");
  const a = await canvasPoint(page, 150, 180), handle = await canvasPoint(page, 190, 180);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  const commits = await page.locator("[data-figcraft-editor]").getAttribute("data-commits");
  await page.mouse.move(handle.x, handle.y, { steps: 8 }); await page.mouse.up();
  await click(300, 280);
  expect(await page.locator("[data-figcraft-editor]").getAttribute("data-commits")).toBe(commits);
  const hover = await canvasPoint(page, 400, 240); await page.mouse.move(hover.x, hover.y);
  await expect(canvas).toHaveScreenshot("pen-open-path.png", { animations: "disabled", maxDiffPixels: 0 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("toolbar", { name: "Vector tools", exact: true }).getByRole("button", { name: "Pen", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ControlOrMeta+z"); await expect(page.getByRole("toolbar", { name: "Tools", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z"); await page.getByRole("button", { name: "Edit vector", exact: true }).click();
  await page.getByRole("toolbar", { name: "Vector tools", exact: true }).getByRole("button", { name: "Pen", exact: true }).click();
  await click(180, 400); await click(300, 400); await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Move points", exact: true })).toHaveAttribute("aria-pressed", "true");
  const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const decoded = await decodeFigcraft(await readFile((await (await downloading).path())!));
  const vectors = Object.values(decoded.document.nodes).filter((n): n is VectorNode => n.kind === "vector");
  expect(vectors).toHaveLength(1); expect(vectors[0].network.vertices).toHaveLength(4); expect(vectors[0].network.segments).toHaveLength(2);
  expect(vectors[0].network.segments[0].ta).toEqual([40, 0]); expect(vectors[0].fill).toBe("transparent");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload();
  await page.getByRole("region", { name: "Layers", exact: true }).getByRole("button", { name: "Vector", exact: true }).click();
  await page.getByRole("button", { name: "Edit vector", exact: true }).click();
  await page.getByRole("button", { name: "Select all points", exact: true }).click(); await expect(page.getByRole("group", { name: "Vector points", exact: true })).toContainText("4 selected points");
  await page.setViewportSize({ width: 390, height: 844 });
  const pen = page.getByRole("toolbar", { name: "Vector tools", exact: true }).getByRole("button", { name: "Pen", exact: true });
  await pen.scrollIntoViewIfNeeded(); const box = (await pen.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/pen-mobile.png", fullPage: true });
});

test("Pen closes, resumes endpoints and double-clicks without stray layers", async ({ page }) => {
  await login(page); const canvas = page.getByLabel("Design canvas", { exact: true });
  const click = async (x: number, y: number) => { const p = await canvasPoint(page, x, y); await page.mouse.click(p.x, p.y); };
  await canvas.focus(); await page.keyboard.press("p");
  await click(150, 180); await click(250, 180); await click(250, 280); await click(150, 180);
  await expect(page.getByRole("toolbar", { name: "Tools", exact: true }).getByRole("button", { name: "Pen", exact: true })).toHaveAttribute("aria-pressed", "true");
  await click(350, 380); await click(500, 380); await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Move points", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter"); await page.keyboard.press("p"); await click(500, 380); await click(600, 450);
  await page.keyboard.press("Escape"); await expect(page.getByRole("toolbar", { name: "Vector tools", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await page.keyboard.press("p");
  const p = await canvasPoint(page, 420, 380); await page.mouse.dblclick(p.x, p.y);
  await expect(page.getByRole("button", { name: "Move points", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter"); await page.keyboard.press("p"); await click(700, 180); await click(800, 250); await page.keyboard.press("ControlOrMeta+z");
  const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const decoded = await decodeFigcraft(await readFile((await (await downloading).path())!));
  const vectors = Object.values(decoded.document.nodes).filter((n): n is VectorNode => n.kind === "vector");
  expect(vectors).toHaveLength(2); expect(vectors[0].network.vertices).toHaveLength(3); expect(vectors[0].network.regions).toHaveLength(1); expect(vectors[0].fill).toBe("#d9d9d9");
  expect(vectors[1].network.vertices).toHaveLength(3); expect(vectors[1].network.segments).toHaveLength(2); expect(vectors[1].network.regions).toEqual([]);
});

test("Pen anchor undo and redo preserve earlier anchors, handles and document history", async ({ page }) => {
  await login(page); const canvas = page.getByLabel("Design canvas", { exact: true }), undo = page.getByRole("button", { name: "Undo", exact: true }), redo = page.getByRole("button", { name: "Redo", exact: true });
  const at = (x: number, y: number) => canvasPoint(page, x, y);
  const click = async (x: number, y: number) => { const p = await at(x, y); await page.mouse.click(p.x, p.y); };
  await expect(undo).toBeDisabled(); await canvas.focus(); await page.keyboard.press("p");
  const start = await at(150, 180), handle = await at(180, 180); await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(handle.x, handle.y); await page.mouse.up();
  await expect(undo).toBeEnabled(); await expect(redo).toBeDisabled(); const commits = await page.locator("[data-figcraft-editor]").getAttribute("data-commits");
  await click(300, 240); await click(400, 350); await page.keyboard.press("ControlOrMeta+z"); await expect(redo).toBeEnabled();
  await undo.click(); await expect(undo).toBeEnabled();
  await expect(canvas).toHaveScreenshot("pen-undo-one-anchor.png", { animations: "disabled", maxDiffPixels: 0 });
  await redo.click(); await canvas.focus(); await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(redo).toBeDisabled(); await page.keyboard.press("ControlOrMeta+z"); await click(420, 300); await expect(redo).toBeDisabled();
  expect(await page.locator("[data-figcraft-editor]").getAttribute("data-commits")).toBe(commits);
  await page.keyboard.press("Enter"); await expect(page.getByText("1 layer", { exact: true })).toBeVisible(); await undo.click();
  await expect(page.getByText("0 layers", { exact: true })).toBeVisible(); await redo.click(); await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const decoded = await decodeFigcraft(await readFile((await (await downloading).path())!)), vector = Object.values(decoded.document.nodes).find((n): n is VectorNode => n.kind === "vector")!;
  const matrix = worldTransform(decoded.document, vector.id); expect(vector.network.vertices.map(v => transformPoint(matrix, v))).toEqual([{ x: 150, y: 180 }, { x: 300, y: 240 }, { x: 420, y: 300 }]);
  expect(vector.network.segments[0].ta).toEqual([30, 0]);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload(); await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const control of [undo, redo]) { const box = (await control.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390); }
});

test("Pencil draws without React updates, commits once, saves and recovers", async ({ page }) => {
  await login(page); const canvas = page.getByLabel("Design canvas", { exact: true });
  await canvas.focus(); await page.keyboard.press("Shift+p");
  const pencil = page.getByRole("button", { name: "Pencil", exact: true }); await expect(pencil).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Local recovery ready");
  const start = await canvasPoint(page, 150, 180); await page.mouse.move(start.x, start.y); await page.mouse.down();
  const commits = await page.locator("[data-figcraft-editor]").getAttribute("data-commits");
  for (const [x, y] of [[300, 180], [300, 300], [450, 240]]) { const p = await canvasPoint(page, x, y); await page.mouse.move(p.x, p.y, { steps: 10 }); }
  expect(await page.locator("[data-figcraft-editor]").getAttribute("data-commits")).toBe(commits);
  await expectCanvasPixel(page, 220, 180, [0, 0, 0, 255]);
  await expect(canvas).toHaveScreenshot("pencil-preview.png", { animations: "disabled", maxDiffPixels: 0 });
  await page.mouse.up(); await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  await expect(pencil).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ControlOrMeta+z"); await expect(page.getByText("0 layers", { exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z"); await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const decoded = await decodeFigcraft(await readFile((await (await downloading).path())!));
  const vectors = Object.values(decoded.document.nodes).filter((n): n is VectorNode => n.kind === "vector");
  expect(vectors).toHaveLength(1); const node = vectors[0];
  expect(node).toMatchObject({ fill: "transparent", stroke: { weight: 2, capStart: "round", capEnd: "round", join: "round", align: "center" } });
  expect(node.stroke?.widthProfile).toBeUndefined(); expect(node.network.regions).toEqual([]);
  const world = worldTransform(decoded.document, node.id), first = transformPoint(world, node.network.vertices[0]), last = transformPoint(world, node.network.vertices.at(-1)!);
  expect(first.x).toBeCloseTo(150, 8); expect(first.y).toBeCloseTo(180, 8); expect(last.x).toBeCloseTo(450, 8); expect(last.y).toBeCloseTo(240, 8);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload();
  await expect(page.getByText("1 layer", { exact: true })).toBeVisible(); await resetCanvasOrigin(page);
  await expectCanvasPixel(page, 220, 180, [0, 0, 0, 255]);
  await page.mouse.move(10, 10); await expect(canvas).toHaveScreenshot("pencil-completed.png", { animations: "disabled", maxDiffPixels: 0 });
  await page.setViewportSize({ width: 390, height: 844 }); await pencil.scrollIntoViewIfNeeded();
  const box = (await pencil.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  await pencil.click(); await expect(pencil).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/pencil-mobile.png", fullPage: true });
});

test("Pencil cancels clicks and interrupted strokes and preserves capture across zoom", async ({ page }) => {
  await login(page); const canvas = page.getByLabel("Design canvas", { exact: true });
  await page.getByRole("button", { name: "Pencil", exact: true }).click();
  const start = await canvasPoint(page, 150, 180), end = await canvasPoint(page, 300, 240);
  await page.mouse.click(start.x, start.y); await expect(page.getByText("0 layers", { exact: true })).toBeVisible();
  for (const key of ["Escape", "ControlOrMeta+z", "v"]) {
    await page.keyboard.press("Shift+p"); await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 }); await page.keyboard.press(key); await page.mouse.up();
    await expect(page.getByText("0 layers", { exact: true })).toBeVisible();
  }
  for (const interruption of ["pointercancel", "releaseCapture"] as const) {
    await page.keyboard.press("Shift+p"); await page.mouse.move(start.x, start.y);
    await canvas.evaluate(node => { node.addEventListener("pointerdown", event => { node.setAttribute("data-test-pointer", String((event as PointerEvent).pointerId)); }, { once: true }); });
    await page.mouse.down(); const pointerId = Number(await canvas.getAttribute("data-test-pointer")); await page.mouse.move(end.x, end.y);
    if (interruption === "pointercancel") await canvas.dispatchEvent("pointercancel", { pointerId, pointerType: "mouse" });
    else await canvas.evaluate((node, id) => node.releasePointerCapture(id), pointerId);
    await page.mouse.move(end.x + 10, end.y); await page.mouse.up();
    await expect(page.getByText("0 layers", { exact: true })).toBeVisible();
  }
  await page.keyboard.press("Shift+p"); await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.keyboard.press("+"); await expect(canvas).not.toHaveAttribute("data-view-zoom", "1");
  const final = await canvasPoint(page, 400, 260); await page.mouse.move(final.x, final.y); await page.mouse.up();
  await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z"); await expect(page.getByText("0 layers", { exact: true })).toBeVisible();
  // These half-unit page positions are visible integer screen pixels at 200%. Pencil ignores
  // pixel snapping and Shift's angle constraint, unlike the neighbouring shape/Pen tools.
  await expect(page.getByRole("button", { name: "Snap to pixel grid", exact: true })).toHaveAttribute("aria-pressed", "true");
  const next = await canvasPoint(page, 410.5, 300.5); await page.mouse.move(next.x, next.y); await page.keyboard.down("Shift"); await page.mouse.down();
  const nextEnd = await canvasPoint(page, 479.5, 329.5); await page.mouse.move(nextEnd.x, nextEnd.y); await page.mouse.up(); await page.keyboard.up("Shift");
  await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const decoded = await decodeFigcraft(await readFile((await (await downloading).path())!));
  const vector = Object.values(decoded.document.nodes).find((node): node is VectorNode => node.kind === "vector")!;
  const matrix = worldTransform(decoded.document, vector.id);
  expect(transformPoint(matrix, vector.network.vertices[0])).toEqual({ x: 410.5, y: 300.5 });
  expect(transformPoint(matrix, vector.network.vertices.at(-1)!)).toEqual({ x: 479.5, y: 329.5 });
});

test("Pencil preview is black with native zoom weight and one-screen-pixel floor", async ({ page }) => {
  await login(page); const canvas = page.getByLabel("Design canvas", { exact: true });
  await page.getByRole("button", { name: "Pencil", exact: true }).click();
  for (const [zoom, weight] of [[1, 2], [.25, 1]]) {
    if (zoom === .25) { await page.getByRole("button", { name: "Zoom out", exact: true }).click({ clickCount: 1 }); await page.getByRole("button", { name: "Zoom out", exact: true }).click(); }
    await expect(canvas).toHaveAttribute("data-view-zoom", String(zoom)); const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 120, box.y + 250); await page.mouse.down(); await page.mouse.move(box.x + 320, box.y + 250);
    // Summed darkness across the antialiased horizontal cross-section measures actual screen width.
    await expect.poll(() => canvas.evaluate((node: HTMLCanvasElement) => {
      const ctx = node.getContext("2d")!, bg = ctx.getImageData(220, 240, 1, 1).data[0], data = ctx.getImageData(220, 245, 1, 11).data;
      let width = 0; for (let i = 0; i < data.length; i += 4) { if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) return -1; width += 1 - data[i] / bg; } return width;
    })).toBeCloseTo(weight, 1);
    await page.keyboard.press("Escape"); await page.mouse.up(); await expect(page.getByText("0 layers", { exact: true })).toBeVisible();
  }
});

test("Pencil records browser pen pressure and persists the tapered stroke", async ({ page, context }) => {
  await login(page); await page.getByRole("button", { name: "Pencil", exact: true }).click();
  const session = await context.newCDPSession(page);
  const send = async (type: "mousePressed" | "mouseMoved" | "mouseReleased", x: number, force: number) => {
    const point = await canvasPoint(page, x, 220);
    await session.send("Input.dispatchMouseEvent", { type, ...point, pointerType: "pen", button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1, force });
  };
  await send("mousePressed", 150, .25); await send("mouseMoved", 250, .5); await send("mouseMoved", 350, 1); await send("mouseReleased", 450, 0); await session.detach();
  await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const decoded = await decodeFigcraft(await readFile((await (await downloading).path())!));
  const node = Object.values(decoded.document.nodes).find((n): n is VectorNode => n.kind === "vector")!;
  expect(node.stroke?.widthProfile?.points).toHaveLength(4);
  expect(node.stroke?.widthProfile?.points.map(p => p.scale)).toEqual([.5, 1, 2, .1]);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload(); await resetCanvasOrigin(page);
  await page.mouse.move(10, 10); await expect(page.getByLabel("Design canvas", { exact: true })).toHaveScreenshot("pencil-pressure.png", { animations: "disabled", maxDiffPixels: 0 });
});

test("vector point dimensions, shared box gestures and snapping controls survive undo and recovery", async ({ page }) => {
  const engine = new EditorEngine();
  engine.execute("vector.create", { name: "Snap target", points: [[500, 180], [600, 280], [520, 240]], closed: true });
  engine.execute("shape.rectangle", { name: "Point transforms", x: 200, y: 180, width: 160, height: 120 });
  await login(page); await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "transforms.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(await engine.nativeSnapshot()) });
  await resetCanvasOrigin(page);
  const layers = page.getByRole("region", { name: "Layers", exact: true }), canvas = page.getByLabel("Design canvas", { exact: true });
  await layers.getByRole("button", { name: "Point transforms", exact: true }).click(); await page.getByRole("button", { name: "Edit vector", exact: true }).click();
  const panel = page.getByRole("group", { name: "Vector points", exact: true });
  await panel.getByRole("button", { name: "Select all points", exact: true }).click();
  await expect(panel.getByLabel("Point width", { exact: true })).toHaveValue("160");
  await panel.getByLabel("Point width", { exact: true }).fill("80"); await panel.getByLabel("Point height", { exact: true }).fill("80");
  await panel.getByRole("button", { name: "Apply point dimensions", exact: true }).click();
  const drag = async (from: [number, number], to: [number, number]) => {
    await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
    const a = await canvasPoint(page, ...from), b = await canvasPoint(page, ...to);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); const commits = await page.locator("[data-figcraft-editor]").getAttribute("data-commits");
    await page.mouse.move(b.x, b.y, { steps: 8 }); expect(await page.locator("[data-figcraft-editor]").getAttribute("data-commits")).toBe(commits); await page.mouse.up();
  };
  await drag([280, 220], [320, 220]); await expect(panel.getByLabel("Point width", { exact: true })).toHaveValue("120");
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+z"); await expect(panel.getByLabel("Point width", { exact: true })).toHaveValue("80");
  await page.keyboard.press("ControlOrMeta+Shift+z"); await expect(panel.getByLabel("Point width", { exact: true })).toHaveValue("120");
  await page.mouse.move(10, 10); await expect(canvas).toHaveScreenshot("vector-point-box.png", { animations: "disabled", maxDiffPixels: 0 });
  await drag([330, 170], [310, 290]); expect(Number(await panel.getByLabel("Point width", { exact: true }).inputValue())).toBeCloseTo(80, 7);
  expect(Number(await panel.getByLabel("Point height", { exact: true }).inputValue())).toBeCloseTo(120, 7);
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+z");
  const corner = await canvasPoint(page, 320, 260); await page.mouse.click(corner.x, corner.y);
  // A second click after clearing the selection isolates this point.
  const empty = await canvasPoint(page, 440, 380); await page.mouse.click(empty.x, empty.y); await page.mouse.click(corner.x, corner.y);
  await expect(panel).toContainText("1 selected point"); await drag([320, 260], [518, 242]);
  await expect(panel.getByLabel("Point X", { exact: true })).toHaveValue("520"); await expect(panel.getByLabel("Point Y", { exact: true })).toHaveValue("240");
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+z");
  for (const name of ["Snap to objects", "Snap to pixel grid"]) {
    const button = page.getByRole("button", { name, exact: true }); await expect(button).toHaveAttribute("aria-pressed", "true"); await button.click(); await expect(button).toHaveAttribute("aria-pressed", "false");
  }
  await drag([320, 260], [518, 242]); await expect(panel.getByLabel("Point X", { exact: true })).toHaveValue("518"); await expect(panel.getByLabel("Point Y", { exact: true })).toHaveValue("242");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const saved = await decodeFigcraft(await readFile((await (await download).path())!));
  const n = Object.values(saved.document.nodes).find(n => n.name === "Point transforms") as VectorNode;
  const savedPoint = transformPoint(worldTransform(saved.document, n.id), n.network.vertices[2]); expect(savedPoint).toEqual({ x: 518, y: 242 });
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload();
  await layers.getByRole("button", { name: "Point transforms", exact: true }).click(); await page.getByRole("button", { name: "Edit vector", exact: true }).click();
  await panel.getByRole("button", { name: "Select all points", exact: true }).click(); await expect(panel.getByLabel("Point width", { exact: true })).toHaveValue("318");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const label of ["Point width", "Point height"]) { const input = panel.getByLabel(label, { exact: true }); await input.scrollIntoViewIfNeeded(); const b = (await input.boundingBox())!; expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(390); }
  await page.screenshot({ path: "test-results/vector-point-transforms-mobile.png", fullPage: true });
  // Changing height must not submit and clamp an untouched, already-wide vector's width.
  await page.setViewportSize({ width: 1440, height: 900 });
  const wide = new EditorEngine(); wide.execute("vector.create", { name: "Wide path", points: [[0, 0], [2e7, 10]] });
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "wide.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(await wide.nativeSnapshot()) });
  await page.getByRole("button", { name: "Replace document", exact: true }).click();
  await layers.getByRole("button", { name: "Wide path", exact: true }).click(); await page.getByRole("button", { name: "Edit vector", exact: true }).click();
  await panel.getByRole("button", { name: "Select all points", exact: true }).click();
  await expect(panel.getByLabel("Point width", { exact: true })).toHaveValue("20000000");
  await panel.getByLabel("Point height", { exact: true }).fill("20"); await panel.getByRole("button", { name: "Apply point dimensions", exact: true }).click();
  await expect(panel.getByLabel("Point width", { exact: true })).toHaveValue("20000000"); await expect(panel.getByLabel("Point height", { exact: true })).toHaveValue("20");
});

test("vector Bend, double-click entry, Escape and point deletion use editor keyboard routing", async ({ page }) => {
  await login(page); const engine = new EditorEngine();
  engine.execute("vector.create", { name: "Editable path", path: "M0 0L50 30L100 0", x: 200, y: 200 });
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "points.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(await engine.nativeSnapshot()) });
  const canvas = page.getByLabel("Design canvas", { exact: true }); await resetCanvasOrigin(page);
  const p = await canvasPoint(page, 250, 230); await page.mouse.dblclick(p.x, p.y);
  const panel = page.getByRole("group", { name: "Vector points", exact: true }); await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Bend", exact: true }).click(); await page.mouse.click(p.x, p.y);
  await expect(panel.getByLabel("Handle mirroring", { exact: true })).toHaveValue("angle");
  await page.mouse.click(p.x, p.y); await expect(panel.getByLabel("Handle mirroring", { exact: true })).toHaveValue("none");
  await panel.getByRole("button", { name: "Smooth points", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(panel.getByLabel("Handle mirroring", { exact: true })).toHaveValue("angle");
  await panel.getByRole("button", { name: "Sharpen points", exact: true }).click();
  await canvas.focus(); await page.keyboard.press("v"); await expect(page.getByRole("button", { name: "Move points", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Shift+Delete"); await expect(panel).toContainText("Select points to edit");
  await page.keyboard.press("ControlOrMeta+a"); await expect(panel).toContainText("2 selected points");
  await page.keyboard.press("ControlOrMeta+z"); await page.keyboard.press("ControlOrMeta+a"); await expect(panel).toContainText("3 selected points");
  await page.keyboard.press("Escape"); await expect(panel).toHaveCount(0); await expect(page.getByRole("region", { name: "Selected vector", exact: true })).toBeVisible();
});

test("native open vectors and even-odd regions support canvas selection, caps and atomic file errors", async ({ page }) => {
  const engine = new EditorEngine();
  engine.execute("vector.create", { name: "Open curve", x: 200, y: 200, path: "M0 0C60 0 100 100 160 100", props: { fill: null, stroke: "black", strokeWeight: 8 } });
  const id = String(engine.execute("vector.create", { name: "Ring", x: 450, y: 200, path: "M0 0H160V160H0Z M40 40H120V120H40Z", props: { fill: "red" } }).id);
  const doc = engine.getSnapshot().document, ring = doc.nodes[id] as VectorNode;
  const bytes = Buffer.from(await encodeFigcraft({ ...doc, nodes: { ...doc.nodes, [id]: { ...ring, network: freezeNetwork({ ...ring.network, regions: ring.network.regions.map(r => ({ ...r, winding: "evenOdd" })) }) } } }));
  await login(page); await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "vector.figcraft", mimeType: "application/octet-stream", buffer: bytes });
  const layers = page.getByRole("region", { name: "Layers", exact: true }); await expect(layers.getByRole("button", { name: "Ring", exact: true })).toBeVisible(); await resetCanvasOrigin(page);
  const canvas = page.getByLabel("Design canvas", { exact: true }), bounds = (await canvas.boundingBox())!;
  await page.mouse.click(bounds.x + 530, bounds.y + 280); await expect(page.getByRole("region", { name: "Selected vector", exact: true })).toHaveCount(0);
  await page.mouse.click(bounds.x + 465, bounds.y + 215); await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Ring");
  await page.mouse.click(bounds.x + 280, bounds.y + 250); await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Open curve");
  const stroke = page.getByRole("group", { name: "Stroke", exact: true }); await stroke.getByText("Advanced stroke", { exact: true }).click();
  await stroke.getByLabel("End cap", { exact: true }).selectOption("diamondFilled"); await expect(stroke.getByLabel("End cap", { exact: true })).toHaveValue("diamondFilled");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const saved = await readFile((await (await download).path())!); const parsed = await decodeFigcraft(saved);
  expect(Object.values(parsed.document.nodes).find(n => n.name === "Open curve")).toMatchObject({ stroke: { capEnd: "diamondFilled" } });
  const malformed = JSON.parse(strFromU8(unzipSync(saved)["document.json"])) as { nodes: Record<string, { type: string; network?: { vertices: unknown } }> };
  const vector = Object.values(malformed.nodes).find(n => n.type === "vector")!; vector.network!.vertices = null;
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "invalid-vector.figcraft", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(malformed)) });
  await expect(page.locator("main [role=alert]")).toContainText("Vector metadata must be an array");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Open curve"); await expect(stroke.getByLabel("End cap", { exact: true })).toHaveValue("diamondFilled");
});

test("fractional layer targets win over pixels during move, resize and draw", async ({ page }) => {
  const e = new EditorEngine();
  e.execute("shape.rectangle", { name: "Target", x: 100, y: 100, width: 11, height: 11 });
  const id = String(e.execute("shape.rectangle", { name: "Moving", x: 300, y: 300, width: 100, height: 100 }).id);
  await login(page);
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "priority.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(await e.nativeSnapshot()) });
  const moving = page.getByRole("region", { name: "Layers", exact: true }).getByRole("button", { name: "Moving", exact: true });
  await expect(moving).toBeVisible(); await resetCanvasOrigin(page); await moving.click();
  const drag = async (x: number, y: number, xx: number, yy: number, guide = false) => {
    const a = await canvasPoint(page, x, y), b = await canvasPoint(page, xx, yy);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 });
    if (guide) await expectCanvasPixel(page, 105, 200, [242, 72, 34, 255]);
    await page.mouse.up();
  };
  await drag(350, 350, 106, 352, true);
  await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("55.5");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await drag(300, 350, 106, 350);
  await expect(page.getByLabel("Edit Width", { exact: true })).toHaveValue("294.5");
  const canvas = page.getByLabel("Design canvas", { exact: true }); await canvas.focus(); await page.keyboard.press("r");
  await drag(150, 200, 106, 240);
  await expect(page.getByLabel("Edit Width", { exact: true })).toHaveValue("44.5");
  const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const { document } = await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.nodes[id]).toMatchObject({ x: 105.5, y: 300, width: 294.5, height: 100 });
  expect(Object.values(document.nodes).find(n => n.name === "Rectangle")).toMatchObject({ x: 105.5, y: 200, width: 44.5, height: 40 });
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload(); await moving.click(); await expect(page.getByLabel("Edit X", { exact: true })).toHaveValue("105.5");
});

test("layer reorder changes nested paint order and survives undo, native save and recovery", async ({ page }) => {
  const engine = new EditorEngine();
  const frame = String(engine.execute("frame.create", { name: "Artwork", x: 80, y: 80, width: 200, height: 160 }).id);
  const rect = (name: string, fill: string) => String(engine.execute("shape.rectangle", {
    name, parent: frame, x: 20, y: 20, width: 100, height: 80, props: { fill },
  }).id);
  const red = rect("Red", "#ff0000"), blue = rect("Blue", "#0000ff");
  await login(page);
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "reorder.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(await engine.nativeSnapshot()) });
  const list = page.getByRole("list", { name: "Children of Artwork" }), redButton = list.getByRole("button", { name: "Red", exact: true });
  await expect(redButton).toBeVisible(); await resetCanvasOrigin(page);
  await expectCanvasPixel(page, 140, 130, [0, 0, 255, 255]); await redButton.click();
  const up = page.getByRole("button", { name: "Move layer up", exact: true });
  await up.click(); await expect(up).toBeDisabled();
  await expectCanvasPixel(page, 140, 130, [255, 0, 0, 255]);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(up).toBeEnabled();
  await expectCanvasPixel(page, 140, 130, [0, 0, 255, 255]);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expectCanvasPixel(page, 140, 130, [255, 0, 0, 255]);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Red");
  const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
  const { document } = await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.nodes[frame]).toMatchObject({ children: [blue, red] });
  expect(document.nodes[red]).toMatchObject({ parent: frame, x: 20, y: 20 });
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload();
  await expect(redButton).toBeVisible(); await resetCanvasOrigin(page); await expectCanvasPixel(page, 140, 130, [255, 0, 0, 255]);
  await redButton.click(); await page.getByRole("button", { name: "Move layer down", exact: true }).click();
  await expectCanvasPixel(page, 140, 130, [0, 0, 255, 255]);
});

test("join shortcuts reconnect a hole, preserve its winding and save smooth tangents", async ({ page }) => {
  const e = new EditorEngine();
  const id = String(e.execute("vector.create", { name: "Ring", x: 200, y: 160, path: "M0 0H100V100H0Z M25 25V75H75V25Z", props: { fill: "#ff0000" } }).id);
  const line = String(e.execute("vector.create", { name: "Open path", x: 400, y: 200, points: [[0,0],[50,0],[50,50]] }).id);
  const doc = e.getSnapshot().document, ring = doc.nodes[id] as VectorNode;
  // Remove one hole corner and its two incident edges. Its loop still owns the surviving pair.
  const net = ring.network, corner = net.vertices.findIndex(v => v.x === 75 && v.y === 25);
  const { deleteVertices } = await import("../../src/engine/vector-edit-ops");
  const open = deleteVertices(net, [corner]);
  const file = await encodeFigcraft({ ...doc, nodes: { ...doc.nodes, [id]: { ...ring, network: open } } });
  await login(page); await page.getByLabel("Open Figcraft file", {exact:true}).setInputFiles({ name:"join.figcraft", mimeType:"application/octet-stream", buffer:Buffer.from(file) });
  const layers = page.getByRole("region",{ name:"Layers",exact:true }), canvas = page.getByLabel("Design canvas",{exact:true});
  const ringButton = layers.getByRole("button",{ name:"Ring",exact:true });
  await expect(ringButton).toBeVisible(); await resetCanvasOrigin(page); await ringButton.click();
  await page.getByRole("button",{name:"Edit vector",exact:true}).click();
  const click = async (x: number, y: number) => { const at = await canvasPoint(page,x,y); await page.mouse.click(at.x, at.y); };
  await click(225,185); await page.keyboard.down("Shift"); await click(275,235); await page.keyboard.up("Shift");
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+j");
  const save = async () => {
    const downloading = page.waitForEvent("download"); await page.getByRole("button",{name:"Save as",exact:true}).click();
    return (await decodeFigcraft(await readFile((await (await downloading).path())!))).document;
  };
  const closed = (await save()).nodes[id] as VectorNode;
  expect(closed.network.regions).toHaveLength(1); expect(closed.network.regions[0].loops.map(loop=>loop.length)).toEqual([4,3]);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  expect(((await save()).nodes[id] as VectorNode).network.segments).toHaveLength(open.segments.length);
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+Shift+j");
  const smooth = ((await save()).nodes[id] as VectorNode).network;
  expect(smooth.regions[0].loops.map(loop=>loop.length)).toEqual([4,3]);
  expect(Math.hypot(...smooth.segments.at(-1)!.ta)).toBeGreaterThan(0);
  await page.getByRole("button",{name:"Done editing",exact:true}).click();
  await layers.getByRole("button",{name:"Open path",exact:true}).click();
  await layers.getByRole("button",{name:"Join selection",exact:true}).click();
  expect(((await save()).nodes[line] as VectorNode).network.regions[0].loops).toEqual([[0,1,2]]);
  await expectCanvasPixel(page,210,210,[255,0,0,255]);
  const background = await canvas.evaluate((node: HTMLCanvasElement) => Array.from(node.getContext("2d")!.getImageData(175,220,1,1).data));
  await expectCanvasPixel(page,240,220,background);
  const capture = await canvasPoint(page,190,150);
  await expect(page).toHaveScreenshot("join-reconnected-hole.png", { clip: { x:capture.x, y:capture.y, width:120, height:120 }, animations:"disabled", maxDiffPixels:0 });
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload(); await resetCanvasOrigin(page);
  const recovered = (await save()).nodes[id] as VectorNode;
  expect(recovered.network).toEqual(smooth);
  await page.setViewportSize({width:390,height:844}); await page.locator(".figcraft-mobile-layers > summary").click();
  for(const label of ["Join selection","Smooth join selection"]) {
    const button = page.locator(".figcraft-mobile-layers").getByRole("button",{ name:label,exact:true });
    await button.scrollIntoViewIfNeeded(); const box = (await button.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(390);
  }
});

test("variable width authors both sides on canvas, edits the inspector and restores the native profile", async ({ page }) => {
  const e = new EditorEngine();
  const id = String(e.execute("vector.create", { name: "Width sample", x: 200, y: 200, points: [[0,0],[150,0]], closed: false }).id);
  e.execute("node.set", { id, props: { strokes: ["#303030"], strokeWeight: 10, strokeAlign: "center" } });
  await login(page);
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "width.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(await encodeFigcraft(e.getSnapshot().document)) });
  const layers = page.getByRole("region", { name: "Layers", exact: true });
  const canvas = page.getByLabel("Design canvas", { exact: true });
  await expect(layers.getByRole("button", { name: "Width sample", exact: true })).toBeVisible();
  await resetCanvasOrigin(page); await layers.getByRole("button", { name: "Width sample", exact: true }).click();
  await page.getByRole("button", { name: "Edit vector", exact: true }).click(); await canvas.focus(); await page.keyboard.press("Shift+w");
  const tool = page.getByRole("button", { name: "Variable width", exact: true });
  await expect(tool).toHaveAttribute("aria-pressed", "true"); await expect(page.getByText("Drag the stroke to add a width point")).toBeVisible();
  const at = await canvasPoint(page, 275, 200);
  await page.mouse.move(at.x, at.y + 1); await page.mouse.down(); await page.keyboard.down("Alt");
  await page.mouse.move(at.x, at.y + 25, { steps: 5 }); await page.mouse.up(); await page.keyboard.up("Alt");
  const group = page.getByRole("group", { name: "Width point", exact: true });
  const left = group.getByLabel("Left side width"), right = group.getByLabel("Right side width");
  await expect(left).toHaveValue("5"); await expect(right).toHaveValue("25");
  await left.fill("12"); await left.press("Enter"); await expect(group.getByLabel("Width", { exact: true })).toHaveValue("37");
  const position = group.getByLabel("Position (%)"); await position.fill("60"); await position.press("Enter"); await expect(position).toHaveValue("60");
  await page.mouse.move(at.x + 50, at.y + 54);
  const clip = await canvasPoint(page,184,162);
  await expect(page).toHaveScreenshot("asymmetric-width-handles.png", { clip: { x: clip.x, y: clip.y, width: 182, height: 78 }, animations: "disabled", maxDiffPixels: 0 });
  await canvas.focus(); await page.keyboard.press("Delete"); await expect(page.getByText("Drag the stroke to add a width point")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const save = async () => {
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
    const file = await decodeFigcraft(await readFile((await (await download).path())!));
    return (file.document.nodes[id] as VectorNode).stroke?.widthProfile;
  };
  const profile = await save(); expect(profile?.points).toHaveLength(3);
  const p = profile!.points[1]; expect(p.t).toBeCloseTo(.6); expect(p.scale * (1-p.bias)*5).toBeCloseTo(12); expect(p.scale * (1+p.bias)*5).toBeCloseTo(25);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload();
  expect(await save()).toEqual(profile);
  await layers.getByRole("button", { name: "Width sample", exact: true }).click(); await page.getByRole("button", { name: "Edit vector", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await tool.scrollIntoViewIfNeeded(); await tool.click(); await expect(tool).toHaveAttribute("aria-pressed", "true");
  const button = (await tool.boundingBox())!; expect(button.x).toBeGreaterThanOrEqual(0); expect(button.x + button.width).toBeLessThanOrEqual(390);
});

test("closed vectors smooth their painted corners and preserve authored points on undo and recovery", async ({ page }) => {
  const engine = new EditorEngine();
  const id = String(engine.execute("vector.create", { name: "Closed corners", x: 165, y: 120, path: "M0 0H1800V1800H0Z" }).id);
  engine.execute("node.set", { id, props: { fill: "#ff0000", cornerRadius: 400 } });
  engine.execute("vector.create", { name: "Open corners", x: 40, y: 450, path: "M0 0L40 0L40 50" });
  await login(page);
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "corners.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(await encodeFigcraft(engine.getSnapshot().document)) });
  const layers = page.getByRole("region", { name: "Layers", exact: true });
  const closed = layers.getByRole("button", { name: "Closed corners", exact: true }), open = layers.getByRole("button", { name: "Open corners", exact: true });
  await expect(closed).toBeVisible(); await resetCanvasOrigin(page); await open.click();
  await expect(page.getByRole("button", { name: "Corner smoothing", exact: true })).toHaveCount(0);
  await closed.click();
  const canvas = page.getByLabel("Design canvas", { exact: true });
  const firstRed = () => canvas.evaluate((node: HTMLCanvasElement) => {
    const row = node.getContext("2d")!.getImageData(165, 160, 450, 1).data;
    for (let i = 0; i < row.length; i += 4) if (row[i] === 255 && row[i+1] === 0 && row[i+2] === 0) return i/4;
    throw new Error("Missing red contour");
  });
  const plain = await firstRed();
  await page.getByRole("button", { name: "Corner smoothing", exact: true }).click();
  const smooth = page.getByLabel("Corner smoothing", { exact: true });
  await smooth.fill("100"); await page.getByRole("button", { name: "Apply corner smoothing" }).click();
  await expect.poll(firstRed).toBeGreaterThan(plain + 4);
  const edge = await firstRed();
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect.poll(firstRed).toBe(plain);
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await expect.poll(firstRed).toBe(edge);
  const click = async (x:number, y:number) => { const point = await canvasPoint(page,x,y); await page.mouse.click(point.x,point.y); };
  await click(100,260); await click(165 + Math.floor((edge + plain)/2),160);
  await expect(layers.locator('li[aria-current="true"]')).toHaveCount(0);
  await click(500,400); await expect(layers.locator('li[aria-current="true"]')).toHaveAttribute("data-layer-id",id);
  await click(100,260); await page.mouse.move(10,10);
  const unselectedEdge = await firstRed();
  const crop = await canvasPoint(page,157,112);
  await expect(page).toHaveScreenshot("closed-vector-smoothed-corner.png", { clip: { x: crop.x, y: crop.y, width: 435, height: 285 }, animations: "disabled", maxDiffPixels: 0 });
  const save = async () => {
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact:true }).click();
    const file = await decodeFigcraft(await readFile((await (await download).path())!)); return file.document.nodes[id] as VectorNode;
  };
  const saved = await save(); expect(saved.corners?.smoothing).toBe(1); expect(saved.network.vertices.map(v=>v.radius)).toEqual([400,400,400,400]); expect(saved.network.segments).toHaveLength(4);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload(); await resetCanvasOrigin(page);
  const recovered = await save(); expect(recovered.network).toEqual(saved.network); expect(recovered.corners).toEqual(saved.corners);
  await expect.poll(firstRed).toBe(unselectedEdge);
  await closed.click(); await page.setViewportSize({ width:390,height:844 });
  const control = page.getByRole("button", { name: "Corner smoothing", exact:true }); await control.scrollIntoViewIfNeeded();
  const bounds=(await control.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
  if (await control.getAttribute("aria-expanded") !== "true") await control.click();
  await page.getByRole("button", { name: "iOS", exact: true }).click(); await expect(smooth).toHaveValue("60");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(smooth).toHaveValue("100");
});

test("Paint bucket hatches a face, previews a drag and recovers independent native regions", async ({ page }) => {
  const engine = new EditorEngine();
  const id = String(engine.execute("shape.rectangle", { name: "Bucket square", x: 150, y: 125, width: 100, height: 100, props: { fill: "#ff0000" } }).id);
  engine.execute("vector.edit.begin", { id });
  engine.execute("vector.edit.connect", { a: 0, b: 2 });
  const file = await encodeFigcraft(engine.getRenderDocument());
  await login(page);
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "faces.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(file) });
  const layer = page.getByRole("region", { name: "Layers", exact: true }).getByRole("button", { name: "Bucket square", exact: true });
  await expect(layer).toBeVisible(); await resetCanvasOrigin(page); await layer.click();
  await page.getByRole("button", { name: "Edit vector", exact: true }).click();
  const canvas = page.getByLabel("Design canvas", { exact: true });
  const bucket = page.getByRole("button", { name: "Paint bucket", exact: true });
  await canvas.focus(); await page.keyboard.press("b"); await expect(bucket).toHaveAttribute("aria-pressed", "true");
  const upper = await canvasPoint(page, 225, 150), lower = await canvasPoint(page, 175, 200);
  const background = await canvas.evaluate((el: HTMLCanvasElement) => Array.from(el.getContext("2d")!.getImageData(120, 115, 1, 1).data));
  const save = async () => {
    const promise = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
    return (await decodeFigcraft(await readFile((await (await promise).path())!))).document.nodes[id] as VectorNode;
  };
  await page.mouse.move(upper.x, upper.y);
  const topLeft = await canvasPoint(page, 140, 115);
  await expect(page).toHaveScreenshot("paint-bucket-face-hover.png", { clip: { ...topLeft, width: 120, height: 120 }, animations: "disabled", maxDiffPixels: 0 });
  await page.mouse.down(); await page.mouse.move(lower.x, lower.y); await page.keyboard.press("Escape"); await page.mouse.up();
  await page.mouse.move(0, 0);
  await expectCanvasPixel(page, 225, 150, [255, 0, 0, 255]); await expectCanvasPixel(page, 175, 200, [255, 0, 0, 255]);
  await page.mouse.move(upper.x, upper.y); await page.mouse.down(); await page.mouse.move(lower.x, lower.y); await page.mouse.up();
  await page.mouse.move(0, 0); await expectCanvasPixel(page, 225, 150, background); await expectCanvasPixel(page, 175, 200, background);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectCanvasPixel(page, 225, 150, [255, 0, 0, 255]); await expectCanvasPixel(page, 175, 200, [255, 0, 0, 255]);
  await canvas.focus(); await page.keyboard.press("Shift+b"); await expect(bucket).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(upper.x, upper.y); await page.mouse.move(0, 0);
  await expectCanvasPixel(page, 225, 150, background); await expectCanvasPixel(page, 175, 200, [255, 0, 0, 255]);
  const saved = (await save()).network;
  expect(saved.regions).toHaveLength(1); expect(saved.regions[0].loops[0]).toHaveLength(3);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload(); await resetCanvasOrigin(page);
  expect((await save()).network).toEqual(saved);
  await layer.click(); await page.getByRole("button", { name: "Edit vector", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await bucket.scrollIntoViewIfNeeded(); await bucket.click(); await expect(bucket).toHaveAttribute("aria-pressed", "true");
});

test("painted region hover, Shift selection, drag undo and recovery", async ({ page }) => {
  const engine = new EditorEngine();
  const id = String(engine.execute("vector.create", { name: "Region with hole", x: 140, y: 110,
    path: "M0 0H160V160H0Z M50 50H110V110H50Z", props: { fill: "#ff0000" } }).id);
  const doc = engine.getRenderDocument(), node = doc.nodes[id] as VectorNode;
  const network = freezeNetwork({ ...node.network, regions: [{ ...node.network.regions[0], winding: "evenOdd" }] });
  const file = await encodeFigcraft({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, network } } });
  await login(page);
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "region.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(file) });
  const layer = page.getByRole("region", { name: "Layers", exact: true }).getByRole("button", { name: "Region with hole", exact: true });
  await expect(layer).toBeVisible(); await resetCanvasOrigin(page); await layer.click();
  await page.getByRole("button", { name: "Edit vector", exact: true }).click();
  const canvas = page.getByLabel("Design canvas", { exact: true });
  const coloured = await canvasPoint(page, 170, 140), hole = await canvasPoint(page, 220, 190);
  const sample = () => canvas.evaluate((el: HTMLCanvasElement) => {
    const pixels = el.getContext("2d")!.getImageData(155, 125, 25, 25).data;
    let marks = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 2] > 30) marks++;
    return marks;
  });
  await page.mouse.move(hole.x, hole.y); await expect.poll(sample).toBe(0);
  await page.mouse.move(coloured.x, coloured.y); await expect.poll(sample).toBeGreaterThan(25);
  const crop = await canvasPoint(page, 130, 100);
  await expect(page).toHaveScreenshot("painted-vector-region-hole.png", { clip: { ...crop, width: 180, height: 180 }, animations: "disabled", maxDiffPixels: 0 });
  await page.mouse.move(0, 0); await expect.poll(sample).toBe(0);
  await page.mouse.click(coloured.x, coloured.y); await page.mouse.move(0, 0); await expect.poll(sample).toBeGreaterThan(25);
  await page.keyboard.down("Shift"); await page.mouse.click(coloured.x, coloured.y); await page.keyboard.up("Shift");
  await page.mouse.move(0, 0); await expect.poll(sample).toBe(0);
  const save = async () => {
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
    return (await decodeFigcraft(await readFile((await (await download).path())!))).document.nodes[id] as VectorNode;
  };
  for (const cancel of [true, false]) {
    await page.mouse.move(coloured.x, coloured.y); await page.mouse.down(); await page.mouse.move(coloured.x + 30, coloured.y + 20, { steps: 4 });
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
    if (cancel) expect((await save()).x).toBe(140);
  }
  const moved = await save(); expect(moved.x).toBe(170); expect(moved.y).toBe(130); expect(moved.network.regions).toEqual(network.regions);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); expect((await save()).x).toBe(140);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload(); await expect(layer).toBeVisible();
  const recovered = await save(); expect(recovered.x).toBe(170); expect(recovered.network).toEqual(moved.network);
  await layer.click(); await page.getByRole("button", { name: "Edit vector", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Fit selection", exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  const spot = await canvasPoint(page, 200, 160);
  const bounds = (await canvas.boundingBox())!;
  expect(spot.x).toBeGreaterThan(bounds.x); expect(spot.x).toBeLessThan(bounds.x + bounds.width);
  await page.mouse.click(spot.x, spot.y); await page.mouse.move(0, 0);
  expect((await save()).network).toEqual(moved.network);
});

test("selected region fills show mixed stacks, edit independently and survive native recovery", async ({ page }) => {
  const engine = new EditorEngine(), id = String(engine.execute("vector.create", { x: 120, y: 120, name: "Fill regions",
    path: "M0 0H80V80H0Z M100 0H180V80H100Z", props: { fill: "#ff0000" } }).id);
  const doc = engine.getSnapshot().document, node = doc.nodes[id] as VectorNode;
  const regions = node.network.regions[0].loops.map(loop => ({ winding: "nonZero" as const, loops: [loop] }));
  const bytes = await encodeFigcraft({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, network: { ...node.network, regions } } } });
  await login(page);
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "fills.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(bytes) });
  const layer = page.getByRole("region", { name: "Layers", exact: true }).getByRole("button", { name: "Fill regions", exact: true });
  await expect(layer).toBeVisible(); await resetCanvasOrigin(page); await layer.click();
  await page.getByRole("button", { name: "Edit vector", exact: true }).click();
  const left = await canvasPoint(page, 150, 155), right = await canvasPoint(page, 250, 155);
  const panel = page.getByRole("region", { name: "Appearance", exact: true });
  const fill = panel.getByLabel("Fill 1 CSS colour", { exact: true }), opacity = panel.getByLabel("Fill 1 opacity", { exact: true });
  const clickRegion = async (p: { x: number; y: number }, shift = false) => {
    if (shift) await page.keyboard.down("Shift"); await page.mouse.click(p.x, p.y); if (shift) await page.keyboard.up("Shift");
  };
  await clickRegion(right); await fill.fill("#0000ff"); await panel.getByRole("button", { name: "Apply fill 1" }).click();
  await panel.getByRole("button", { name: "Add fill" }).click();
  await fill.fill("#00ff00"); await opacity.fill("0.5"); await panel.getByRole("button", { name: "Apply fill 1" }).click();
  await panel.getByRole("button", { name: "Move fill 1 down" }).click();
  await expect(opacity).toHaveValue("1");
  await panel.getByLabel("Fill 2 CSS colour", { exact: true }).click({ button: "right" }); await panel.getByRole("button", { name: "Copy fill" }).click();
  await clickRegion(left, true); await expect(panel.getByText("Click + to replace mixed content")).toBeVisible();
  await expect(fill).toHaveCount(0);
  await expect(panel.getByRole("group", { name: "Fills", exact: true })).toHaveScreenshot("mixed-vector-region-fills.png", { animations: "disabled", maxDiffPixels: 0 });
  await clickRegion(right, true); await expect(fill).toBeVisible();
  await fill.focus(); await page.keyboard.press("Shift+F10"); await panel.getByRole("button", { name: "Paste fill" }).click();
  await expect(opacity).toHaveValue("0.5");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(opacity).toHaveValue("1");
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await expect(opacity).toHaveValue("0.5");
  await page.getByRole("button", { name: "Done editing", exact: true }).click();
  // The right region's opaque top blue paint masks its green underlay.
  await expectCanvasPixel(page, 250, 155, [0, 0, 255, 255]);
  const crop = await canvasPoint(page, 112, 112);
  await expect(page).toHaveScreenshot("independent-vector-region-fills.png", { clip: { ...crop, width: 196, height: 96 }, animations: "disabled", maxDiffPixels: 0 });
  const save = async () => {
    const pending = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
    return (await decodeFigcraft(await readFile((await (await pending).path())!))).document.nodes[id] as VectorNode;
  };
  const saved = await save(); expect(saved.fill).toBe("#ff0000"); expect(saved.network.regions.map(r => r.fills?.length)).toEqual([1, 2]);
  expect(saved.network.regions[0].fills![0]).toEqual(saved.network.regions[1].fills![0]);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload(); await expect(layer).toBeVisible();
  expect((await save()).network).toEqual(saved.network);
  await layer.click(); await page.getByRole("button", { name: "Edit vector", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("button", { name: "Fit selection", exact: true }).click();
  const canvas = page.getByLabel("Design canvas", { exact: true }); await canvas.scrollIntoViewIfNeeded();
  await clickRegion(await canvasPoint(page, 250, 155));
  const remove = panel.getByRole("button", { name: "Remove fill 1" }); await remove.scrollIntoViewIfNeeded(); await remove.click();
  await expect(opacity).toHaveValue("0.5"); expect((await save()).network.regions[1].fills).toHaveLength(1);
});

test("Lasso selects points, Cut separates layers, and Eraser previews and recovers a native gap", async ({ page }) => {
  const engine = new EditorEngine(), id = String(engine.execute("shape.rectangle", { name: "Cut and erase", x: 150, y: 120, width: 120, height: 100, props: { fill: "#e44c45", strokes: ["#222222"], strokeWeight: 2 } }).id);
  engine.execute("vector.edit.begin", { id });
  const bytes = await engine.nativeSnapshot();
  await login(page); await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "cut.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(bytes) });
  const layers = page.getByRole("region", { name: "Layers", exact: true });
  const row = layers.getByRole("button", { name: "Cut and erase", exact: true });
  await expect(row).toHaveCount(1); await resetCanvasOrigin(page); await row.click();
  await page.getByRole("button", { name: "Edit vector", exact: true }).click();
  const canvas = page.getByLabel("Design canvas", { exact: true });
  const tool = (name: string) => page.getByRole("toolbar", { name: "Vector tools" }).getByRole("button", { name, exact: true });
  const move = async (x: number, y: number) => { const p = await canvasPoint(page, x, y); await page.mouse.move(p.x, p.y); };
  const key = async (shortcut: string, name: string) => { await canvas.focus(); await page.keyboard.press(shortcut); await expect(tool(name)).toHaveAttribute("aria-pressed", "true"); };
  const save = async () => {
    const pending = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
    return (await decodeFigcraft(await readFile((await (await pending).path())!))).document;
  };
  const clip = { ...await canvasPoint(page, 130, 99), width: 165, height: 142 };
  await key("q", "Lasso"); await move(140, 110); await page.mouse.down();
  await move(280, 110); await move(280, 135); await move(140, 135);
  await expect(page).toHaveScreenshot("lasso-two-vector-points.png", { clip, animations: "disabled", maxDiffPixels: 0 });
  await page.mouse.up();
  await key("x", "Cut"); await move(210, 108); await page.mouse.down(); await move(210, 232);
  await expect(page).toHaveScreenshot("vector-cut-line.png", { clip, animations: "disabled", maxDiffPixels: 0 });
  await page.keyboard.press("Escape"); await page.mouse.up(); await expect(row).toHaveCount(1);
  await move(210,108); await page.mouse.down(); await move(210,232); await page.mouse.up(); await expect(row).toHaveCount(2);
  const cut = await save(), pieces = Object.values(cut.nodes).filter((n): n is VectorNode => n.kind === "vector");
  expect(pieces).toHaveLength(2); expect(pieces.map(p => Math.round(p.width))).toEqual([60,60]); expect(pieces.every(p => p.network.regions.length === 1)).toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(row).toHaveCount(1);
  await key("Shift+e", "Eraser"); await move(210, 120);
  await expect(page).toHaveScreenshot("vector-eraser-brush.png", { clip, animations: "disabled", maxDiffPixels: 0 });
  await page.mouse.down(); await move(210, 136); await page.keyboard.press("Escape"); await page.mouse.up();
  expect(((await save()).nodes[id] as VectorNode).network.segments).toHaveLength(4);
  await move(210, 115); await page.mouse.down(); await move(210, 125); await page.mouse.up();
  const erased = ((await save()).nodes[id] as VectorNode).network; expect(erased.segments).toHaveLength(5);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); expect(((await save()).nodes[id] as VectorNode).network.segments).toHaveLength(4);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload(); await expect(row).toBeVisible();
  expect(((await save()).nodes[id] as VectorNode).network).toEqual(erased);
  await row.click(); await page.getByRole("button", { name: "Edit vector", exact: true }).click(); await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["Lasso", "Cut", "Eraser"]) {
    await tool(name).scrollIntoViewIfNeeded(); await tool(name).click(); await expect(tool(name)).toHaveAttribute("aria-pressed", "true");
  }
});

test("winding and reversed inner loops retain holes and native geometry in the authenticated editor", async ({ page }) => {
  const engine = new EditorEngine(), id = String(engine.execute("vector.create", { x: 100, y: 100, path: "M0 0H100V100H0Z M25 25H75V75H25Z" }).id);
  engine.execute("node.set", { id, props: { fill: "#008844" } });
  await login(page);
  for (const state of ["evenOdd", "nonZero", "reverseLoop"] as const) {
    if (state === "reverseLoop") engine.execute("vector.reverseLoop", { id, region: 0, loop: 1 });
    else engine.execute("vector.fillRule", { id, rule: state });
    const document = engine.getSnapshot().document;
    await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: state + ".figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(await engine.nativeSnapshot()) });
    await resetCanvasOrigin(page);
    await expectCanvasPixel(page, 110, 150, [0,136,68,255]);
    await expectCanvasPixel(page, 150, 150, state === "nonZero" ? [0,136,68,255] : [245,245,245,255]);
    const saved = page.waitForEvent("download"); await page.getByRole("button", { name: "Save as", exact: true }).click();
    const decoded = await decodeFigcraft(await readFile((await (await saved).path())!));
    expect((decoded.document.nodes[id] as VectorNode).network).toEqual((document.nodes[id] as VectorNode).network);
  }
  const origin = await canvasPoint(page, 94, 94);
  await expect(page).toHaveScreenshot("vector-winding-hole.png", { clip: { ...origin, width: 112, height: 112 }, animations: "disabled", maxDiffPixels: 0 });
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload(); await resetCanvasOrigin(page); await expectCanvasPixel(page, 150, 150, [245,245,245,255]);
});
