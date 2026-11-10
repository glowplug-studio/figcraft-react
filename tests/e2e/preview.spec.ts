import { expectSolid } from "../fixtures/expect-solid";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { chromium, expect, test, type Page } from "@playwright/test";
import { localSupabase } from "../support/localSupabase";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { rectanglePaints, type RectangleNode, type VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { freezeNetwork } from "../../src/engine/vector-network";
import { transformPoint } from "../../src/engine/affine";
import { worldTransform } from "../../src/engine/hierarchy";
import { starPoints } from "../../src/engine/polygon";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

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
test.afterAll(async () => {
  if (!backend || !userId) return;
  // This suite creates its own local account. A failed workflow can leave an
  // upload whose Auth owner would otherwise be removed before Storage cleanup.
  const storage = backend.admin.storage.from("figcraft-files");
  for (;;) {
    const objects = await storage.list(userId, {limit: 100});
    if (objects.error) throw objects.error;
    if (!objects.data.length) break;
    const removed = await storage.remove(objects.data.map(object => userId + "/" + object.name));
    if (removed.error) throw removed.error;
  }
  const deleted = await backend.admin.auth.admin.deleteUser(userId);
  if (deleted.error) throw deleted.error;
});
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

test("signed-in ownership finalisation validates the staged archive and safely retries", async ({ page }) => {
  await login(page);
  const url = backend?.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = backend?.key ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Set the hosted Supabase URL and publishable key for the ownership fixture");
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const id = randomUUID(), path = signedIn.data.user.id + "/" + id + ".figcraft";
  const oversized = randomUUID(), oversizedPath = signedIn.data.user.id + "/" + oversized + ".figcraft";
  const storage = client.storage.from("figcraft-files");
  const archive = unzipSync(await readFile(new URL("../fixtures/native-pdf-print-dialog.zip", import.meta.url)));
  const upload = await storage.upload(path, archive["Cover.figcraft"], { contentType: "application/octet-stream" });
  expect(upload.error).toBeNull();
  try {
    const publish = (target = id) => page.evaluate(async id => {
      const result = await fetch("/api/online-files", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      return { status: result.status, data: await result.json() };
    }, target);
    const first = await publish();
    expect(first.status).toBe(200);
    expect(first.data).toEqual({ id, name: "Untitled", created: expect.any(String) });
    expect(await publish()).toEqual(first);
    const members = unzipSync(archive["Cover.figcraft"]);
    const drawing = JSON.parse(strFromU8(members["document.json"]));
    drawing.nodes["2"].plugin_data = { note: "x".repeat(16 * 1024 * 1024) };
    members["document.json"] = strToU8(JSON.stringify(drawing));
    const compressed = zipSync(members);
    expect(compressed.length).toBeLessThan(100_000);
    expect((await storage.upload(oversizedPath, compressed, {contentType: "application/octet-stream"})).error).toBeNull();
    expect((await publish(oversized)).status).toBe(422);
    const hidden = await client.from("online_files").select("id").eq("id", oversized);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
    const refused = await page.request.post("/api/online-files", { headers: { Origin: "https://unrelated.example" }, data: { id } });
    expect(refused.status()).toBe(403);
  } finally {
    expect((await storage.remove([path, oversizedPath])).error).toBeNull();
  }
});

// These local production checks use the host's normal operator settings.
const hourlyFixture = process.env.FIGCRAFT_E2E_HOURLY_LIMIT === "1";
if (hourlyFixture || process.env.FIGCRAFT_E2E_RETAINED_LIMIT === "1") {
  test(hourlyFixture ? "hourly publication limit survives removal and permits receipt recovery" :
    "retained file limit is shown in the editor and retry succeeds after capacity is freed", async ({page}) => {
    await login(page);
    if (!backend || !userId) throw new Error("The capacity fixture requires the local Supabase host");
    const storage = backend.admin.storage.from("figcraft-files");
    const paths = new Set<string>();
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/api/online-files" && request.method() === "POST") {
        const id = request.postDataJSON().id;
        paths.add(userId + "/" + id + ".figcraft");
      }
    });
    const bar = page.locator(".figcraft-document-bar");
    const form = page.getByRole("dialog", {name: "Publish to server", exact: true});
    const open = async (name: string) => {
      await bar.getByText("File", {exact: true}).click();
      await bar.getByRole("button", {name: "Publish to server…", exact: true}).click();
      await form.getByLabel("File name").fill(name);
      await form.getByRole("button", {name: "Publish", exact: true}).click();
    };
    try {
      await open("First capacity drawing");
      await expect(form).toHaveCount(0);
      const [first] = paths;
      if (hourlyFixture) {
        const retry = await page.evaluate(async id => {
          const result = await fetch("/api/online-files", {method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({id})});
          return {status: result.status, file: (await result.json()).id};
        }, first.split("/")[1].replace(".figcraft", ""));
        expect(retry).toEqual({status: 200, file: first.split("/")[1].replace(".figcraft", "")});
      }
      const refusal = page.waitForResponse(response => new URL(response.url()).pathname === "/api/online-files"
        && response.status() === (hourlyFixture ? 429 : 409));
      await open("Second capacity drawing");
      await refusal;
      const reason = hourlyFixture ? "Too many files published from your address lately: try again in an hour" :
        "Your address has reached its retained file limit";
      await expect(form.getByRole("alert")).toHaveText(reason);
      expect(paths.size).toBe(2);
      const list = () => backend!.admin.from("online_files").select("name").eq("owner_id", userId!);
      expect((await list()).data).toEqual([{name: "First capacity drawing"}]);
      expect((await storage.remove([first])).error).toBeNull();
      const retried = page.waitForResponse(response => new URL(response.url()).pathname === "/api/online-files");
      await form.getByRole("button", {name: "Publish", exact: true}).click();
      expect((await retried).status()).toBe(hourlyFixture ? 429 : 200);
      if (hourlyFixture) await expect(form.getByRole("alert")).toHaveText(reason);
      else await expect(form).toHaveCount(0);
      expect(paths.size).toBe(2);
      expect((await list()).data).toEqual(hourlyFixture ? [] : [{name: "Second capacity drawing"}]);
    } finally {
      if (paths.size) expect((await storage.remove([...paths])).error).toBeNull();
    }
  });
}

test("publish, reopen and manage a device-owned file in Home Online", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await login(page);
  const bar = page.locator(".figcraft-document-bar");
  const home = page.getByRole("region", { name: "Home", exact: true });
  const panel = home.getByRole("region", { name: "Online files", exact: true });
  const showList = async () => {
    await bar.getByRole("button", { name: "Home", exact: true }).click();
    await home.getByRole("button", { name: "Online", exact: true }).click();
  };
  const actions = (name: string) => panel.getByLabel("Actions for " + name, { exact: true });
  const publish = async (name: string) => {
    await bar.getByText("File", { exact: true }).click();
    await bar.getByRole("button", { name: "Publish to server…", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Publish to server", exact: true });
    await form.getByRole("button", {name: "About this server"}).click();
    await expect(form.getByText("Files nobody opens for 30 days are deleted.")).toBeVisible();
    await form.getByLabel("File name").fill(name);
    await form.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(form).toHaveCount(0);
  };
  const url = backend?.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = backend?.key ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Set the Supabase URL and publishable key for the ownership fixture");
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const paths: string[] = [];
  page.on("response", async response => {
    if (response.ok() && new URL(response.url()).pathname === "/api/online-files") {
      const row = await response.json();
      paths.push(signIn.data.user.id + "/" + row.id + ".figcraft");
    }
  });
  try {
    await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
    const firstJoin = page.waitForRequest(r => new URL(r.url()).pathname === "/api/online-files/join");
    await publish("Owner drawing");
    const sourceConnection = (await firstJoin).postDataJSON().tab;
    await bar.getByText("File", {exact:true}).click();
    await bar.getByRole("button", {name:"About this server"}).click();
    await expect(bar.getByText(/The server deletes this file if nobody opens it before .* UTC/)).toBeVisible();
    await bar.getByText("File", {exact:true}).click();
    await expect(bar.getByText(/Can edit/)).toBeVisible();
    const ownerGrant = async (tab: string) => {
      const row = await backend!.admin.from("online_file_connections").select("principal_id,online_file_links!inner(access_level)")
        .eq("id", tab).maybeSingle();
      expect(row.error).toBeNull();
      return row.data;
    };
    if (backend) expect(await ownerGrant(sourceConnection)).toMatchObject({
      principal_id: signIn.data.user.id, online_file_links: {access_level: "edit"},
    });
    await showList();
    await expect(panel.getByRole("button", { name: /^Owner drawing/ })).toBeEnabled();
    await expect(panel.locator("small")).toContainText(new URL(url).host + " · Not shared · Opened ");
    await expect(panel).toHaveScreenshot("online-files-owner.png", { mask: [panel.locator("small")], maskColor: "#e1e5e8" });
    await actions("Owner drawing").click();
    await panel.getByRole("button", { name: "Rename on the server…" }).click();
    const rename = page.getByRole("dialog", { name: "Rename on the server" });
    await rename.getByLabel("File name").fill("Server listing");
    await rename.getByRole("button", { name: "Rename", exact: true }).click();
    await panel.getByRole("button", { name: /^Server listing/ }).click();
    await expect(page.getByRole("tablist", { name: "Open files" })).toHaveCount(0);
    await page.reload();
    await expect(bar.getByRole("button", { name: "Home", exact: true })).toBeEnabled();
    await page.route("**/rest/v1/online_files?**", route => route.fulfill({ status: 400, json: { message: "offline fixture" } }));
    await showList();
    await expect(panel.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Server listing/ })).toBeVisible();
    await page.unroute("**/rest/v1/online_files?**");
    await panel.getByRole("button", { name: "Try again" }).click();
    await expect(panel.getByRole("button", { name: /^Server listing/ })).toBeEnabled();
    const nextJoin = page.waitForRequest(r => new URL(r.url()).pathname === "/api/online-files/join");
    await panel.getByRole("button", { name: /^Server listing/ }).click();
    const reopenedConnection = (await nextJoin).postDataJSON().tab;
    expect(reopenedConnection).not.toBe(sourceConnection);
    await expect(bar.getByText(/Can edit/)).toBeVisible();
    if (backend) expect(await ownerGrant(reopenedConnection)).toMatchObject({principal_id: signIn.data.user.id});
    await expect(bar.getByRole("heading", { name: "Owner drawing", exact: true })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveCount(2);
    await expect(page.getByRole("region", { name: "Layers", exact: true }).getByRole("button", { name: "Rectangle", exact: true })).toBeVisible();
    const other = await browser.newContext({ baseURL: new URL(page.url()).origin, storageState: await page.context().storageState() });
    try {
      const fresh = await other.newPage();
      await fresh.goto("/");
      await fresh.locator(".figcraft-document-bar").getByRole("button", { name: "Home", exact: true }).click();
      await fresh.getByRole("button", { name: "Online", exact: true }).click();
      await expect(fresh.getByText("Nothing online yet.")).toBeVisible();
    } finally { await other.close(); }
    await showList();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await actions("Server listing").click();
    await panel.getByRole("button", { name: "Remove from server…" }).click();
    const confirm = page.getByRole("dialog", { name: "Remove from server" });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(panel.getByRole("button", { name: /^Server listing/ })).toBeVisible();
    await panel.getByRole("button", { name: "Remove from server…" }).click();
    await confirm.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(panel.getByText("Nothing online yet.")).toBeVisible();
    expect((await client.from("online_files").select("id").eq("id", paths[0].split("/")[1].split(".")[0])).data).toEqual([]);
    await home.getByRole("button", { name: "Recents" }).click();
    await home.getByRole("button", { name: "Owner drawing", exact: true }).click();
    await publish("Forget me");
    await showList(); await actions("Forget me").click();
    await panel.getByRole("button", { name: "Forget on this computer" }).click();
    await expect(panel.getByText("Nothing online yet.")).toBeVisible();
    expect((await client.storage.from("figcraft-files").download(paths[1])).error).toBeNull();

    await home.getByRole("button", { name: "Recents" }).click();
    await home.getByRole("button", { name: "Owner drawing", exact: true }).click();
    await publish("Removed elsewhere");
    if (backend) {
      const thirdId = paths[2].split("/")[1].replace(".figcraft", "");
      const revoked = await backend.admin.from("online_file_links").delete().eq("file_id", thirdId).eq("access_level", "edit").select("id");
      expect(revoked.error).toBeNull();
      expect(revoked.data).toHaveLength(1);
      await expect(page.getByRole("tab", {name: /Owner drawing, disconnected from its live session/, selected: true})).toBeVisible({timeout: 15_000});
      await bar.getByText("File", {exact: true}).click();
      await bar.getByRole("button", {name: "Leave session"}).click();
      await showList();
      await panel.getByRole("button", {name: /^Removed elsewhere/}).click();
      await expect(panel.getByRole("alert")).toHaveText("The invite is unavailable");
      expect((await client.storage.from("figcraft-files").download(paths[2])).error).toBeNull();
      await home.getByRole("button", {name: "Recents"}).click();
      await home.getByRole("button", {name: "Owner drawing", exact: true}).click();
    }
    expect((await client.storage.from("figcraft-files").remove([paths[2]])).error).toBeNull();
    await showList();
    await expect(panel.getByRole("button", { name: /Removed elsewhere.*No longer on the server/ })).toBeDisabled();
    await actions("Removed elsewhere").click();
    await panel.getByRole("button", { name: "Clear from this list" }).click();
    await expect(panel.getByText("Nothing online yet.")).toBeVisible();
  } finally {
    if (paths.length) expect((await client.storage.from("figcraft-files").remove(paths)).error).toBeNull();
  }
});

for (const confirmed of [true, false]) {
  test("reload recovers an interrupted publication " + (confirmed ? "after" : "before") + " server confirmation", async ({ page }) => {
    await login(page);
    const url = backend?.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = backend?.key ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Configure Supabase for the interrupted publication fixture");
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const session = await client.auth.signInWithPassword({ email, password });
    if (session.error) throw session.error;
    const bar = page.locator(".figcraft-document-bar");
    const endpoint = "**/api/online-files";
    let fileId: string | undefined;
    let intercepted = 0;
    await page.route(endpoint, async route => {
      fileId = route.request().postDataJSON().id;
      intercepted++;
      if (confirmed) expect((await route.fetch()).ok()).toBe(true);
      await route.fulfill({ status: 503, json: { error: "fixture interrupted" } });
    });
    try {
      await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
      await bar.getByText("File", { exact: true }).click();
      await bar.getByRole("button", { name: "Publish to server…" }).click();
      const form = page.getByRole("dialog", { name: "Publish to server" });
      const name = "Interrupted drawing " + randomUUID();
      await form.getByLabel("File name").fill(name);
      await form.getByRole("button", { name: "Publish", exact: true }).click();
      await expect(form.getByRole("alert")).toBeVisible();
      expect(fileId).toBeTruthy();
      const listing = () => client.from("online_files").select("id").eq("name", name);
      expect((await listing()).data).toEqual(confirmed ? [{ id: fileId }] : []);
      const path = session.data.user.id + "/" + fileId + ".figcraft";
      const staged = await client.storage.from("figcraft-files").download(path);
      expect(staged.error).toBeNull();
      const original = Buffer.from(await staged.data!.arrayBuffer());
      if (!confirmed) {
        if (process.env.FIGCRAFT_VERIFY_STAGING_CLEANUP === "1") {
          const local = backend;
          if (!local) throw new Error("Scheduled staging cleanup requires the local fixture");
          test.setTimeout(22 * 60_000);
          const before = await local.admin.storage.from("figcraft-files").info(path);
          expect(before.error).toBeNull();
          await expect.poll(async () => {
            const row = await local.admin.storage.from("figcraft-files").info(path);
            return !!row.error && /not found|does not exist/i.test(row.error.message);
          }, {timeout:21 * 60_000, intervals:[5000]}).toBe(true);
        } else if (backend) {
          // Simulate cleanup between the failed finalisation and device recovery.
          const removed = await backend.admin.storage.from("figcraft-files").remove([path]);
          expect(removed.data).toHaveLength(1);
        }
      }
      await page.unroute(endpoint);
      await page.reload();
      await bar.getByRole("button", { name: "Home", exact: true }).click();
      await page.getByRole("button", { name: "Online", exact: true }).click();
      const panel = page.getByRole("region", { name: "Online files", exact: true });
      const row = panel.getByRole("button", { name: new RegExp("^" + name) });
      if (!confirmed) {
        await expect(row).toContainText("Publication unconfirmed");
        await expect(row).toBeDisabled();
        await panel.getByLabel("Actions for " + name).click();
        await panel.getByRole("button", { name: "Retry publication" }).click();
      }
      await expect(row).toBeEnabled();
      expect((await listing()).data).toEqual([{ id: fileId }]);
      await row.click();
      await expect(bar.getByRole("heading", { name, exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Layers" }).getByRole("button", { name: "Rectangle", exact: true })).toBeVisible();
      const reopened = await client.storage.from("figcraft-files").download(path);
      expect(Buffer.from(await reopened.data!.arrayBuffer()).equals(original)).toBe(true);
      expect(intercepted).toBe(1);
    } finally {
      if (fileId) {
        const removed = await client.storage.from("figcraft-files").remove([session.data.user.id + "/" + fileId + ".figcraft"]);
        expect(removed.error).toBeNull();
      }
    }
  });
}

test("owner sharing retries a lost reply and rotates three roles from Home Online", async ({page}) => {
  test.setTimeout(90_000);
  await login(page);
  const origin = new URL(page.url()).origin;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {origin});
  const bar = page.locator(".figcraft-document-bar");
  let dropped = false;
  const endpoint = "**/api/online-files/sharing";
  await page.route(endpoint, async route => {
    const body = route.request().postDataJSON();
    if (body.action !== "change" || dropped) return route.continue();
    const receipt = await route.fetch();
    expect(receipt.ok()).toBe(true);
    dropped = true;
    await route.fulfill({status: 503, json: {error: "Fixture discarded the acknowledgement"}});
  });
  await bar.getByText("Share", {exact: true}).click();
  await bar.getByRole("button", {name: "Start sharing", exact: true}).click();
  await expect(bar.getByRole("button", {name: "Retry start sharing"})).toBeEnabled();
  expect(dropped).toBe(true);
  await page.unroute(endpoint);
  await bar.getByRole("button", {name: "Retry start sharing"}).click();
  await expect(bar.getByRole("button", {name: "Stop sharing"})).toBeEnabled();
  const codes = new Set<string>();
  for (const access of ["edit", "view", "comment"]) {
    await bar.getByLabel("Access", {exact: true}).selectOption(access);
    const code = await bar.getByLabel("Join code").innerText();
    expect(code).toMatch(/^([0-9A-Z]{3}-){2}[0-9A-Z]{3}$/);
    await bar.getByRole("button", {name: "Copy code", exact: true}).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(code);
    codes.add(code);
  }
  expect(codes.size).toBe(3);
  await bar.getByRole("button", {name: "Copy link", exact: true}).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(origin + "/#join=");
  await bar.getByText("Share", {exact: true}).click();
  await bar.getByRole("button", {name: "Home", exact: true}).click();
  await page.getByRole("button", {name: "Online", exact: true}).click();
  const panel = page.getByRole("region", {name: "Online files", exact: true});
  await expect(panel.locator("small")).toContainText("Shared · Opened");
  await page.setViewportSize({width: 390, height: 844});
  await panel.getByLabel("Actions for Untitled").click();
  await panel.getByRole("button", {name: "Stop sharing"}).click();
  await expect(panel.locator("small")).toContainText("Not shared · Opened");
  await panel.getByRole("button", {name: "Start sharing"}).click();
  await expect(panel.getByRole("button", {name: "Stop sharing"})).toBeEnabled();
  expect(codes.has(await panel.getByLabel("Join code").innerText())).toBe(false);
  if (backend && userId) {
    const listing = await backend.admin.from("online_files").select("id").eq("owner_id", userId).eq("name", "Untitled").single();
    expect(listing.error).toBeNull();
    const revoked = await backend.admin.from("online_file_links").delete().eq("file_id", listing.data!.id).eq("label", "Shared (edit)").select("id");
    expect(revoked.data).toHaveLength(1);
    const home = page.getByRole("region", {name: "Home", exact: true});
    await home.getByRole("button", {name: "Recents", exact: true}).click();
    await home.getByRole("button", {name: "Online", exact: true}).click();
    await expect(panel.getByLabel("Actions for Untitled")).toBeVisible();
    await panel.getByLabel("Actions for Untitled").click();
    await expect(panel.getByRole("button", {name: "Start sharing", exact: true})).toBeEnabled();
    await expect(panel.locator("small")).toContainText("Not shared · Opened");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.getByRole("button", {name: "Remove from server…"}).click();
  await page.getByRole("dialog", {name: "Remove from server"}).getByRole("button", {name: "Remove", exact: true}).click();
  await expect(panel.getByText("Nothing online yet.")).toBeVisible();
});

test("the published view and edit invites open the original drawing in another signed-in browser", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await login(page);
  const url = backend?.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = backend?.key ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Configure the local or hosted Supabase fixture");
  const { createClient } = await import("@supabase/supabase-js");
  const owner = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = await owner.auth.signInWithPassword({ email, password });
  if (auth.error) throw auth.error;
  const guestEmail = backend ? "figcraft-guest-" + randomUUID() + "@example.test" : process.env.FIGCRAFT_E2E_GUEST_EMAIL;
  const guestPassword = backend ? "Figcraft-" + randomUUID() + "!" : process.env.FIGCRAFT_E2E_GUEST_PASSWORD;
  if (!guestEmail || !guestPassword || guestEmail === email) throw new Error("Configure a second independent account for hosted sharing checks");
  const guestId = backend && (await backend.admin.auth.admin.createUser({ email: guestEmail, password: guestPassword, email_confirm: true })).data.user?.id;
  const origin = new URL(page.url()).origin;
  const visitor = await browser.newContext({ baseURL: origin, storageState: process.env.PLAYWRIGHT_STORAGE_STATE });
  let fileId: string | undefined;
  try {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
    const bar = page.locator(".figcraft-document-bar");
    await bar.getByText("File", { exact: true }).click();
    await bar.getByRole("button", { name: "Publish to server…" }).click();
    const form = page.getByRole("dialog", { name: "Publish to server" });
    await form.getByLabel("File name").fill("Original invite drawing");
    const reply = page.waitForResponse(response => new URL(response.url()).pathname === "/api/online-files");
    await form.getByRole("button", { name: "Publish", exact: true }).click();
    const response = await reply;
    expect(response.ok()).toBe(true);
    fileId = (await response.json()).id;
    await bar.getByText("Share", { exact: true }).click();
    const copy = async (access: string) => {
      await bar.getByRole("button", { name: "Copy " + access + " link" }).click();
      await expect(page.getByText(access === "view" ? "View link copied" : "Edit link copied", { exact: true })).toBeVisible();
      return page.evaluate(() => navigator.clipboard.readText());
    };
    const view = await copy("view"), edit = await copy("edit");
    expect(view.startsWith(origin + "/#join=") && edit !== view).toBe(true);
    const guest = await visitor.newPage();
    let secretInRequestUrl = false;
    guest.on("request", request => {
      secretInRequestUrl ||= /token(?:=|%3d)|#join=/i.test(request.url().split("#")[0]);
    });
    await guest.goto(view);
    await guest.getByLabel("Email", { exact: true }).fill(guestEmail);
    await guest.getByLabel("Password", { exact: true }).fill(guestPassword);
    await guest.getByRole("button", { name: "Sign in", exact: true }).click();
    const toolbar = guest.locator(".figcraft-document-bar");
    await expect(toolbar.getByRole("heading", { name: "Original invite drawing" })).toBeVisible();
    await expect(toolbar.getByText(/View only/)).toBeVisible();
    await expect(guest.getByRole("button", { name: "Create rectangle", exact: true })).toBeDisabled();
    expect(new URL(guest.url()).hash).toBe("");
    await toolbar.getByText("File", {exact:true}).click();
    await toolbar.getByRole("button", {name:"About this server"}).click();
    await expect(toolbar.getByText(/The server deletes this file if nobody opens it before .* UTC/)).toBeVisible();
    await toolbar.getByText("File", {exact:true}).click();
    await bar.getByRole("button", {name: "Start sharing", exact: true}).click();
    await bar.getByLabel("Access", {exact: true}).selectOption("comment");
    await bar.getByRole("button", {name: "Copy link", exact: true}).click();
    await expect(bar.getByText("Link copied", {exact: true})).toBeVisible();
    const comment = await page.evaluate(() => navigator.clipboard.readText());
    const commenter = await visitor.newPage();
    await commenter.goto(comment);
    const commentBar = commenter.locator(".figcraft-document-bar");
    await expect(commentBar.getByText(/Can comment/)).toBeVisible();
    await expect(commenter.getByRole("button", {name: "Create rectangle", exact: true})).toBeDisabled();
    const codeGuest = await visitor.newPage();
    await codeGuest.goto("/");
    const codeBar = codeGuest.locator(".figcraft-document-bar");
    const codeDialog = codeGuest.getByRole("dialog", {name: "Join live session"});
    const enterCode = async (value: string) => {
      await codeBar.getByText("Share", {exact: true}).click();
      await codeBar.getByText("Share", {exact: true}).locator("..").getByRole("button", {name: "Join live session…"}).click();
      await codeDialog.getByLabel("Invite link or code").fill(value);
      await codeDialog.getByRole("button", {name: "Join", exact: true}).click();
    };
    let retiredCode = "";
    for (const [role, label] of [["edit", "Can edit"], ["view", "View only"], ["comment", "Can comment"]]) {
      await bar.getByLabel("Access", {exact: true}).selectOption(role);
      const code = await bar.getByLabel("Join code").innerText();
      retiredCode = code;
      const native = new URL(decodeURIComponent(new URL(comment).hash.slice(6)));
      native.searchParams.delete("file"); native.searchParams.delete("token"); native.searchParams.set("code", code);
      await enterCode(role === "view" ? native.toString() : code.toLowerCase().replaceAll("-", " "));
      await expect(codeBar.getByText(new RegExp(label))).toBeVisible();
      await expect(codeBar.getByRole("heading", {name: "Original invite drawing"})).toBeVisible();
      const create = codeGuest.getByRole("button", {name: "Create rectangle", exact: true});
      if (role === "edit") await expect(create).toBeEnabled();
      else await expect(create).toBeDisabled();
      await codeBar.getByText("File", {exact: true}).click();
      await codeBar.getByRole("button", {name: "Leave session"}).click();
      await expect(codeBar.getByText(/Local document/)).toBeVisible();
    }
    await bar.getByRole("button", {name: "Stop sharing", exact: true}).click();
    await enterCode(retiredCode);
    await expect(codeDialog.getByRole("alert")).toHaveText("That code has expired or its sharing was stopped");
    await codeDialog.getByRole("button", {name: "Cancel"}).click();
    await bar.getByRole("button", {name: "Start sharing", exact: true}).click();
    await bar.getByLabel("Access", {exact: true}).selectOption("edit");
    await enterCode(await bar.getByLabel("Join code").innerText());
    await expect(codeBar.getByText(/Can edit/)).toBeVisible();
    await bar.getByRole("button", {name: "Stop sharing", exact: true}).click();
    await expect(codeBar.getByText(/Disconnected/)).toBeVisible();
    await codeGuest.close();
    await expect(commentBar.getByText(/Disconnected/)).toBeVisible({timeout: 15000});
    await expect(toolbar.getByText(/View only/)).toBeVisible();
    await commenter.close();
    await toolbar.getByText("File", { exact: true }).click();
    await toolbar.getByRole("button", { name: "Leave session" }).click();
    await expect(toolbar.getByText(/Local document/)).toBeVisible();
    await expect(guest.getByRole("button", { name: "Create rectangle", exact: true })).toBeEnabled();
    const join = toolbar.getByRole("button", { name: "Join live session…" });
    if (!await join.isVisible()) await toolbar.getByText("File", { exact: true }).click();
    await join.click();
    const dialog = guest.getByRole("dialog", { name: "Join live session" });
    await dialog.getByLabel("Invite link").fill(edit);
    await dialog.getByRole("button", { name: "Join", exact: true }).click();
    await expect(toolbar.getByText(/Can edit/)).toBeVisible();
    await expect(guest.getByRole("button", { name: "Create rectangle", exact: true })).toBeEnabled();
    // Closing the browser page bypasses Figcraft's explicit Leave command.
    const vanished = await visitor.newPage();
    const joined = vanished.waitForRequest(request => new URL(request.url()).pathname === "/api/online-files/join");
    await vanished.goto(edit);
    const vanishedId = (await joined).postDataJSON().tab as string;
    await expect(vanished.locator(".figcraft-document-bar").getByText(/Can edit/)).toBeVisible();
    await vanished.close();
    const viewer = await visitor.newPage();
    const viewerBar = viewer.locator(".figcraft-document-bar");
    const validations = new Map<string, number>();
    const joinedTab = () => viewer.waitForResponse(response =>
      new URL(response.url()).pathname === "/api/online-files/join" && response.ok())
      .then(response => response.request().postDataJSON().tab as string);
    viewer.on("response", async response => {
      if (!new URL(response.url()).pathname.endsWith("/rpc/online_connection_active") || !response.ok()) return;
      if (await response.json().catch(() => false) !== true) return;
      const tab = response.request().postDataJSON().tab as string;
      validations.set(tab, (validations.get(tab) ?? 0) + 1);
    });
    const initialJoin = joinedTab();
    await viewer.goto(view);
    const firstGrant = await initialJoin;
    await expect(viewerBar.getByText(/View only/)).toBeVisible();
    await expect.poll(() => validations.get(firstGrant) ?? 0, {timeout: 15000}).toBeGreaterThanOrEqual(2);
    // Suppress just this tab's contact with the host. Its sibling keeps its
    // real heartbeat, despite both pages sharing one authenticated login.
    const heartbeatUrl = "**/rest/v1/rpc/online_connection_active";
    const redeemUrl = "**/api/online-files/join";
    await viewer.route(heartbeatUrl, route => route.abort("connectionreset"));
    await viewer.route(redeemUrl, route => route.abort("connectionreset"));
    await expect(viewerBar.getByText(/reconnecting \(attempt/)).toBeVisible({timeout: 55_000});
    await expect(toolbar.getByText(/Can edit/)).toBeVisible();
    await expect(viewer.getByRole("button", {name: "Create rectangle", exact: true})).toBeDisabled();
    const recoveredJoin = joinedTab();
    await viewer.unroute(heartbeatUrl);
    await viewer.unroute(redeemUrl);
    await expect(viewerBar.getByText(/View only/)).toBeVisible({timeout: 15_000});
    const recoveredGrant = await recoveredJoin;
    expect(recoveredGrant).not.toBe(firstGrant);
    // Exercise revocation of an established subscription: the first check
    // opens the private channel and the second confirms the grant on subscribe.
    await expect.poll(() => validations.get(recoveredGrant) ?? 0, {timeout: 10_000}).toBeGreaterThanOrEqual(2);
    await expect(viewerBar.getByRole("heading", {name: "Original invite drawing"})).toBeVisible();
    if (backend) {
      const abandoned = await backend.admin.from("online_file_connections").select("id").eq("id", vanishedId);
      expect(abandoned.error).toBeNull();
      expect(abandoned.data).toEqual([]);
      const revoked = await backend.admin.from("online_file_links").delete().eq("file_id", fileId!).eq("access_level", "view").select("id");
      expect(revoked.error).toBeNull();
      expect(revoked.data).toHaveLength(1);
      await expect(viewerBar.getByText("Disconnected", {exact: false})).toBeVisible({timeout: 15000});
      await expect(viewer.getByText("Sharing was stopped", {exact: true})).toBeVisible();
      await expect(viewer.getByRole("button", {name: "Create rectangle", exact: true})).toBeEnabled();
      await viewerBar.getByText("File", {exact: true}).click();
      await viewerBar.getByRole("button", {name: "Reconnect", exact: true}).click();
      await expect(viewer.getByText("The invite is unavailable", {exact: true})).toBeVisible();
      await expect(viewerBar.getByText(/Disconnected/)).toBeVisible();
      await expect(toolbar.getByText(/Can edit/)).toBeVisible();
      await viewer.goto(edit);
      await expect(viewerBar.getByText(/Can edit/)).toBeVisible();
    }
    const closeFile = toolbar.getByRole("button", { name: "Close file", exact: true });
    if (!await closeFile.isVisible()) await toolbar.getByText("File", { exact: true }).click();
    const closed = guest.waitForResponse(response => new URL(response.url()).pathname === "/api/online-files/leave");
    await closeFile.click();
    expect((await closed).status()).toBe(204);
    await expect(toolbar.getByText(/Local document/)).toBeVisible();
    await visitor.setOffline(true);
    expect((await owner.storage.from("figcraft-files").remove([auth.data.user.id + "/" + fileId + ".figcraft"])).error).toBeNull();
    fileId = undefined;
    await visitor.setOffline(false);
    await expect(viewerBar.getByText(/Disconnected/)).toBeVisible({timeout: 15000});
    await expect(viewer.getByText(/The file was removed from the server|The session is no longer available/)).toBeVisible();
    await expect(viewerBar.getByRole("heading", {name: "Original invite drawing"})).toBeVisible();
    if (backend) {
      const rows = await backend.admin.from("online_file_connections").select("id").eq("principal_id", guestId!);
      expect(rows.error).toBeNull();
      expect(rows.data).toEqual([]);
    }
    expect(secretInRequestUrl).toBe(false);
  } finally {
    await visitor.close();
    if (fileId) expect((await owner.storage.from("figcraft-files").remove([auth.data.user.id + "/" + fileId + ".figcraft"])).error).toBeNull();
    if (backend && guestId) await backend.admin.auth.admin.deleteUser(guestId);
  }
});

test("authenticated rectangle command, pixels, keyboard undo/redo and resize", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("requestfailed", request => { if (!request.failure()?.errorText.includes("ERR_ABORTED")) errors.push(request.failure()?.errorText ?? "Request failed"); });
  await login(page);
  const create = page.getByRole("group", { name: "Create layer", exact: true });
  for (const [name, value] of Object.entries({ X: 10, Y: 20, Width: 30, Height: 40 })) {
    await create.getByRole("spinbutton", { name, exact: true }).fill(String(value));
  }
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

test("native download, independent open tabs, cancelled discard and recovery after reload", async ({ page }) => {
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
  const tabs = page.getByRole("tablist", { name: "Open files" }).getByRole("tab");
  await expect(tabs).toHaveCount(2);
  await tabs.first().click();
  await expect(page.getByText("2 layers", { exact: true })).toBeVisible();
  await page.locator(".figcraft-document-bar").getByText("File", { exact: true }).click();
  await page.getByRole("button", { name: "Close file", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Close unsaved file" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await tabs.last().click();
  await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  await page.reload(); await resetCanvasOrigin(page);
  await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  await expect(page.getByText("Unsaved · Local document", { exact: true })).toBeVisible();
  await expect(tabs).toHaveCount(2);
  await input.setInputFiles({ name: "invalid.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from("broken") });


  await expect(page.locator("main [role=alert]")).toContainText("Cannot open Figcraft file");
  await expect(page.getByText("1 layer", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("file tabs rename, duplicate, reorder, retain editing state and restore an empty workspace", async ({ page }) => {
  await login(page);
  const menu = async (name: string) => {
    const bar = page.locator(".figcraft-document-bar");
    const button = bar.getByRole("button", { name, exact: true });
    if (!await button.isVisible()) await bar.getByText("File", { exact: true }).click();
    await button.click();
  };
  const fileTabs = page.getByRole("tablist", { name: "Open files" }).getByRole("tab");
  await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
  await menu("Rename file");
  const dialog = page.getByRole("dialog", { name: "Rename file" });
  await dialog.getByLabel("File name").fill("Drawing");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await menu("Duplicate file");
  await expect(page.getByRole("heading", { name: "Drawing (Copy)", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await menu("New file");
  await expect(fileTabs).toHaveCount(3);
  await expect(page.getByLabel("Design canvas", { exact: true })).toHaveCount(1);
  await menu("Move tab left");
  await expect(fileTabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await fileTabs.nth(1).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("heading", { name: "Drawing", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  await menu("Close file");
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(fileTabs.nth(0)).toHaveText("Untitled");
  await menu("Close file");
  await expect(page.getByRole("heading", { name: "Drawing (Copy)", exact: true })).toBeVisible();
  await menu("Close file");
  await expect(page.getByRole("heading", { name: "Files", exact: true })).toBeVisible();
  await expect(page.getByLabel("Design canvas")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Recovery saved on this device" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Files", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New file", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Untitled", exact: true })).toBeVisible();
});

test("native image archive preserves original bytes through browser open, edits, recovery and download", async ({ page }) => {
  const formats = ["bmp", "gif", "jpg", "png", "tiff", "webp"];
  const resources: Record<string, Uint8Array> = {};
  for (const ext of formats) resources[`images/${ext}`] = await readFile(new URL(`../fixtures/images/six-pixels.${ext}`, import.meta.url));
  const native = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8"));
  native.imageIndex = [...formats, "lost"].map(hash => ({ hash }));
  native.image_presets = [{ name: "Camera flash", filters: { exposure: -0.5, shadows: 0.25 } }];
  const archive = zipSync({ "document.json": Buffer.from(JSON.stringify(native)), ...resources });
  await login(page);
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({
    name: "images.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(archive),
  });
  await expect(page.locator("main [role=alert]")).toContainText("image lost is used by the file but its data is missing");
  await page.getByRole("button", { name: "Create rectangle", exact: true }).click();
  await expect(page.getByText("2 layers", { exact: true })).toBeVisible();
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("2 layers", { exact: true })).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save as", exact: true }).click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  const members = unzipSync(await readFile((await download.path())!));
  for (const [name, original] of Object.entries(resources)) expect(Buffer.from(members[name]!)).toEqual(original);
  const saved = JSON.parse(strFromU8(members["document.json"]!));
  expect(saved.imageIndex).toEqual(formats.map(hash => ({ hash, width: 3, height: 2 })));
  expect(saved.image_presets).toEqual([{ name: "Camera flash", filters: { exposure: -0.5, shadows: 0.25, highlights: 0, tint: 0, temperature: 0, saturation: 0, contrast: 0 } }]);
});

test("image paints draw original pixels and retain placed files through undo, recovery and download", async ({ page }) => {
  const png = await readFile(new URL("../fixtures/images/six-pixels.png", import.meta.url));
  const native = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8"));
  const paint = { type: "image", image: "sample", scale_mode: "tile" };
  const rect = native.nodes["2"];
  rect.fills = [paint];
  native.nodes["3"] = { ...rect, id: 3, transform: [1,0,0,1,60,20], fills: [{ ...paint, rotation: 1, filters: { saturation: -1 } }] };
  native.nodes["4"] = { ...rect, id: 4, transform: [1,0,0,1,110,20], fills: [], strokes: [paint], stroke: { weight: 5, align: "inside" } };
  native.nodes["1"].children = [2,3,4];
  native.next_id = 5;
  await login(page);
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "raster.figcraft", mimeType: "application/octet-stream",
    buffer: Buffer.from(zipSync({ "document.json": Buffer.from(JSON.stringify(native)), "images/sample": png })) });
  await expect(page.getByRole("heading", { name: "Native rectangle", exact: true })).toBeVisible();
  await resetCanvasOrigin(page);
  await expectCanvasPixel(page, 13, 22, [255,0,0,255]);
  await expectCanvasPixel(page, 14, 22, [0,255,0,255]);
  await expectCanvasPixel(page, 15, 22, [0,0,255,255]);
  await expectCanvasPixel(page, 62, 23, [18,18,18,255]);
  await expectCanvasPixel(page, 114, 22, [0,255,0,255]);
  await page.getByLabel("Place image file", { exact: true }).setInputFiles({ name:"Placed.png", mimeType:"image/png", buffer:png });
  await expect(page.getByText("4 layers", {exact:true})).toBeVisible();
  await page.getByRole("button", { name:"Undo", exact:true }).click();
  await expect(page.getByText("3 layers", {exact:true})).toBeVisible();
  await page.getByRole("button", { name:"Redo", exact:true }).click();
  await expect(page.getByText("Recovery saved on this device", {exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByText("4 layers", {exact:true})).toBeVisible();
  await resetCanvasOrigin(page);
  await expectCanvasPixel(page, 13, 22, [255,0,0,255]);
  const pending = page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const bytes = await readFile((await (await pending).path())!);
  const wire = JSON.parse(strFromU8(unzipSync(bytes)["document.json"]!));
  expect(wire.nodes["5"]).toMatchObject({ name:"Placed", width:3, height:2, fills:[{type:"image",scale_mode:"fill"}] });
  expect(Buffer.from(unzipSync(bytes)["images/"+wire.nodes["5"].fills[0].image]!)).toEqual(png);
  await page.getByLabel("Place image file", { exact:true }).setInputFiles({ name:"Damaged.png",mimeType:"image/png",buffer:png.subarray(0,png.length-12) });
  await expect(page.locator("main [role=alert]")).toContainText("can't be read");
  await expect(page.getByText("4 layers", {exact:true})).toBeVisible();
});

test("opening raster files draws decoded pixels for all six formats and preserves the TIFF source on download", async ({ page }) => {
  await login(page);
  const input = page.getByLabel("Open Figcraft file", { exact:true });
  const files = ["six-pixels.png","six-pixels.jpg","six-pixels.webp","six-pixels.gif","six-pixels.bmp","strips-deflate-be.tiff","tile-packbits-big.tiff","planes-lzw.tiff","float-strip.tiff","float-planar-tile.tiff","strips-jpeg.tiff"];
  for (const [index, filename] of files.entries()) {
    const source = await readFile(new URL("../fixtures/images/"+filename,import.meta.url));
    await input.setInputFiles({name:index+"-"+filename,mimeType:"application/octet-stream",buffer:source});


    await expect(page.getByRole("heading", { name:index+"-"+filename.replace(/\.[^.]*$/,""), exact:true })).toBeVisible();
    await resetCanvasOrigin(page);
    await expectCanvasPixel(page,0,0,filename.endsWith(".jpg") ? [27,97,27,255] : filename === "strips-jpeg.tiff" ? [250,0,8,255] : [255,0,0,255]);
    if (index === files.length-1) {
      const pending=page.waitForEvent("download");
      await page.getByRole("button",{name:"Save as",exact:true}).click();
      const members=unzipSync(await readFile((await (await pending).path())!));
      const root=JSON.parse(strFromU8(members["document.json"]!));
      expect(Buffer.from(members["images/"+root.imageIndex[0].hash]!)).toEqual(source);
    }
  }
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
    return expectSolid(rectanglePaints(decoded.document.nodes["2"] as RectangleNode)[0]);
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
  const firstX = page.getByRole("region",{name:"Selected rectangle",exact:true}).locator("dt").filter({hasText:/^X$/}).locator("+ dd");
  const a = await canvasPoint(page, 225, 230), c = await canvasPoint(page, 385, 230);
  const root = page.locator("[data-figcraft-editor]"), commits = await root.getAttribute("data-commits");
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(c.x, c.y, { steps: 12 });
  expect(await root.getAttribute("data-commits")).toBe(commits);
  await page.keyboard.press("ControlOrMeta+z"); await page.mouse.up();
  await expect(page.getByLabel("Edit X",{exact:true})).toHaveValue("");
  await expect(firstX).toHaveText("200");
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(c.x, c.y, { steps: 12 });
  const bounds = (await canvas.boundingBox())!; await page.mouse.move(bounds.x + bounds.width + 20, c.y); await page.mouse.up();
  await expect(firstX).toHaveText("360");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.keyboard.down("ControlOrMeta"); await page.mouse.move(c.x, c.y, { steps: 10 });
  await page.mouse.up(); await page.keyboard.up("ControlOrMeta");
  await expect(firstX).toHaveText("360");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await panel.getByLabel("Source layer", { exact: true }).selectOption({ label: "A" }); await panel.getByLabel("Target slot", { exact: true }).selectOption({ label: "C" });
  await panel.getByLabel("Swap only these two", { exact: true }).check(); await panel.getByRole("button", { name: "Reorder selection", exact: true }).click();
  await expect(firstX).toHaveText("360");
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
  // A macOS Control-primary drag can raise contextmenu before the pointer is released.
  await canvas.dispatchEvent("contextmenu",{ctrlKey:true,button:2,clientX:q.x,clientY:q.y});
  await expect(page.getByRole("group",{name:"Canvas actions",exact:true})).toBeHidden();
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


  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device"); await page.reload();
  await page.getByRole("region", { name: "Layers", exact: true }).getByRole("button", { name: "Line", exact: true }).click();
  await stroke.getByText("Advanced stroke", { exact: true }).click(); await expect(profile).toHaveValue("custom");
  const malformed = JSON.parse(strFromU8(unzipSync(bytes)["document.json"]), (key, value: unknown) => key === "width_profile" ? { points: null } : value) as unknown;
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: "invalid-profile.figcraft", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(malformed)) });


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

  await expect(page.locator("main [role=alert]")).toContainText("Brush seed"); await expect(brush).toHaveValue("dots");
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

test("live boolean groups edit their operands, render cuts and recover native geometry", async ({ page }) => {
  const engine = new EditorEngine();
  const rectangle = (name: string, x: number, y: number, fill: string) =>
    String(engine.execute("shape.rectangle", { x, y, width: 120, height: 100, props: { name, fill } }).id);
  const bottom = rectangle("Base", 150, 140, "#ff0000");
  const top = rectangle("Cutter", 210, 185, "#00ff00");
  await login(page);
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({
    name: "boolean.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(await engine.nativeSnapshot()),
  });
  const layers = page.getByRole("region", { name: "Layers", exact: true });
  const row = (name: string) => layers.getByRole("button", { name, exact: true });
  const menu = page.getByRole("button", { name: "Boolean groups", exact: true });
  const choose = async (name: string) => {
    await menu.click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
  };
  const save = async () => {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save as", exact: true }).click();
    return (await decodeFigcraft(await readFile((await (await pending).path())!))).document;
  };
  const clickCanvas = async (x: number, y: number) => {
    const p = await canvasPoint(page, x, y);
    await page.mouse.click(p.x, p.y);
  };
  await expect(row("Base")).toBeVisible();
  await resetCanvasOrigin(page);
  await row("Base").click();
  await row("Cutter").click({ modifiers: ["Shift"] });
  await choose("Subtract");
  const selected = layers.locator('li[aria-current="true"]');
  const group = (await selected.getAttribute("data-layer-id"))!;
  const saved = await save();
  expect(saved.nodes[group]).toMatchObject({ kind: "booleanOp", op: "subtract", children: [bottom, top], fill: "#ff0000" });
  const red = [255,0,0,255], background = [245,245,245,255];
  await clickCanvas(390, 350);
  await expectCanvasPixel(page, 180, 205, red);
  await expectCanvasPixel(page, 235, 200, background);
  await clickCanvas(235, 200);
  await expect(selected).toHaveCount(0);
  const origin = await canvasPoint(page, 144, 134);
  await expect(page).toHaveScreenshot("boolean-subtract.png", { clip: { ...origin, width: 192, height: 158 }, animations: "disabled", maxDiffPixels: 0 });
  await clickCanvas(175, 175);
  await expect(selected).toHaveAttribute("data-layer-id", group);
  await menu.click();
  await expect(page.getByRole("menuitemradio", { name: "Subtract" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("menu", { name: "Boolean operations" })).toHaveScreenshot("boolean-operations.png", { animations: "disabled" });
  await page.keyboard.press("Escape");
  await choose("Intersect");
  await expect(row("Intersect")).toBeVisible();
  await expectCanvasPixel(page, 235, 200, red);
  await choose("Union");
  await expect(row("Union")).toBeVisible();
  await row("Cutter").click();
  await choose("Exclude");
  await expect(layers.getByLabel("Exclude operand")).toBeVisible();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await resetCanvasOrigin(page);
  await expect(layers.getByLabel("Exclude operand")).toBeVisible();
  expect((await save()).nodes[top]).toMatchObject({ parent: group, boolOp: "exclude" });
  await row("Union").click();
  await choose("Subtract");
  await expect(layers.getByLabel("Exclude operand")).toHaveCount(0);
  await row("Cutter").click();
  const start = await canvasPoint(page, 295, 255), end = await canvasPoint(page, 365, 255);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await expectCanvasPixel(page, 235, 200, red);
  await page.mouse.up();
  expect((await save()).nodes[top]).toMatchObject({ parent: group, x: 130 });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await save()).nodes[top]).toMatchObject({ parent: group, x: 60 });
  await row("Subtract").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await menu.click();
  await expect(page.getByRole("menuitemradio", { name: "Subtract" })).toBeInViewport();
  await page.getByRole("menuitem", { name: "Flatten" }).click();
  const flat = await save();
  expect(Object.values(flat.nodes).filter(n => n.kind === "vector")).toHaveLength(1);
  expect(flat.nodes[top]).toBeUndefined();
  expect(flat.nodes[bottom]).toBeUndefined();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await save()).nodes[group]).toMatchObject({ kind: "booleanOp", children: [bottom, top] });
});

test("Outline stroke preserves fill and border pixels, transformed native layers and device recovery", async ({ page }) => {
  const engine = new EditorEngine(), id = String(engine.execute("shape.rectangle", {
    x: 120, y: 120, width: 100, height: 70, props: { name: "Tile", fill: "#336699", stroke: "#cc2211", strokeWeight: 8, strokeAlign: "inside" },
  }).id);
  await login(page);
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({
    name: "outline.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(await engine.nativeSnapshot()),
  });
  const layers = page.getByRole("region", { name: "Layers", exact: true });
  const tile = layers.getByRole("button", { name: "Tile", exact: true });
  await expect(tile).toHaveCount(1);
  await resetCanvasOrigin(page);
  const samples = async () => {
    await expectCanvasPixel(page, 124, 150, [204,34,17,255]);
    await expectCanvasPixel(page, 150, 150, [51,102,153,255]);
    await expectCanvasPixel(page, 116, 150, [245,245,245,255]);
  };
  await samples();
  await tile.click();
  await page.keyboard.press("Control+Alt+o");
  await expect(tile).toHaveCount(3);
  const save = async () => {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name:"Save as", exact:true }).click();
    return (await decodeFigcraft(await readFile((await (await pending).path())!))).document;
  };
  const check = async () => {
    const doc = await save();
    const group = Object.values(doc.nodes).find(n => n.kind === "group");
    expect(group?.children[0]).toBe(id);
    expect(doc.nodes[group!.children[1]]).toMatchObject({ kind: "vector", fill: "#cc2211" });
    expect(doc.nodes[id]).toMatchObject({ kind: "rectangle", fill: "#336699" });
  };
  await check();
  const p = await canvasPoint(page, 300, 270);
  await page.mouse.click(p.x, p.y);
  await samples();
  const origin = await canvasPoint(page, 114, 114);
  await expect(page).toHaveScreenshot("outlined-stroke-fill.png", { clip: { ...origin, width: 112, height: 82 }, animations: "disabled", maxDiffPixels: 0 });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(tile).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".figcraft-mobile-layers > summary").click();
  await tile.click();
  await layers.getByRole("button", { name: "Outline stroke", exact: true }).click();
  await expect(tile).toHaveCount(3);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await expect(tile).toHaveCount(3);
  await resetCanvasOrigin(page);
  await samples();
  await check();
});

test("Offset path grows and erodes a ring, preserves its hole and recovers its paint frame", async ({ page }) => {
  const e = new EditorEngine(), id = String(e.execute("vector.create", { x:120,y:120,path:"M0 0H100V100H0Z M25 25H75V75H25Z" }).id);
  e.execute("node.set", { id, props: { name:"Ring", fill:"#008844" } });
  e.execute("vector.fillRule", { id, rule:"evenOdd" });
  await login(page);
  await page.getByLabel("Open Figcraft file", { exact:true }).setInputFiles({
    name:"offset.figcraft", mimeType:"application/octet-stream", buffer:Buffer.from(await e.nativeSnapshot()),
  });
  const layers = page.getByRole("region", { name:"Layers", exact:true }), row = layers.getByRole("button", { name:"Ring", exact:true });
  const dialog = page.getByRole("dialog", { name:"Offset path", exact:true });
  const open = async () => {
    await row.click();
    await layers.getByRole("button", { name:"Offset path", exact:true }).click();
    await expect(dialog.getByLabel("Offset distance")).toHaveValue("0");
  };
  const apply = async (distance: number) => {
    await open();
    await dialog.getByLabel("Offset distance").fill(String(distance));
    await dialog.getByRole("button", { name:"Offset", exact:true }).click();
    await expect(dialog).toBeHidden();
  };
  const deselect = async () => {
    const p = await canvasPoint(page, 330, 290);
    await page.mouse.click(p.x,p.y);
  };
  const green = [0,136,68,255], bg = [245,245,245,255];
  await expect(row).toBeVisible();
  await resetCanvasOrigin(page);
  await open();
  await dialog.getByLabel("Offset distance").fill("18");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await deselect();
  await expectCanvasPixel(page,115,170,bg);
  await apply(8);
  await deselect();
  await expectCanvasPixel(page,115,170,green);
  await expectCanvasPixel(page,149,170,green);
  await expectCanvasPixel(page,170,170,bg);
  await expectCanvasPixel(page,112,112,bg);
  const origin = await canvasPoint(page,108,108);
  await expect(page).toHaveScreenshot("offset-ring.png", { clip:{...origin,width:124,height:124}, animations:"disabled", maxDiffPixels:0 });
  await page.getByRole("button", { name:"Undo", exact:true }).click();
  await deselect();
  await expectCanvasPixel(page,115,170,bg);
  await page.setViewportSize({ width:390,height:844 });
  await page.locator(".figcraft-mobile-layers > summary").click();
  await apply(-5);
  await page.setViewportSize({ width:1440,height:900 });
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await expect(row).toBeVisible();
  await resetCanvasOrigin(page);
  await expectCanvasPixel(page,122,170,bg);
  await expectCanvasPixel(page,129,170,green);
  await expectCanvasPixel(page,143,170,bg);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name:"Save as", exact:true }).click();
  const doc = (await decodeFigcraft(await readFile((await (await download).path())!))).document;
  const layer = doc.nodes[id] as VectorNode;
  expect(layer.network.regions[0]).toMatchObject({ winding:"evenOdd", paintSpace:{ width:100,height:100 } });
  expect(layer.width).toBeCloseTo(90,2);
});

test("Simplify vector reduces editable segments and recovers a closed fill plus a loose trail", async ({ page }) => {
  const e = new EditorEngine(), id = String(e.execute("vector.create", {
    x:130,y:130,path:"M0 0H20H40H60V60H0Z M90 20H110H130H150",
  }).id);
  // Vector creation and sparse property writes are distinct native commands.
  e.execute("node.set",{id,props:{name:"Path",fill:"#008844",stroke:"black",strokeWeight:2}});
  const original=(e.getSnapshot().document.nodes[id] as VectorNode).network;
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({
    name:"simplify.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await e.nativeSnapshot()),
  });
  const layers=page.getByRole("region",{name:"Layers",exact:true}), row=layers.getByRole("button",{name:"Path",exact:true});
  const apply=async()=>{
    await row.click();
    await layers.getByRole("button",{name:"Simplify vector",exact:true}).click();
  };
  const save=async()=>{
    const pending=page.waitForEvent("download");await page.getByRole("button",{name:"Save as",exact:true}).click();
    return ((await decodeFigcraft(await readFile((await (await pending).path())!))).document.nodes[id] as VectorNode).network;
  };
  await expect(row).toBeVisible();
  await resetCanvasOrigin(page);
  await apply();
  const simplified=await save();
  expect(simplified.segments.length).toBeLessThan(original.segments.length);
  expect(simplified.regions).toHaveLength(1);
  expect(simplified.regions[0].loops.flat()).toHaveLength(simplified.segments.length-1);
  const away=await canvasPoint(page,340,280);await page.mouse.click(away.x,away.y);
  await expectCanvasPixel(page,150,150,[0,136,68,255]);
  await expectCanvasPixel(page,245,150,[0,0,0,255]);
  const origin=await canvasPoint(page,124,124);
  await expect(page).toHaveScreenshot("simplify-loose-trail.png",{clip:{...origin,width:162,height:72},animations:"disabled",maxDiffPixels:0});
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  expect(await save()).toEqual(original);
  await page.setViewportSize({width:390,height:844});
  await page.locator(".figcraft-mobile-layers > summary").click();
  await apply();
  await page.setViewportSize({width:1440,height:900});
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await expect(row).toBeVisible();
  expect(await save()).toEqual(simplified);
});

test("authenticated host renders its initial editor shell on the server", async ({ page }) => {
  await login(page);
  const response = await page.request.get("/");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toMatch(/<button[^>]*>Sign out<\/button>/);
  expect(html).toMatch(/<p role="status">Opening editor…<\/p>/);
});

test("Shape Builder hatches overlaps, commits one drag and recovers editable regions", async ({page}) => {
  const seed = new EditorEngine();
  const rectangle = (x: number, fill: string, name: string) => String(seed.execute("shape.rectangle", {
    x, y:120, width:100, height:80, props:{fill,name},
  }).id);
  const red = rectangle(120,"#ff0000","Red"), blue = rectangle(180,"#0000ff","Blue");
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({
    name:"builder.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await seed.nativeSnapshot()),
  });
  const canvas = page.getByLabel("Design canvas",{exact:true});
  const toolbar = page.getByRole("toolbar",{name:"Shape Builder",exact:true});
  const save = async () => {
    const pending = page.waitForEvent("download");
    await page.getByRole("button",{name:"Save as",exact:true}).click();
    return (await decodeFigcraft(await readFile((await (await pending).path())!))).document;
  };
  await expect(page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Blue",exact:true})).toBeVisible();
  await resetCanvasOrigin(page);
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Shift+m");
  await expect(toolbar.getByRole("button",{name:"Merge regions"})).toHaveAttribute("aria-pressed","true");
  const overlap = await canvasPoint(page,200,155), right = await canvasPoint(page,250,155);
  await page.mouse.move(overlap.x,overlap.y);
  const crop = await canvasPoint(page,115,115);
  await expect(page).toHaveScreenshot("shape-builder-overlap.png",{clip:{...crop,width:170,height:90},animations:"disabled",maxDiffPixels:0});
  await page.mouse.down();
  await page.mouse.move(right.x,right.y);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(toolbar).toBeVisible();
  expect((await save()).nodes[red].kind).toBe("rectangle");
  await page.mouse.move(overlap.x,overlap.y);
  await page.mouse.down();
  await page.mouse.move(right.x,right.y);
  await page.mouse.up();
  await page.keyboard.press("Enter");
  const merged = await save();
  expect(merged.nodes[red].kind).toBe("vector");
  expect(merged.nodes[blue]).toBeUndefined();
  const created = Object.values(merged.nodes).find(n => n.id !== red && n.kind === "vector")!;
  expect(created).toMatchObject({fill:"#0000ff",width:100,height:80});
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  expect((await save()).nodes[blue].kind).toBe("rectangle");
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+a");
  await page.getByRole("button",{name:"Shape Builder",exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await toolbar.getByRole("button",{name:"Remove regions"}).click();
  await expect(toolbar.getByRole("button",{name:"Remove regions"})).toHaveAttribute("aria-pressed","true");
  await page.setViewportSize({width:1440,height:900});
  await resetCanvasOrigin(page);
  const hit = await canvasPoint(page,200,155);
  await page.mouse.click(hit.x,hit.y);
  await toolbar.getByRole("button",{name:"Done"}).click();
  await expectCanvasPixel(page,200,155,[245,245,245,255]);
  await expectCanvasPixel(page,145,155,[255,0,0,255]);
  await expectCanvasPixel(page,245,155,[0,0,255,255]);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  const recovered = await save();
  expect(recovered.nodes[red]).toMatchObject({kind:"vector",width:60});
  expect(recovered.nodes[blue]).toMatchObject({kind:"vector",width:60});
});

test("gradient picker edits fills, canvas handles and stops with one-step undo and device recovery",async({page})=>{
  await login(page);
  await createNamedRectangle(page,"Gradient",120,120,160,100);
  const picker=page.getByRole("group",{name:"fill 1 paint picker",exact:true});
  await page.getByRole("button",{name:"Edit fill 1 paint"}).click();
  await picker.getByLabel("Paint type").selectOption("linear");
  const canvas=page.getByLabel("Design canvas",{exact:true});
  const save=async()=>{
    const pending=page.waitForEvent("download");
    await canvas.focus(); await page.keyboard.press("ControlOrMeta+s");
    const saved=await decodeFigcraft(await readFile((await (await pending).path())!));
    const paint=rectanglePaints(saved.document.nodes["2"] as RectangleNode)[0];
    if (paint.type!=="gradient") throw Error("Expected a saved gradient");
    return paint;
  };
  const at=async(x:number,y:number)=>{const p=await canvasPoint(page,x,y);await page.mouse.move(p.x,p.y);};
  const initial=await save();
  await at(200,170); await page.mouse.down(); await at(200,184); await page.mouse.up();
  let paint=await save(); expect(paint.stops).toHaveLength(3); expect(paint.stops[2].position).toBeCloseTo(.64,2);
  await picker.getByLabel("Stop CSS colour").fill("red");
  await picker.getByRole("button",{name:"Apply stop"}).click();
  expect((await save()).stops[2].color).toMatchObject({r:1,g:0,b:0,a:1});
  await at(200,120); await page.mouse.down(); await at(160,128); await page.keyboard.press("Escape"); await page.mouse.up();
  expect((await save()).from).toEqual(initial.from);
  await at(200,120); await page.mouse.down(); await at(180,135); await at(160,140); await page.mouse.up();
  paint=await save(); expect(paint.from).toEqual([.25,.2]); expect(paint.width[0]).toBeCloseTo(-.25); expect(paint.width[1]).toBeCloseTo(.6);
  await page.getByLabel("Design canvas",{exact:true}).focus(); await page.keyboard.press("ControlOrMeta+z");
  expect((await save()).from).toEqual(initial.from);
  const clip=await canvasPoint(page,112,110);
  await expect(page).toHaveScreenshot("gradient-linear-handles.png",{clip:{...clip,width:178,height:120},animations:"disabled",maxDiffPixels:0});
  await canvas.focus(); await page.keyboard.press("Delete");
  expect((await save()).stops).toHaveLength(2);
  await page.getByLabel("Design canvas",{exact:true}).focus(); await page.keyboard.press("ControlOrMeta+z");
  const before=await save();
  await page.setViewportSize({width:390,height:844});
  await picker.getByLabel("Paint type").selectOption("angular");
  await picker.getByRole("button",{name:"Flip",exact:true}).click();
  await picker.getByRole("button",{name:"Rotate 90°"}).click();
  await page.setViewportSize({width:1440,height:900});
  const after=await save(); expect(after.kind).toBe("angular");
  expect(after.stops.map(s=>s.position)).toEqual(before.stops.map(s=>Math.fround(1-s.position)));
  expect(after.to).toEqual([0,.5]); expect(after.width).toEqual([.5,1]);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await expect(page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Gradient",exact:true})).toBeVisible();
  expect(await save()).toEqual(after);
});

test("stroke picker preserves stops across kinds and commits a captured stop-bar drag once",async({page})=>{
  await login(page); await createNamedRectangle(page,"Stroke gradient",100,100,160,90);
  const panel=page.getByRole("group",{name:"Stroke",exact:true});
  await panel.getByRole("button",{name:"Add stroke",exact:true}).click();
  await panel.getByRole("button",{name:"Edit stroke 1 paint"}).click();
  const picker=panel.getByRole("group",{name:"stroke 1 paint picker"});
  await picker.getByLabel("Paint type").selectOption("radial");
  await picker.getByRole("button",{name:"Add stop"}).click();
  const handle=picker.getByRole("button",{name:"Gradient stop 3",exact:true});
  const bounds=(await handle.boundingBox())!, bar=(await handle.locator("..").boundingBox())!;
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2); await page.mouse.down();
  await page.mouse.move(bar.x+bar.width*.7,bar.y-12,{steps:4}); await page.mouse.up();
  expect(Number(await picker.getByLabel("Stop position").inputValue())).toBeCloseTo(.7,1);
  await page.getByLabel("Design canvas",{exact:true}).focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect(picker.getByLabel("Stop position")).toHaveValue("0.5");
  await picker.getByLabel("Paint type").selectOption("diamond");
  await picker.getByRole("button",{name:"Remove stop",exact:true}).click();
  await expect(picker.getByRole("button",{name:"Remove stop",exact:true})).toBeDisabled();
  await picker.getByLabel("Stop CSS colour").fill("blue");
  await picker.getByRole("button",{name:"Apply stop"}).click();
  await picker.getByLabel("Paint type").selectOption("solid");
  await expect(panel.getByLabel("Stroke 1 CSS colour")).toHaveValue("rgba(0,0,255,1)");
});

test("image picker cancels a placeholder, uploads and drops images, preserves settings and recovers presets", async ({page})=>{
  await login(page);
  await createNamedRectangle(page,"Picture",120,120,90,60);
  const canvas=page.getByLabel("Design canvas",{exact:true});
  const open=page.getByRole("button",{name:"Edit fill 1 paint",exact:true});
  const picker=page.getByRole("group",{name:"fill 1 paint picker",exact:true});
  const save=async()=>{
    const pending=page.waitForEvent("download");
    await canvas.focus(); await page.keyboard.press("ControlOrMeta+s");
    return (await decodeFigcraft(await readFile((await (await pending).path())!))).document;
  };
  const paintOf=(doc:Awaited<ReturnType<typeof save>>)=>rectanglePaints(doc.nodes["2"] as RectangleNode)[0];
  await open.click();
  await picker.getByLabel("Paint type").selectOption("image");
  await expect(picker.getByRole("button",{name:"Upload from computer"})).toBeVisible();
  expect(paintOf(await save()).type).toBe("solid");
  await picker.getByRole("button",{name:"Close paint picker"}).click();
  await open.click();
  await expect(picker.getByLabel("Paint type")).toHaveValue("solid");
  await picker.getByLabel("Paint type").selectOption("image");
  const file = await readFile(new URL("../fixtures/images/six-pixels.png",import.meta.url));
  await picker.getByLabel("Choose image").setInputFiles({name:"bad.png",mimeType:"image/png",buffer:file.subarray(0,20)});
  await expect(picker.getByRole("alert")).toBeVisible();
  expect(paintOf(await save()).type).toBe("solid");
  const choose=page.waitForEvent("filechooser");
  await picker.getByRole("button",{name:"Upload from computer"}).click();
  await (await choose).setFiles({name:"pixels.png",mimeType:"image/png",buffer:file});
  await picker.getByLabel("Image mode").selectOption("fit");
  await picker.getByRole("button",{name:"Rotate 90°"}).click();
  await picker.getByLabel("Adjustment presets").click();
  await picker.getByRole("button",{name:"Warm",exact:true}).click();
  await expect(picker).toHaveScreenshot("image-picker-warm.png");
  const slider=picker.getByRole("slider",{name:"Exposure",exact:true});
  await slider.click({trial:true});
  const bound=(await slider.boundingBox())!;
  await page.mouse.move(bound.x+bound.width/2,bound.y+bound.height/2); await page.mouse.down();
  await page.mouse.move(bound.x+bound.width*.85,bound.y+bound.height/2,{steps:5}); await page.mouse.up();
  const adjusted=paintOf(await save());
  expect(adjusted).toMatchObject({type:"image",scale_mode:"fit",rotation:1,filters:{temperature:.5}});
  if(adjusted.type!=="image") throw Error("Missing edited image");
  expect(adjusted.filters.exposure).toBeGreaterThan(.5);
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+z");
  expect(paintOf(await save())).toMatchObject({filters:{exposure:0,temperature:.5}});
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+Shift+z");
  await picker.getByLabel("Adjustment presets").click();
  await picker.getByRole("button",{name:"Save as preset…"}).click();
  await picker.getByLabel("Preset name").fill("Sunny");
  await picker.getByRole("button",{name:"Save",exact:true}).click();
  const before=await save();
  expect(before.imagePresets).toEqual([{name:"Sunny",filters:adjusted.filters}]);
  await picker.getByRole("button",{name:"Reset adjustments"}).click();
  await picker.getByLabel("Adjustment presets").click();
  await picker.getByRole("button",{name:"Sunny",exact:true}).click();
  const tiff=await readFile(new URL("../fixtures/images/planes-lzw.tiff",import.meta.url));
  const transfer=await page.evaluateHandle(bytes=>{
    const data=new DataTransfer();
    data.items.add(new File([Uint8Array.from(bytes)],"replace.tiff",{type:"image/tiff"}));
    return data;
  },[...tiff]);
  const well=picker.getByRole("group",{name:"Image paint",exact:true});
  await well.dispatchEvent("dragover",{dataTransfer:transfer});
  await expect(well.getByText("Drop to use this image")).toBeVisible();
  await well.dispatchEvent("drop",{dataTransfer:transfer});
  await transfer.dispose();
  await expect(page.getByText("Recovery saved on this device",{exact:true})).toBeVisible();
  const replaced=paintOf(await save());
  expect(replaced).toEqual({...adjusted,image:expect.any(String)});
  if(replaced.type!=="image") throw Error("Missing replacement image");
  expect(replaced.image).not.toBe(adjusted.image);
  await page.reload();
  await expect(page.getByText("1 layer",{exact:true})).toBeVisible();
  const restored=await save();
  expect(paintOf(restored)).toEqual(replaced);
  expect(restored.imagePresets).toEqual(before.imagePresets);
});

test("image strokes can upload, adjust with the keyboard and delete a saved preset on a narrow viewport",async({page})=>{
  await login(page); await createNamedRectangle(page,"Image stroke",90,100,60,50);
  await page.setViewportSize({width:390,height:844});
  const panel=page.getByRole("group",{name:"Stroke",exact:true});
  await panel.getByRole("button",{name:"Add stroke",exact:true}).click();
  await panel.getByRole("button",{name:"Edit stroke 1 paint",exact:true}).click();
  const picker=panel.getByRole("group",{name:"stroke 1 paint picker",exact:true});
  await picker.getByLabel("Paint type").selectOption("image");
  const file=await readFile(new URL("../fixtures/images/tile-packbits-big.tiff",import.meta.url));
  await picker.getByLabel("Choose image").setInputFiles({name:"stroke.tiff",mimeType:"image/tiff",buffer:file});
  const slider=picker.getByRole("slider",{name:"Tint",exact:true});
  await slider.focus(); await slider.press("End");
  await expect(slider).toHaveValue("1");
  await picker.getByLabel("Adjustment presets").click();
  await picker.getByRole("button",{name:"Save as preset…"}).click();
  await picker.getByLabel("Preset name").fill("Stroke tint");
  await picker.getByRole("button",{name:"Save",exact:true}).click();
  await picker.getByLabel("Adjustment presets").click();
  await picker.getByRole("button",{name:"Delete preset Stroke tint"}).click();
  await expect(picker.getByRole("button",{name:"Stroke tint",exact:true})).toHaveCount(0);
  const box=(await picker.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(390);
  const pending=page.waitForEvent("download");
  await page.getByLabel("Design canvas",{exact:true}).focus(); await page.keyboard.press("ControlOrMeta+s");
  const {document}=await decodeFigcraft(await readFile((await (await pending).path())!));
  const node=document.nodes["2"] as RectangleNode;
  expect(rectanglePaints(node)[0].type).toBe("solid");
  expect(node.strokes?.[0]).toMatchObject({type:"image",filters:{tint:1}});
  expect(document.imagePresets ?? []).toEqual([]);
});

test("multiple dropped files use page coordinates and the open image picker takes only the first",async({page})=>{
  await login(page);
  const canvas=page.getByLabel("Design canvas",{exact:true});
  const png=await readFile(new URL("../fixtures/images/six-pixels.png",import.meta.url));
  const data=await page.evaluateHandle(bytes=>{
    const transfer=new DataTransfer();
    for(const name of ["first.png","second.png"]) transfer.items.add(new File([Uint8Array.from(bytes)],name,{type:"image/png"}));
    return transfer;
  },[...png]);
  const at=await canvasPoint(page,45,60);
  const event={clientX:at.x,clientY:at.y,dataTransfer:data};
  await canvas.dispatchEvent("drop",event);
  await expect(page.getByText("2 layers",{exact:true})).toBeVisible();
  async function saved() {
    const download=page.waitForEvent("download");
    await canvas.focus();await page.keyboard.press("ControlOrMeta+s");
    return (await decodeFigcraft(await readFile((await (await download).path())!))).document;
  }
  const doc=await saved();
  expect(doc.nodes["2"]).toMatchObject({name:"first",x:45,y:60});
  expect(doc.nodes["3"]).toMatchObject({name:"second",x:45,y:60});
  expect(Object.keys(doc.images!)).toHaveLength(1);
  await createNamedRectangle(page,"Target",90,100,60,50);
  await page.getByRole("button",{name:"Edit fill 1 paint",exact:true}).click();
  const picker=page.getByRole("group",{name:"fill 1 paint picker",exact:true});
  await picker.getByLabel("Paint type").selectOption("image");
  await picker.dispatchEvent("drop",event);
  await expect(page.getByText("4 layers",{exact:true})).toBeVisible();
  const multi=await saved();
  expect(multi.nodes["4"]).toMatchObject({name:"Target",fills:[{type:"image"}]});
  expect(multi.nodes["5"]).toMatchObject({name:"second",x:45,y:60});
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByText("3 layers",{exact:true})).toBeVisible();
  expect((await saved()).nodes["4"]).toMatchObject({fills:[{type:"image"}]});
  await page.keyboard.press("ControlOrMeta+z");
  expect(rectanglePaints((await saved()).nodes["4"] as RectangleNode)[0].type).toBe("solid");
  await data.dispose();
});

test("browser image paste centres in the view, appends to a selected fill, respects fields and pastes here at the pointer",async({page,context})=>{
  await login(page);
  const canvas=page.getByLabel("Design canvas",{exact:true});
  const png=await readFile(new URL("../fixtures/images/six-pixels.png",import.meta.url));
  await context.grantPermissions(["clipboard-read","clipboard-write"],{origin:new URL(page.url()).origin});
  await page.evaluate(async bytes=>navigator.clipboard.write([new ClipboardItem({"image/png":new Blob([Uint8Array.from(bytes)],{type:"image/png"})})]),[...png]);
  const centre=await canvas.evaluate((node:HTMLCanvasElement)=>{
    const bounds=node.getBoundingClientRect(), z=Number(node.dataset.viewZoom);
    return {x:Number(node.dataset.viewOriginX)+bounds.width/(2*z),y:Number(node.dataset.viewOriginY)+bounds.height/(2*z)};
  });
  const round=(n:number)=>Math.sign(n)*Math.round(Math.abs(n));
  await canvas.focus();await page.keyboard.press("ControlOrMeta+v");
  await expect(page.getByText("1 layer",{exact:true})).toBeVisible();
  async function saved() {
    const download=page.waitForEvent("download");await canvas.focus();await page.keyboard.press("ControlOrMeta+s");
    return (await decodeFigcraft(await readFile((await (await download).path())!))).document;
  }
  expect((await saved()).nodes["2"]).toMatchObject({name:"Pasted image",width:3,height:2,x:round(centre.x-1.5),y:round(centre.y-1)});
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.getByRole("button",{name:"Edit fill 2 paint",exact:true})).toBeVisible();
  const field=page.getByRole("region",{name:"Appearance"}).getByLabel("Name",{exact:true});
  await field.focus();await page.keyboard.press("ControlOrMeta+v");
  expect(rectanglePaints((await saved()).nodes["2"] as RectangleNode)).toHaveLength(2);
  const at=await canvasPoint(page,82,124);
  await page.mouse.click(at.x,at.y,{button:"right"});
  await page.getByRole("button",{name:"Paste here",exact:true}).click();
  await expect(page.getByText("2 layers",{exact:true})).toBeVisible();
  const doc=await saved();
  expect(doc.nodes["3"]).toMatchObject({name:"Pasted image",x:82,y:124});
  expect(rectanglePaints(doc.nodes["2"] as RectangleNode)).toHaveLength(2);
  await expect(page.getByText("Recovery saved on this device",{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByText("2 layers",{exact:true})).toBeVisible();
  expect((await saved()).nodes["3"]).toMatchObject({x:82,y:124,fills:[{type:"image"}]});
});

test("image crop preserves visible pixels on layer resize, dims the outside and moves the picture independently", async ({page}) => {
  await login(page);
  await createNamedRectangle(page, "Crop fixture", 100, 100, 180, 120);
  const canvas = page.getByLabel("Design canvas", {exact:true});
  const picker = page.getByRole("group", {name:"fill 1 paint picker",exact:true});
  await page.getByRole("button", {name:"Edit fill 1 paint",exact:true}).click();
  await picker.getByLabel("Paint type").selectOption("image");
  await picker.getByLabel("Choose image").setInputFiles(new URL("../fixtures/images/six-pixels.png",import.meta.url).pathname);
  await expect(picker.getByLabel("Image mode")).toBeVisible();
  await picker.getByRole("button", {name:"Close paint picker"}).click();
  async function sample(x:number, y:number) {
    const point = await canvasPoint(page,x,y);
    return canvas.evaluate((node:HTMLCanvasElement, p) => {
      const r=node.getBoundingClientRect();
      return Array.from(node.getContext("2d")!.getImageData(Math.round((p.x-r.x)*devicePixelRatio),Math.round((p.y-r.y)*devicePixelRatio),1,1).data);
    },point);
  }
  async function saved() {
    const pending=page.waitForEvent("download");
    await canvas.focus(); await page.keyboard.press("ControlOrMeta+s");
    const {document} = await decodeFigcraft(await readFile((await (await pending).path())!));
    return document.nodes["2"] as RectangleNode;
  }
  async function drag(x:number,y:number,toX:number,toY:number) {
    const a=await canvasPoint(page,x,y), b=await canvasPoint(page,toX,toY);
    await page.mouse.move(a.x,a.y); await page.mouse.down();
    await page.mouse.move(b.x,b.y,{steps:4}); await page.mouse.up();
  }
  const background=await sample(300,130);
  await expect.poll(()=>sample(250,130)).not.toEqual(background);
  const retained=await sample(145,135), removed=await sample(250,130);
  const centre=await canvasPoint(page,150,145);
  await page.mouse.click(centre.x,centre.y,{button:"right"});
  await page.getByRole("group",{name:"Canvas actions"}).getByRole("button",{name:"Crop image"}).click();
  await drag(280,160,220,160);
  const resized=await saved();
  expect(resized).toMatchObject({x:100,y:100,width:120,height:120});
  const paint=rectanglePaints(resized)[0];
  if (paint.type!=="image") throw Error("Expected cropped image fill");
  expect(paint.scale_mode).toBe("crop"); expect(paint.crop?.[0]).toBeCloseTo(2/3);
  await expectCanvasPixel(page,145,135,retained);
  const ghost=removed.map((v,i)=>Math.round(v*115/255+background[i]*(1-115/255)));
  await expectCanvasPixel(page,250,130,ghost);
  const clip=await canvasPoint(page,91,91);
  await expect(page).toHaveScreenshot("image-crop-brackets.png",{clip:{...clip,width:198,height:138},animations:"disabled"});
  await page.keyboard.press("Enter");
  await expectCanvasPixel(page,250,130,background);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await saved()).toMatchObject({width:180,height:120});
  await page.getByRole("button",{name:"Crop fill 1 image",exact:true}).click();
  await drag(150,145,165,155);
  const moved=await saved();
  expect(moved).toMatchObject({x:100,y:100,width:180,height:120});
  const movedPaint=rectanglePaints(moved)[0];
  if(movedPaint.type!=="image") throw Error("Expected moved image fill");
  expect(movedPaint.crop?.[4]).toBeCloseTo(-15/180);
  expect(movedPaint.crop?.[5]).toBeCloseTo(-10/120);
  await page.keyboard.press("Escape"); await page.keyboard.press("ControlOrMeta+z");
  expect(rectanglePaints(await saved())[0]).toMatchObject({scale_mode:"crop",crop:[1,0,0,1,0,0]});
  await page.locator("summary").getByText("Object",{exact:true}).click();
  await page.getByRole("button",{name:"Crop image",exact:true}).click();
  const outside=await canvasPoint(page,320,240);
  await page.mouse.click(outside.x,outside.y);
  await expect(page.getByRole("button",{name:"Crop fill 1 image",exact:true})).toBeHidden();
});

test("the editor holds an animated GIF on frame one at idle and refuses unsafe progressive JPEG placement atomically",async({page})=>{
  await login(page);
  const open=page.getByLabel("Open Figcraft file",{exact:true});
  const gif=await readFile(new URL("../fixtures/images/red-green-animated.gif",import.meta.url));
  await open.setInputFiles({name:"Animated.gif",mimeType:"image/gif",buffer:gif});
  await expect(page.getByRole("heading",{name:"Animated",exact:true})).toBeVisible();
  await resetCanvasOrigin(page);
  await expectCanvasPixel(page,1,1,[255,0,0,255]);
  await expect(page.getByText("Recovery saved on this device",{exact:true})).toBeVisible();
  const idle=await page.evaluate(async()=>{
    const node=document.querySelector<HTMLCanvasElement>("canvas[aria-label='Design canvas']")!;
    const renders=()=>performance.getEntriesByName("figcraft:render").length;
    const count=renders(), colours=[];
    for(let i=0;i<8;i++) {
      await new Promise(resolve=>setTimeout(resolve,40));
      colours.push(Array.from(node.getContext("2d")!.getImageData(1,1,1,1).data));
    }
    return {renders:renders()-count,colours};
  });
  expect(idle.renders).toBe(0);
  expect(idle.colours).toEqual(Array(8).fill([255,0,0,255]));
  const jpeg=await readFile(new URL("../fixtures/images/progressive.jpg",import.meta.url));
  const place=page.getByLabel("Place image file",{exact:true});
  const damaged=Buffer.from(jpeg), frame=damaged.indexOf(Buffer.from([255,194]));
  expect(frame).toBeGreaterThan(0); damaged[frame+14]=0x21;
  await place.setInputFiles({name:"Unsupported.jpg",mimeType:"image/jpeg",buffer:damaged});
  await expect(page.locator("main [role=alert]")).toContainText("can't be read");
  await expect(page.getByText("1 layer",{exact:true})).toBeVisible();
  await place.setInputFiles({name:"Valid.jpg",mimeType:"image/jpeg",buffer:jpeg});
  await expect(page.getByText("2 layers",{exact:true})).toBeVisible();
  const pending=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const members=unzipSync(await readFile((await (await pending).path())!));
  const originals=Object.entries(members).filter(([key])=>key.startsWith("images/")).map(([,data])=>Buffer.from(data));
  expect(originals.some(bytes=>bytes.equals(gif))).toBe(true);
  expect(originals.some(bytes=>bytes.equals(jpeg))).toBe(true);
  expect(originals).toHaveLength(2);
});

test("PNG source profiles keep the native gamma labels and convert canvas pixels into sRGB",async({page})=>{
  await login(page);
  const input=page.getByLabel("Open Figcraft file",{exact:true});
  const files=[
    {name:"gamma-linear",profile:"Gamma 1.00",grey:188,colour:[229,152,133,255]},
    {name:"gamma-wide",profile:"Gamma 2.20",grey:129,colour:[230,79,56,255]},
    {name:"gamma-srgb",profile:"sRGB",grey:128,colour:[200,80,60,255]}
  ];
  for(const [index,{name,profile,grey,colour}] of files.entries()){
    await input.setInputFiles(new URL("../fixtures/images/"+name+".png",import.meta.url).pathname);


    await expect(page.getByRole("heading",{name,exact:true})).toBeVisible();
    await resetCanvasOrigin(page);
    await expectCanvasPixel(page,0,0,[grey,grey,grey,255]);
    await expectCanvasPixel(page,1,0,colour);
    await page.getByRole("list",{name:"Page layers",exact:true}).getByRole("button",{name,exact:true}).click();
    await page.getByRole("button",{name:"Edit fill 1 paint",exact:true}).click();
    const picker=page.getByRole("group",{name:"fill 1 paint picker",exact:true});
    await expect(picker.getByText("Color profile: "+profile,{exact:true})).toBeVisible();
    await picker.getByRole("button",{name:"Close paint picker"}).click();
  }
});

test("embedded ICC profiles convert PNG JPEG WebP and TIFF pixels and survive a native file round trip",async({page})=>{
  await login(page);
  const input=page.getByLabel("Open Figcraft file",{exact:true});
  const files=["png","jpg","webp","tiff"];
  for(const [i,ext] of files.entries()){
    const file="icc-adobe."+ext, name=ext+"-adobe";
    await input.setInputFiles({name:name+"."+ext,mimeType:"application/octet-stream",buffer:await readFile(new URL("../fixtures/images/"+file,import.meta.url))});


    await expect(page.getByRole("heading",{name,level:1,exact:true})).toBeVisible();
    await resetCanvasOrigin(page);
    // D65 Adobe RGB (1998) [200,80,60] mapped through XYZ to sRGB.
    await expectCanvasPixel(page,20,1,[230,79,56,255]);
    await page.getByRole("list",{name:"Page layers",exact:true}).getByRole("button",{name,exact:true}).click();
    await page.getByRole("button",{name:"Edit fill 1 paint",exact:true}).click();
    const picker=page.getByRole("group",{name:"fill 1 paint picker",exact:true});
    await expect(picker.getByText("Color profile: Adobe RGB (1998)",{exact:true})).toBeVisible();
    await picker.getByRole("button",{name:"Close paint picker"}).click();
  }
  const pending=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=await readFile((await (await pending).path())!);
  const doc=(await decodeFigcraft(saved)).document;
  const image=Object.values(doc.images!)[0];
  expect(image.profileName).toBe("Adobe RGB (1998)");
  expect(Buffer.from(await image.bytes.arrayBuffer())).toEqual(await readFile(new URL("../fixtures/images/icc-adobe.tiff",import.meta.url)));
  await input.setInputFiles({name:"Recovered.figcraft",mimeType:"application/octet-stream",buffer:saved});

  await resetCanvasOrigin(page);
  await expectCanvasPixel(page,20,1,[230,79,56,255]);
});

test("grey and lookup-table ICC profiles preserve opacity and match the native picker pixels",async({page})=>{
  await login(page);
  const files=[
    {name:"icc-grey",label:"Linear grey",pixels:[188,188,188,255,188,188,188,128]},
    {name:"icc-lut",label:"Grey LUT",pixels:[119,119,119,255,194,194,194,128]}
  ];
  for(const [i,{name,label,pixels}] of files.entries()){
    await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(new URL("../fixtures/images/"+name+".png",import.meta.url).pathname);


    await expect(page.getByRole("heading",{name,level:1,exact:true})).toBeVisible();
    await page.getByRole("list",{name:"Page layers",exact:true}).getByRole("button",{name,exact:true}).click();
    await page.getByRole("button",{name:"Edit fill 1 paint",exact:true}).click();
    const picker=page.getByRole("group",{name:"fill 1 paint picker",exact:true});
    await expect(picker.getByText("Color profile: "+label,{exact:true})).toBeVisible();
    const preview=picker.getByLabel("Image preview");
    await expect.poll(()=>preview.evaluate((canvas:HTMLCanvasElement, reference)=>{
      const values=canvas.getContext("2d")!.getImageData(0,0,2,1).data;
      return values.every((x,i)=>Math.abs(x-reference[i])<=(i%4===3?0:3));
    },pixels)).toBe(true);
    await picker.getByRole("button",{name:"Close paint picker"}).click();
  }
});

test("file profile dialog converts or assigns colours, previews the composite and recovers the working space", async ({page}) => {
  await login(page);
  const native = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8"));
  native.nodes["2"].fills[0].color = {r: 0.8, g: 0.4, b: 0.2, a: 1};
  const file = page.getByLabel("Open Figcraft file", {exact:true});
  await file.setInputFiles({ name:"Colour.figcraft", mimeType:"application/json", buffer:Buffer.from(JSON.stringify(native)) });
  await resetCanvasOrigin(page);
  await expectCanvasPixel(page,20,30,[204,102,51,255]);
  const dialog = page.getByRole("dialog",{name:"Color profile",exact:true});
  const open = async () => {
    await page.getByText("File", {exact:true}).click();
    await page.getByRole("button",{name:"Color profile",exact:true}).click();
    await expect(dialog).toBeVisible();
  };
  await open();
  await expect(dialog.getByRole("radio",{name:"sRGB (current)",exact:true})).toBeChecked();
  await dialog.getByRole("radio",{name:"Display P3",exact:true}).check();
  await expect(dialog).toHaveScreenshot("document-working-profile.png", {animations:"disabled"});
  await dialog.getByRole("button",{name:"Keep appearance"}).click();
  await expectCanvasPixel(page,20,30,[204,102,51,255]);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await open();
  await dialog.getByRole("radio",{name:"Display P3",exact:true}).check();
  await dialog.getByRole("button",{name:"Keep values"}).click();
  // Display P3 (0.8, 0.4, 0.2), converted via D65 XYZ into the sRGB screen preview.
  await expectCanvasPixel(page,20,30,[219,94,31,255]);
  const download = page.waitForEvent("download");
  await page.getByRole("button", {name:"Save as",exact:true}).click();
  const bytes = await readFile((await (await download).path())!);
  const wire = JSON.parse(strFromU8(unzipSync(bytes)["document.json"]));
  expect(wire.color_profile).toBe("displayP3");
  expect(wire.nodes["2"].fills[0].color.r).toBeCloseTo(.8, 6);
  await expect(page.locator(".figcraft-recovery")).toContainText(/saved/i);
  await page.reload();
  await resetCanvasOrigin(page);
  await expectCanvasPixel(page,20,30,[219,94,31,255]);
  await page.setViewportSize({width:390,height:844});
  await open();
  await expect(dialog.getByRole("radio",{name:"Display P3 (current)",exact:true})).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("working-space image filters use direct ICC and PNG gamma conversion and reuse images after switching the file profile", async ({page}) => {
  await login(page);
  const native = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8"));
  native.color_profile = "displayP3";
  const members: Record<string, Uint8Array> = {};
  for (const [i, name] of ["icc","gamma","plain"].entries()) {
    const node = structuredClone(native.nodes["2"]);
    node.id = 2+i; node.name = name; node.transform = [1,0,0,1,10+40*i,20];
    node.fills = [{type:"image",image:name,filters:{saturation:-1}}];
    native.nodes[String(node.id)] = node;
    members["images/"+name] = await readFile(new URL("../fixtures/images/red-"+name+".png",import.meta.url));
  }
  native.next_id = 5; native.nodes["1"].children = [2,3,4];
  members["document.json"] = new TextEncoder().encode(JSON.stringify(native));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({
    name:"Working space.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(zipSync(members))
  });
  await resetCanvasOrigin(page);
  // Adobe red in P3 composes grey from (255,61,43). Untagged red is filtered in sRGB.
  for (const [x,v] of [[20,101],[60,101],[100,54]]) await expectCanvasPixel(page,x,30,[v,v,v,255]);
  await page.getByText("File",{exact:true}).click();
  await page.getByRole("button",{name:"Color profile",exact:true}).click();
  const dialog = page.getByRole("dialog",{name:"Color profile"});
  await dialog.getByRole("radio",{name:"sRGB",exact:true}).check();
  await dialog.getByRole("button",{name:"Keep values"}).click();
  for (const x of [20,60,100]) await expectCanvasPixel(page,x,30,[54,54,54,255]);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expectCanvasPixel(page,20,30,[101,101,101,255]);
});

test("P3 gamut warning and soft proof identify clipped colours and clear on a fresh file", async ({page}) => {
  await login(page);
  const doc = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json", import.meta.url),"utf8"));
  doc.color_profile="displayP3"; doc.nodes["2"].fills[0].color={r:0,g:1,b:0,a:1};
  const input = page.getByLabel("Open Figcraft file",{exact:true});
  const open = () => input.setInputFiles({name:"Gamut.figcraft",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(doc))});
  await open(); await resetCanvasOrigin(page);
  await page.locator("summary").filter({hasText:/^View$/}).click();
  const proof = page.getByRole("button",{name:"Soft-proof sRGB",exact:true});
  await expect(proof).toHaveAttribute("aria-pressed","false");
  await proof.click();
  await expectCanvasPixel(page,20,28,[128,128,128,255]);
  await expectCanvasPixel(page,24,28,[0,255,0,255]);
  await page.getByRole("list",{name:"Page layers",exact:true}).getByRole("button",{name:"Rectangle",exact:true}).click();
  await page.getByRole("button",{name:"Edit fill 1 paint",exact:true}).click();
  await expect(page.getByText("Outside sRGB",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Close paint picker"}).click();
  await open();


  await page.locator("summary").filter({hasText:/^View$/}).click();
  await expect(proof).toHaveAttribute("aria-pressed","false");
  await expectCanvasPixel(page,20,28,[0,255,0,255]);
});

test("two- and four-component JPEG TIFFs keep native CMYK and alpha pixels on open and save", async ({page}) => {
  await login(page);
  let workers = 0;
  page.on("worker", () => { workers++; });
  const open = page.getByLabel("Open Figcraft file", {exact:true});
  for (const [i, [name, sampled]] of ([
    ["raw-cmyk",[111,79,15,255]], ["raw-rgba",[138,170,234,255]], ["raw-grey-alpha",[165,165,165,255]], ["raw-hv",[16,0,192,255]], ["raw-worker",[138,170,234,255]],
  ] as const).entries()) {
    const beforeWorkers = workers;
    const original = await readFile(new URL("../fixtures/images/"+name+".tiff",import.meta.url));
    await open.setInputFiles({name:name+".tiff",mimeType:"image/tiff",buffer:original});

    await expect(page.getByRole("heading",{name,exact:true,level:1})).toBeVisible();
    await resetCanvasOrigin(page);
    await expectCanvasPixel(page,12,3,sampled);
    if (name === "raw-hv") await expectCanvasPixel(page,15,15,[16,112,80,255]);
    if (name === "raw-worker") expect(workers).toBeGreaterThan(beforeWorkers);
    const download = page.waitForEvent("download");
    await page.getByRole("button",{name:"Save as",exact:true}).click();
    const archive = unzipSync(await readFile((await (await download).path())!));
    const key = Object.keys(archive).find(key=>key.startsWith("images/"))!;
    expect(Buffer.from(archive[key])).toEqual(original);
  }
});

test("native archives stream through file selection, recovery and download without base64 copies", async ({page}) => {
  await page.addInitScript(() => {
    const encode = window.btoa, decode = window.atob;
    window.btoa = data => {
      if (data.length > 1024 * 1024) throw Error("Full archive base64 encoding");
      return encode(data);
    };
    window.atob = data => {
      if (data.length > 1024 * 1024) throw Error("Full archive base64 decoding");
      return decode(data);
    };
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function() {
      if (this.name === "stream.figcraft") throw Error("Full input archive read");
      return original.call(this);
    };
  });
  await login(page);
  const client = await page.context().newCDPSession(page);
  const memory: Record<string, unknown> = {};
  const sample = async (stage: string) => { memory[stage] = await client.send("Runtime.getHeapUsage"); };
  await sample("beforeOpen");
  const width = 2048, height = 4096, pixels = width * height * 3;
  const payload = Buffer.alloc(54 + pixels, 37);
  payload.fill(0,0,54);
  payload.write("BM"); payload.writeUInt32LE(payload.length,2); payload.writeUInt32LE(54,10);
  payload.writeUInt32LE(40,14); payload.writeUInt32LE(width,18); payload.writeUInt32LE(height,22);
  payload.writeUInt16LE(1,26); payload.writeUInt16LE(24,28); payload.writeUInt32LE(pixels,34);
  const native = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json",import.meta.url),"utf8"));
  native.nodes["2"].fills = [{type:"image",image:"legacy",scale_mode:"fill"}];
  const archive = zipSync({"document.json":Buffer.from(JSON.stringify(native)), "images/legacy":[payload,{level:0}]});
  // File-path selection avoids Playwright serialising a 24 MiB buffer into the measured renderer.
  const input = test.info().outputPath("stream.figcraft");
  await writeFile(input,archive);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(input);
  await expect(page.getByText("1 layer",{exact:true})).toBeVisible();
  await resetCanvasOrigin(page);
  await expectCanvasPixel(page,15,25,[37,37,37,255]);
  await sample("afterOpen");
  await page.getByRole("button",{name:"Create rectangle",exact:true}).click();
  await expect(page.getByText("Recovery saved on this device",{exact:true})).toBeVisible();
  await sample("afterRecoveryWrite");
  await page.reload();
  await expect(page.getByText("2 layers",{exact:true})).toBeVisible();
  await sample("afterRestore");
  const pending = page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const restored = unzipSync(await readFile((await (await pending).path())!));
  expect(Buffer.compare(restored["images/legacy"], payload)).toBe(0);
  await sample("afterDownload");
  await test.info().attach("archive-memory",{contentType:"application/json",body:Buffer.from(JSON.stringify(memory))});
  await client.detach();
  await rm(input);
});

test("large native JSON records stream through open, device recovery and save", async ({page}) => {
  const native = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json",import.meta.url),"utf8"));
  const count = 256, longName = "ü🎨".repeat(12000);
  native.name = "Streamed JSON"; native.pages.push(3);
  native.nodes["3"] = {...native.nodes["1"],id:3,name:"Long layer labels",children:[]};
  for (let i=0; i<count; i++) {
    const id = 4+i;
    native.nodes[id] = {...native.nodes["2"],id,parent:3,name:longName+i};
    native.nodes["3"].children.push(id);
  }
  native.next_id = 4 + count;
  const json = Buffer.from(JSON.stringify(native));
  expect(json.length).toBeGreaterThan(16 * 1024 * 1024);
  const path = test.info().outputPath("records.figcraft");
  await writeFile(path,zipSync({"document.json":json}));
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(path);
  await expect(page.getByRole("heading",{name:"Streamed JSON",exact:true,level:1})).toBeVisible();
  await page.getByRole("button",{name:"Create rectangle",exact:true}).click();
  await expect(page.getByText("Recovery saved on this device",{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByText("2 layers",{exact:true})).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved = unzipSync(await readFile((await (await pending).path())!))["document.json"];
  expect(saved.byteLength).toBeGreaterThan(16 * 1024 * 1024);
  const root = JSON.parse(strFromU8(saved));
  expect(root.nodes["3"].children).toEqual(native.nodes["3"].children);
  expect(root.nodes[3+count].name === longName+(count-1)).toBe(true);
  await rm(path);
});

test("wide native pages window layer rows and retain offscreen edits through recovery and save", async ({page}) => {
  test.setTimeout(90_000);
  const native = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json",import.meta.url),"utf8"));
  native.name = "Wide layer tree";
  const children = native.nodes["1"].children;
  for (let id = 3; id <= 10242; id++) {
    native.nodes[id] = {...native.nodes["2"], id, name:"Layer " + id, transform:[1,0,0,1,id*75,20]};
    children.push(id);
  }
  for (let id = 10243; id <= 10322; id++) {
    native.nodes[id] = {id,parent:1,type:"group",name:"Group " + id,children:[],width:10,height:10};
    children.push(id);
  }
  native.next_id = 10323;
  const input = test.info().outputPath("wide.figcraft");
  await writeFile(input,zipSync({"document.json":Buffer.from(JSON.stringify(native))}));
  await login(page);
  const cdp = await page.context().newCDPSession(page);
  const memory: Record<string,number> = {};
  const sample = async (key: string) => { memory[key] = (await cdp.send("Runtime.getHeapUsage")).usedSize; };
  await sample("beforeOpen");
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(input);
  await expect(page.getByRole("heading",{name:native.name,level:1})).toBeVisible();
  const view = page.getByRole("region",{name:"Scroll layers"});
  const rows = view.locator("li");
  await expect(view.getByRole("button",{name:"Group 10322",exact:true})).toBeVisible();
  expect(await rows.count()).toBeLessThan(20);
  const destinations = page.getByRole("combobox",{name:"Move selection into",exact:true});
  await expect(destinations.locator("option")).toHaveCount(64);
  await sample("afterOpen");
  await view.getByRole("button",{name:"Group 10322",exact:true}).press("End");
  const rectangle = view.getByRole("button",{name:"Rectangle",exact:true});
  await expect(rectangle).toBeFocused();
  await rectangle.press("Enter");
  await expect(view.locator('li[aria-current="true"]')).toHaveAttribute("data-layer-id","2");
  await page.getByRole("button",{name:"Next destinations"}).click();
  await expect(destinations.locator("option")).toHaveCount(17);
  await page.getByRole("searchbox",{name:"Find destination"}).fill("Group 10243");
  await expect(destinations.locator("option")).toHaveCount(1);
  await page.getByRole("button",{name:"Move selection",exact:true}).click();
  await expect(page.getByText("Recovery saved on this device",{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading",{name:native.name,level:1})).toBeVisible();
  const top = view.getByRole("button",{name:"Group 10322",exact:true});
  await expect(top).toBeVisible();
  await view.evaluate(el => { el.scrollTop = 78 * 32; });
  const collapse = view.getByRole("button",{name:"Collapse group Group 10243",exact:true});
  await expect(rectangle).toBeVisible();
  await collapse.click();
  await expect(rectangle).toHaveCount(0);
  await view.getByRole("button",{name:"Expand group Group 10243",exact:true}).click();
  await rectangle.focus();
  await rectangle.press("ArrowLeft");
  const group = view.getByRole("button",{name:"Group 10243",exact:true});
  await expect(group).toBeFocused();
  await group.press("ArrowLeft");
  await expect(rectangle).toHaveCount(0);
  await group.press("ArrowRight");
  await group.press("ArrowRight");
  await expect(rectangle).toBeFocused();
  await expect(view.getByRole("treeitem",{level:2})).toHaveAttribute("aria-posinset","1");
  await rectangle.click();
  await expect(view.locator('li[aria-current="true"]')).toHaveAttribute("data-layer-id","2");
  expect(await rows.count()).toBeLessThan(20);
  await sample("afterRecovery");
  const pending = page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved = JSON.parse(strFromU8(unzipSync(await readFile((await (await pending).path())!))["document.json"]));
  expect(saved.nodes["10243"].children).toEqual([2]);
  expect(saved.nodes["2"].parent).toBe(10243);
  expect(Object.keys(saved.nodes)).toHaveLength(10322);
  await sample("afterSave");
  await test.info().attach("wide-page-heap",{contentType:"application/json",body:Buffer.from(JSON.stringify(memory))});
  await cdp.detach();
  await rm(input);
});

test("copied image fills and strokes survive a different file using the same image key", async ({page})=>{
  const fixture = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json",import.meta.url),"utf8"));
  const source = await readFile(new URL("../fixtures/images/six-pixels.png",import.meta.url));
  const taken = await readFile(new URL("../fixtures/images/icc-lut.png",import.meta.url));
  const archive = (sourceFile: boolean) => {
    const doc = structuredClone(fixture);
    doc.name = sourceFile ? "Clipboard source" : "Clipboard destination";
    doc.nodes["2"].fills = [{type:"image",image:"legacy",scale_mode:"tile"}];
    if (sourceFile) {
      doc.nodes["2"].strokes = doc.nodes["2"].fills;
      doc.nodes["2"].stroke = {weight:7,align:"inside"};
    } else {
      doc.nodes["3"] = {...doc.nodes["2"],id:3,name:"Destination picture",transform:[1,0,0,1,70,20]};
      doc.nodes["1"].children.push(3); doc.next_id = 4;
    }
    return Buffer.from(zipSync({"document.json":Buffer.from(JSON.stringify(doc)),"images/legacy":sourceFile?source:taken}));
  };
  await login(page);
  const open = async (sourceFile: boolean) => {
    await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"Clipboard.figcraft",mimeType:"application/octet-stream",buffer:archive(sourceFile)});

    await expect(page.getByRole("heading",{name:sourceFile?"Clipboard source":"Clipboard destination",level:1})).toBeVisible();
    await page.getByRole("list",{name:"Page layers",exact:true}).getByRole("button",{name:"Rectangle",exact:true}).click();
  };
  for (const list of ["fill","stroke"] as const) {
    await open(true);
    const label = list === "fill" ? "Fill" : "Stroke";
    await page.getByLabel(label+" 1 opacity",{exact:true}).click({button:"right"});
    await page.getByRole("button",{name:"Copy "+list,exact:true}).click();
    await open(false);
    const target = list === "fill" ? page.getByLabel("Fill 1 opacity",{exact:true}) : page.getByRole("button",{name:"Add stroke",exact:true});
    await target.focus(); await target.press("Shift+F10");
    await page.getByRole("button",{name:"Paste "+list,exact:true}).click();
    await expect(page.getByText("Recovery saved on this device",{exact:true})).toBeVisible();
    await page.reload(); await resetCanvasOrigin(page);
    if (list === "fill") await expectCanvasPixel(page,13,22,[255,0,0,255]);
    const pending = page.waitForEvent("download");
    await page.getByRole("button",{name:"Save as",exact:true}).click();
    const members = unzipSync(await readFile((await (await pending).path())!));
    const root = JSON.parse(strFromU8(members["document.json"]));
    const key = root.nodes["2"][list === "fill" ? "fills" : "strokes"][0].image;
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(root.nodes["3"].fills[0].image).toBe("legacy");
    if (list === "stroke") expect(root.nodes["2"].stroke.weight).toBe(7);
    expect(Buffer.from(members["images/"+key])).toEqual(source);
    expect(Buffer.from(members["images/legacy"])).toEqual(taken);
  }
});

test("pattern picker tiles a live source, scrubs once and recovers its native file", async ({page}) => {
  await login(page);
  await createNamedRectangle(page,"Tile",22,20,10,10);
  const picker=page.getByRole("group",{name:"fill 1 paint picker",exact:true});
  const open=page.getByRole("button",{name:"Edit fill 1 paint",exact:true});
  await open.click();
  await picker.getByLabel("Paint type").selectOption("pattern");
  await expect(picker.getByRole("status")).toHaveText("Add a layer or component to tile first");
  await expect(picker.getByLabel("Paint type")).toHaveValue("solid");
  await picker.getByRole("button",{name:"Close paint picker"}).click();
  await createNamedRectangle(page,"Destination",80,80,100,100);
  await open.click();
  await picker.getByLabel("Paint type").selectOption("pattern");
  await expect(picker.getByLabel("Pattern source").locator("option")).toHaveText(["Tile"]);
  await picker.getByLabel("Tile type").selectOption("horizontalHex");
  await picker.getByLabel("Pattern alignment").selectOption("center");
  for (const [label,n] of [["Scale (%)","200"],["Horizontal gap","10"],["Vertical gap","16"]]) {
    const control=picker.getByRole("spinbutton",{name:label,exact:true});
    await control.fill(n);
    await control.press("Enter");
  }
  const canvas=page.getByLabel("Design canvas",{exact:true});
  const scrub=picker.getByRole("button",{name:"Scrub Horizontal gap"});
  const box=(await scrub.boundingBox())!;
  await page.mouse.move(box.x+8,box.y+8); await page.mouse.down();
  await page.mouse.move(box.x+38,box.y+8,{steps:5}); await page.mouse.up();
  await expect(picker.getByRole("spinbutton",{name:"Horizontal gap",exact:true})).toHaveValue("40");
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect(picker.getByRole("spinbutton",{name:"Horizontal gap",exact:true})).toHaveValue("10");
  await expect(picker).toHaveScreenshot("live-pattern-picker.png",{animations:"disabled",maxDiffPixels:0});
  await page.setViewportSize({width:390,height:844});
  await picker.getByLabel("Tile type").selectOption("verticalHex");
  await picker.getByLabel("Pattern alignment").selectOption("end");
  const bounds=(await picker.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({width:1440,height:900});
  await picker.getByRole("button",{name:"Close paint picker"}).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await expect(page.getByRole("list",{name:"Page layers"}).getByRole("button",{name:"Destination",exact:true})).toBeVisible();
  const pending=page.waitForEvent("download");
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+s");
  const doc=(await decodeFigcraft(await readFile((await (await pending).path())!))).document;
  expect(rectanglePaints(doc.nodes["3"] as RectangleNode)[0]).toMatchObject({type:"pattern",source:"2",tile:"verticalHex",align:"end",spacing:[10,16],scale:2});
});

test("stroke and regional pattern pickers retain their own paint stacks", async ({page}) => {
  const engine = new EditorEngine();
  const src=String(engine.execute("shape.rectangle",{name:"Tile",x:500,y:10,width:10,height:10,props:{fill:"blue"}}).id);
  const id=String(engine.execute("vector.create",{x:120,y:120,name:"Faces",path:"M0 0H80V80H0Z M100 0H180V80H100Z",props:{fill:"red"}}).id);
  const doc=engine.getSnapshot().document, node=doc.nodes[id] as VectorNode;
  const regions=node.network.regions[0].loops.map(loop=>({winding:"nonZero" as const,loops:[loop]}));
  const bytes=await encodeFigcraft({...doc,nodes:{...doc.nodes,[id]:{...node,network:{...node.network,regions}}}});
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"patterns.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(bytes)});
  const layer=page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Faces",exact:true});
  await expect(layer).toBeVisible(); await resetCanvasOrigin(page); await layer.click();
  const stroke=page.getByRole("group",{name:"Stroke",exact:true});
  await stroke.getByRole("button",{name:"Add stroke",exact:true}).click();
  await stroke.getByRole("button",{name:"Edit stroke 1 paint"}).click();
  const sp=stroke.getByRole("group",{name:"stroke 1 paint picker"});
  await sp.getByLabel("Paint type").selectOption("pattern");
  await sp.getByLabel("Tile type").selectOption("verticalHex");
  await sp.getByRole("button",{name:"Close paint picker"}).click();
  await page.getByRole("button",{name:"Edit vector",exact:true}).click();
  const right=await canvasPoint(page,250,155); await page.mouse.click(right.x,right.y);
  await page.getByRole("button",{name:"Edit fill 1 paint",exact:true}).click();
  const fp=page.getByRole("group",{name:"fill 1 paint picker",exact:true});
  await fp.getByLabel("Paint type").selectOption("pattern");
  await fp.getByRole("button",{name:"Close paint picker"}).click();
  await page.getByRole("button",{name:"Done editing",exact:true}).click();
  await expectCanvasPixel(page,150,155,[255,0,0,255]);
  await expectCanvasPixel(page,250,155,[0,0,255,255]);
  const pending=page.waitForEvent("download"); await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=(await decodeFigcraft(await readFile((await (await pending).path())!))).document.nodes[id] as VectorNode;
  expect(rectanglePaints(saved)[0].type).toBe("solid");
  expect(saved.strokes).toMatchObject([{type:"pattern",source:src,tile:"verticalHex"}]);
  expect(saved.network.regions[0].fills).toBeUndefined();
  expect(saved.network.regions[1].fills).toMatchObject([{type:"pattern",source:src,tile:"grid"}]);
});

test("layer and paint blend menus preview without history, commit once and recover a native file",async({page})=>{
  const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("response",response=>{if(response.status()>=400) errors.push(response.status()+" "+new URL(response.url()).pathname);});
  const e=new EditorEngine();
  e.execute("page.setBackground",{color:"yellow"});
  const id=String(e.execute("shape.rectangle",{x:120,y:100,width:100,height:80,name:"Blend target",props:{fill:"cyan"}}).id);
  const bytes=await encodeFigcraft(e.getSnapshot().document);
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"blend.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(bytes)});
  const layer=page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Blend target",exact:true});
  await expect(layer).toBeVisible(); await resetCanvasOrigin(page); await layer.click();
  await expectCanvasPixel(page,150,130,[0,255,255,255]);
  const toggle=page.getByRole("button",{name:"Blend mode",exact:true});
  const layerButton=page.getByRole("button",{name:"Layer blend mode",exact:true});
  const layerMenu=page.getByRole("menu",{name:"Layer blend mode",exact:true});
  const undo=page.getByRole("button",{name:"Undo",exact:true});
  await toggle.click(); await layerButton.click();
  await expect(layerMenu.getByRole("menuitemradio")).toHaveCount(19);
  const multiply=layerMenu.getByRole("menuitemradio",{name:"Multiply",exact:true});
  await multiply.hover(); await expectCanvasPixel(page,150,130,[0,255,0,255]);
  await expect(undo).toBeDisabled();
  await expect(layerMenu).toHaveScreenshot("layer-blend-menu.png",{animations:"disabled"});
  await page.mouse.move(4,4); await expectCanvasPixel(page,150,130,[0,255,255,255]);
  await multiply.hover(); await page.keyboard.press("Escape");
  await expect(layerMenu).toHaveCount(0); await expect(layerButton).toBeFocused();
  await expectCanvasPixel(page,150,130,[0,255,255,255]); await expect(undo).toBeDisabled();
  await layerButton.press("ArrowDown");
  await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
  await expect(multiply).toBeFocused(); await expectCanvasPixel(page,150,130,[0,255,0,255]);
  await page.keyboard.press("Enter"); await expect(layerButton).toHaveText("Multiply");
  await undo.click(); await expect(undo).toBeDisabled();
  await expectCanvasPixel(page,150,130,[0,255,255,255]);
  const edit=page.getByRole("button",{name:"Edit fill 1 paint",exact:true});
  await edit.click();
  const paintButton=page.getByRole("button",{name:"fill 1 blend mode",exact:true});
  const paintMenu=page.getByRole("menu",{name:"fill 1 blend mode",exact:true});
  await paintButton.click();
  await expect(paintMenu.getByRole("menuitemradio")).toHaveCount(18);
  await expect(paintMenu.getByRole("menuitemradio",{name:"Pass through"})).toHaveCount(0);
  const darker=paintMenu.getByRole("menuitemradio",{name:"Plus darker",exact:true});
  await darker.hover(); await expectCanvasPixel(page,150,130,[0,255,0,255]);
  await page.getByRole("heading",{name:"Appearance",exact:true}).click();
  await expect(paintMenu).toHaveCount(0); await expectCanvasPixel(page,150,130,[0,255,255,255]);
  await edit.click(); await paintButton.click();
  // Inspect the first mobile layout before JavaScript receives its resize notification.
  await page.evaluate(()=>window.addEventListener("resize",event=>event.stopImmediatePropagation(),{capture:true,once:true}));
  await page.setViewportSize({width:390,height:700});
  const bounds=(await paintMenu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y+bounds.height).toBeLessThanOrEqual(700);
  await darker.click(); await expect(paintButton).toHaveText("Plus darker");
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole("button",{name:"Close paint picker"}).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload(); await expect(layer).toBeVisible(); await resetCanvasOrigin(page);
  await expectCanvasPixel(page,150,130,[0,255,0,255]);
  const pending=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const doc=(await decodeFigcraft(await readFile((await (await pending).path())!))).document;
  expect(rectanglePaints(doc.nodes[id] as RectangleNode)[0].blend).toBe("plusDarker");
  expect((doc.nodes[id] as RectangleNode).blend ?? "normal").toBe("normal");
  expect(errors).toEqual([]);
});

test("stroke and region blend menus keep the layer and other vector faces independent",async({page})=>{
  const engine=new EditorEngine();
  engine.execute("page.setBackground",{color:"yellow"});
  const id=String(engine.execute("vector.create",{name:"Blend faces",x:120,y:120,path:"M0 0H80V80H0Z M100 0H180V80H100Z",
    props:{fill:"cyan",strokes:["cyan"],strokeWeight:6}}).id);
  const initial=engine.getSnapshot().document, vector=initial.nodes[id] as VectorNode;
  const regions=vector.network.regions[0].loops.map(loop=>({winding:"nonZero" as const,loops:[loop]}));
  const bytes=await encodeFigcraft({...initial,nodes:{...initial.nodes,[id]:{...vector,network:{...vector.network,regions}}}});
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"faces.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(bytes)});
  const layer=page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Blend faces",exact:true});
  await expect(layer).toBeVisible(); await resetCanvasOrigin(page); await layer.click();
  async function choose(list:"stroke"|"fill",mode:string) {
    await page.getByRole("button",{name:"Edit "+list+" 1 paint",exact:true}).click();
    const label=list+" 1 blend mode";
    await page.getByRole("button",{name:label,exact:true}).click();
    await page.getByRole("menu",{name:label,exact:true}).getByRole("menuitemradio",{name:mode,exact:true}).click();
    await page.getByRole("button",{name:"Close paint picker",exact:true}).click();
  }
  await choose("stroke","Difference");
  await page.getByRole("button",{name:"Edit vector",exact:true}).click();
  const right=await canvasPoint(page,250,155); await page.mouse.click(right.x,right.y);
  await choose("fill","Multiply");
  await page.getByRole("button",{name:"Done editing",exact:true}).click();
  await expectCanvasPixel(page,150,155,[0,255,255,255]);
  await expectCanvasPixel(page,250,155,[0,255,0,255]);
  const pending=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const doc=(await decodeFigcraft(await readFile((await (await pending).path())!))).document;
  const node=doc.nodes[id] as VectorNode;
  expect(node.strokes?.[0].blend).toBe("difference");
  expect(rectanglePaints(node)[0].blend).toBe("normal");
  expect(node.network.regions.map(region=>region.fills?.[0].blend??"normal").sort()).toEqual(["multiply","normal"]);
});

test("mask actions, mixed types, hit testing, native downloads and recovery in the signed-in editor",async({page})=>{
  const engine=new EditorEngine();
  engine.execute("page.setBackground",{color:"white"});
  const rect=(name:string,x:number,y:number,width:number,height:number,fill:string)=>
    String(engine.execute("shape.rectangle",{x,y,width,height,props:{name,fill}}).id);
  rect("Backing",190,190,60,60,"blue");
  const mask=rect("Coverage",130,130,50,50,"black");
  const paint=rect("Ink",130,130,110,110,"red");
  const other=rect("Other mask",380,200,20,20,"white");
  engine.execute("node.set",{id:other,props:{isMask:true,maskType:"vector"}});
  const bytes=await encodeFigcraft(engine.getSnapshot().document);
  await login(page);
  const open=page.getByLabel("Open Figcraft file",{exact:true});
  await open.setInputFiles({name:"mask-test.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(bytes)});
  const tree=page.getByRole("region",{name:"Layers",exact:true});
  const layer=(name:string)=>tree.getByRole("button",{name,exact:true});
  const type=page.getByRole("combobox",{name:"Mask type",exact:true});
  const canvas=page.getByLabel("Design canvas",{exact:true});
  await expect(layer("Coverage")).toBeVisible(); await resetCanvasOrigin(page);
  await layer("Coverage").click(); await layer("Ink").click({modifiers:["Shift"]});
  await page.getByRole("button",{name:"Use as mask",exact:true}).click();
  await expect(layer("Mask group").locator("..")).toHaveAttribute("aria-current","true");
  await expectCanvasPixel(page,150,150,[255,0,0,255]); await expectCanvasPixel(page,215,215,[0,0,255,255]);
  const p=await canvasPoint(page,215,215);
  await page.mouse.click(p.x,p.y); await expect(layer("Backing").locator("..")).toHaveAttribute("aria-current","true");
  await page.mouse.click(p.x,p.y,{button:"right"});
  const menu=page.getByRole("group",{name:"Canvas actions",exact:true});
  await menu.getByText("Select layer",{exact:true}).click();
  await expect(menu.getByRole("group",{name:"Layers at point"}).getByRole("button")).toHaveText(["Backing"]);
  await menu.getByRole("button",{name:"Backing",exact:true}).click();
  const covered=await canvasPoint(page,150,150);
  await page.mouse.click(covered.x,covered.y,{button:"right"});
  await menu.getByText("Select layer",{exact:true}).click();
  await expect(menu.getByRole("group",{name:"Layers at point"}).getByRole("button")).toHaveText(["Mask group","Ink","Coverage"]);
  await menu.getByRole("button",{name:"Coverage",exact:true}).click(); await expect(type).toHaveValue("alpha");
  await layer("Other mask").click({modifiers:["Shift"]}); await expect(type).toHaveValue("");
  await type.selectOption("luminance"); await expect(type).toHaveValue("luminance");
  await expectCanvasPixel(page,150,150,[255,255,255,255]);
  await page.getByRole("button",{name:"Undo",exact:true}).click(); await expect(type).toHaveValue("");
  await layer("Coverage").click(); await type.selectOption("vector");
  await page.getByRole("button",{name:"Release mask",exact:true}).click();
  await expect(type).toHaveCount(0); await expectCanvasPixel(page,215,215,[255,0,0,255]);
  await canvas.focus();
  await page.keyboard.press(await page.evaluate(()=>/Mac|iPhone|iPad/.test(navigator.platform)) ? "Control+Meta+m":"Control+Alt+m");
  await expect(type).toHaveValue("vector"); await expectCanvasPixel(page,215,215,[0,0,255,255]);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload(); await expect(layer("Mask group")).toBeVisible();
  await resetCanvasOrigin(page); await expectCanvasPixel(page,215,215,[0,0,255,255]);
  await layer("Coverage").click(); await expect(type).toHaveValue("vector");
  const pending=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=await readFile((await (await pending).path())!);
  const doc=(await decodeFigcraft(saved)).document;
  expect(doc.nodes[mask]).toMatchObject({isMask:true,maskType:"vector",parent:doc.nodes[paint].parent});
  await open.setInputFiles({name:"masks-roundtrip.figcraft",mimeType:"application/octet-stream",buffer:saved});
  await layer("Coverage").click(); await expect(type).toHaveValue("vector");
});

test("native effect stacks survive an editor change, device recovery and download", async ({page}) => {
  const engine = new EditorEngine();
  const id = String(engine.execute("shape.rectangle", {name:"Effect sample", x:40}).id);
  engine.execute("shape.rectangle",{x:120,y:100,width:30,height:30,props:{
    fill:"white",effects:[{type:"dropShadow",offset:[10,0],radius:0,color:"red"},
      {type:"innerShadow",offset:[4,0],radius:0,color:"blue"}]}});
  engine.execute("shape.rectangle",{x:200,y:100,width:20,height:30,props:{fill:"black"}});
  engine.execute("shape.rectangle",{x:220,y:100,width:20,height:30,props:{fill:"white"}});
  engine.execute("shape.rectangle",{x:210,y:105,width:20,height:20,props:{fills:[],effects:[{type:"backgroundBlur",radius:2}]}});
  engine.execute("shape.rectangle",{x:260,y:100,width:30,height:30,props:{fill:"blue",effects:[
    {type:"noise",mode:"mono",color:"lime",density:1},{type:"texture",size:1,radius:2,clipToShape:true}]}});
  engine.execute("shape.rectangle",{x:300,y:100,width:30,height:40,props:{fill:"black"}});
  engine.execute("shape.rectangle",{x:330,y:100,width:60,height:40,props:{fill:"white"}});
  engine.execute("shape.rectangle",{x:320,y:100,width:60,height:40,props:{fills:[],effects:[
    {type:"glass",depth:20,refraction:.8,lightIntensity:0,frost:0,dispersion:0}]}});
  const members = unzipSync(await encodeFigcraft(engine.getSnapshot().document));
  const native = JSON.parse(strFromU8(members["document.json"]));
  native.nodes[id].effects = [
    {type:"dropShadow",radius:6}, {type:"innerShadow",showBehind:true},
    {type:"layerBlur",blurType:"PROGRESSIVE",startOffset:[.2,.7]}, {type:"backgroundBlur"},
    {type:"noise",mode:"duo",sizeY:2}, {type:"texture",clipToShape:true}, {type:"glass",visible:false,frost:150},
  ];
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({
    name:"effects.figcraft", mimeType:"application/octet-stream",
    buffer:Buffer.from(zipSync({...members,"document.json":new TextEncoder().encode(JSON.stringify(native))})),
  });
  const layer = page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Effect sample",exact:true});
  await expect(layer).toBeVisible();
  await resetCanvasOrigin(page);
  await expectCanvasPixel(page,122,115,[0,0,255,255]);
  await expectCanvasPixel(page,137,115,[255,255,255,255]);
  await expectCanvasPixel(page,155,115,[255,0,0,255]);
  await expectCanvasPixel(page,219,115,[85,85,85,255]);
  await expectCanvasPixel(page,220,115,[170,170,170,255]);
  await expectCanvasPixel(page,275,115,[0,255,0,255]);
  await expectCanvasPixel(page,319,120,[0,0,0,255]);
  await expectCanvasPixel(page,321,120,[255,255,255,255]);
  await layer.click();
  await page.getByLabel("Design canvas",{exact:true}).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await expect(layer).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const raw = await readFile((await (await pending).path())!);
  const node = JSON.parse(strFromU8(unzipSync(raw)["document.json"])).nodes[id];
  expect(node.transform[4]).toBe(41);
  expect(node.effects).toMatchObject([
    {type:"dropShadow",radius:6}, {type:"innerShadow",show_behind:true},
    {type:"layerBlur",blur_type:"progressive",start:[.2,.7]}, {type:"backgroundBlur"},
    {type:"noise",mode:"duo",size_y:2}, {type:"texture",clip_to_shape:true}, {type:"glass",visible:false,frost:150},
  ]);
});

test("effect settings, clipboard and row order survive a native save and recovery", async ({page}) => {
  await login(page);
  await page.getByRole("button",{name:"Create rectangle",exact:true}).click();
  const panel = page.getByRole("region",{name:"Effects",exact:true});
  const add = panel.getByRole("button",{name:"Add effect"});
  const rows = panel.getByRole("listitem");
  await add.click();
  await rows.first().getByRole("button",{name:"Effect 1 settings"}).click();
  await rows.first().getByLabel("Shadow colour hex").fill("#27A43D");
  await rows.first().getByLabel("Shadow colour hex").press("Enter");
  await rows.first().getByLabel("Shadow colour opacity (%)",{exact:true}).fill("65");
  await rows.first().getByLabel("Shadow colour opacity (%)",{exact:true}).press("Enter");
  await rows.first().getByLabel("Show behind transparent areas").check();
  await add.click();
  await rows.first().getByLabel("Effect type").selectOption("glass");
  await rows.first().getByRole("button",{name:"Effect 1 settings"}).click();
  const depth = rows.first().getByLabel("Depth",{exact:true});
  await depth.fill("1400"); await depth.press("Enter"); await expect(depth).toHaveValue("1000");
  const scrub = rows.first().getByRole("button",{name:"Scrub Frost"});
  await scrub.scrollIntoViewIfNeeded();
  const p = await scrub.boundingBox(); if (!p) throw new Error("missing Frost scrub");
  await page.mouse.move(p.x+4,p.y+4); await page.mouse.down(); await page.mouse.move(p.x+14,p.y+4,{steps:5}); await page.mouse.up();
  await expect(rows.first().getByLabel("Frost",{exact:true})).toHaveValue("14");
  await rows.first().getByRole("button",{name:"Move down"}).click();
  await expect(rows.nth(1).getByLabel("Depth",{exact:true})).toHaveValue("1000");
  await rows.nth(1).getByLabel("Effect type").press("Shift+F10");
  await panel.getByRole("button",{name:"Copy effect",exact:true}).click();
  await add.press("Shift+F10");
  await panel.getByRole("button",{name:"Paste effect",exact:true}).click();
  await expect(rows).toHaveCount(3);
  await rows.first().getByLabel("Visible",{exact:true}).uncheck();
  await rows.first().getByRole("button",{name:"Remove effect 1"}).click();
  await expect(rows).toHaveCount(2);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  const pending = page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const archive = unzipSync(await readFile((await (await pending).path())!));
  const native = JSON.parse(strFromU8(archive["document.json"]));
  const layer = Object.values(native.nodes).find((n:any) => n.effects?.length) as {effects: {type:string}[]};
  expect(layer.effects).toMatchObject([{type:"glass",depth:1000,frost:14},{type:"dropShadow",show_behind:true}]);
});

test("progressive blur handles edit unit-box endpoints with one undo", async ({page}) => {
  const engine = new EditorEngine();
  const id = String(engine.execute("shape.rectangle",{x:80,y:70,width:100,height:80,name:"Ramp sample",props:{
    effects:[{type:"backgroundBlur",blurType:"progressive",start:[.25,.5],end:[.75,.5]}]}}).id);
  await login(page);
  const open = page.getByLabel("Open Figcraft file",{exact:true});
  await open.setInputFiles({name:"ramp.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await encodeFigcraft(engine.getSnapshot().document))});
  await page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Ramp sample",exact:true}).click();
  await resetCanvasOrigin(page);
  const panel = page.getByRole("region",{name:"Effects",exact:true});
  await panel.getByRole("button",{name:"Effect 1 settings",exact:true}).click();
  await expect(panel.getByLabel("Blur type")).toHaveValue("progressive");
  const from = await canvasPoint(page,105,110), to = await canvasPoint(page,120,130);
  await page.mouse.move(from.x,from.y); await page.mouse.down(); await page.mouse.move(to.x,to.y,{steps:6}); await page.mouse.up();
  async function savedStart() {
    const pending = page.waitForEvent("download");
    await page.getByRole("button",{name:"Save as",exact:true}).click();
    const bytes = await readFile((await (await pending).path())!);
    return JSON.parse(strFromU8(unzipSync(bytes)["document.json"])).nodes[id].effects[0].start;
  }
  expect(await savedStart()).toEqual([.4,.75]);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  expect(await savedStart()).toEqual([.25,.5]);
});

test("mobile effect settings edit native noise, texture and blur properties", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await login(page,false);
  await page.getByRole("button",{name:"Create rectangle",exact:true}).click();
  const panel = page.getByRole("region",{name:"Effects",exact:true});
  const row = panel.getByRole("listitem").first();
  await panel.getByRole("button",{name:"Add effect"}).click();
  await row.getByLabel("Effect type").selectOption("noise");
  await row.getByRole("button",{name:"Effect 1 settings"}).click();
  await row.getByLabel("Noise mode").selectOption("duo");
  await row.getByLabel("Secondary colour hex").fill("#E04020"); await row.getByLabel("Secondary colour hex").press("Enter");
  await row.getByLabel("Density (%)",{exact:true}).fill("35"); await row.getByLabel("Density (%)",{exact:true}).press("Enter");
  await row.getByLabel("Noise mode").selectOption("multi");
  await expect(row.getByLabel("Secondary colour hex")).toHaveCount(0);
  await row.getByLabel("Opacity (%)",{exact:true}).fill("80"); await row.getByLabel("Opacity (%)",{exact:true}).press("Enter");
  await panel.getByRole("button",{name:"Add effect"}).click();
  await row.getByLabel("Effect type").selectOption("texture");
  await row.getByRole("button",{name:"Effect 1 settings"}).click();
  await row.getByLabel("Clip to shape").check();
  await row.getByLabel("Size",{exact:true}).fill("-6"); await row.getByLabel("Size",{exact:true}).press("Enter");
  await expect(row.getByLabel("Size",{exact:true})).toHaveValue("0.01");
  await panel.getByRole("button",{name:"Add effect"}).click();
  await row.getByLabel("Effect type").selectOption("layerBlur");
  await row.getByRole("button",{name:"Effect 1 settings"}).click();
  await row.getByLabel("Blur type").selectOption("progressive");
  await row.getByLabel("End",{exact:true}).fill("17"); await row.getByLabel("End",{exact:true}).press("Enter");
  expect(await panel.evaluate(n=>n.getBoundingClientRect().right)).toBeLessThanOrEqual(390);
  const pending = page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const bytes = await readFile((await (await pending).path())!);
  const native = JSON.parse(strFromU8(unzipSync(bytes)["document.json"]));
  const layer = Object.values(native.nodes).find((n:any) => n.effects?.length) as {effects: {type:string}[]};
  expect(layer.effects).toMatchObject([{type:"noise",mode:"multi",density:.35},{type:"texture",clip_to_shape:true,size:.01},
    {type:"layerBlur",blur_type:"progressive",radius:17}]);
});

test("bundled web fonts load on demand and match native glyph metrics", async ({page}) => {
  const fonts: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.endsWith(".ttf")) fonts.push(request.url()); });
  await login(page);
  expect(fonts).toEqual([]);
  // Face::from_bytes and Face::advance from the pinned native crate, measured at one em.
  const cases = [
    ["Figcraft Inter","normal",400,2048,"A",1413,1984,494],
    ["Figcraft Inter","italic",400,2048,"A",1413,1984,494],
    ["Figcraft Inter","normal",600,2048,"A",1490,1984,494],
    ["Figcraft Inter","normal",700,2048,"A",1529,1984,494],
    ["Figcraft Noto Sans Georgian","normal",400,1000,"ა",549,1068,292],
  ] as const;
  for (const [family,style,weight,size,character,width,ascent,descent] of cases) {
    const result = await page.evaluate(async ({family,style,weight,size,character}) => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = style + " " + weight + " " + size + 'px "' + family + '"';
      const faces = await document.fonts.load(ctx.font, character);
      const metrics = ctx.measureText(character);
      return [faces.length, metrics.width, metrics.fontBoundingBoxAscent, metrics.fontBoundingBoxDescent];
    }, {family,style,weight,size,character});
    expect(result).toEqual([1,width,ascent,descent]);
  }
  const variableAdvances = await page.evaluate(() => {
    const sample = document.createElement("span");
    sample.style.cssText = 'position:fixed;display:inline-block;white-space:pre;font:1000px "Figcraft Noto Sans Georgian"';
    sample.textContent = "ა";
    document.body.append(sample);
    const widths = ['"wght" 900, "wdth" 100','"wght" 400, "wdth" 62.5'].map(axes => {
      sample.style.fontVariationSettings = axes;
      return sample.getBoundingClientRect().width;
    });
    sample.remove();
    return widths;
  });
  expect(variableAdvances).toEqual([608,413]);
  expect(new Set(fonts).size).toBe(5);
  const count = fonts.length;
  await page.evaluate(() => document.fonts.load('600 16px "Figcraft Inter"', "A").then(() => undefined));
  expect(fonts).toHaveLength(count);
});

test("a Rust rich-text layer paints separate run colours, downloads and restores after reload", async ({page}) => {
  const raw = await readFile(new URL("../fixtures/native-text.json", import.meta.url));
  await login(page);
  await page.getByLabel("Open Figcraft file", {exact:true}).setInputFiles({
    name:"native-text.figcraft", mimeType:"application/octet-stream", buffer:raw,
  });
  await expect(page.getByRole("heading",{name:"Native text",exact:true})).toBeVisible();
  const canvas = page.getByLabel("Design canvas",{exact:true});
  const ink = () => canvas.evaluate((node:HTMLCanvasElement) => {
    const pixels = node.getContext("2d")!.getImageData(0,0,node.width,node.height).data;
    let red=0,black=0;
    for (let i=0;i<pixels.length;i+=4) {
      if (pixels[i]===198 && pixels[i+1]===31 && pixels[i+2]===66) red++;
      if (pixels[i]===0 && pixels[i+1]===0 && pixels[i+2]===0) black++;
    }
    return red>10 && black>10;
  });
  await expect.poll(ink).toBe(true);
  const saving = page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const download = await saving;
  const saved = await decodeFigcraft(await readFile((await download.path())!));
  expect(saved.document).toEqual((await decodeFigcraft(raw)).document);
  await expect(page.getByText("Recovery saved on this device",{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading",{name:"Native text",exact:true})).toBeVisible();
  await expect.poll(ink).toBe(true);
});

test("the Text tool types on canvas, drags a fixed box and commits each edit as one undo",async ({page})=>{
  await login(page);
  const input=page.getByRole("textbox",{name:"Edit text layer"});
  const canvas=page.getByLabel("Design canvas",{exact:true});
  await canvas.focus(); await page.keyboard.press("t");
  const point=await canvasPoint(page,110,95);
  await page.mouse.click(point.x,point.y); await expect(input).toBeFocused();
  await page.keyboard.insertText("Native"); await page.keyboard.press("Enter"); await page.keyboard.insertText("ქართული");
  await page.keyboard.press("Escape"); await expect(input).toHaveCount(0);
  await expect(page.getByText("1 layer",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.getByText("0 layers",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Redo",exact:true}).click();
  await page.getByRole("button",{name:"Text",exact:true}).click();
  const a=await canvasPoint(page,220,120), b=await canvasPoint(page,295,174);
  await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:3}); await page.mouse.up();
  await expect(input).toBeFocused();
  await page.keyboard.insertText("box"); await page.keyboard.press("Control+Enter");
  const downloading=page.waitForEvent("download"); await page.getByRole("button",{name:"Save as",exact:true}).click();
  const downloaded=await downloading, saved=await decodeFigcraft(await readFile((await downloaded.path())!));
  expect(saved.document.nodes["2"]).toMatchObject({kind:"text",name:"Native",x:110,y:88,text:{characters:"Native\nქართული",autoResize:"widthAndHeight"}});
  expect(saved.document.nodes["3"]).toMatchObject({kind:"text",name:"box",x:220,y:120,width:75,height:54,text:{characters:"box",autoResize:"none"}});
  await page.mouse.dblclick(a.x+8,a.y+6); await expect(input).toHaveValue("box");
  await input.press("ControlOrMeta+a"); await page.keyboard.insertText("Revised"); await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await page.mouse.dblclick(a.x+8,a.y+6); await expect(input).toHaveValue("box");
  await page.keyboard.press("Escape"); await page.keyboard.press("t");
  await page.mouse.click(b.x+25,b.y+25); await expect(input).toBeFocused();
  await page.keyboard.press("Escape"); await expect(page.getByText("2 layers",{exact:true})).toBeVisible();
});

test("native Chromium IME pre-edit paints temporary glyphs and commits once on the canvas",async ({page})=>{
  await login(page);
  const canvas=page.getByLabel("Design canvas",{exact:true});
  await page.getByRole("button",{name:"Text",exact:true}).click();
  const point=await canvasPoint(page,160,105); await page.mouse.click(point.x,point.y);
  const input=page.getByRole("textbox",{name:"Edit text layer"}); await expect(input).toBeFocused();
  const hash=()=>canvas.evaluate((n:HTMLCanvasElement)=>{
    const bytes=n.getContext("2d")!.getImageData(0,0,n.width,n.height).data;
    let black=0; for (let i=0;i<bytes.length;i+=4) if (!bytes[i] && !bytes[i+1] && !bytes[i+2]) black++;
    return black;
  });
  const cdp=await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition",{text:"temporary",selectionStart:9,selectionEnd:9});
  await expect(input).toHaveValue("temporary");
  await expect.poll(hash).toBeGreaterThan(4);
  await cdp.send("Input.insertText",{text:"final"});
  await expect(input).toHaveValue("final");
  await input.press("Escape");
  const downloading=page.waitForEvent("download"); await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(saved.document.nodes["2"]).toMatchObject({name:"final",text:{characters:"final"}});
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.getByText("0 layers",{exact:true})).toBeVisible();
});

test("Typography formats selected Unicode characters and saves the edit as one undo", async ({page}) => {
  await login(page);
  const canvas = page.getByLabel("Design canvas",{exact:true});
  await canvas.focus(); await page.keyboard.press("t");
  const point = await canvasPoint(page, 155, 115);
  await page.mouse.click(point.x,point.y);
  const input = page.getByRole("textbox", {name:"Edit text layer"});
  await expect(input).toBeFocused();
  await page.keyboard.insertText("A🙂BC");
  await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(1,4));
  const panel = page.getByRole("group", {name:"Typography",exact:true});
  const size = panel.getByLabel("Font size",{exact:true});
  await size.fill("32"); await size.press("Enter");
  await expect(input).toHaveCount(1);
  await panel.getByText("More typography options").click();
  await panel.getByLabel("Text decoration",{exact:true}).selectOption("underline");
  await input.focus(); await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(size).toHaveAttribute("placeholder","Mixed");
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.getByText("0 layers",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Redo",exact:true}).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved = await decodeFigcraft(await readFile((await (await download).path())!));
  expect(saved.document.nodes["2"]).toMatchObject({text:{characters:"A🙂BC",style:{fontSize:12},
    runs:[{start:1,end:3,style:{fontSize:32,decoration:"underline"}}]}});
});

test("text shortcuts style a scalar selection and create, nest and exit native lists",async ({page})=>{
  await login(page);
  const canvas=page.getByLabel("Design canvas",{exact:true});
  await canvas.focus(); await page.keyboard.press("t");
  const point=await canvasPoint(page,180,130); await page.mouse.click(point.x,point.y);
  const input=page.getByRole("textbox",{name:"Edit text layer"}); await expect(input).toBeFocused();
  await page.keyboard.insertText("1."); await page.keyboard.press("Space");
  await expect(input).toHaveValue("");
  await page.keyboard.insertText("A🙂B"); await input.press("Enter"); await page.keyboard.insertText("Two");
  await input.press("Tab"); await input.press("Enter"); await input.press("Enter");
  await input.press("Backspace"); await page.keyboard.insertText("Plain");
  await input.evaluate((el:HTMLTextAreaElement)=>el.setSelectionRange(1,3));
  await input.press("ControlOrMeta+b"); await input.press("ControlOrMeta+i"); await input.press("ControlOrMeta+u");
  await input.press("Escape"); await expect(input).toHaveCount(0);
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+Shift+Period");
  const download=page.waitForEvent("download"); await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=await decodeFigcraft(await readFile((await (await download).path())!));
  expect(saved.document.nodes["2"]).toMatchObject({text:{characters:"A🙂B\nTwo\nPlain",style:{fontSize:13},
    runs:[{start:1,end:2,style:{fontStyle:"Bold Italic",decoration:"underline",fontSize:13}}],
    paragraphs:[{list:"numbered",indent:0},{list:"numbered",indent:1},{list:"none",indent:0}]}});
  await page.getByRole("button",{name:"Undo",exact:true}).click(); await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.getByText("0 layers",{exact:true})).toBeVisible();
});

test("create-link shortcuts retain the selected characters and Alt+Enter opens only web or mail links",async ({page,context})=>{
  await context.route("https://example.test/figcraft-link",route=>route.fulfill({contentType:"text/plain",body:"Figcraft link"}));
  await login(page);
  const canvas=page.getByLabel("Design canvas",{exact:true});
  await canvas.focus(); await page.keyboard.press("t");
  const point=await canvasPoint(page,155,105); await page.mouse.click(point.x,point.y);
  const input=page.getByRole("textbox",{name:"Edit text layer"}); await expect(input).toBeFocused();
  await page.keyboard.insertText("A🙂BC");
  await input.evaluate((el:HTMLTextAreaElement)=>el.setSelectionRange(1,3));
  await input.press("ControlOrMeta+k");
  const dialog=page.getByRole("dialog",{name:"Create link"}); await expect(dialog).toBeVisible();
  await dialog.getByLabel("URL").fill("  https://example.test/figcraft-link  "); await dialog.getByRole("button",{name:"Apply link"}).click();
  await expect(input).toBeFocused();
  expect(await input.evaluate((el:HTMLTextAreaElement)=>[el.selectionStart,el.selectionEnd])).toEqual([1,3]);
  const opened=context.waitForEvent("page"); await input.press("Alt+Enter");
  const tab=await opened; await tab.waitForLoadState(); expect(tab.url()).toBe("https://example.test/figcraft-link");
  expect(await tab.evaluate(()=>window.opener===null)).toBe(true); await tab.close();
  await input.press("ControlOrMeta+Shift+u"); await expect(dialog).toBeVisible();
  await dialog.getByLabel("URL").fill("javascript:alert(1)"); await dialog.getByRole("button",{name:"Apply link"}).click();
  await input.press("Alt+Enter"); await expect(page.getByText("Only web and mail links can be opened",{exact:true})).toBeVisible();
  await input.press("Escape");
  const download=page.waitForEvent("download"); await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=await decodeFigcraft(await readFile((await (await download).path())!));
  expect(saved.document.nodes["2"]).toMatchObject({text:{characters:"A🙂BC",runs:[{start:1,end:2,style:{link:"javascript:alert(1)",decoration:"underline"}}]}});
});

test("attach text to a curved layer, change its offset and side, then detach and undo",async ({page})=>{
  const engine=new EditorEngine();
  await engine.executeAsync("text.create",{name:"Route label",text:"Curved text",x:65,y:50});
  engine.execute("vector.create",{name:"Route path",x:120,y:90,path:"M0 0C40 50 90 50 140 0",props:{fill:"#c61f42"}});
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"text-path.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await encodeFigcraft(engine.getSnapshot().document))});
  const tree=page.getByRole("region",{name:"Layers",exact:true});
  const layer=(name:string)=>tree.getByRole("button",{name,exact:true});
  await layer("Route label").click(); await layer("Route path").click({modifiers:["Shift"]});
  const panel=page.getByRole("group",{name:"Typography",exact:true});
  await panel.getByRole("button",{name:"Put text on path"}).click();
  await expect(layer("Route path")).toHaveCount(0);
  const offset=panel.getByLabel("Start on path (%)");
  await offset.fill("25"); await offset.press("Enter");
  const flip=panel.getByRole("button",{name:"Flip text to the other side"});
  await flip.click(); await expect(flip).toHaveAttribute("aria-pressed","true");
  const download=page.waitForEvent("download"); await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=await decodeFigcraft(await readFile((await (await download).path())!));
  expect(saved.document.nodes["2"]).toMatchObject({kind:"text",fill:"#c61f42",text:{path:{start:.25,flip:true}}});
  expect(saved.document.nodes["3"]).toBeUndefined();
  await panel.getByRole("button",{name:"Remove text from path"}).click(); await expect(offset).toHaveCount(0);
  await page.getByRole("button",{name:"Undo",exact:true}).click(); await expect(offset).toHaveValue("25");
});

test("missing fonts lists the document's families and uses a fallback until the font is available",async ({page})=>{
  const engine=new EditorEngine();
  const id=(await engine.executeAsync("text.create",{name:"Font sample",text:"Sample",x:30,y:50})).id;
  engine.execute("node.set",{id,props:{fontFamily:"Figcraft unavailable"}});
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"fonts.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await encodeFigcraft(engine.getSnapshot().document))});
  await page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Font sample"}).click();
  const panel=page.getByRole("group",{name:"Typography",exact:true});
  await panel.getByText("More typography options",{exact:true}).click();
  const show=panel.getByRole("button",{name:"Missing fonts…"});
  const dialog=page.getByRole("dialog",{name:"Missing fonts"});
  await show.click(); await expect(dialog).toContainText("Figcraft unavailable · 1 layer");
  await dialog.getByRole("button",{name:"Close",exact:true}).click();
  await panel.getByRole("button",{name:"Font family",exact:true}).click();
  await page.getByRole("option",{name:"Inter",exact:true}).click();
  await show.click(); await expect(dialog).toContainText("All the fonts this file uses are installed.");
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
});

test("local font access reads only the selected face, then repaints and refits the saved text box",async ({page})=>{
  const bytes=await readFile(new URL("../../fonts/inter/Inter-Bold.ttf",import.meta.url));
  const engine=new EditorEngine(), id=(await engine.executeAsync("text.create",{name:"Local font sample",text:"Wide WWW and iii",x:35,y:70})).id;
  engine.execute("node.set",{id,props:{fontFamily:"Figcraft Local Test"}});
  const initial=Number(engine.execute("node.get",{id})!.width);
  await page.addInitScript(({encoded})=>{
    const events:string[]=[];
    Object.assign(window,{fontReads:events,queryLocalFonts:async ()=>{
      events.push("query");
      return ["Figcraft Local Test","Figcraft Unused"].map(family=>({
        family,style:"Regular",postscriptName:"Inter-Bold",
        async blob(){events.push(family); return new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))]);}
      }));
    }});
  },{encoded:bytes.toString("base64")});
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"local.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await encodeFigcraft(engine.getSnapshot().document))});
  await page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Local font sample"}).click();
  const panel=page.getByRole("group",{name:"Typography",exact:true});
  const reads=()=>page.evaluate(()=>(window as Window & {fontReads?:string[]}).fontReads);
  expect(await reads()).toEqual([]);
  const before=await page.locator("canvas").first().evaluate(el=>(el as HTMLCanvasElement).toDataURL());
  await panel.getByRole("button",{name:"Font family",exact:true}).click();
  await panel.getByRole("button",{name:"Use fonts installed on this computer…"}).click();
  await expect.poll(reads).toEqual(["query","Figcraft Local Test"]);
  await panel.getByRole("button",{name:"Font family",exact:true}).click();
  await expect(panel.getByRole("option",{name:"Figcraft Unused"})).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect.poll(()=>page.locator("canvas").first().evaluate(el=>(el as HTMLCanvasElement).toDataURL())).not.toBe(before);
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=await decodeFigcraft(await readFile((await (await download).path())!));
  const result=saved.document.nodes[String(id)];
  expect(result).toMatchObject({kind:"text",text:{style:{fontFamily:"Figcraft Local Test"}}});
  expect((result as {width:number}).width).toBeGreaterThan(initial);
  expect(await reads()).toEqual(["query","Figcraft Local Test"]);
});

test("denied local font permission keeps the text editable and asks only once",async ({page})=>{
  await page.addInitScript(()=>Object.assign(window,{queryLocalFonts:async ()=>{throw new DOMException("Denied","NotAllowedError");}}));
  const engine=new EditorEngine();await engine.executeAsync("text.create",{name:"Local denial",text:"Sample",x:80,y:80});
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"deny.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await encodeFigcraft(engine.getSnapshot().document))});
  await page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Local denial"}).click();
  const panel=page.getByRole("group",{name:"Typography",exact:true});
  await panel.getByRole("button",{name:"Font family",exact:true}).click();
  const ask=panel.getByRole("button",{name:"Use fonts installed on this computer…"});
  await ask.click();await expect(ask).toHaveCount(0);
  await panel.getByLabel("Font size",{exact:true}).fill("20");await panel.getByLabel("Font size",{exact:true}).press("Enter");
  await expect(panel.getByLabel("Font size",{exact:true})).toHaveValue("20");
});

test("Chromium's granted system font catalogue supplies an actual face to the signed-in editor",async ({baseURL,context})=>{
  const browser=await chromium.launch({channel:"chromium"});
  try {
    const page=await browser.newPage({baseURL,storageState:await context.storageState(),viewport:{width:1440,height:900}});
    test.setTimeout(60_000);
    await login(page);
    const client=await page.context().newCDPSession(page);
    const {targetInfo:{browserContextId}}=await client.send("Target.getTargetInfo");
    await client.send("Browser.setPermission",{browserContextId,origin:new URL(page.url()).origin,permission:{name:"local-fonts"},setting:"granted"});
    const engine=new EditorEngine(), id=(await engine.executeAsync("text.create",{name:"System font",text:"iiiiiiiiiiii",x:20,y:50})).id;
    const original=Number(engine.execute("node.get",{id})!.width);
    await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"system.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await encodeFigcraft(engine.getSnapshot().document))});
    await page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"System font"}).click();
    const panel=page.getByRole("group",{name:"Typography",exact:true});
    await panel.getByRole("button",{name:"Font family",exact:true}).click();
    const ask=panel.getByRole("button",{name:"Use fonts installed on this computer…"});
    await ask.click();await expect(ask).toHaveCount(0);
    await panel.getByRole("button",{name:"Font family",exact:true}).click();
    const search=page.getByRole("combobox",{name:"Search fonts"});
    const available=await page.evaluate(async()=>{
      const browser=window as Window & {queryLocalFonts?:()=>Promise<{family:string}[]>};
      return [...new Set((await browser.queryLocalFonts!()).map(f=>f.family))];
    });
    const mono=["Courier New","DejaVu Sans Mono","Liberation Mono","Menlo","Courier"].find(f=>available.includes(f));
    test.info().annotations.push({type:"real-font",description:mono ?? "No known system monospace face exposed"});
    if (!mono) {await page.keyboard.press("Escape");await expect(panel.getByRole("button",{name:"Font family",exact:true})).toHaveText("Inter");return;}
    await search.fill(mono);
    await page.getByRole("option",{name:mono,exact:true}).click();
    await expect.poll(async()=>Number(await page.getByLabel("Edit Width",{exact:true}).inputValue())).toBeGreaterThan(original*1.5);
    const download=page.waitForEvent("download");await page.getByRole("button",{name:"Save as",exact:true}).click();
    const saved=await decodeFigcraft(await readFile((await (await download).path())!));
    expect(saved.document.nodes[String(id)]).toMatchObject({kind:"text",text:{style:{fontFamily:mono}}});
  } finally {await browser.close();}
});

test("a 20000-family font menu virtualises rows, searches, previews, cancels and commits from the keyboard",async ({page})=>{
  const bytes=await readFile(new URL("../../fonts/inter/Inter-Bold.ttf",import.meta.url));
  await page.addInitScript(encoded=>Object.assign(window,{queryLocalFonts:async()=>Array.from({length:20_000},(_,i)=>({
    family:"Catalogue "+String(i).padStart(5,"0"),style:"Regular",postscriptName:"Inter-Bold",
    blob:async()=>new Blob([Uint8Array.from(atob(encoded),s=>s.charCodeAt(0))]),
  }))}),bytes.toString("base64"));
  const engine=new EditorEngine();
  await engine.executeAsync("text.create",{name:"Menu sample",text:"Type preview",x:110,y:80});
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"menu.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await encodeFigcraft(engine.getSnapshot().document))});
  await page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Menu sample"}).click();
  const panel=page.getByRole("group",{name:"Typography",exact:true}),choose=panel.getByRole("button",{name:"Font family",exact:true});
  await choose.click();
  const sample=page.getByRole("option",{name:"Inter",exact:true}).locator("[data-font-sample]");
  await expect(sample).toBeVisible();
  const ink=await sample.evaluate(async el=>{
    const src=getComputedStyle(el).maskImage.match(/url\(["']?(data:image\/png[^"')]+)/)?.[1];
    if (!src) return 0;
    const img=new Image();img.src=src;await img.decode();
    const canvas=document.createElement("canvas");canvas.width=img.width;canvas.height=img.height;
    const ctx=canvas.getContext("2d")!;ctx.drawImage(img,0,0);
    return ctx.getImageData(0,0,img.width,img.height).data.filter((n,i)=>i%4===3 && n>0).length;
  });
  expect(ink).toBeGreaterThan(20);
  await page.getByRole("button",{name:"Use fonts installed on this computer…"}).click();
  await choose.click();const search=page.getByRole("combobox",{name:"Search fonts"});
  await expect(page.getByRole("option",{name:"Catalogue 00000",exact:true})).toBeVisible();
  await expect(page.getByRole("option",{name:"Catalogue 00000",exact:true}).locator("[data-font-sample]")).toHaveCount(0);
  expect(await page.getByRole("listbox",{name:"Font families"}).getByRole("option").count()).toBeLessThan(16);
  await search.fill("unavailable family");await expect(page.getByText("No fonts match")).toBeVisible();
  const canvas=page.getByLabel("Design canvas",{exact:true});
  const pixels=()=>canvas.evaluate(el=>(el as HTMLCanvasElement).toDataURL());
  const previous=await pixels();
  await search.fill("19999");await search.press("ArrowDown");
  await expect(page.getByRole("option",{name:"Catalogue 19999"})).toHaveAttribute("aria-selected","true");
  await expect.poll(pixels).not.toBe(previous);
  await search.press("Escape");await expect(choose).toHaveText("Inter");
  await expect.poll(pixels).toBe(previous);
  await choose.click();await search.fill("19999");await search.press("Enter");
  await expect(choose).toHaveText("Catalogue 19999");
  await choose.click();await expect(page.getByText("Recent",{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:700});
  const menu=page.getByRole("dialog",{name:"Choose font family"});
  await expect.poll(async()=>{
    const box=await menu.boundingBox();
    return !!box && box.x>=0 && box.y>=0 && box.x+box.width<=390 && box.y+box.height<=700;
  }).toBe(true);
  await search.press("Escape");await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(choose).toHaveText("Inter");
});

test("loading a browser font file resolves a missing family and saves its refitted box",async ({page})=>{
  const {renamedFont}=await import("../support/renamedFont");
  const e=new EditorEngine(), id=String((await e.executeAsync("text.create",{text:"ABC",name:"Import face",x:20,y:30})).id);
  e.execute("node.set",{id,props:{fontFamily:"Proof"}});
  const doc=e.getSnapshot().document;
  const native={...doc,nodes:{...doc.nodes,[id]:{...doc.nodes[id],width:999}}};
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"import-font.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await encodeFigcraft(native))});
  await page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Import face"}).click();
  const panel=page.getByRole("group",{name:"Typography",exact:true});
  await panel.getByText("More typography options",{exact:true}).click();
  const input=panel.getByLabel("Load font file",{exact:true});
  await input.setInputFiles({name:"bad.ttf",mimeType:"font/ttf",buffer:Buffer.from("not a font")});
  await expect(page.getByRole("alert").filter({hasText:"Not a font file"})).toBeVisible();
  await input.setInputFiles({name:"proof.ttf",mimeType:"font/ttf",buffer:await renamedFont()});
  await expect(panel.getByLabel("Font style",{exact:true}).locator("option")).toHaveText(["Regular"]);
  const show=panel.getByRole("button",{name:"Missing fonts…"}), dialog=page.getByRole("dialog",{name:"Missing fonts"});
  await expect.poll(async()=>{
    await show.click();
    const text=await dialog.innerText();
    await dialog.getByRole("button",{name:"Close",exact:true}).click();
    return text;
  }).toContain("All the fonts this file uses are installed.");
  const download=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=await decodeFigcraft(await readFile((await (await download).path())!));
  const node=saved.document.nodes[id];
  expect(node.kind).toBe("text");
  if (node.kind==="text") { expect(node.width).toBeGreaterThan(1); expect(node.width).toBeLessThan(999); }
});

test("variable font axes preview on drag, cancel, commit once and survive native download",async ({page})=>{
  const engine=new EditorEngine(), id=String((await engine.executeAsync("text.create",{name:"Variable sample",text:"ქართული ტექსტი",x:110,y:80})).id);
  engine.execute("node.set",{id,props:{fontFamily:"Noto Sans Georgian",fontSize:34}});
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"axes.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await encodeFigcraft(engine.getSnapshot().document))});
  await page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Variable sample"}).click();
  const panel=page.getByRole("group",{name:"Typography",exact:true});
  await panel.getByText("More typography options",{exact:true}).click();
  await panel.getByRole("button",{name:"Variable",exact:true}).click();
  const slider=panel.getByRole("slider",{name:"Weight slider"}), field=panel.getByRole("spinbutton",{name:"Weight value"});
  await expect(field).toHaveValue("400");
  await slider.scrollIntoViewIfNeeded();
  const track=(await slider.boundingBox())!;
  const canvas=page.getByLabel("Design canvas",{exact:true});
  const pixels=()=>canvas.evaluate(el=>(el as HTMLCanvasElement).toDataURL());
  const before=await pixels();
  await page.mouse.move(track.x+track.width*.4,track.y+track.height/2);await page.mouse.down();
  await page.mouse.move(track.x+track.width*.85,track.y+track.height/2,{steps:5});
  await expect.poll(pixels).not.toBe(before);
  await page.keyboard.press("Escape");await page.mouse.up();
  await expect.poll(pixels).toBe(before);await expect(field).toHaveValue("400");
  await page.mouse.move(track.x+track.width*.4,track.y+track.height/2);await page.mouse.down();
  await page.mouse.move(track.x+track.width*.8,track.y+track.height/2,{steps:8});await page.mouse.up();
  await expect(panel.getByRole("button",{name:"Reset to style"})).toBeVisible();
  await page.getByRole("button",{name:"Undo",exact:true}).click();await expect(field).toHaveValue("400");
  await field.fill("643");await field.press("Enter");await expect(field).toHaveValue("643");
  const instance=panel.getByRole("button",{name:"Named instance"});await expect(instance).toHaveText("Custom");
  await instance.click();
  await panel.getByRole("button",{name:"Bold",exact:true}).click();
  await expect(field).toHaveValue("700");await expect(instance).toHaveText("Bold");
  await field.fill("671");await field.press("Enter");
  const save=page.waitForEvent("download");await page.getByRole("button",{name:"Save as",exact:true}).click();
  const reopened=await decodeFigcraft(await readFile((await (await save).path())!));
  expect(reopened.document.nodes[id]).toMatchObject({text:{style:{fontStyle:"Bold",variations:{wght:671}}}});
  await panel.getByRole("button",{name:"Reset to style"}).click();
  await expect(field).toHaveValue("700");
});

test("OpenType feature switches expose mixed selections, record overrides and clear defaults",async ({page})=>{
  const engine=new EditorEngine();
  const ids=[];
  for (const [i,name] of ["First text","Second text"].entries()) ids.push(String((await engine.executeAsync("text.create",{name,text:"123/456",x:100,y:80+i*80})).id));
  engine.execute("text.setFeatures",{id:ids[0],features:{tnum:true}});
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"features.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await encodeFigcraft(engine.getSnapshot().document))});
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  await layers.getByRole("button",{name:"First text"}).click();
  await layers.getByRole("button",{name:"Second text"}).click({modifiers:["Shift"]});
  const panel=page.getByRole("group",{name:"Typography",exact:true});
  await panel.getByText("More typography options",{exact:true}).click();
  await expect(panel.getByRole("button",{name:"Variable",exact:true})).toHaveCount(0);
  await panel.getByRole("button",{name:"Details",exact:true}).click();
  const tabular=panel.getByRole("checkbox",{name:"Tabular numbers"}), liga=panel.getByRole("checkbox",{name:"Standard ligatures"});
  await expect(tabular).toHaveAttribute("aria-checked","mixed");
  await expect(liga).toBeChecked();await expect(liga).toHaveAttribute("title","Not in this font");
  for (const label of ["Contextual alternates","Fractions","Case-sensitive forms","Slashed zero",
    "Stylistic set 1","Stylistic set 2","Stylistic set 3","Stylistic set 4","Stylistic set 5","Small capitals"]) {
    const control=panel.getByRole("checkbox",{name:label,exact:true});
    const initial=await control.isChecked();
    await control.click();await expect(control).toHaveAttribute("aria-checked",String(!initial));
    await control.click();await expect(control).toHaveAttribute("aria-checked",String(initial));
  }
  await tabular.click();await expect(tabular).toBeChecked();
  await tabular.click();await expect(tabular).not.toBeChecked();
  await liga.click();await expect(liga).not.toBeChecked();
  const save=page.waitForEvent("download");await page.getByRole("button",{name:"Save as",exact:true}).click();
  const reopened=await decodeFigcraft(await readFile((await (await save).path())!));
  for (const id of ids) {
    const node=reopened.document.nodes[id];
    expect(node.kind==="text" && node.text.features).toEqual({liga:false});
  }
});

test("variable axes change only the selected Unicode characters during live text editing",async ({page})=>{
  await login(page);
  const canvas=page.getByLabel("Design canvas",{exact:true});await canvas.focus();await page.keyboard.press("t");
  const point=await canvasPoint(page,155,115);await page.mouse.click(point.x,point.y);
  const input=page.getByRole("textbox",{name:"Edit text layer"});
  await expect(input).toBeFocused();
  await page.keyboard.insertText("ა🙂ბგ");await expect(input).toHaveValue("ა🙂ბგ");await input.press("ControlOrMeta+a");
  const panel=page.getByRole("group",{name:"Typography",exact:true});
  await panel.getByRole("button",{name:"Font family",exact:true}).click();
  await page.getByRole("option",{name:"Noto Sans Georgian",exact:true}).click();
  await input.focus();await input.evaluate((el:HTMLTextAreaElement)=>el.setSelectionRange(1,4));
  await panel.getByText("More typography options",{exact:true}).click();
  await panel.getByRole("button",{name:"Variable",exact:true}).click();
  const weight=panel.getByRole("spinbutton",{name:"Weight value",exact:true});
  await weight.fill("575");await weight.press("Enter");await expect(input).toHaveCount(1);
  await input.focus();await input.press("Escape");await expect(input).toHaveCount(0);
  const save=page.waitForEvent("download");await page.getByRole("button",{name:"Save as",exact:true}).click();
  const reopened=await decodeFigcraft(await readFile((await (await save).path())!));
  const node=reopened.document.nodes["2"];
  expect(node).toMatchObject({text:{characters:"ა🙂ბგ",style:{variations:{}},runs:expect.arrayContaining([
    expect.objectContaining({start:1,end:3,style:expect.objectContaining({variations:{wght:575}})}),
  ])}});
});

test("typography basics save underline metrics, skip ink, hanging text and paragraph direction",async ({page})=>{
  const e=new EditorEngine(), id=String((await e.executeAsync("text.create",{text:"مثال",name:"Arabic sample",x:80,y:80})).id);
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"decoration.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await encodeFigcraft(e.getSnapshot().document))});
  await page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Arabic sample"}).click();
  const panel=page.getByRole("group",{name:"Typography",exact:true});
  await panel.getByText("More typography options",{exact:true}).click();
  await panel.getByLabel("Text decoration",{exact:true}).selectOption("underline");
  async function enter(label:string,value:string) {
    const field=panel.getByLabel(label,{exact:true});await field.fill(value);await field.press("Enter");
  }
  await enter("Decoration thickness","2");await enter("Underline offset","12%");await enter("Decoration colour","#336699");
  await panel.getByLabel("Decoration style",{exact:true}).selectOption("wavy");
  for (const label of ["Skip ink","Hanging punctuation","Hanging list"]) await panel.getByLabel(label,{exact:true}).check();
  await panel.getByLabel("Text direction",{exact:true}).selectOption("rtl");
  const max=panel.getByLabel("Maximum lines",{exact:true});
  await expect(max).toHaveCount(0);
  await panel.getByLabel("Truncate text",{exact:true}).selectOption("on");await expect(max).toHaveValue("Auto");
  await enter("Maximum lines","3");await expect(max).toHaveValue("3");
  await panel.getByLabel("Text alignment",{exact:true}).selectOption("center");
  await expect(panel.getByLabel("Paragraph indent",{exact:true})).toBeDisabled();
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"Save as",exact:true}).click();
  const reopened=await decodeFigcraft(await readFile((await (await download).path())!));
  expect(reopened.document.nodes[id]).toMatchObject({text:{hangingPunctuation:true,hangingList:true,maxLines:3,autoResize:"truncate",
    paragraphs:[expect.objectContaining({direction:"rtl"})],style:{decoration:"underline",decorationLook:{
      skipInk:true,style:"wavy",thickness:{unit:"pixels",value:2},offset:{unit:"percent",value:12},color:{a:1},
    }}}});
  await enter("Decoration thickness","0");await expect(panel.getByLabel("Decoration thickness",{exact:true})).toHaveValue("Auto");
  await enter("Decoration colour","");await expect(panel.getByLabel("Decoration colour",{exact:true})).toHaveValue("Auto");
  await panel.getByLabel("Text decoration",{exact:true}).selectOption("strikethrough");
  await expect(panel.getByLabel("Skip ink",{exact:true})).toHaveCount(0);
  await expect(panel.getByLabel("Underline offset",{exact:true})).toHaveCount(0);
});

test("canvas keyboard navigation preserves backwards selection, native word boundaries and grapheme deletion",async ({page})=>{
  await login(page);
  const canvas=page.getByLabel("Design canvas",{exact:true});await canvas.focus();await page.keyboard.press("t");
  const at=await canvasPoint(page,130,105);await page.mouse.click(at.x,at.y);
  const input=page.getByRole("textbox",{name:"Edit text layer"});
  await expect(input).toBeFocused();await page.keyboard.insertText("Latin中文字 é🙂");await input.press("Enter");await page.keyboard.insertText("second");
  const select=()=>input.evaluate((el:HTMLTextAreaElement)=>[el.selectionStart,el.selectionEnd,el.selectionDirection]);
  await input.press("Home");await input.press("Shift+End");
  const start="Latin中文字 é🙂\n".length;
  expect((await select()).slice(0,2)).toEqual([start,start+6]);
  await input.press("ArrowLeft");await input.press("Shift+ArrowLeft");
  expect(await select()).toEqual([start-1,start,"backward"]);
  const mac=await page.evaluate(()=>/Mac|iPhone|iPad/.test(navigator.platform));
  await input.evaluate((el:HTMLTextAreaElement)=>el.setSelectionRange(8,8));
  await input.press((mac ? "Alt" : "Control")+"+Shift+ArrowLeft");
  expect(await select()).toEqual([5,8,"backward"]);
  await input.press("Backspace");await expect(input).toHaveValue("Latin é🙂\nsecond");
  await input.evaluate((el:HTMLTextAreaElement)=>el.setSelectionRange("Latin é🙂".length,"Latin é🙂".length));
  await input.press("Backspace");await expect(input).toHaveValue("Latin é\nsecond");
  await input.press("Escape");
  const save=page.waitForEvent("download");await page.getByRole("button",{name:"Save as",exact:true}).click();
  const doc=await decodeFigcraft(await readFile((await (await save).path())!));
  expect(doc.document.nodes["2"]).toMatchObject({text:{characters:"Latin é\nsecond"}});
});

test("text clipboard, triple-click, save and undo use the active canvas edit",async ({page,context})=>{
  await login(page);
  await context.grantPermissions(["clipboard-read","clipboard-write"],{origin:new URL(page.url()).origin});
  const canvas=page.getByLabel("Design canvas",{exact:true});
  await canvas.focus(); await page.keyboard.press("t");
  const at=await canvasPoint(page,130,105);
  await page.mouse.click(at.x,at.y);
  const input=page.getByRole("textbox",{name:"Edit text layer"});
  await expect(input).toBeFocused();
  await page.keyboard.insertText("A🙂B"); await input.press("Enter"); await page.keyboard.insertText("word line");
  await input.evaluate((e:HTMLTextAreaElement)=>e.setSelectionRange(1,3,"backward"));
  await input.press("ControlOrMeta+b");
  await input.press("ControlOrMeta+c");
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe("🙂");
  await input.press("ControlOrMeta+End"); await input.press("ControlOrMeta+v");
  await expect(input).toHaveValue("A🙂B\nword line🙂");
  const line=await canvasPoint(page,139,119);
  await page.mouse.click(line.x,line.y,{clickCount:3});
  expect(await input.evaluate((e:HTMLTextAreaElement)=>e.value.slice(e.selectionStart,e.selectionEnd))).toBe("word line🙂");
  await input.press("ControlOrMeta+x");
  await expect(input).toHaveValue("A🙂B\n");
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe("word line🙂");
  await input.press("ControlOrMeta+v");
  const saving=page.waitForEvent("download"); await input.press("ControlOrMeta+s");
  const saved=await decodeFigcraft(await readFile((await (await saving).path())!));
  expect(saved.document.nodes["2"]).toMatchObject({text:{characters:"A🙂B\nword line🙂",runs:[{start:1,end:2,style:{fontStyle:"Bold"}}]}});
  await expect(input).toBeFocused();
  await input.press("ControlOrMeta+z"); await expect(input).toHaveCount(0);
  await expect(page.getByText("0 layers",{exact:true})).toBeVisible();
  await canvas.press("ControlOrMeta+Shift+z"); await expect(page.getByText("1 layer",{exact:true})).toBeVisible();
});

test("Text on a path hits the visible outline, cancels an empty edit and replaces the path in one undo",async ({page})=>{
  const engine=new EditorEngine();
  const id=String(engine.execute("vector.create",{name:"Path source",x:40,y:100,path:"M0 0L200 0",props:{fill:"#c61f42"}}).id);
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"placement.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await encodeFigcraft(engine.getSnapshot().document))});
  const tree=page.getByRole("region",{name:"Layers",exact:true}), source=tree.getByRole("button",{name:"Path source",exact:true});
  await expect(source).toBeVisible();
  const tool=page.getByRole("button",{name:"Text on a path",exact:true}), canvas=page.getByLabel("Design canvas",{exact:true});
  const input=page.getByRole("textbox",{name:"Edit text layer"});
  const openTool=async()=>{await page.getByRole("button",{name:"Text",exact:true}).click();await tool.click();};
  await openTool();
  const miss=await canvasPoint(page,90,120), hit=await canvasPoint(page,90,103);
  await page.mouse.click(miss.x,miss.y); await expect(input).toHaveCount(0);
  await page.mouse.move(hit.x,hit.y); await expect(canvas).toHaveCSS("cursor","text");
  await page.mouse.click(hit.x,hit.y); await expect(input).toBeFocused(); await input.press("Escape");
  await expect(source).toBeVisible(); await expect(page.getByRole("button",{name:"Undo",exact:true})).toBeDisabled();
  await openTool();await page.mouse.click(hit.x,hit.y);await expect(input).toBeFocused();
  await page.keyboard.insertText("Along");await input.press("Escape");
  await expect(source).toHaveCount(0);
  const saving=page.waitForEvent("download");await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await saving).path())!));
  expect(document.nodes[id]).toBeUndefined();
  const node=Object.values(document.nodes).find(n=>n.kind==="text");
  expect(node).toMatchObject({name:"Along",fill:"#c61f42",text:{characters:"Along",path:{flip:false}}});
  expect(node!.text.path!.start).toBeCloseTo(.25,2);
  await page.getByRole("button",{name:"Undo",exact:true}).click();await expect(source).toBeVisible();
});

test("Flatten text preserves curved glyph counters and decoration ink in editable vector geometry",async ({page})=>{
  const e=new EditorEngine();
  await e.executeAsync("text.create",{name:"Glyph outlines",text:"O Bé",x:50,y:50});
  e.execute("node.set",{id:2,props:{fontSize:28,fill:"#c61f42",textDecoration:"underline"}});
  e.execute("vector.create",{x:90,y:100,path:"M0 0C65 60 130 60 220 0",props:{fills:[]}});
  e.execute("text.onPath",{text:2,path:3,start:.2});
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"glyphs.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await encodeFigcraft(e.getSnapshot().document))});
  const layers=page.getByRole("region",{name:"Layers",exact:true}), layer=layers.getByRole("button",{name:"Glyph outlines",exact:true});
  await expect(layer).toBeVisible();
  const canvas=page.getByLabel("Design canvas",{exact:true});
  const ink=()=>canvas.evaluate(async (node:HTMLCanvasElement)=>{
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    const rgba=node.getContext("2d")!.getImageData(0,0,node.width,node.height).data, mask:number[]=[];
    for (let i=0;i<rgba.length;i+=4) if(rgba[i]===198 && rgba[i+1]===31 && rgba[i+2]===66)mask.push(i/4);
    return mask;
  });
  const before=await ink();expect(before.length).toBeGreaterThan(100);
  await layer.click(); await layers.getByRole("button",{name:"Flatten",exact:true}).click();
  await expect(page.getByRole("region",{name:"Selected vector",exact:true})).toBeVisible();
  const blank=await canvasPoint(page,30,30);await page.mouse.click(blank.x,blank.y);
  const after=await ink(),pixels=new Set(after);
  expect(before.filter(p=>pixels.has(p)).length/Math.max(before.length,after.length)).toBeGreaterThan(.97);
  await layer.click();
  const saving=page.waitForEvent("download");await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=await decodeFigcraft(await readFile((await (await saving).path())!));
  const vector=Object.values(saved.document.nodes).find(n=>n.kind==="vector");
  expect(vector!.network.segments.length).toBeGreaterThan(30);
  await page.getByRole("button",{name:"Edit vector",exact:true}).click();
  await canvas.press("Escape");await page.getByRole("button",{name:"Undo",exact:true}).click();
  await layer.click();await expect(page.getByRole("group",{name:"Typography",exact:true})).toBeVisible();
});

test("a narrow touch viewport creates, composes and saves a Unicode text layer",async ({page})=>{
  await login(page);
  await page.setViewportSize({width:390,height:844});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:1});
  const tap=async (point:{x:number;y:number})=>{
    await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[point]});
    await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  };
  const text=page.getByRole("button",{name:"Text",exact:true});
  await text.scrollIntoViewIfNeeded();
  const button=await text.boundingBox();
  await tap({x:button!.x+button!.width/2,y:button!.y+button!.height/2});
  const canvas=page.getByLabel("Design canvas",{exact:true});
  const b=await canvas.boundingBox();
  const point={x:b!.x+b!.width/3,y:b!.y+b!.height/2};
  expect(await canvas.evaluate((el,p)=>document.elementFromPoint(p.x,p.y)===el,point)).toBe(true);
  await tap(point);
  const input=page.getByRole("textbox",{name:"Edit text layer"});
  await expect(input).toBeFocused();
  await cdp.send("Input.imeSetComposition",{text:"に",selectionStart:1,selectionEnd:1});
  await cdp.send("Input.insertText",{text:"日本🙂"});
  await expect(input).toHaveValue("日本🙂");
  await input.press("Escape");
  const download=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const archive=await decodeFigcraft(await readFile((await (await download).path())!));
  expect(archive.document.nodes["2"]).toMatchObject({kind:"text",text:{characters:"日本🙂"}});
});

test("native frame layout survives opening, recovery and a browser download", async ({page}) => {
  const native = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8"));
  native.name = "Native grid";
  Object.assign(native.nodes["2"], {type: "frame", children: [], layout: {
    mode: "grid", grid_columns: 3, row_tracks: [{sizing: "hug", value: 0}],
    column_tracks: [{sizing: "fixed", value: 24}, {sizing: "fill", value: 2}],
    padding: [4, 8, 12, 16], cross_gap: 7, reverse_z: true,
  }});
  native.nodes["2"].children = [3];
  native.nodes["3"] = {id: 3, parent: 2, name: "Spanning child", type: "rectangle", width: 40, height: 15,
    child_layout: {sizing_h: "fill", min_w: 12, grid_column: 0, grid_row_span: 2, grid_align_v: "center"}};
  native.next_id = 4;
  await login(page);
  await page.getByLabel("Open Figcraft file", {exact: true}).setInputFiles({
    name: "native-grid.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(JSON.stringify(native)),
  });
  await expect(page.getByRole("heading", {name: "Native grid", exact: true})).toBeVisible();
  await expect(page.getByText("Recovery saved on this device", {exact: true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", {name: "Native grid", exact: true})).toBeVisible();
  await page.getByRole("region", {name: "Layers"}).getByRole("button", {name: "Rectangle", exact: true}).click();
  const first = page.getByRole("spinbutton", {name: "Column 1 size", exact: true});
  await expect(first).toHaveValue("24");
  await first.fill("48"); await first.press("Enter");
  await expect(first).toHaveValue("48");
  await page.getByRole("button", {name: "Undo", exact: true}).click();
  await expect(first).toHaveValue("24");
  await first.fill("36"); await first.press("Enter");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", {name: "Save as", exact: true}).click();
  const saved = await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(saved.document.nodes["3"]).toMatchObject({sizing: {horizontal: "fill", vertical: "fixed"},
    childLayout: {minWidth: 12, gridColumn: 0, gridRowSpan: 2, gridAlignV: "center"}});
  expect(saved.document.nodes["2"]).toMatchObject({kind: "frame", layout: {
    mode: "grid", gridColumns: 3, rowTracks: [{sizing: "hug", value: 0}],
    columnTracks: [{sizing: "fixed", value: 36}, {sizing: "fill", value: 2}], padding: [4, 8, 12, 16], crossGap: 7, reverseZ: true,
  }});
});

test("editing a child rewraps horizontal flow and an undo restores the previous row", async ({page}) => {
  const file = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8"));
  file.name = "Wrapped flow";
  Object.assign(file.nodes["2"], {type: "frame", name: "Flow frame", width: 120, height: 100, children: [3,4,5],
    layout: {mode: "horizontal", wrap: true, gap: 10, cross_gap: 5, padding: [0,0,0,0]}});
  for (const [i,x] of [0,40,80].entries()) file.nodes[3+i] = {id: 3+i, parent: 2, type: "rectangle",
    name: ["First","Second","Third"][i], width: 30, height: 20, transform: [1,0,0,1,x,0]};
  file.next_id = 6;
  await login(page);
  await page.getByLabel("Open Figcraft file", {exact:true}).setInputFiles({
    name:"flow.figcraft", mimeType:"application/octet-stream", buffer:Buffer.from(JSON.stringify(file)),
  });
  await expect(page.getByRole("heading",{name:"Wrapped flow",exact:true})).toBeVisible();
  const layers = page.getByRole("region",{name:"Layers"});
  const third = layers.getByRole("button",{name:"Third",exact:true});
  if (!await third.isVisible()) await layers.getByRole("button",{name:"Expand frame Flow frame",exact:true}).click();
  await layers.getByRole("button",{name:"First",exact:true}).click();
  await page.getByLabel("Edit Width",{exact:true}).fill("70");
  await page.getByRole("button",{name:"Apply geometry",exact:true}).click();
  await third.click();
  await expect(page.getByLabel("Edit X",{exact:true})).toHaveValue("0");
  await expect(page.getByLabel("Edit Y",{exact:true})).toHaveValue("25");
  await page.getByRole("button",{name:"Undo",exact:true}).click(); await third.click();
  await expect(page.getByLabel("Edit X",{exact:true})).toHaveValue("80");
  await expect(page.getByLabel("Edit Y",{exact:true})).toHaveValue("0");
  const canvas = page.getByLabel("Design canvas", {exact:true});
  await canvas.press("ArrowLeft");
  await expect(page.getByLabel("Edit X",{exact:true})).toHaveValue("40");
  await canvas.press("ArrowRight");
  await expect(page.getByLabel("Edit X",{exact:true})).toHaveValue("80");
  await layers.getByRole("button",{name:"Flow frame",exact:true}).click();
  const layout = page.getByRole("group",{name:"Auto layout",exact:true});
  await layout.getByRole("button",{name:"Vertical",exact:true}).click();
  await expect(layout.getByRole("button",{name:"Wrap",exact:true})).toHaveAttribute("aria-pressed","true");
  await layout.getByLabel("Horizontal padding",{exact:true}).fill("13");
  await layout.getByLabel("Horizontal padding",{exact:true}).press("Enter");
  await layout.getByRole("button",{name:"Individual padding"}).click();
  await expect(layout.getByLabel("Right padding")).toHaveValue("13");
  await expect(layout.getByLabel("Left padding")).toHaveValue("13");
  await layout.getByLabel("Canvas stacking").selectOption("true");
  await layout.getByRole("button",{name:"Grid",exact:true}).click();
  await expect(page.getByRole("region",{name:"Grid tracks"})).toBeVisible();
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(layout.getByRole("button",{name:"Vertical",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(layout.getByLabel("Canvas stacking")).toHaveValue("true");
});

test("grid child sizing, anchors and limits persist after recovery", async ({page}) => {
  const file = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json",import.meta.url),"utf8"));
  file.name="Grid child sizing";
  Object.assign(file.nodes[2],{type:"frame",name:"Container",width:200,height:80,children:[3,4],
    layout:{mode:"grid",grid_columns:2,grid_rows:1,gap:0,padding:[0,0,0,0]}});
  for (const id of [3,4]) file.nodes[id]={id,parent:2,type:"rectangle",name:"Cell "+id,width:20,height:20};
  file.next_id=5;
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({
    name:"child.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(JSON.stringify(file)),
  });
  const select = async () => {
    const layers=page.getByRole("region",{name:"Layers"});
    await expect(page.getByRole("heading",{name:file.name,exact:true})).toBeVisible();
    const child=layers.getByRole("button",{name:"Cell 3",exact:true});
    if (!await child.isVisible()) await layers.getByRole("button",{name:"Expand frame Container",exact:true}).click();
    await child.click();
  };
  await select();
  const panel=page.getByRole("group",{name:"Layout sizing",exact:true});
  await panel.getByLabel("Width sizing").selectOption("fill");
  await expect(page.getByLabel("Edit Width",{exact:true})).toHaveValue("100");
  await panel.getByLabel("Width sizing").selectOption("maxWidth");
  const maximum=panel.getByLabel("Max width",{exact:true});
  await maximum.fill("66"); await maximum.press("Enter");
  await expect(page.getByLabel("Edit Width",{exact:true})).toHaveValue("66");
  const column=panel.getByLabel("Column",{exact:true});
  await column.fill("2"); await column.press("Enter");
  await panel.getByLabel("Horizontal align",{exact:true}).selectOption("max");
  await expect(page.getByLabel("Edit X",{exact:true})).toHaveValue("134");
  await panel.getByRole("button",{name:"Ignore auto layout (absolute position)"}).click();
  await expect(panel.getByRole("button",{name:"Use auto layout"})).toBeVisible();
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(panel.getByLabel("Width sizing")).toHaveValue("fill");
  await expect(page.getByText("Recovery saved on this device",{exact:true})).toBeVisible();
  await page.reload(); await select();
  await expect(column).toHaveValue("2"); await expect(maximum).toHaveValue("66");
  await panel.getByRole("button",{name:"Place automatically"}).click();
  await expect(column).toHaveValue("1");
});

test("suggest, remove and add auto layout through the inspector, keyboard and canvas menu", async ({page}) => {
  const file=JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json",import.meta.url),"utf8"));
  file.name="Layout authoring";
  Object.assign(file.nodes[2],{type:"frame",name:"Board",width:180,height:120,children:[3,4,5,6]});
  [[8,6],[46,6],[8,28],[46,28]].forEach(([x,y],i)=>{
    file.nodes[i+3]={id:i+3,parent:2,type:"rectangle",name:"Item "+i,width:24,height:12,transform:[1,0,0,1,x,y]};
  });
  file.next_id=7;
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({
    name:"layout.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(JSON.stringify(file)),
  });
  await expect(page.getByRole("heading",{name:file.name,exact:true})).toBeVisible();
  await page.getByRole("region",{name:"Layers"}).getByRole("button",{name:"Board",exact:true}).click();
  await page.getByRole("button",{name:"Suggest auto layout",exact:true}).click();
  const panel=page.getByRole("group",{name:"Auto layout",exact:true});
  await expect(panel.getByRole("button",{name:"Vertical",exact:true})).toHaveAttribute("aria-pressed","true");
  const canvas=page.getByLabel("Design canvas",{exact:true});
  await canvas.focus(); await page.keyboard.press("Alt+Shift+A");
  await expect(page.getByRole("button",{name:"Suggest auto layout",exact:true})).toBeVisible();
  await page.keyboard.press("Shift+A"); await expect(panel).toBeVisible();
  await canvas.click({button:"right",position:{x:25,y:25}});
  await page.getByRole("group",{name:"Canvas actions"}).getByRole("button",{name:"Remove all auto layout",exact:true}).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=await decodeFigcraft(await readFile((await (await downloading).path())!));
  for (const id of ["2","7","8"]) expect(saved.document.nodes[id]).toHaveProperty("layout");
  expect(saved.document.nodes["7"]).toMatchObject({kind:"frame",children:["3","4"],clip:false,layout:{mode:"horizontal",gap:14}});
});

test("pointer reordering previews wrapped rows, cancels and saves a drop into a grid", async ({page}) => {
  const file = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8"));
  file.name = "Pointer layouts";
  const rectangle = file.nodes[2];
  file.nodes[1].children = [2, 9];
  file.nodes[2] = {...rectangle, type: "frame", name: "Rows", transform: [1,0,0,1,190,170], width: 200, height: 200,
    children: [3,4,5,6,7,8], layout: {mode: "horizontal", wrap: true, gap: 10, cross_gap: 10, padding: [0,0,0,0]}};
  for (let i=0; i<6; i++) file.nodes[i+3] = {...rectangle, id: i+3, parent: 2, name: "Item "+i,
    width: 50, height: 30, transform: [1,0,0,1,(i%3)*60,Math.floor(i/3)*40]};
  file.nodes[9] = {...rectangle, id: 9, type: "frame", name: "Grid", width: 150, height: 140, children: [],
    transform: [1,0,0,1,430,170], layout: {mode: "grid", grid_columns: 2, grid_rows: 2, padding: [0,0,0,0]}};
  file.next_id = 10;
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({
    name:"pointer-layouts.figcraft", mimeType:"application/octet-stream", buffer: Buffer.from(JSON.stringify(file)),
  });
  await expect(page.getByRole("heading",{name:file.name,exact:true})).toBeVisible();
  await resetCanvasOrigin(page);
  const start = await canvasPoint(page,215,185), secondRow = await canvasPoint(page,315,225);
  const mouseDown = async (p: {x:number; y:number}) => { await page.mouse.move(p.x,p.y); await page.mouse.down(); };
  await mouseDown(start); await page.mouse.move(secondRow.x,secondRow.y,{steps:6});
  await expectCanvasPixel(page,245,225,[0,135,95,255]);
  await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(page.getByLabel("Edit X",{exact:true})).toHaveValue("0");
  await mouseDown(start); await page.mouse.move(secondRow.x,secondRow.y,{steps:6}); await page.mouse.up();
  await expect(page.getByLabel("Edit X",{exact:true})).toHaveValue("60");
  await expect(page.getByLabel("Edit Y",{exact:true})).toHaveValue("40");
  const middle = await canvasPoint(page,275,225), target = await canvasPoint(page,540,265);
  await mouseDown(middle); await page.mouse.move(target.x,target.y,{steps:8}); await page.mouse.up();
  const panel = page.getByRole("group",{name:"Layout sizing",exact:true});
  await expect(panel.getByLabel("Column",{exact:true})).toHaveValue("2");
  await expect(panel.getByLabel("Row",{exact:true})).toHaveValue("2");
  await expect(page.getByText("Recovery saved on this device",{exact:true})).toBeVisible();
  await page.reload(); await expect(page.getByRole("heading",{name:file.name,exact:true})).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved = await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(saved.document.nodes[2]).toMatchObject({children: ["4","5","6","7","8"]});
  expect(saved.document.nodes[3]).toMatchObject({parent: "9", childLayout: {gridColumn: 1,gridRow: 1}});
});

test("double-clicking a layout edge hugs the frame and Alt-double-click fills its text child", async ({page}) => {
  const file = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8"));
  file.name = "Edge sizing";
  Object.assign(file.nodes[2], {type: "frame", name: "Container", width: 250, height: 100,
    transform: [1,0,0,1,190,170], children: [3], layout: {mode: "horizontal", gap: 0, padding: [0,0,0,0]}});
  file.nodes[3] = {id: 3, parent: 2, type: "text", name: "Caption", width: 100, height: 40, characters: "Caption", auto_resize: "none"};
  file.next_id = 4;
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({
    name:"edge.figcraft", mimeType:"application/octet-stream", buffer:Buffer.from(JSON.stringify(file)),
  });
  await expect(page.getByRole("heading",{name:file.name,exact:true})).toBeVisible();
  await resetCanvasOrigin(page);
  const layers = page.getByRole("region",{name:"Layers"}), parent = layers.getByRole("button",{name:"Container",exact:true});
  await parent.click();
  const right = await canvasPoint(page,440,220);
  await page.mouse.dblclick(right.x,right.y);
  await expect(page.getByLabel("Edit Width",{exact:true})).toHaveValue("100");
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.getByLabel("Edit Width",{exact:true})).toHaveValue("250");
  const child = layers.getByRole("button",{name:"Caption",exact:true});
  if (!await child.isVisible()) await layers.getByRole("button",{name:"Expand frame Container",exact:true}).click();
  await child.click();
  const edge = await canvasPoint(page,289,190);
  await page.keyboard.down("Alt"); await page.mouse.dblclick(edge.x,edge.y); await page.keyboard.up("Alt");
  await expect(page.getByLabel("Edit Width",{exact:true})).toHaveValue("250");
  await expect(page.getByRole("textbox",{name:"Edit text layer"})).toHaveCount(0);
  const filled = await canvasPoint(page,439,190); await page.mouse.dblclick(filled.x,filled.y);
  await expect(page.getByRole("textbox",{name:"Edit text layer"})).toBeFocused();
});

test("canvas layout handles fix spread row gaps, pair padding and support a narrow touch drag", async ({page}) => {
  const file = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8"));
  file.name = "Spacing handles";
  const base = file.nodes[2];
  file.nodes[2] = {...base, type:"frame", name:"Wrapped rows", width:300, height:300, children:[3,4,5],
    transform:[1,0,0,1,190,170], layout:{mode:"horizontal",wrap:true,padding:[0,0,0,0],gap:10,cross_gap:10,content_align:"spaceBetween"}};
  for (const [i,[x,y]] of [[0,0],[130,0],[0,240]].entries()) file.nodes[3+i] = {...base,id:3+i,parent:2,
    width:120,height:60,name:"Card "+i,transform:[1,0,0,1,x,y]};
  file.next_id=6;
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({
    name:"spacing.figcraft", mimeType:"application/octet-stream", buffer:Buffer.from(JSON.stringify(file)),
  });
  await expect(page.getByRole("heading",{name:file.name,exact:true})).toBeVisible();
  await resetCanvasOrigin(page);
  await page.getByRole("region",{name:"Layers"}).getByRole("button",{name:"Wrapped rows",exact:true}).click();
  const start = await canvasPoint(page,340,320), end = await canvasPoint(page,340,340);
  await page.mouse.move(start.x,start.y);
  await expect(page.getByLabel("Design canvas",{exact:true})).toHaveCSS("cursor","ns-resize");
  await page.mouse.down(); await page.mouse.move(end.x,end.y,{steps:6}); await page.mouse.up();
  const panel=page.getByRole("group",{name:"Auto layout",exact:true});
  await expect(panel.getByLabel("Gap between rows",{exact:true})).toHaveValue("200");
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(panel.getByRole("combobox",{name:"Row gap",exact:true})).toHaveValue("spaceBetween");
  const left=await canvasPoint(page,192,295);
  await page.mouse.move(left.x,left.y); await page.keyboard.down("Shift"); await page.mouse.down();
  await page.mouse.move(left.x+16,left.y,{steps:4}); await page.mouse.up(); await page.keyboard.up("Shift");
  await expect(panel.getByLabel("Horizontal padding",{exact:true})).toHaveValue("16");
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("button",{name:"Fit page",exact:true}).click();
  const cdp=await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:1});
  const from=await canvasPoint(page,340,320), to=await canvasPoint(page,340,340);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[from]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[to]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(saved.document.nodes[2]).toMatchObject({layout:{contentAlign:"auto",crossGap:200,padding:[0,16,0,16]}});
});

test("layout numeric fields apply arithmetic, arrow steps and cancellable live scrubs",async ({page}) => {
  const file = JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json",import.meta.url),"utf8"));
  Object.assign(file.nodes[2],{type:"frame",name:"Field grid",width:240,height:100,children:[],
    layout:{mode:"grid",grid_columns:2,grid_rows:1,gap:10,padding:[2,3,4,5]}});
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({
    name:"fields.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(JSON.stringify(file)),
  });
  await page.getByRole("region",{name:"Layers"}).getByRole("button",{name:"Field grid",exact:true}).click();
  const layout = page.getByRole("group",{name:"Auto layout",exact:true});
  const gap = layout.getByRole("spinbutton",{name:"Column gap",exact:true});
  await gap.fill("+(2,5 px * 4)"); await gap.press("Tab"); await expect(gap).toHaveValue("20");
  await gap.fill("50%"); await gap.press("Shift+ArrowUp"); await expect(gap).toHaveValue("20");
  await gap.press("ArrowDown"); await expect(gap).toHaveValue("19"); await expect(gap).toBeFocused();
  await gap.fill("19/0"); await gap.press("Enter"); await expect(gap).toHaveValue("19");
  await gap.fill("99"); await gap.press("Escape"); await expect(gap).toHaveValue("19");
  const lead = layout.getByText("Column gap",{exact:true});
  await lead.scrollIntoViewIfNeeded();
  const box = (await lead.boundingBox())!;
  const x = box.x+4, y = box.y+box.height/2;
  await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+10,y);
  await expect(gap).toHaveValue("29");
  await page.keyboard.down("Shift"); await page.mouse.move(x+12,y); await page.keyboard.up("Shift");
  await expect(gap).toHaveValue("49");
  await page.keyboard.press("Escape"); await page.mouse.up(); await expect(gap).toHaveValue("19");
  await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+10,y);
  await page.keyboard.down("Alt"); await page.mouse.move(x+15,y); await page.keyboard.up("Alt");
  await expect(gap).toHaveValue("29.5"); await page.mouse.up(); await expect(gap).toHaveValue("30");
  await page.getByRole("button",{name:"Undo",exact:true}).click(); await expect(gap).toHaveValue("19");
  await layout.getByRole("button",{name:"Individual padding"}).click();
  const left=layout.getByRole("spinbutton",{name:"Left padding"});
  await left.click({modifiers:["Control"]}); await left.press("Tab");
  const right=layout.getByRole("spinbutton",{name:"Right padding"});
  await expect(right).toHaveValue("3");
  await left.click({modifiers:["Control"]}); await left.fill("5.0"); await left.press("Enter");
  await expect(right).toHaveValue("5"); await expect(layout.getByLabel("Top padding")).toHaveValue("5");
  const track=page.getByRole("spinbutton",{name:"Column 1 size",exact:true});
  await track.fill("*1,5"); await track.press("Enter"); await expect(track).toHaveValue("1.5");
  await track.press("ArrowUp"); await expect(track).toHaveValue("1.6");
  await track.press("Shift+ArrowDown"); await expect(track).toHaveValue("0.6");
});

test("mixed geometry preserves each layer's value, groups undo and saves the focused field",async ({page}) => {
  const file=JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json",import.meta.url),"utf8"));
  file.nodes["1"].children=[2,3]; file.next_id=4;
  for (const [id,x,y,width,height] of [[2,10,20,40,30],[3,100,50,20,20]]) {
    file.nodes[id]={id,parent:1,type:"frame",name:"Board "+id,children:[],clip:id===2,
      transform:[1,0,0,1,x,y],width,height};
  }
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({
    name:"mixed.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(JSON.stringify(file)),
  });
  const layer = (id: number) => page.getByRole("region",{name:"Layers"}).getByRole("button",{name:"Board "+id,exact:true});
  await layer(2).click(); await layer(3).click({modifiers:["Shift"]});
  const width=page.getByLabel("Edit Width",{exact:true}), x=page.getByLabel("Edit X",{exact:true});
  await expect(width).toHaveAttribute("placeholder","Mixed"); await expect(width).toHaveValue("");
  await width.fill("*2"); await width.press("Enter");
  await width.fill("/4"); await width.press("Tab");
  const undo=page.getByRole("button",{name:"Undo",exact:true});
  await undo.click(); await expect(width).toHaveValue("");
  await x.focus(); await x.press("ArrowUp"); await x.press("Shift+ArrowUp");
  const clip=page.getByLabel("Clip content",{exact:true});
  await expect(clip).not.toBeChecked(); await clip.check(); await expect(clip).toBeChecked();
  await layer(2).click(); await expect(width).toHaveValue("80"); await expect(x).toHaveValue("21"); await expect(clip).toBeChecked();
  await layer(3).click(); await expect(width).toHaveValue("40"); await expect(x).toHaveValue("111"); await expect(clip).toBeChecked();
  await layer(2).click({modifiers:["Shift"]});
  const height=page.getByLabel("Edit Height",{exact:true});
  await height.fill("50%");
  const downloading=page.waitForEvent("download");
  await height.press("ControlOrMeta+s");
  const saved=await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(saved.document.nodes["2"]).toMatchObject({x:21,width:80,height:15,clip:true});
  expect(saved.document.nodes["3"]).toMatchObject({x:111,width:40,height:10,clip:true});
});

test("constraints follow frame eligibility and preserve each mixed layer's other axis",async ({page}) => {
  const file=JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json",import.meta.url),"utf8"));
  file.nodes[2]={id:2,parent:1,name:"Container",type:"frame",width:220,height:90,children:[3,4]};
  for (const id of [3,4]) file.nodes[id]={id,parent:2,type:"rectangle",name:"Box "+id,width:30,height:20,
    constraints:{horizontal:"left",vertical:id===3 ? "top" : "bottom"}};
  file.next_id=5;
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({
    name:"pins.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(JSON.stringify(file)),
  });
  const layer=(name: string) => page.getByRole("region",{name:"Layers"}).getByRole("button",{name,exact:true});
  const frame=layer("Container"), a=layer("Box 3"), b=layer("Box 4");
  await frame.click();
  const controls=page.getByRole("group",{name:"Constraints",exact:true});
  await expect(controls).toHaveCount(0);
  if (!await a.isVisible()) await layer("Expand frame Container").click();
  await a.click(); await b.click({modifiers:["Shift"]});
  const horizontal=page.getByLabel("Horizontal constraint"),vertical=page.getByLabel("Vertical constraint");
  await expect(horizontal).toHaveValue(""); await expect(vertical).toHaveValue("");
  await horizontal.selectOption("right");
  await a.click(); await expect(horizontal).toHaveValue("right"); await expect(vertical).toHaveValue("top");
  await b.click(); await expect(horizontal).toHaveValue("right"); await expect(vertical).toHaveValue("bottom");
  await frame.click(); await page.getByRole("button",{name:"Add auto layout",exact:true}).click();
  await a.click(); await expect(controls).toHaveCount(0);
  await page.getByRole("button",{name:"Ignore auto layout (absolute position)"}).click();
  await expect(horizontal).toHaveValue("right"); await vertical.selectOption("center");
  await page.getByRole("button",{name:"Undo",exact:true}).click(); await expect(vertical).toHaveValue("top");
});

test("negative layout gaps preserve paint and hit order when stacking is reversed",async ({page}) => {
  const file=JSON.parse(await readFile(new URL("../fixtures/native-rectangle.json",import.meta.url),"utf8"));
  file.nodes[2]={id:2,parent:1,type:"frame",name:"Stack",children:[3,4],width:140,height:100,
    transform:[1,0,0,1,190,170],layout:{mode:"horizontal",gap:-20,padding:[0,0,0,0]}};
  for (const id of [3,4]) file.nodes[id]={id,parent:2,type:"rectangle",name:id===3 ? "Red" : "Blue",width:50,height:40,
    transform:[1,0,0,1,(id-3)*30,0],fills:[{type:"solid",color:{r:id===3 ? 1 : 0,g:0,b:id===4 ? 1 : 0,a:1}}]};
  file.next_id=5;
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({
    name:"stack.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(JSON.stringify(file)),
  });
  const frame=page.getByRole("region",{name:"Layers"}).getByRole("button",{name:"Stack",exact:true});
  await frame.click(); await resetCanvasOrigin(page);
  const pick = async () => {
    await page.getByLabel("Design canvas",{exact:true}).scrollIntoViewIfNeeded();
    const empty=await canvasPoint(page,370,300);
    await page.mouse.click(empty.x,empty.y);
    const point=await canvasPoint(page,230,190);
    await page.mouse.click(point.x,point.y);
  };
  await expectCanvasPixel(page,230,190,[0,0,255,255]);
  await pick();
  await expect(page.getByRole("region",{name:"Selected rectangle"}).getByRole("heading",{name:"Blue",exact:true})).toBeVisible();
  await frame.click(); await page.getByLabel("Canvas stacking").selectOption("true");
  await expectCanvasPixel(page,230,190,[255,0,0,255]);
  await pick();
  await expect(page.getByRole("region",{name:"Selected rectangle"}).getByRole("heading",{name:"Red",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expectCanvasPixel(page,230,190,[0,0,255,255]);
});

test("native component mirrors paint at their own positions and survive recovery and download", async ({page}) => {
  await login(page);
  const buffer=await readFile(new URL("../fixtures/native-component-instance.json",import.meta.url));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"cards.figcraft",mimeType:"application/octet-stream",buffer});
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  await expect(layers.getByRole("button",{name:"Card",exact:true})).toHaveCount(2);
  await resetCanvasOrigin(page);
  await expectCanvasPixel(page,6,7,[255,0,0,255]);
  await expectCanvasPixel(page,166,27,[255,0,0,255]);
  await expectCanvasPixel(page,200,50,[255,255,255,255]);
  const instancePoint=await canvasPoint(page,200,50);
  await page.mouse.click(instancePoint.x,instancePoint.y);
  await expect(page.getByRole("region",{name:"Selected instance"})).toHaveCount(0);
  await page.keyboard.down("Control");
  await page.mouse.click(instancePoint.x,instancePoint.y);
  await page.keyboard.up("Control");
  await expect(page.getByRole("region",{name:"Selected instance"})).toBeVisible();
  await page.getByLabel("Edit X",{exact:true}).fill("210");
  await page.getByLabel("Edit X",{exact:true}).press("Enter");
  await expect(page.getByLabel("Edit X",{exact:true})).toHaveValue("210");
  await page.getByLabel("Design canvas",{exact:true}).scrollIntoViewIfNeeded();
  const blank=await canvasPoint(page,360,160);
  await page.mouse.click(blank.x,blank.y);
  await expectCanvasPixel(page,216,27,[255,0,0,255]);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await expect(layers.getByRole("button",{name:"Card",exact:true})).toHaveCount(2);
  await resetCanvasOrigin(page);
  await expectCanvasPixel(page,216,27,[255,0,0,255]);
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.nodes["2"]).toMatchObject({kind:"component",children:["3"]});
  expect(document.nodes["4"]).toMatchObject({kind:"instance",component:"2",source:"2",children:["5"],x:210});
  expect(document.nodes["5"]).toMatchObject({source:"3",parent:"4",name:"Marker"});
});

test("creating a component through the layer action and shortcut retains the original drawing on undo",async ({page})=>{
  await login(page);
  const buffer=await readFile(new URL("../fixtures/native-rectangle.json",import.meta.url));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"shape.figcraft",mimeType:"application/octet-stream",buffer});
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  await layers.getByRole("button",{name:"Rectangle",exact:true}).click();
  await layers.getByRole("button",{name:"Create component",exact:true}).click();
  await expect(page.getByRole("region",{name:"Selected component"})).toContainText("Rectangle");
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.getByRole("region",{name:"Selected rectangle"})).toBeVisible();
  await page.getByLabel("Design canvas",{exact:true}).focus();
  await page.keyboard.press("Control+Alt+k");
  await expect(page.getByRole("region",{name:"Selected component"})).toBeVisible();
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.nodes["4"]).toMatchObject({kind:"component",name:"Rectangle",children:["2"],x:10,y:20});
  expect(document.nodes["2"]).toMatchObject({kind:"rectangle",parent:"4",x:0,y:0});
});

test("creating an instance from a native variant set saves its default main and restores it after reload", async ({page}) => {
  await login(page);
  const buffer = await readFile(new URL("../fixtures/native-component-variants.json", import.meta.url));
  await page.getByLabel("Open Figcraft file", {exact:true}).setInputFiles({
    name:"variants.figcraft", mimeType:"application/octet-stream", buffer,
  });
  const layers = page.getByRole("region", {name:"Layers", exact:true});
  const cards = layers.getByRole("button", {name:"Card", exact:true});
  await cards.click();
  await layers.getByRole("button", {name:"Create instance", exact:true}).click();
  await expect(page.getByRole("region", {name:"Selected instance"})).toBeVisible();
  await expect(cards).toHaveCount(2);
  await page.getByRole("button", {name:"Undo", exact:true}).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", {name:"Redo", exact:true}).click();
  await expect(cards).toHaveCount(2);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await expect(cards).toHaveCount(2);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", {name:"Save as", exact:true}).click();
  const {document} = await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.nodes["5"]).toMatchObject({kind:"instance", name:"Card", component:"2", source:"2", parent:"1", x:140, y:0});
});

test("component edits update linked layers and preserve a renamed instance child across reload and download", async ({page}) => {
  await login(page);
  const buffer = await readFile(new URL("../fixtures/native-component-instance.json",import.meta.url));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"linked.figcraft",mimeType:"application/octet-stream",buffer});
  const layers = page.getByRole("region",{name:"Layers",exact:true});
  const layer = (id: number, name: string) => layers.locator('[data-layer-id="'+id+'"]').getByRole("button",{name,exact:true});
  async function rename(id: number, from: string, to: string) {
    await layer(id,from).click();
    await page.getByLabel("Name",{exact:true}).fill(to);
    await page.getByRole("button",{name:"Apply layer",exact:true}).click();
  }
  await rename(3,"Marker","Indicator");
  await expect(layer(5,"Indicator")).toBeVisible();
  await rename(5,"Indicator","On hold");
  await rename(3,"Indicator","Ready");
  await expect(layer(5,"On hold")).toBeVisible();
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(layer(3,"Indicator")).toBeVisible();
  await page.getByRole("button",{name:"Redo",exact:true}).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await expect(layer(3,"Ready")).toBeVisible();
  await expect(layer(5,"On hold")).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document} = await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.nodes["5"]).toMatchObject({parent:"4",source:"3",name:"On hold",overrides:["name"]});
});

test("instance controls swap variants, reset an override and detach with undo and native recovery",async ({page}) => {
  await login(page);
  const buffer=await readFile(new URL("../fixtures/native-component-variant-overrides.json",import.meta.url));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"variants.figcraft",mimeType:"application/octet-stream",buffer});
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  const pick=(id:number,name:string)=>layers.locator('[data-layer-id="'+id+'"]').getByRole("button",{name,exact:true}).click();
  await pick(2,"State=Off");
  await layers.getByRole("button",{name:"Create instance",exact:true}).click();
  const controls=page.getByRole("group",{name:"Instance",exact:true});
  await expect(controls).toBeVisible();
  const state=controls.getByRole("combobox",{name:"Variant State",exact:true});
  await expect(state).toHaveValue("Off");
  await state.selectOption("On");
  await expect(state).toHaveValue("On");
  await pick(10,"Mark");
  await page.getByLabel("Name",{exact:true}).fill("Own name");
  await page.getByRole("button",{name:"Apply layer"}).click();
  await page.getByRole("group",{name:"Overrides",exact:true}).getByRole("button",{name:"Reset name",exact:true}).click();
  await expect(page.getByLabel("Name",{exact:true})).toHaveValue("Mark");
  await pick(9,"Component 1");
  await controls.getByRole("button",{name:"Go to main component"}).click();
  await expect(page.getByRole("region",{name:"Selected component",exact:true})).toBeVisible();
  await expect(page.getByLabel("Name",{exact:true})).toHaveValue("State=On");
  await pick(9,"Component 1");
  await controls.getByRole("button",{name:"Detach instance"}).click();
  await expect(page.getByRole("region",{name:"Selected frame",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(controls).toBeVisible();
  await pick(9,"Component 1");
  await page.getByLabel("Design canvas",{exact:true}).focus();
  await page.keyboard.press("Control+Alt+b");
  await expect(page.getByRole("region",{name:"Selected frame",exact:true})).toBeVisible();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await pick(9,"Component 1");
  await expect(page.getByRole("region",{name:"Selected frame",exact:true})).toBeVisible();
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.nodes[9]).toMatchObject({kind:"frame",children:["10","11"]});
  expect(document.nodes[9].source).toBeUndefined();
  expect(document.nodes[10].source).toBeUndefined();
});

test("bound instance properties and editable slots survive recovery and native download",async ({page})=>{
  await login(page);
  const buffer=await readFile(new URL("../fixtures/native-component-typed.json",import.meta.url));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"typed.figcraft",mimeType:"application/octet-stream",buffer});
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  const selectCard=()=>layers.locator('[data-layer-id="7"]').getByRole("button",{name:"Card",exact:true}).click();
  const controls=page.getByRole("group",{name:"Instance",exact:true});
  await selectCard();
  await controls.getByLabel("Shown",{exact:true}).uncheck();
  const caption=controls.getByLabel("Caption",{exact:true});
  await caption.fill("Edited caption");
  await caption.press("Enter");
  await controls.getByLabel("Body",{exact:true}).selectOption({value:"5"});
  await selectCard();
  const reset=controls.getByRole("button",{name:"Reset Body",exact:true});
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(reset).toHaveCount(0);
  await controls.getByLabel("Body",{exact:true}).selectOption({value:"5"});
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await selectCard();
  await expect(controls.getByLabel("Shown",{exact:true})).not.toBeChecked();
  await expect(caption).toHaveValue("Edited caption");
  await expect(reset).toBeVisible();
  const saving=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await saving).path())!));
  expect(document.nodes[7]).toMatchObject({props:{Shown:false,Caption:"Edited caption"}});
  expect(document.nodes[8]).toMatchObject({visible:false});
  expect(document.nodes[9]).toMatchObject({text:{characters:"Edited caption"}});
  const slot=document.nodes[10];
  expect(slot).toMatchObject({kind:"frame",overrides:["slot"]});
  if (slot.kind!=="frame") throw new Error("Missing slot frame");
  expect(slot.children).toHaveLength(1);
  expect(document.nodes[slot.children[0]]).toMatchObject({kind:"instance",component:"5"});
});

test("adding variants wraps a standalone main and preserves declared choices after reload",async ({page})=>{
  await login(page);
  const buffer=await readFile(new URL("../fixtures/native-component-instance.json",import.meta.url));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"variants.figcraft",mimeType:"application/octet-stream",buffer});
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  const select=(id:number,name:string)=>layers.locator('[data-layer-id="'+id+'"]').getByRole("button",{name,exact:true}).click();
  await select(2,"Card");
  await layers.getByRole("button",{name:"Add variant",exact:true}).click();
  await expect(page.getByLabel("Name",{exact:true})).toHaveValue("Property 1=Variant2");
  await layers.getByRole("button",{name:"Add variant",exact:true}).click();
  await expect(page.getByLabel("Name",{exact:true})).toHaveValue("Property 1=Variant3");
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await select(4,"Card");
  const choice=page.getByRole("combobox",{name:"Variant Property 1",exact:true});
  await choice.selectOption("Variant2");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await select(4,"Card");
  await expect(choice).toHaveValue("Variant2");
  const saving=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await saving).path())!));
  expect(document.nodes[6]).toMatchObject({kind:"componentSet",name:"Card",children:["2","7"]});
  expect(document.nodes[4]).toMatchObject({kind:"instance",component:"7"});
});

test("combining selected mains as variants retains the linked instance and undoes in one step",async ({page})=>{
  await login(page);
  const buffer=await readFile(new URL("../fixtures/native-component-typed.json",import.meta.url));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"choices.figcraft",mimeType:"application/octet-stream",buffer});
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  const row=(id:number,name:string)=>layers.locator('[data-layer-id="'+id+'"]').getByRole("button",{name,exact:true});
  await row(2,"Card").click();
  await row(5,"Icon").click({modifiers:["Shift"]});
  await layers.getByRole("button",{name:"Combine as variants",exact:true}).click();
  await expect(row(11,"Card")).toBeVisible();
  await expect(row(2,"Property 1=Default")).toBeVisible();
  await expect(row(5,"Property 1=Variant2")).toBeVisible();
  await row(7,"Card").click();
  await expect(page.getByRole("combobox",{name:"Variant Property 1",exact:true})).toHaveValue("Default");
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(row(11,"Card")).toHaveCount(0);
  await expect(row(2,"Card")).toBeVisible();
  await expect(row(5,"Icon")).toBeVisible();
});

test("main property bindings, defaults and descriptions edit linked instances and survive native download",async ({page})=>{
  await login(page);
  const buffer=await readFile(new URL("../fixtures/native-component-instance.json",import.meta.url));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"main.figcraft",mimeType:"application/octet-stream",buffer});
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  const select=(id:number,name:string)=>layers.locator('[data-layer-id="'+id+'"]').getByRole("button",{name,exact:true}).click();
  await select(3,"Marker");
  await page.getByRole("button",{name:"Create visibility property",exact:true}).click();
  await expect(page.getByLabel("Bind Visibility",{exact:true})).toHaveValue("Visibility");
  await select(2,"Card");
  const properties=page.getByRole("group",{name:"Component properties",exact:true});
  await properties.getByLabel("Rename Visibility",{exact:true}).fill("Show marker");
  await properties.getByLabel("Rename Visibility",{exact:true}).press("Enter");
  await properties.getByLabel("Default Show marker",{exact:true}).uncheck();
  const description=page.getByLabel("Description",{exact:true});
  await description.fill("Dashboard card");
  await description.press("Tab");
  await properties.getByLabel("Create component property",{exact:true}).selectOption("text");
  await properties.getByLabel("Rename Property 1",{exact:true}).fill("Caption");
  await properties.getByLabel("Rename Property 1",{exact:true}).press("Enter");
  await select(4,"Card");
  const instance=page.getByRole("group",{name:"Instance",exact:true});
  await expect(instance.getByText("Dashboard card",{exact:true})).toBeVisible();
  await instance.getByLabel("Show marker",{exact:true}).uncheck();
  await instance.getByLabel("Caption",{exact:true}).fill("Hello");
  await instance.getByLabel("Caption",{exact:true}).press("Enter");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await select(4,"Card");
  await expect(instance.getByLabel("Show marker",{exact:true})).not.toBeChecked();
  await expect(instance.getByLabel("Caption",{exact:true})).toHaveValue("Hello");
  const saving=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await saving).path())!));
  expect(document.nodes[2]).toMatchObject({description:"Dashboard card",propOrder:["Show marker","Caption"]});
  expect(document.nodes[3]).toMatchObject({visible:false,propRefs:{visible:"Show marker"}});
  expect(document.nodes[5]).toMatchObject({visible:false,source:"3"});
});

test("slot authoring, scoped insertion and removal use the selected frame and support undo",async ({page})=>{
  await login(page);
  const buffer=await readFile(new URL("../fixtures/native-component-typed.json",import.meta.url));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"slots.figcraft",mimeType:"application/octet-stream",buffer});
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  const select=(id:number,name:string)=>layers.locator('[data-layer-id="'+id+'"]').getByRole("button",{name,exact:true}).click();
  await select(6,"Body");
  await page.getByRole("button",{name:"Remove slot",exact:true}).click();
  await page.getByRole("button",{name:"Name slot",exact:true}).click();
  await page.getByLabel("Slot name",{exact:true}).fill("Content");
  await page.getByRole("button",{name:"Make slot",exact:true}).click();
  await expect(page.getByLabel("Bind Slot",{exact:true})).toHaveValue("Content");
  await select(7,"Card");
  await page.getByRole("button",{name:"Select Content slot",exact:true}).click();
  const slot=page.getByRole("group",{name:"Slot",exact:true});
  await slot.getByLabel("Content",{exact:true}).selectOption("5");
  await select(6,"Body");
  await page.getByRole("button",{name:"Remove slot",exact:true}).click();
  await select(7,"Card");
  await expect(page.getByRole("button",{name:"Select Content slot",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await select(7,"Card");
  await expect(page.getByRole("button",{name:"Reset Content",exact:true})).toBeVisible();
});

test("variant property controls rename choices, reorder axes and save the chosen default into the saved set",async ({page})=>{
  await login(page);
  const buffer=await readFile(new URL("../fixtures/native-component-variant-overrides.json",import.meta.url));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"axes.figcraft",mimeType:"application/octet-stream",buffer});
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  // The native capture overlays both variants at the same coordinates.
  await layers.locator('[data-layer-id="5"]').getByRole("button",{name:"State=On",exact:true}).click();
  await page.getByLabel("Design canvas",{exact:true}).focus();
  await page.keyboard.press("ArrowRight");
  await layers.locator('[data-layer-id="8"]').getByRole("button",{name:"Component 1",exact:true}).click();
  const properties=page.getByRole("group",{name:"Component properties",exact:true});
  const rename=async(label:string,value:string)=>{
    const input=properties.getByLabel(label,{exact:true});
    await input.fill(value); await input.press("Enter");
  };
  await rename("Rename State","Mode");
  await rename("Rename Mode value On","Active");
  await properties.getByLabel("Default Mode",{exact:true}).selectOption("Active");
  await properties.getByLabel("Create component property",{exact:true}).selectOption("variant");
  await rename("Rename Property 1","Size");
  await properties.getByRole("button",{name:"Move Size up",exact:true}).click();
  await expect(layers.locator('[data-layer-id="5"]')).toContainText("Size=Default, Mode=Active");
  await properties.getByRole("button",{name:"Delete Size",exact:true}).click();
  await expect(properties.getByLabel("Default Size",{exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await layers.locator('[data-layer-id="8"]').getByRole("button",{name:"Component 1",exact:true}).click();
  await expect(properties.getByLabel("Default Mode",{exact:true})).toHaveValue("Active");
  const saving=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await saving).path())!));
  expect(document.nodes[5]).toMatchObject({name:"Size=Default, Mode=Active"});
  expect(document.nodes[2]).toMatchObject({name:"Size=Default, Mode=Off"});
});

async function openAssetDrawing(page: Page) {
  const engine = new EditorEngine();
  for (const [type,name,x,y,width,height,fill] of [
    ["component","Controls / Red",10,10,40,32,"#ff0000"],
    ["component","Controls / Blue",80,10,40,32,"#0000ff"],
    ["frame","Shelf",220,80,200,160,"#ffffff"],
  ]) engine.execute("node.create",{type,name,props:{x,y,width,height,fill}});
  const buffer = Buffer.from(await encodeFigcraft(engine.getSnapshot().document));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"assets.figcraft",mimeType:"application/octet-stream",buffer});
  await expect(page.getByRole("heading",{name:"Untitled",exact:true})).toBeVisible();
}

test("local Assets renders component thumbnails, filters folders, places into frames and Alt-swaps in one undo step",async({page})=>{
  await login(page);
  await openAssetDrawing(page);
  await resetCanvasOrigin(page);
  await page.getByRole("button",{name:"Assets",exact:true}).click();
  const panel = page.getByRole("region",{name:"Assets",exact:true});
  const red = panel.getByRole("button",{name:"Place Controls / Red",exact:true});
  const blue = panel.getByRole("button",{name:"Place Controls / Blue",exact:true});
  const folder = panel.getByRole("button",{name:"Page 1 / Controls"});
  await expect.poll(()=>red.locator("canvas").evaluate((el:HTMLCanvasElement)=>Array.from(el.getContext("2d")!.getImageData(el.width>>1,el.height>>1,1,1).data))).toEqual([255,0,0,255]);
  await folder.click();
  await expect(red).toHaveCount(0);
  await panel.getByRole("searchbox").fill(" red ");
  await expect(red).toBeVisible(); await expect(blue).toHaveCount(0);
  await panel.getByRole("searchbox").press("Escape");
  await folder.click();
  await red.click({button:"right"});
  await panel.getByRole("button",{name:"Hide when publishing"}).click();
  const hidden = panel.getByRole("button",{name:"Place .Controls / Red",exact:true});
  await hidden.click({button:"right"});
  await panel.getByRole("button",{name:"Hide when publishing"}).click();
  const canvas = page.getByLabel("Design canvas",{exact:true});
  const drop = await canvasPoint(page,300,140), box = (await canvas.boundingBox())!;
  const targetPosition = {x:drop.x-box.x,y:drop.y-box.y};
  await red.dragTo(canvas,{targetPosition});
  await expect(page.getByRole("region",{name:"Selected instance"})).toBeVisible();
  await page.keyboard.down("Alt");
  try { await blue.dragTo(canvas,{targetPosition}); } finally { await page.keyboard.up("Alt"); }
  await expectCanvasPixel(page,300,140,[0,0,255,255]);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expectCanvasPixel(page,300,140,[255,0,0,255]);
  await page.getByRole("button",{name:"Redo",exact:true}).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  const download = page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const doc = (await decodeFigcraft(await readFile((await (await download).path())!))).document;
  expect(doc.nodes["4"]).toMatchObject({children:["5"]});
  expect(doc.nodes["5"]).toMatchObject({kind:"instance",component:"3",parent:"4",x:60,y:44});
});

test("mobile Assets places its component at the current viewport centre and returns focus to the drawing",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await login(page,false);
  await openAssetDrawing(page);
  const menu = page.locator(".figcraft-mobile-assets");
  await menu.locator("summary").click();
  await menu.getByRole("button",{name:"Place Controls / Red"}).click();
  await expect(menu).not.toHaveAttribute("open","");
  const canvas = page.getByLabel("Design canvas",{exact:true});
  await expect(canvas).toBeFocused();
  const download = page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const doc = (await decodeFigcraft(await readFile((await (await download).path())!))).document;
  expect(doc.nodes["5"]).toMatchObject({kind:"instance",component:"2"});
  const centre = await canvas.evaluate((c:HTMLCanvasElement)=>{
    const b = c.getBoundingClientRect(), z = Number(c.dataset.viewZoom);
    return {x:Number(c.dataset.viewOriginX)+b.width/(2*z),y:Number(c.dataset.viewOriginY)+b.height/(2*z)};
  });
  const [,,,,x,y] = worldTransform(doc,"5");
  expect(x+20).toBeCloseTo(centre.x,3);
  expect(y+16).toBeCloseTo(centre.y,3);
});

test("local shared styles and linked layers survive an edit, browser recovery and a native download", async ({page}) => {
  await login(page);
  const buffer = await readFile(new URL("../fixtures/native-shared-styles.json", import.meta.url));
  const native = JSON.parse(buffer.toString("utf8"));
  await page.getByLabel("Open Figcraft file", {exact:true}).setInputFiles({name:"styles.figcraft", mimeType:"application/octet-stream", buffer});
  const surface = page.getByRole("region", {name:"Layers", exact:true}).getByRole("button", {name:"Surface", exact:true});
  await surface.click();
  const x = page.getByLabel("Edit X", {exact:true});
  await x.fill("87");
  await x.press("Enter");
  await expect(x).toHaveValue("87");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await surface.click();
  await expect(x).toHaveValue("87");
  const saving = page.waitForEvent("download");
  await page.getByRole("button", {name:"Save as", exact:true}).click();
  const archive = await readFile((await (await saving).path())!);
  const stored = JSON.parse(strFromU8(unzipSync(archive)["document.json"]));
  expect(stored.styles).toEqual(native.styles);
  expect(stored.nodes[2].grids).toEqual(native.nodes[2].grids);
  expect(stored.nodes[3].styles).toEqual(native.nodes[3].styles);
  expect(stored.nodes[4].runs).toEqual(native.nodes[4].runs);
});

test("create and edit a local style in Design, apply it from Assets and detach it on a narrow screen", async ({page}) => {
  await login(page);
  const buffer = await readFile(new URL("../fixtures/native-shared-styles.json", import.meta.url));
  await page.getByLabel("Open Figcraft file", {exact:true}).setInputFiles({name:"local-styles.figcraft",mimeType:"application/octet-stream",buffer});
  const layers = page.getByRole("region",{name:"Layers",exact:true});
  await layers.getByRole("button",{name:"Surface",exact:true}).click();
  const panel = page.getByRole("group",{name:"Shared styles",exact:true});
  await panel.getByRole("button",{name:"Fill styles",exact:true}).click();
  const picker = panel.getByRole("group",{name:"Fill style picker"});
  await picker.getByRole("button",{name:"Create style",exact:true}).click();
  await picker.getByRole("textbox",{name:"Style name",exact:true}).fill("Brand/Signal");
  await picker.getByRole("textbox",{name:"Style description",exact:true}).fill("Signal colour");
  await picker.getByRole("button",{name:"Save style",exact:true}).click();
  await picker.getByRole("button",{name:"Close",exact:true}).click();
  await expect(panel.getByRole("button",{name:"Fill styles"})).toContainText("Brand/Signal");
  await layers.getByRole("button",{name:"Card",exact:true}).click();
  await page.getByRole("button",{name:"Assets",exact:true}).click();
  const assets = page.getByRole("region",{name:"Assets",exact:true}).filter({visible:true});
  await assets.getByRole("searchbox",{name:"Search assets"}).fill("signal");
  await assets.getByRole("button",{name:"Brand/Signal",exact:true}).press("Enter");
  await expect(panel.getByRole("button",{name:"Fill styles"})).toContainText("Brand/Signal");
  await page.setViewportSize({width:390,height:844});
  await panel.getByRole("button",{name:"Fill styles"}).click();
  await picker.getByRole("button",{name:"Detach style"}).click();
  await expect(panel.getByRole("button",{name:"Fill styles"})).toHaveText("Fill");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document} = await decodeFigcraft(await readFile((await (await downloading).path())!));
  const saved = document.styles?.find(s=>s.name === "Brand/Signal");
  expect(saved).toMatchObject({id:"S:8",description:"Signal colour",type:"paint"});
  expect(document.nodes["3"].styles?.fill).toBe("S:8");
  expect(document.nodes["2"].styles?.fill).toBeNull();
  expect(document.nodes["2"].styles?.grid).toBe("S:1");
});

test("creating a shared text style in Design retains the selected Unicode characters", async ({page}) => {
  await login(page);
  const canvas = page.getByLabel("Design canvas",{exact:true});
  await canvas.focus(); await page.keyboard.press("t");
  const at = await canvasPoint(page,130,105);
  await page.mouse.click(at.x,at.y);
  const input = page.getByRole("textbox",{name:"Edit text layer"});
  await expect(input).toBeFocused();
  await page.keyboard.insertText("A🙂B");
  await input.evaluate((e:HTMLTextAreaElement)=>e.setSelectionRange(1,3,"backward"));
  await input.press("ControlOrMeta+b");
  const panel = page.getByRole("group",{name:"Shared styles",exact:true});
  await panel.getByRole("button",{name:"Text styles",exact:true}).click();
  const picker = panel.getByRole("group",{name:"Text style picker"});
  await picker.getByRole("button",{name:"Create style",exact:true}).click();
  await picker.getByRole("textbox",{name:"Style name",exact:true}).fill("Type/Emphasis");
  await picker.getByRole("button",{name:"Save style",exact:true}).click();
  await picker.getByRole("button",{name:"Close",exact:true}).click();
  await input.focus();
  await expect(input).toHaveValue("A🙂B");
  await input.press("Escape");
  const saving=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document} = await decodeFigcraft(await readFile((await (await saving).path())!));
  expect(document.styles).toMatchObject([{name:"Type/Emphasis",type:"text",style:{fontStyle:"Bold"}}]);
  const layer=document.nodes["2"];
  if (layer.kind !== "text") throw new Error("Missing text");
  expect(layer.text.runs).toMatchObject([{start:1,end:2,style:{styleId:"S:1"}}]);
  expect(layer.styles?.text).toBeFalsy();
});

test("frame layout guides render, toggle, reorder and survive browser recovery", async ({page}) => {
  const engine = new EditorEngine();
  engine.execute("node.create",{type:"frame",name:"Guided board",x:20,y:20,width:100,height:100,props:{fill:"white"}});
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({
    name:"guides.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(await engine.nativeSnapshot())
  });
  await page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Guided board",exact:true}).click();
  await resetCanvasOrigin(page);
  const panel = page.getByRole("group",{name:"Layout guides",exact:true});
  await panel.getByRole("button",{name:"Add layout grid"}).click();
  const first=panel.getByRole("group",{name:"Guide 1",exact:true});
  await first.getByLabel("Guide type").selectOption("columns");
  await first.getByRole("button",{name:"Guide 1 settings"}).click();
  for (const [label,value] of [["Guide count","2"],["Guide gutter","10"],["Guide margin","10"],["Guide opacity","100"]]) {
    const input=first.getByRole("spinbutton",{name:label,exact:true});
    await input.fill(value);
    await input.press("Enter");
  }
  await expectCanvasPixel(page,40,60,[255,0,0,255]);
  await expectCanvasPixel(page,70,60,[255,255,255,255]);
  const canvas=page.getByLabel("Design canvas",{exact:true});
  await canvas.focus();
  await page.keyboard.press("Shift+g");
  await expectCanvasPixel(page,40,60,[255,255,255,255]);
  await page.locator("summary").getByText("View",{exact:true}).click();
  await page.getByRole("button",{name:"Layout grids",exact:true}).click();
  await expectCanvasPixel(page,40,60,[255,0,0,255]);
  await panel.getByRole("button",{name:"Add layout grid"}).click();
  await first.getByRole("button",{name:"Move guide up"}).click();
  await expect(first.getByLabel("Guide type")).toHaveValue("grid");
  await first.getByRole("button",{name:"Remove guide"}).click();
  await expect(first.getByLabel("Guide type")).toHaveValue("columns");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.nodes[2].grids).toMatchObject([{kind:"columns",count:2,offset:10,gutter:10,color:{r:1,g:0,b:0,a:1}}]);
});

test("Design organises local style folders, reorders styles across folders and searches folded picker groups", async ({page})=>{
  await login(page);
  const buffer=await readFile(new URL("../fixtures/native-shared-styles.json",import.meta.url));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"organise.figcraft",mimeType:"application/octet-stream",buffer});
  const catalogue=page.getByRole("group",{name:"Local styles",exact:true});
  const palette=catalogue.getByRole("group",{name:"Colour styles"});
  await palette.getByRole("button",{name:"Rename folder Palette"}).click();
  await palette.getByLabel("Folder name").fill("Brand");
  await palette.getByLabel("Folder name").press("Enter");
  await palette.getByRole("button",{name:"Options for Brand/Surface"}).click();
  await palette.getByRole("button",{name:"Duplicate",exact:true}).click();
  const first=palette.getByRole("button",{name:"Edit Brand/Surface",exact:true});
  const stack=palette.getByRole("button",{name:"Edit Surface/Stack",exact:true});
  await stack.dragTo(first);
  await expect(palette.getByRole("button",{name:"Edit Brand/Stack"})).toBeVisible();
  await palette.getByRole("button",{name:"Options for Brand/Stack"}).click();
  await palette.getByRole("button",{name:"Move down"}).press("Enter");
  await palette.getByRole("button",{name:"Edit Brand/Surface copy"}).click();
  await expect(catalogue.getByRole("button",{name:"Update from selection"})).toHaveCount(0);
  await catalogue.getByLabel("Style description").fill("Catalogue copy");
  await catalogue.getByRole("button",{name:"Save style"}).click();
  await page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Surface",exact:true}).click();
  const shared=page.getByRole("group",{name:"Shared styles",exact:true});
  await shared.getByRole("button",{name:"Fill styles"}).click();
  const picker=shared.getByRole("group",{name:"Fill style picker"});
  await picker.getByRole("button",{name:"Style folder Brand"}).click();
  await expect(picker.getByRole("button",{name:"Brand/Stack",exact:true})).toHaveCount(0);
  await picker.getByRole("searchbox").fill("stack");
  await expect(picker.getByRole("button",{name:"Brand/Stack",exact:true})).toBeVisible();
  await picker.getByRole("button",{name:"Show as grid"}).press("Enter");
  await picker.getByRole("button",{name:"Brand/Stack",exact:true}).click();
  await shared.getByRole("button",{name:"Stroke styles"}).click();
  await expect(shared.getByRole("button",{name:"Show as list"})).toBeVisible();
  await expect(shared.getByRole("button",{name:"Style folder Brand"})).toHaveAttribute("aria-expanded","false");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.styles?.filter(s=>s.type==="paint").map(s=>s.name)).toEqual(["Brand/Surface","Brand/Stack","Brand/Surface copy"]);
  expect(document.nodes[3].styles?.fill).toBe("S:6");
  expect(document.styles?.find(s=>s.name==="Brand/Surface copy")?.description).toBe("Catalogue copy");
});

test("editing a shared text definition updates linked characters and preserves its font on recovery", async ({page})=>{
  await login(page);
  const buffer=await readFile(new URL("../fixtures/native-shared-styles.json",import.meta.url));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"type.figcraft",mimeType:"application/octet-stream",buffer});
  const catalogue=page.getByRole("group",{name:"Local styles",exact:true});
  await catalogue.getByRole("button",{name:"Edit Type/Emphasis"}).click();
  const type=catalogue.getByRole("group",{name:"Typography properties"});
  for (const [label,value,result] of [["Style font size","*1.5","30"],["Style line height","150%","150%"],
    ["Style line height","-2","0%"],["Style line height","24px","24"],["Style letter spacing","-2.5%","-2.5%"]]) {
    const field=type.getByLabel(label,{exact:true});
    await field.fill(value);
    await field.press("Enter");
    await expect(field).toHaveValue(result);
  }
  await type.getByRole("button",{name:"Font family",exact:true}).click();
  const fonts=type.getByRole("dialog",{name:"Choose font family"});
  await fonts.getByRole("option",{name:"Inter",exact:true}).first().click();
  await type.getByRole("combobox",{name:"Style font style",exact:true}).selectOption("Regular");
  await catalogue.getByLabel("Style description").fill("Reviewed typography");
  await catalogue.getByRole("button",{name:"Back",exact:true}).click();
  await catalogue.getByRole("button",{name:"Edit Depth/Stack"}).click();
  await expect(catalogue.getByRole("list",{name:"Effect properties"}).getByRole("listitem")).toHaveCount(6);
  await catalogue.getByRole("button",{name:"Back",exact:true}).click();
  await catalogue.getByRole("button",{name:"Edit Layout/Columns"}).click();
  await expect(catalogue.getByRole("list",{name:"Grid properties"}).getByRole("listitem")).toHaveCount(2);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  const definition={fontSize:30,fontFamily:"Inter",fontStyle:"Regular",lineHeight:{unit:"pixels",value:24},letterSpacing:{unit:"percent",value:-2.5}};
  expect(document.styles?.find(s=>s.id==="S:5")).toMatchObject({style:definition,description:"Reviewed typography"});
  const text=document.nodes[4];
  expect(text.kind==="text" && text.text.runs[0]).toMatchObject({start:0,end:5,style:{...definition,styleId:"S:5"}});
});

test("a shared paint picker propagates gradient stops and uploaded images with no selected layers", async ({page})=>{
  await login(page);
  const buffer=await readFile(new URL("../fixtures/native-shared-styles.json",import.meta.url));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"paints.figcraft",mimeType:"application/octet-stream",buffer});
  const catalogue=page.getByRole("group",{name:"Local styles",exact:true});
  await catalogue.getByRole("button",{name:"Edit Palette/Surface"}).click();
  const opacity=catalogue.getByRole("textbox",{name:"Style paint 1 opacity (%)"});
  await opacity.fill("75"); await opacity.press("Enter");
  await catalogue.getByRole("button",{name:"Edit Style paint 1 paint",exact:true}).click();
  const picker=catalogue.getByRole("group",{name:"Style paint 1 paint picker"});
  await picker.getByLabel("Paint type").selectOption("linear");
  await picker.getByRole("button",{name:"Add stop",exact:true}).click();
  const stop=picker.getByRole("button",{name:"Gradient stop 3",exact:true});
  const handle=(await stop.boundingBox())!;
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
  await page.mouse.down(); await page.mouse.move(handle.x+handle.width/2+30,handle.y+handle.height/2,{steps:4}); await page.mouse.up();
  await expect(picker.getByRole("button",{name:"Gradient stop 3",exact:true})).toHaveAttribute("aria-pressed","true");
  await picker.getByLabel("Paint type").selectOption("image");
  await picker.getByLabel("Choose image").setInputFiles(new URL("../fixtures/images/six-pixels.png",import.meta.url).pathname);
  await picker.getByLabel("Image mode").selectOption("tile");
  await picker.getByRole("button",{name:"Close paint picker"}).click();
  await catalogue.getByRole("button",{name:"Back",exact:true}).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  const style=document.styles?.find(s=>s.id==="S:2");
  if (style?.type!=="paint" || style.paints[0].type!=="image") throw new Error("Missing shared image paint");
  const paint=style.paints[0];
  expect(paint).toMatchObject({scale_mode:"tile",opacity:.75});
  expect(document.images?.[paint.image]).toMatchObject({width:3,height:2});
  expect(document.nodes[3]).toMatchObject({fills:[paint],strokes:[paint]});
});

test("local variables display expressions and preserve extended collections and reordered modes after recovery", async ({page})=>{
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(new URL("../fixtures/native-variables.json",import.meta.url).pathname);
  await page.getByRole("button",{name:"Open variables (6)"}).click();
  const panel=page.getByRole("dialog",{name:"Local variables"});
  await panel.getByRole("searchbox",{name:"Search variables"}).fill("Highlight");
  const row=panel.getByRole("row",{name:/Highlight/});
  await expect(row.getByRole("cell").first()).toContainText("Base + Accent");
  await panel.getByRole("button",{name:"Extend collection",exact:true}).click();
  await expect(panel.getByRole("table",{name:"Theme (extended) variables"})).toBeVisible();
  await expect(panel.getByRole("button",{name:"Add mode"})).toHaveCount(0);
  await panel.getByRole("button",{name:"Theme",exact:true}).click();
  await panel.getByLabel("Options for Dark").click();
  await panel.getByRole("button",{name:"Duplicate mode",exact:true}).click();
  await panel.getByRole("textbox",{name:"Mode name"}).fill("Dusk");
  await panel.getByRole("button",{name:"Save name"}).click();
  await panel.getByLabel("Options for Dusk").click();
  await panel.getByRole("columnheader",{name:/Dusk/}).getByRole("button",{name:"Move left"}).click();
  await panel.getByRole("button",{name:"Create collection",exact:true}).click();
  await panel.getByRole("textbox",{name:"Collection name"}).fill("Motion");
  await panel.getByRole("button",{name:"Save name"}).click();
  await panel.getByRole("button",{name:"Close variables",exact:true}).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await page.getByRole("button",{name:"Open variables (11)"}).click();
  await panel.getByRole("button",{name:"Theme (extended)",exact:true}).click();
  await expect(panel.getByRole("columnheader")).toHaveText(["Name","Light","Dusk","Dark"]);
  await panel.getByRole("button",{name:"Close variables",exact:true}).click();
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.variables?.collections.map(c=>c.name)).toEqual(["Theme","Density","Theme (extended)","Motion"]);
  expect(document.variables?.variables.filter(v=>v.extends)).toHaveLength(5);
});

test("variable authoring preserves aliases, metadata and collection overrides through recovery", async ({page})=>{
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(new URL("../fixtures/native-variables.json",import.meta.url).pathname);
  await page.getByRole("button",{name:"Open variables (6)"}).click();
  const panel=page.getByRole("dialog",{name:"Local variables"});
  await panel.getByRole("button",{name:"Create variable",exact:true}).click();
  await panel.getByRole("group",{name:"Variable type"}).getByRole("button",{name:"Number",exact:true}).click();
  const details=panel.getByRole("form",{name:"Variable details"});
  await details.getByLabel("Variable name").fill("Highlight");
  await details.getByRole("button",{name:"Save variable"}).click();
  await expect(panel.getByRole("alert")).toContainText("unique name");
  await details.getByLabel("Variable name").fill("Size/Tap");
  await details.getByLabel("Variable description").fill("Minimum target");
  await details.getByLabel("All scopes",{exact:true}).uncheck();
  await details.getByLabel("Width and height").check();
  await details.getByLabel("Hide from publishing").check();
  await details.getByLabel("WEB code syntax").fill("var(--tap)");
  await details.getByRole("button",{name:"Save variable"}).click();
  const row=panel.getByRole("row").filter({has:page.getByRole("button",{name:"Edit variable Size/Tap",exact:true})});
  const light=row.getByRole("button",{name:"Edit Size/Tap · Light",exact:true});
  const input=row.getByRole("textbox",{name:"Value for Size/Tap · Light"});
  async function setLight(value:string) {
    await light.click();
    await input.fill(value);
    await input.press("Enter");
    await expect(light).toHaveText(value);
  }
  await setLight("44");
  await row.getByRole("button",{name:"Choose alias for Size/Tap · Dark"}).click();
  await row.getByRole("combobox",{name:"Alias for Size/Tap · Dark"}).selectOption("VariableID:6");
  await expect(row.getByRole("button",{name:"Edit Size/Tap · Dark"})).toContainText("Spacing");
  await panel.getByRole("button",{name:"Extend collection",exact:true}).click();
  await expect(panel.getByRole("table",{name:"Theme (extended) variables"})).toBeVisible();
  await setLight("70");
  await row.getByRole("button",{name:"Reset override"}).click();
  await expect(light).toHaveText("44");
  await setLight("72");
  await row.getByRole("button",{name:"Detach alias"}).click();
  await expect(row.getByRole("button",{name:"Edit Size/Tap · Dark"})).toHaveText("6.5");
  const mixed=panel.getByRole("cell").filter({has:page.getByRole("button",{name:"Edit Highlight · Dark",exact:true})});
  await mixed.getByRole("button",{name:"Detach calculation"}).click();
  await expect(mixed.getByRole("button",{name:"Edit Highlight · Dark"})).toContainText("#");
  await panel.getByRole("button",{name:"Close variables"}).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  const data=document.variables!;
  const parent=data.variables.find(v=>v.name==="Size/Tap" && !v.extends)!;
  const child=data.variables.find(v=>v.extends===parent.id)!;
  expect(parent).toMatchObject({description:"Minimum target",hiddenFromPublishing:true,scopes:["WIDTH_HEIGHT"],codeSyntax:{WEB:"var(--tap)"}});
  const values=(v:typeof parent)=>data.collections.find(c=>c.id===v.collection)!.modes.map(m=>v.values[m.id]);
  expect(values(parent)).toEqual([{type:"number",value:44},{type:"alias",value:"VariableID:6"}]);
  expect(values(child)).toEqual([{type:"number",value:72},{type:"number",value:6.5}]);
  expect(child.overrides).toHaveLength(2);
});

test("frame variable modes distinguish inherited main modes from mixed and explicit choices",async({page})=>{
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(new URL("../fixtures/native-variable-modes.json",import.meta.url).pathname);
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  const pick=(id:number,name:string)=>layers.locator('[data-layer-id="'+id+'"]').getByRole("button",{name,exact:true});
  const mode=page.getByRole("group",{name:"Variable modes"}).getByRole("combobox",{name:"Theme",exact:true});
  await pick(2,"Container").click();
  await expect(mode.locator("option:checked")).toHaveText("Auto (Dark)");
  await pick(5,"Card").click();
  await expect(mode.locator("option:checked")).toHaveText("Auto (Light)");
  await mode.selectOption({label:"Dark"});
  await pick(2,"Container").click({modifiers:["Shift"]});
  await expect(mode.locator("option:checked")).toHaveText("Mixed");
  await mode.selectOption({label:"Light"});
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await pick(5,"Card").click();
  await expect(mode.locator("option:checked")).toHaveText("Light");
  await mode.selectOption("auto");
  await expect(mode.locator("option:checked")).toHaveText("Auto (Light)");
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.nodes[2].variableModes).toEqual({"VariableCollectionId:1":"VariableCollectionId:1/mode1"});
  expect(document.nodes[5].variableModes).toBeUndefined();
});

test("shared style variable pickers filter by scope and retain per-layer mode colours after download",async({page})=>{
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(new URL("../fixtures/native-style-mode-consumers.json",import.meta.url).pathname);
  const catalogue=page.getByRole("group",{name:"Local styles",exact:true});
  await catalogue.getByRole("button",{name:"Edit Surface",exact:true}).click();
  await catalogue.getByRole("button",{name:"Bind variable to Style paint 1 colour"}).click();
  const picker=catalogue.getByRole("group",{name:"Variables for Style paint 1 colour"});
  await expect(picker.getByRole("button",{name:"Spacing"})).toHaveCount(0);
  await expect(picker.getByRole("button",{name:"Accent"})).toHaveCount(0);
  await page.evaluate(()=>window.document.fonts.ready.then(()=>true));
  await expect(picker).toHaveScreenshot("style-paint-variable-picker.png",{animations:"disabled",caret:"hide"});
  await picker.getByRole("searchbox").fill("Bas");
  await picker.getByRole("button",{name:"Base",exact:true}).click();
  const chip=catalogue.getByRole("button",{name:"Detach variable from Style paint 1 colour"});
  await expect(chip).toHaveText("Base");
  await chip.click();
  await catalogue.getByRole("button",{name:"Bind variable to Style paint 1 colour"}).click();
  await picker.getByRole("button",{name:"Base",exact:true}).click();
  await catalogue.getByRole("button",{name:"Back",exact:true}).click();
  await catalogue.getByRole("button",{name:"Edit Columns",exact:true}).click();
  await catalogue.getByRole("button",{name:"Bind variable to Style grid 1 size"}).click();
  await catalogue.getByRole("group",{name:"Variables for Style grid 1 size"}).getByRole("button",{name:"Spacing"}).click();
  await catalogue.getByRole("button",{name:"Back",exact:true}).click();
  await catalogue.getByRole("button",{name:"Edit Caption",exact:true}).click();
  await catalogue.getByRole("button",{name:"Bind variable to Style font size"}).click();
  await catalogue.getByRole("group",{name:"Variables for Style font size"}).getByRole("button",{name:"Spacing"}).click();
  await expect(catalogue.getByRole("textbox",{name:"Style font size",exact:true})).toHaveCount(0);
  await expect(catalogue.getByRole("button",{name:"Detach variable from Style font size"})).toHaveText("Spacing");
  await catalogue.getByRole("button",{name:"Back",exact:true}).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.styles?.[0]).toMatchObject({bound:{"fills/0/color":"VariableID:1"}});
  expect(document.nodes[2].fills?.[0]).toMatchObject({color:{a:Math.fround(128/255),r:Math.fround(23/255)}});
  expect(document.nodes[5].fills?.[0]).toMatchObject({color:{a:Math.fround(192/255),r:Math.fround(194/255)}});
  expect(document.nodes[2].grids?.[0].size).toBe(6.5);
});

test("layer paint variables detach, rebind and survive recovery and native download",async({page})=>{
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(new URL("../fixtures/native-layer-variables.json",import.meta.url).pathname);
  const select=page.getByRole("region",{name:"Layers",exact:true}).locator('[data-layer-id="2"]').getByRole("button",{name:"Token swatch",exact:true});
  await select.click();
  const chip=page.getByRole("button",{name:"Detach variable from fill 1 colour",exact:true});
  await expect(chip).toHaveText("Accent");
  await chip.click();
  await page.getByRole("button",{name:"Bind variable to fill 1 colour",exact:true}).click();
  const picker=page.getByRole("group",{name:"Variables for fill 1 colour",exact:true});
  await expect(picker.getByRole("button",{name:"Spacing"})).toHaveCount(0);
  await picker.getByRole("searchbox").fill("Base");
  await picker.getByRole("button",{name:"Base",exact:true}).click();
  await expect(chip).toHaveText("Base");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await select.click();
  await expect(chip).toHaveText("Base");
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.nodes[2].boundVariables).toEqual({"fills/0/color":"VariableID:1"});
  expect(document.nodes[2].fills?.[0]).toMatchObject({color:{a:Math.fround(192/255)},opacity:1});
});

test("layer fills replace mixed character colours and promote a shared character paint", async ({ page }) => {
  await login(page);
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles(new URL("../fixtures/native-character-fills.json", import.meta.url).pathname);
  const layers = page.getByRole("region", { name: "Layers", exact: true });
  const fills = page.getByRole("region", { name: "Appearance" }).getByRole("group", { name: "Fills", exact: true });
  const mixed = fills.getByText("Click + to replace mixed content");
  const colours = fills.getByRole("textbox", { name: /Fill \d+ CSS colour/ });

  await layers.getByRole("button", { name: "Mixed sample", exact: true }).click();
  await expect(mixed).toBeVisible();
  await expect(colours).toHaveCount(0);
  await fills.getByRole("button", { name: "Add fill", exact: true }).click();
  await expect(mixed).toHaveCount(0);
  await expect(colours).toHaveCount(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(mixed).toBeVisible();

  await layers.getByRole("button", { name: "Shared sample", exact: true }).click();
  await expect(colours).toHaveCount(1);
  const yellow = await colours.inputValue();
  expect(yellow).toMatch(/^rgba\(255,204[\d.]*,0,1\)$/);
  await fills.getByRole("button", { name: "Add fill", exact: true }).click();
  await expect(colours.nth(1)).toHaveValue(yellow);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await layers.getByRole("button", { name: "Shared sample", exact: true }).click();
  await expect(colours.nth(1)).toHaveValue(yellow);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save as", exact: true }).click();
  const { document } = await decodeFigcraft(await readFile((await (await downloading).path())!));
  const shared = document.nodes[3];
  expect(shared.kind).toBe("text");
  if (shared.kind !== "text") throw new Error("Missing shared text layer");
  expect(shared.fills).toHaveLength(2);
  expect(shared.text.style.fills).toBeUndefined();
  expect(shared.text.runs.every(run => run.style.fills === undefined)).toBe(true);
});

test("scoped layer fields bind, change and detach across geometry, text, layout, effects and instances", async ({page})=>{
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(new URL("../fixtures/native-variable-inspectors.json",import.meta.url).pathname);
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  const select=(name:string)=>layers.getByRole("button",{name,exact:true}).click();
  const button=(name:string)=>page.getByRole("button",{name,exact:true});
  async function bind(field:string,name:string,excluded?:string,change=false) {
    await button((change ? "Change variable for " : "Bind variable to ")+field).click();
    const group=page.getByRole("group",{name:"Variables for "+field,exact:true});
    if (excluded) await expect(group.getByRole("button",{name:excluded,exact:true})).toHaveCount(0);
    await group.getByRole("searchbox").fill(name);
    await group.getByRole("button",{name,exact:true}).click();
    await expect(button("Detach variable from "+field)).toHaveText(name);
  }

  await select("Token swatch");
  await bind("Edit Width","Size","Alpha");
  const width=page.getByRole("spinbutton",{name:"Edit Width",exact:true});
  await expect(width).toHaveCount(0);
  await bind("Edit Width","Spacing",undefined,true);
  await button("Detach variable from Edit Width").click();
  await expect(width).toHaveValue("6.5");
  await button("Undo").click();
  await expect(button("Detach variable from Edit Width")).toHaveText("Spacing");
  await bind("Node opacity","Alpha","Size");
  await bind("Visible","Enabled","Spacing");
  await button("Effect 1 settings").click();
  await bind("Blur","Blur size","Alpha");
  await select("Grid frame");
  await bind("Gap between items","Spacing","Size");
  await button("Guide 1 settings").click();
  await bind("Grid size","Spacing");
  await select("Editable text");
  await bind("Font size","Spacing","Size");
  await bind("Text content","Copy number","Alpha");
  await select("Button instance");
  await bind("Shown","Enabled","Spacing");
  await bind("Caption","Action","Copy number");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await select("Button instance");
  await expect(button("Detach variable from Caption")).toHaveText("Action");
  const downloading=page.waitForEvent("download");
  await button("Save as").click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.nodes[2]).toMatchObject({width:6.5,opacity:Math.fround(0.4),effects:[{radius:18}],boundVariables:{width:"VariableID:6",visible:"VariableID:5"}});
  expect(document.nodes[3]).toMatchObject({layout:{gap:6.5},grids:[{size:6.5}]});
  expect(document.nodes[4]).toMatchObject({text:{characters:"23",style:{fontSize:6.5}}});
  expect(document.nodes[6]).toMatchObject({props:{Caption:"Continue",Shown:true}});
});

test("a narrow multi-selection inspector restores keyboard focus and binds every selected width", async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(new URL("../fixtures/native-variable-inspectors.json",import.meta.url).pathname);
  await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveCount(2);
  const menu=page.locator(".figcraft-mobile-layers");
  await menu.locator("summary").click();
  const layers=menu.getByRole("region",{name:"Layers",exact:true});
  await layers.getByRole("button",{name:"Token swatch",exact:true}).click();
  await layers.getByRole("button",{name:"Grid frame",exact:true}).click({modifiers:["Shift"]});
  await menu.locator("summary").click();
  const trigger=page.getByRole("button",{name:"Bind variable to Edit Width",exact:true});
  await trigger.focus();
  await page.keyboard.press("Enter");
  const group=page.getByRole("group",{name:"Variables for Edit Width",exact:true});
  await expect(group.getByRole("searchbox")).toBeFocused();
  await expect(group.getByRole("button",{name:"Alpha"})).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const search=group.getByRole("searchbox");
  await search.fill("Size");
  await search.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button",{name:"Detach variable from Edit Width",exact:true})).toHaveText("Size");
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  for (const id of [2,3]) expect(document.nodes[id]).toMatchObject({width:48,boundVariables:{width:"VariableID:7"}});
});

test("variable files download in native formats and merge through the signed-in picker, undo and recovery",async({page})=>{
  const golden=JSON.parse(await readFile(new URL("../fixtures/native-variable-exports.json",import.meta.url),"utf8")) as Record<string,string>;
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(new URL("../fixtures/native-variable-inspectors.json",import.meta.url).pathname);
  const open=page.getByRole("button",{name:"Open variables (12)",exact:true});
  await open.click();
  const panel=page.getByRole("dialog",{name:"Local variables"});
  const format=panel.getByRole("combobox",{name:"Export format"});
  for (const [kind,text] of Object.entries(golden)) {
    await format.selectOption(kind);
    const saving=page.waitForEvent("download");
    await panel.getByRole("button",{name:"Export variables",exact:true}).click();
    const file=await saving;
    expect(file.suggestedFilename()).toBe("Untitled.variables."+kind);
    expect(await readFile((await file.path())!,"utf8")).toBe(text);
  }
  const input=panel.getByLabel("Import variables JSON",{exact:true});
  await input.setInputFiles({name:"invalid.json",mimeType:"application/json",buffer:Buffer.from("{}")});
  await expect(panel.getByRole("status")).toContainText("Expected variableCollections");
  const incoming=JSON.parse(golden.json);
  const raw=incoming.meta.variables["VariableID:4"];
  raw.name="Imported caption";raw.valuesByMode["VariableCollectionId:1/mode1"]="Browser import";
  const upload=()=>input.setInputFiles({name:"variables.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(incoming))});
  await upload();
  await expect(panel.getByRole("status")).toHaveText("Imported 1 new variables, updated 11.");
  await panel.getByRole("button",{name:"Close variables"}).click();
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await open.click();
  await upload();
  await expect(panel.getByRole("status")).toHaveText("Imported 1 new variables, updated 11.");
  await upload();
  await expect(panel.getByRole("status")).toHaveText("Imported 0 new variables, updated 12.");
  await panel.getByRole("button",{name:"Close variables"}).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await page.getByRole("button",{name:"Open variables (13)",exact:true}).click();
  await expect(panel.getByRole("button",{name:"Edit variable Imported caption",exact:true})).toBeVisible();
});

test("a 10,000-variable import keeps the catalogue bounded and edits the last row and mode",async({page})=>{
  await login(page);
  const wideModes=Array.from({length:50},(_,i)=>({name:"Mode "+i,modeId:"m"+i}));
  const variables:Record<string,unknown>={wide:{name:"Wide value",variableCollectionId:"wide",resolvedType:"FLOAT",valuesByMode:{m0:5}}};
  for (let i=0;i<10000;i++) {
    const key=String(i).padStart(5,"0");
    variables[key]={name:"Value "+key,variableCollectionId:"lengths",resolvedType:"FLOAT",valuesByMode:{light:i || 0.4,dark:i+1}};
  }
  const bytes=Buffer.from(JSON.stringify({variableCollections:{lengths:{name:"Lengths",modes:[{name:"Light",modeId:"light"},{name:"Dark",modeId:"dark"}]},
    wide:{name:"Wide",modes:wideModes}},variables}));
  await page.getByRole("button",{name:"Open variables (0)"}).click();
  const panel=page.getByRole("dialog",{name:"Local variables"});
  const start=Date.now();
  await panel.getByLabel("Import variables JSON").setInputFiles({name:"large.json",mimeType:"application/json",buffer:bytes});
  await expect(panel.getByRole("status")).toHaveText("Imported 10001 new variables, updated 0.");
  const importMs=Date.now()-start;
  const table=panel.getByRole("table",{name:"Lengths variables"});
  await expect(table).toHaveAttribute("aria-rowcount","10001");
  expect(await table.getByRole("row").count()).toBeLessThan(30);
  const scroller=panel.locator(".figcraft-variable-table");
  await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await panel.getByRole("button",{name:"Edit Value 09999 · Light",exact:true}).click();
  const value=panel.getByRole("textbox",{name:"Value for Value 09999 · Light",exact:true});
  await value.fill("1234");
  await scroller.evaluate(el=>{el.scrollTop=0;});
  await expect(value).toBeAttached();
  await value.press("Enter");
  const search=panel.getByRole("searchbox",{name:"Search variables"});
  await search.fill("09999");
  await expect(panel.getByRole("button",{name:"Edit Value 09999 · Light",exact:true})).toHaveText("1234");
  await panel.getByRole("button",{name:"Wide",exact:true}).click();
  const wide=panel.getByRole("table",{name:"Wide variables"});
  await expect(wide).toHaveAttribute("aria-colcount","51");
  expect(await wide.getByRole("columnheader").count()).toBeLessThan(15);
  await scroller.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  await expect(panel.getByRole("button",{name:"Edit Wide value · Mode 49",exact:true})).toHaveText("5");
  await test.info().attach("variable-import-time",{body:JSON.stringify({variables:10001,inputBytes:bytes.length,importMs}),contentType:"application/json"});
});

test("Assets publishes a native library revision, undoes it and preserves the snapshot through reload and download",async({page})=>{
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(new URL("../fixtures/native-published-library.figcraft",import.meta.url).pathname);
  await expect(page.getByRole("region",{name:"Layers",exact:true}).locator('[data-layer-id="5"]')).toContainText("Unpublished rename");
  const assets=page.getByRole("button",{name:"Assets",exact:true});
  const launch=page.getByRole("button",{name:"Publish library…",exact:true});
  const menu=page.locator("details").filter({has:page.locator("summary").filter({hasText:/^Libraries$/})});
  await menu.locator("summary").click();
  await menu.getByRole("button",{name:"Publish library…",exact:true}).click();
  const form=page.getByRole("form",{name:"Publish library",exact:true});
  await expect(form.getByRole("status")).toContainText("published version 1");
  await form.getByRole("textbox",{name:"Description (optional)"}).fill("Consumer release");
  const publishing=page.waitForEvent("download");
  await form.getByRole("button",{name:"Publish changes"}).click();
  const published=await decodeFigcraft(await readFile((await (await publishing).path())!));
  expect(published.document.published?.manifest.description).toBe("Consumer release");
  await expect(form.getByRole("status")).toContainText("published version 2");
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(form.getByRole("status")).toContainText("published version 1");
  await page.getByRole("button",{name:"Redo",exact:true}).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await expect(page.getByRole("button",{name:"Save as",exact:true})).toBeEnabled();
  await page.getByLabel("Design canvas",{exact:true}).focus();
  await page.keyboard.press("Alt+Digit3");
  await expect(assets).toHaveAttribute("aria-pressed","true");
  await expect(form).toHaveCount(0);
  await launch.click();
  await expect(form.getByRole("status")).toContainText("published version 2");
  await expect(form.getByRole("textbox",{name:"Description (optional)"})).toHaveValue("Consumer release");
  const download=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=await readFile((await (await download).path())!);
  const {document}=await decodeFigcraft(saved);
  expect(document.published?.manifest.components).toEqual([{id:"5",name:"Unpublished rename",set:false,version:"2",published:true}]);
  await page.getByRole("group",{name:"Sidebar"}).getByRole("button",{name:"Layers"}).click();
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  await layers.locator('[data-layer-id="5"]').getByRole("button",{name:"Unpublished rename",exact:true}).click();
  await menu.locator("summary").click();
  await menu.getByRole("button",{name:"Hide when publishing",exact:true}).click();
  await expect(layers.locator('[data-layer-id="5"]')).toContainText(".Unpublished rename");
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await menu.locator("summary").click();
  await menu.getByRole("button",{name:"Publish library…",exact:true}).click();
  const narrow=page.locator(".figcraft-mobile-assets");
  await expect(narrow.getByRole("form",{name:"Publish library"})).toBeVisible();
  await narrow.locator("summary").click();
  await expect(narrow.getByRole("form",{name:"Publish library"})).toHaveCount(0);
});

test("a consumer adds a local published file, restores the source after reload and removes the link with undo",async({page})=>{
  await login(page);
  const assets=page.getByRole("button",{name:"Assets",exact:true});
  await assets.click();
  await page.getByLabel("Choose published library").setInputFiles(new URL("../fixtures/native-published-library.figcraft",import.meta.url).pathname);
  const enabled=page.getByRole("region",{name:"Enabled libraries"});
  await expect(enabled).toContainText("Published version 1");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();await assets.click();
  await expect(enabled).toContainText("Published version 1");
  const download=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=await readFile((await (await download).path())!);
  const {document}=await decodeFigcraft(saved);
  expect(document.libraryLinks).toHaveLength(1);expect(document.published).toBeUndefined();
  expect(Object.keys(document.nodes)).toEqual(["1"]);
  await enabled.getByRole("button",{name:"Remove library Untitled"}).click();
  await expect(enabled).toHaveCount(0);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(enabled).toContainText("Published version 1");
});

test("linked variables extend, alias and bind from a read-only library, then accept a new edition and recover",async({page})=>{
  await login(page);
  const fixture=(name:string)=>new URL("../fixtures/"+name,import.meta.url).pathname;
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(fixture("native-variable-inspectors.json"));
  const button=(name:string)=>page.getByRole("button",{name,exact:true});
  await expect(button("Open variables (12)")).toBeEnabled();
  await button("Assets").click();
  const picker=page.getByLabel("Choose published library");
  await picker.setInputFiles(fixture("native-published-library.figcraft"));
  const enabled=page.getByRole("region",{name:"Enabled libraries"});
  await expect(enabled).toContainText("Published version 1");
  await button("Open variables (12)").click();
  const panel=page.getByRole("dialog",{name:"Local variables"});
  const external=panel.getByRole("group",{name:"Untitled",exact:true});
  await external.getByRole("button",{name:"Theme",exact:true}).click();
  await expect(panel.getByRole("table",{name:"Theme variables"})).toContainText("Size");
  await expect(panel.getByRole("button",{name:"Create variable",exact:true})).toHaveCount(0);
  await external.getByRole("button",{name:"Density",exact:true}).click();
  await panel.getByRole("button",{name:"Extend collection",exact:true}).click();
  await expect(panel.getByRole("table",{name:"Density (extended) variables"})).toBeVisible();
  await panel.getByRole("button",{name:"Theme",exact:true}).first().click();
  await panel.getByRole("button",{name:"Choose alias for Base · Light",exact:true}).click();
  const alias=panel.getByRole("combobox",{name:"Alias for Base · Light",exact:true});
  await alias.selectOption({value:await alias.locator('optgroup[label="Untitled"] option').filter({hasText:/^Base$/}).getAttribute("value") as string});
  await expect(panel.getByRole("button",{name:"Edit Base · Light",exact:true})).toContainText("Base");
  await panel.getByRole("button",{name:"Close variables"}).click();
  await button("Layers").click();
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  await layers.getByRole("button",{name:"Token swatch",exact:true}).click();
  await button("Bind variable to Edit Width").click();
  const variable=page.getByRole("group",{name:"Variables for Edit Width",exact:true});
  await variable.getByRole("group",{name:"Untitled / Theme",exact:true}).getByRole("button",{name:"Size",exact:true}).click();
  await expect(button("Detach variable from Edit Width")).toHaveText("Size");
  await layers.getByRole("button",{name:"Grid frame",exact:true}).click();
  const mode=page.getByRole("combobox",{name:"Untitled / Theme",exact:true});
  await mode.selectOption("1");
  await expect(mode).toHaveValue("1");
  await button("Assets").click();
  await picker.setInputFiles(fixture("native-published-library-v2.figcraft"));
  await expect(enabled).toContainText("Published version 2");
  const accept=enabled.getByRole("button",{name:/Accept \d+ updates?/});
  await accept.click();await expect(accept).toHaveCount(0);
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await layers.getByRole("button",{name:"Grid frame",exact:true}).click();
  await expect(page.getByRole("combobox",{name:"Kit / Theme",exact:true})).toHaveValue("1");
  const downloading=page.waitForEvent("download");await button("Save as").click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.libraryLinks?.[0].version).toBe("2");
  expect(document.variables?.variables.some(v=>v.name==="New scale" && v.extends)).toBe(true);
  expect(document.libraryRecords?.variables.some(r=>r.key==="VariableID:1" && r.version==="2")).toBe(true);
});

test("linked styles apply from Assets and Design, update a selected text range and recover offline copies",async({page})=>{
  await login(page);
  const button=(name:string)=>page.getByRole("button",{name,exact:true});
  await button("Assets").click();
  const source=page.getByLabel("Choose published library");
  const file=(v:number)=>new URL("../fixtures/native-linked-style-library-v"+v+".figcraft",import.meta.url).pathname;
  await source.setInputFiles(file(1));
  const enabled=page.getByRole("region",{name:"Enabled libraries"});
  await expect(enabled).toContainText("Published version 1");
  const canvas=page.getByLabel("Design canvas",{exact:true});
  await canvas.focus();await page.keyboard.press("t");
  const at=await canvasPoint(page,140,130);await page.mouse.click(at.x,at.y);
  const input=page.getByRole("textbox",{name:"Edit text layer"});
  await expect(input).toBeFocused();await page.keyboard.insertText("A🙂B");
  await input.evaluate((el:HTMLTextAreaElement)=>el.setSelectionRange(1,3,"backward"));
  await input.press("ControlOrMeta+b");
  const panel=page.getByRole("group",{name:"Shared styles",exact:true});
  await panel.getByRole("button",{name:"Text styles"}).click();
  const picker=panel.getByRole("group",{name:"Text style picker"});
  const kit=picker.getByRole("group",{name:"Design Kit",exact:true});
  await expect(kit.getByRole("button",{name:"Edit Caption"})).toHaveCount(0);
  await kit.getByRole("button",{name:"Caption",exact:true}).press("Enter");
  await expect(panel.getByRole("button",{name:"Text styles"})).toContainText("Caption");
  await input.focus();await input.press("Escape");
  await enabled.getByRole("button",{name:"Pattern",exact:true}).click();
  await expect(panel.getByRole("button",{name:"Fill styles"})).toContainText("Pattern");
  await source.setInputFiles(file(2));
  await enabled.getByRole("button",{name:"Accept 1 update",exact:true}).click();
  await enabled.getByRole("button",{name:"Remove library Design Kit"}).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  const downloading=page.waitForEvent("download");await button("Save as").click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  expect(document.libraryLinks).toBeUndefined();
  expect(Object.keys(document.images ?? {})).toHaveLength(1);
  const layer=document.nodes["2"];
  if (layer.kind!=="text") throw Error("Missing text");
  expect(layer.text.runs).toMatchObject([{start:1,end:2,style:{fontSize:32,styleId:document.libraryRecords?.styles?.find(r=>r.key==="S:4")?.local}}]);
});

test("library component tiles place, swap, accept nested updates and recover their hidden mains",async({page})=>{
  await login(page);
  const button=(name:string)=>page.getByRole("button",{name,exact:true});
  await button("Assets").click();
  const enabled=page.getByRole("region",{name:"Enabled libraries"});
  const source=page.getByLabel("Choose published library");
  const kit=(v:number)=>new URL("../fixtures/native-component-library-v"+v+".figcraft",import.meta.url).pathname;
  await source.setInputFiles(kit(1));
  const tile=(name:string)=>enabled.getByRole("button",{name:"Place "+name,exact:true});
  await expect(tile("_Draft")).toHaveCount(0);
  const canvas=page.getByLabel("Design canvas",{exact:true}),drop=await canvasPoint(page,180,125),box=(await canvas.boundingBox())!;
  const targetPosition={x:drop.x-box.x,y:drop.y-box.y};
  await tile("Button").dragTo(canvas,{targetPosition});
  await expect(page.getByRole("region",{name:"Selected instance"})).toBeVisible();
  await page.keyboard.down("Alt");
  try {await tile("Card").dragTo(canvas,{targetPosition});} finally {await page.keyboard.up("Alt");}
  await tile("Button").click();
  await source.setInputFiles(kit(3));
  await enabled.getByRole("button",{name:"Accept 3 updates",exact:true}).click();
  await enabled.getByRole("button",{name:"Remove library Untitled",exact:true}).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  const downloading=page.waitForEvent("download");await button("Save as").click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  const store=document.libraryStore!;
  expect(document.pages).toEqual(["1"]);expect(document.libraryLinks).toBeUndefined();
  expect(store.components.map(r=>r.version)).toEqual(["3","3"]);
  const mains=new Map(store.components.map(r=>[r.key,r.root]));
  const placed=Object.values(document.nodes).filter(n=>n.parent==="1");
  expect(placed).toMatchObject([{kind:"instance",component:mains.get("4")},{kind:"instance",component:mains.get("2")}]);
  expect(Object.values(document.nodes).filter(n=>n.name==="Dot")).toHaveLength(4);
});

test("whole-library swap reports unmatched assets and recovers the replacement after undo and redo",async({page})=>{
  await login(page);
  const file=(name:string)=>new URL("../fixtures/native-swap-"+name+".figcraft",import.meta.url).pathname;
  const button=(name:string)=>page.getByRole("button",{name,exact:true});
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(file("partial-input"));
  await button("Assets").click();
  const enabled=page.getByRole("region",{name:"Enabled libraries"});
  await expect(enabled).toContainText("Ocean");await expect(enabled).toContainText("Forest");
  const picker=page.getByLabel("Choose published library");
  await picker.setInputFiles(file("ocean"));await expect(button("Place Only in A")).toBeVisible();
  await picker.setInputFiles(file("forest"));await expect(button("Place Button")).toHaveCount(2);
  const ocean=enabled.getByRole("group",{name:"Ocean assets",exact:true});
  const forest=enabled.getByRole("group",{name:"Forest assets",exact:true});
  const folder=ocean.getByRole("button",{name:"Library",exact:true});
  await folder.click();await expect(ocean.getByRole("button",{name:"Place Button"})).toHaveCount(0);
  await expect(forest.getByRole("button",{name:"Place Button"})).toBeVisible();
  await forest.getByRole("button",{name:"Forest",exact:true}).click();
  const search=page.getByRole("searchbox",{name:"Search assets"});
  await search.fill("only IN a");
  await expect(ocean.getByRole("button",{name:"Place Only in A"})).toBeVisible();
  await expect(forest).toHaveCount(0);
  await search.fill("brand");
  await expect(forest.getByRole("button",{name:"Brand",exact:true})).toBeVisible();
  await search.fill("");await expect(folder).toHaveAttribute("aria-expanded","false");
  await expect(forest.getByRole("button",{name:"Forest",exact:true})).toHaveAttribute("aria-expanded","false");
  await button("Swap library Ocean").click();
  await page.getByRole("group",{name:"Swap Ocean to"}).getByRole("button",{name:"Forest"}).click();
  const message=page.getByRole("status").filter({hasText:"Swapped Ocean to Forest"});
  await expect(message).toContainText("component Only in A, extended collection Theme (extended)");
  await button("Undo").click();await button("Redo").click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  const downloading=page.waitForEvent("download");await button("Save as").click();
  const {document}=await decodeFigcraft(await readFile((await (await downloading).path())!));
  const native=(await decodeFigcraft(await readFile(file("partial-redo")))).document;
  expect(document).toEqual({...native,name:document.name,libraryLinks:native.libraryLinks?.map(l=>({
    ...l,path:document.libraryLinks?.find(other=>other.id===l.id)?.path
  }))});
});

test("page swatches apply the original alpha to a fill or selected gradient stop",async({page})=>{
  const e=new EditorEngine();
  for (const [i,fill] of ["#0033cc80","#ff0000"].entries()) {
    e.execute("shape.rectangle",{x:i*80,y:40,width:60,height:60});
    e.execute("node.set",{id:i+2,props:{name:i===0 ? "Sample" : "Target",fill}});
  }
  await login(page);
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"Swatches.figcraft",
    mimeType:"application/octet-stream",buffer:Buffer.from(await e.nativeSnapshot())});
  await page.getByRole("region",{name:"Layers",exact:true}).getByRole("button",{name:"Target",exact:true}).click();
  const picker=page.getByRole("group",{name:"fill 1 paint picker",exact:true});
  const swatch=picker.getByRole("button",{name:"Use #0033CC80"});
  await page.getByRole("button",{name:"Edit fill 1 paint"}).click();
  await swatch.click();
  const button=(name:string)=>page.getByRole("button",{name,exact:true});
  const save=async()=>{
    const download=page.waitForEvent("download");await button("Save as").click();
    const {document}=await decodeFigcraft(await readFile((await (await download).path())!));
    return rectanglePaints(document.nodes["3"] as RectangleNode)[0];
  };
  expect(await save()).toMatchObject({type:"solid",opacity:Math.fround(128/255)});
  if (!await picker.isVisible()) await button("Edit fill 1 paint").click();
  await picker.getByLabel("Paint type").selectOption("linear");
  await picker.getByRole("button",{name:"Gradient stop 2",exact:true}).click();
  await swatch.press("Enter");
  const gradient=await save();
  if (gradient.type!=="gradient") throw Error("Expected gradient");
  expect(gradient.stops[1].color).toMatchObject({r:0,g:Math.fround(51/255),b:Math.fround(204/255),a:Math.fround(128/255)});
  await button("Undo").click();
  expect(await save()).not.toEqual(gradient);
});

test("linked main opens its author tab, retains uncommitted edits and reuses the tab after reload", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Assets", exact: true }).click();
  const kit = new URL("../fixtures/native-component-library-v1.figcraft", import.meta.url).pathname;
  await page.getByLabel("Choose published library").setInputFiles(kit);
  await page.getByRole("region", { name: "Enabled libraries" }).getByRole("button", { name: "Place Button", exact: true }).click();
  const go = page.getByRole("button", { name: "Go to main component", exact: true });
  await go.click();
  const tabs = page.getByRole("tablist", { name: "Open files" }).getByRole("tab");
  await expect(tabs).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Selected component", exact: true })).toBeVisible();
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toHaveValue("Button");
  await name.fill("Author edit");
  await page.getByRole("button", { name: "Apply layer", exact: true }).click();
  await tabs.first().click();
  await go.click();
  await expect(tabs).toHaveCount(2);
  await expect(name).toHaveValue("Author edit");
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await tabs.first().click();
  await page.getByRole("list", { name: "Page layers" }).getByRole("button", { name: "Button", exact: true }).click();
  await go.click();
  await expect(name).toHaveValue("Author edit");
});

test("version history previews read-only designs, restores in one undo and persists named versions", async ({ page }) => {
  await login(page);
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  const fileMenu = page.locator(".figcraft-document-bar").getByText("File", { exact: true });
  const panel = page.getByRole("complementary", { name: "Version history" });
  await button("Create rectangle").click();
  await fileMenu.click(); await button("Save to version history…").click();
  await panel.getByLabel("Version name").fill("First drawing");
  await panel.getByLabel("Description").fill("One rectangle");
  await panel.getByRole("button", { name: "Save version", exact: true }).click();
  const first = panel.getByRole("listitem", { name: "First drawing", exact: true });
  await expect(first).toContainText("One rectangle");
  await page.getByRole("group", { name: "Create layer", exact: true }).getByRole("spinbutton", { name: "X", exact: true }).fill("200");
  await button("Create rectangle").click();
  await first.getByRole("button", { name: "First drawing" }).click();
  await expectCanvasPixel(page, 250, 90, [245, 245, 245, 255]);
  await expect(button("Create rectangle")).toBeDisabled();
  await panel.getByRole("button", { name: "Current version" }).click();
  await expectCanvasPixel(page, 250, 90, [217, 217, 217, 255]);
  await first.getByRole("button", { name: "Restore" }).click();
  await expectCanvasPixel(page, 250, 90, [245, 245, 245, 255]);
  await button("Undo").click();
  await expectCanvasPixel(page, 250, 90, [217, 217, 217, 255]);
  await first.getByRole("button", { name: "Rename" }).click();
  await panel.getByLabel("Version name").fill("Milestone");
  await panel.getByRole("button", { name: "Save version" }).click();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  await page.reload();
  await expect(button("Create rectangle")).toBeEnabled();
  await expectCanvasPixel(page, 250, 90, [217, 217, 217, 255]);
  await fileMenu.click(); await button("Version history").click();
  const saved = panel.getByRole("listitem", { name: "Milestone" });
  await expect(saved).toBeVisible();
  await saved.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByRole("heading", { name: "Untitled (Milestone)", exact: true })).toBeVisible();
  await page.getByRole("tablist", { name: "Open files" }).getByRole("tab").first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await saved.getByRole("button", { name: "Delete", exact: true }).click();
  await saved.getByRole("button", { name: "Confirm delete" }).click();
  await expect(saved).toHaveCount(0);
  await expect(panel.getByRole("listitem", { name: "Autosave" })).toBeVisible();
});

test("three 10,000-layer tabs reuse their drawings and mount one canvas during repeated switches", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    return (await cdp.send("Runtime.getHeapUsage")).usedSize;
  };
  const base = await heap();
  const engine = new EditorEngine();
  engine.execute("shape.rectangle");
  const sample = JSON.parse(strFromU8(unzipSync(await engine.nativeSnapshot())["document.json"]));
  for (let i = 3; i <= 10_001; i++) {
    sample.nodes[i] = { ...sample.nodes[2], id: i, name: "Rectangle " + i, transform: [1, 0, 0, 1, (i % 100) * 140, Math.floor(i / 100) * 140] };
    sample.nodes[1].children.push(i);
  }
  sample.next_id = 10_002;
  let bytes = 0;
  for (const name of ["Large A", "Large B", "Large C"]) {
    sample.name = name;
    const buffer = Buffer.from(zipSync({ "document.json": strToU8(JSON.stringify(sample)) }));
    bytes += buffer.length;
    await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({ name: name + ".figcraft", buffer, mimeType: "application/octet-stream" });
    await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
  }
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  const openHeap = await heap();
  const samples = await page.evaluate(async () => {
    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role=tab]')).slice(1);
    const timings: number[] = [];
    for (let i = 0; i < 18; i++) {
      const now = performance.now();
      const tab = tabs[i % tabs.length];
      tab.click();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (document.querySelectorAll('canvas[aria-label="Design canvas"]').length !== 1 ||
        document.querySelector(".figcraft-document-bar h1")?.textContent !== tab.textContent) throw Error("The active canvas did not switch");
      timings.push(performance.now() - now);
    }
    return timings.sort((a, b) => a - b);
  });
  const afterSwitch = await heap();
  for (let i = 0; i < 3; i++) {
    await page.locator(".figcraft-document-bar").getByText("File", { exact: true }).click();
    await page.getByRole("button", { name: "Close file", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Untitled", exact: true })).toBeVisible();
  await expect(page.locator(".figcraft-recovery")).toHaveText("Recovery saved on this device");
  const afterClose = await heap();
  await test.info().attach("file-workspace-memory", { contentType: "application/json", body: JSON.stringify({
    documents: 3, layersPerDocument: 10_000, nativeBytes: bytes, base, openHeap, afterSwitch, afterClose,
    switchMedianMs: samples[9], switchP95Ms: samples[17],
  }) });
  expect(afterSwitch - openHeap).toBeLessThan(8 * 1024 * 1024);
  expect(afterClose).toBeLessThan(openHeap);
});

test("native file thumbnails fit the first page or isolate the selected cover frame", async ({ page }) => {
  await login(page);
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles(new URL("../fixtures/file-thumbnail-scene.json", import.meta.url).pathname);
  await expect(page.getByRole("heading", { name: "Thumbnail frames", exact: true })).toBeVisible();
  const check = async (name: string) => {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save as", exact: true }).click();
    const members = unzipSync(await readFile((await (await pending).path())!));
    expect(members["thumbnail.png"]).toBeDefined();
    const native = await readFile(new URL("../fixtures/file-thumbnail-" + name + ".png", import.meta.url));
    const pixels = await page.evaluate(async ({ pngs, name }) => {
      const result = [];
      for (const png of pngs) {
        const img = await createImageBitmap(new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: "image/png" }));
        const ctx = new OffscreenCanvas(img.width, img.height).getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const points = name === "cover" ? [[10, 10], [60, 60], [180, 180]] : [[10, 15], [150, 15], [310, 15]];
        result.push({ size: [img.width, img.height], pixels: points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]) });
        img.close();
      }
      return result;
    }, { pngs: [native.toString("base64"), Buffer.from(members["thumbnail.png"]).toString("base64")], name });
    expect(pixels[1]).toEqual(pixels[0]);
    return JSON.parse(strFromU8(members["document.json"]));
  };
  await check("page");
  await page.getByRole("list", { name: "Page layers", exact: true }).getByRole("button", { name: "Cover", exact: true }).click();
  await page.locator(".figcraft-document-bar").getByText("Object", { exact: true }).click();
  await page.getByRole("button", { name: "Set as thumbnail" }).click();
  const chosen = await check("cover");
  expect(chosen.nodes[2].plugin_data).toEqual({ "figcraft.thumbnail": "true" });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await check("page");
});

test("branch tabs save the main archive, recover under their owner and reopen archived drawings", async ({ page }) => {
  await login(page);
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  const fileMenu = page.locator(".figcraft-document-bar").getByText("File", { exact: true });
  await button("Create rectangle").click();
  await fileMenu.click(); await button("Create branch…").click();
  await page.getByLabel("Branch name").fill("Review");
  await button("Create").click();
  await expect(page.getByRole("tab", { name: /Review/ })).toHaveAttribute("aria-selected", "true");
  await button("Create rectangle").click();
  const pending = page.waitForEvent("download");
  await button("Save as").click();
  const file = await pending;
  expect(file.suggestedFilename()).toBe("Untitled.figcraft");
  const { document, branches } = await decodeFigcraft(await readFile((await file.path())!));
  expect(document.nodes["4294967297"]).toBeUndefined();
  expect(branches![0].head.document.nodes["4294967297"].kind).toBe("rectangle");
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Untitled", exact: true })).toBeVisible();
  await expect(button("Create rectangle")).toBeEnabled();
  await fileMenu.click(); await button("Version history").click();
  const list = page.getByRole("region", { name: "Branches" });
  await expect(list).toContainText("Review");
  await list.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
  await fileMenu.click(); await button("Version history").click();
  await list.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("heading", { name: "Untitled", exact: true })).toBeVisible();
  await expect(list).toContainText("archived");
  await list.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
});

test("mixed branch conflict choices gate merge, retain history and undo as one edit", async ({ page }) => {
  await login(page);
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  const fileMenu = page.locator(".figcraft-document-bar").getByText("File", { exact: true });
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles(new URL("../fixtures/native-branch-conflict.figcraft", import.meta.url).pathname);
  await expect(page.getByRole("list", { name: "Page layers" }).getByRole("button", { name: "Main box", exact: true })).toBeVisible();
  await fileMenu.click(); await button("Version history").click();
  const list = page.getByRole("region", { name: "Branches" });
  await list.getByRole("button", { name: "Review branch Review", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review and merge" });
  const merge = dialog.getByRole("button", { name: "Merge into main" });
  await expect(merge).toBeDisabled();
  const shots = dialog.locator("canvas");
  await expect(shots).toHaveCount(2);
  await expect.poll(() => shots.first().evaluate(c => {
    const canvas = c as HTMLCanvasElement;
    return canvas.getContext("2d")!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3];
  })).toBe(255);
  await dialog.getByRole("button", { name: "Overlay" }).click();
  await dialog.getByLabel("Comparison split").fill("35");
  await dialog.getByRole("group", { name: "Main box · name" }).getByRole("radio", { name: /^Branch/ }).check();
  await expect(merge).toBeDisabled();
  await dialog.getByRole("group", { name: "Main box · width" }).getByRole("radio", { name: /^Main/ }).check();
  await merge.click();
  await expect(dialog).toHaveCount(0);
  await expect(list).toContainText("merged");
  await expect(page.getByRole("complementary", { name: "Version history" })).toContainText("Merged “Review”");
  const save = async () => {
    const pending = page.waitForEvent("download"); await button("Save as").click();
    return decodeFigcraft(await readFile((await (await pending).path())!));
  };
  const merged = await save();
  expect(merged.document.nodes["2"]).toMatchObject({ name: "Branch box", width: 200, height: 110 });
  await button("Undo").click();
  expect((await save()).document.nodes["2"]).toMatchObject({ name: "Main box", width: 200, height: 80 });
});

test("layer clipboard crosses file tabs, respects newer system text and pastes at the pointer", async ({ page, context }) => {
  await login(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await createNamedRectangle(page, "Transfer", 20, 30);
  const canvas = page.getByLabel("Design canvas", { exact: true });
  const bar = page.locator(".figcraft-document-bar");
  const layers = page.getByRole("region", { name: "Layers", exact: true });
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("<svg width=");
  await bar.getByText("File", { exact: true }).click();
  await bar.getByRole("button", { name: "New file", exact: true }).click();
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(layers.getByRole("button", { name: "Transfer", exact: true })).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+x");
  await expect(layers.getByRole("button", { name: "Transfer", exact: true })).toHaveCount(0);
  const point = await canvasPoint(page, 90, 110);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.getByRole("button", { name: "Paste here", exact: true }).click();
  await expect(layers.getByRole("button", { name: "Transfer", exact: true })).toHaveCount(1);
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+Shift+v");
  await expect(layers.getByRole("button", { name: "Transfer", exact: true })).toHaveCount(2);
  await bar.getByText("Edit", { exact: true }).click();
  await bar.getByRole("button", { name: "Paste to replace", exact: true }).click();
  await page.evaluate(() => navigator.clipboard.writeText("From another app"));
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.getByText("3 layers", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await bar.getByRole("button", { name: "Save as", exact: true }).click();
  const doc = (await decodeFigcraft(await readFile((await (await download).path())!))).document;
  const transferred = Object.values(doc.nodes).filter(n => n.name === "Transfer");
  expect(transferred).toHaveLength(2);
  for (const n of transferred) expect(n).toMatchObject({ kind: "rectangle", x: 90, y: 110 });
  expect(Object.values(doc.nodes).some(n => n.kind === "text" && n.text.characters === "From another app")).toBe(true);
});

test("import report follows its source tab and distinguishes open, append and SVG placement", async ({ page }) => {
  await login(page);
  const report = page.getByRole("dialog", { name: "Import report", exact: true });
  const open = page.getByLabel("Open Figcraft file", { exact: true });
  const add = page.getByLabel("Import into current document", { exact: true });
  const design = (name: string, children: unknown[]) => ({
    name: name + ".json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ name, document: { id: "0:0", type: "DOCUMENT", name, children: [
      { id: "0:1", type: "CANVAS", name: "Page", children },
    ] } })),
  });
  await open.setInputFiles(design("Synthetic", [{ id: "1:1", name: "No type" }]));
  await expect(report.getByText("Opened as a new document")).toBeVisible();
  await expect(report.getByText("Layers without a type were skipped", { exact: true })).toBeVisible();
  await expect(report.getByText("Pages: 1 · Layers: 0 · Images: 0")).toBeVisible();
  await expect(report).toHaveScreenshot("import-report.png", { animations: "disabled", maxDiffPixels: 0 });
  const tabs = page.getByRole("tablist", { name: "Open files" }).getByRole("tab");
  await tabs.first().click();
  await expect(report).toBeVisible();
  await tabs.last().click();
  const bar = page.locator(".figcraft-document-bar");
  await bar.getByText("File", { exact: true }).click();
  await bar.getByRole("button", { name: "Close file", exact: true }).click();
  await expect(report).toHaveCount(0);
  await open.setInputFiles(design("Clean", []));
  await expect(report.getByText("No compatibility warnings reported")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(report).toHaveCount(0);
  await add.setInputFiles(design("Append", []));
  await expect(report.getByText("Pages added to the document")).toBeVisible();
  await report.getByRole("button", { name: "Close", exact: true }).click();
  const svg = (name: string, content: string) => ({ name, mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' + content + '</svg>') });
  await open.setInputFiles(svg("CleanIcon.svg", '<rect width="40" height="40"/>'));
  await expect(page.getByRole("heading", { name: "CleanIcon", exact: true })).toBeVisible();
  await expect(report).toHaveCount(0);
  await add.setInputFiles(svg("Noted.svg", '<defs><filter id="f"><feMorphology radius="2"/></filter></defs><rect width="40" height="40" filter="url(#f)"/>'));
  await expect(report.getByText("Placed on the current page")).toBeVisible();
  await expect(report.getByText(/filter f isn't a shadow or blur/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 700 });
  const bounds = await report.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(report).toHaveCount(0);
});

test("draw, wrap, convert and toggle editable Sections in the signed-in editor",async({page})=>{
  await login(page);
  await createNamedRectangle(page,"Child",55,55,20,20);
  const canvas=page.getByLabel("Design canvas",{exact:true});
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  await canvas.focus();
  await canvas.press("Shift+s");
  const origin=await canvasPoint(page,20,20),end=await canvasPoint(page,145,145);
  await page.mouse.move(origin.x,origin.y);await page.mouse.down();
  await page.mouse.move(end.x,end.y,{steps:4});await page.mouse.up();
  await expect(layers.getByRole("button",{name:"Section 1",exact:true})).toBeVisible();
  await expectCanvasPixel(page,65,65,[217,217,217,255]);
  await layers.getByRole("button",{name:"Hide/Show section contents"}).click();
  await expectCanvasPixel(page,65,65,[255,255,255,255]);
  await canvas.press("ControlOrMeta+z");
  await expectCanvasPixel(page,65,65,[217,217,217,255]);
  await layers.getByRole("button",{name:"Convert to frame",exact:true}).click();
  await layers.getByRole("button",{name:"Convert to section",exact:true}).click();
  await layers.getByRole("button",{name:"Wrap in new section",exact:true}).click();
  const save=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const doc=(await decodeFigcraft(await readFile((await (await save).path())!))).document;
  const nodes=Object.values(doc.nodes),outer=nodes.find(n=>n.name==="Section 2")!,inner=nodes.find(n=>n.name==="Section 1")!;
  expect(outer).toMatchObject({kind:"section",x:-20,y:-20,width:205,height:205});
  expect(inner).toMatchObject({kind:"section",contentsHidden:false,parent:outer.id});
  expect(nodes.find(n=>n.name==="Child")?.parent).toBe(inner.id);
});

test("frame PDF download finds nested frames in a folded Section and keeps native reading order",async({page})=>{
  await login(page);
  const files=unzipSync(await readFile(new URL("../fixtures/native-section-frame-export.zip",import.meta.url)));
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"nested.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(files["nested.figcraft"])});
  const bar=page.locator(".figcraft-document-bar");
  await bar.getByText("File",{exact:true}).click();
  const download=page.waitForEvent("download");
  await bar.getByRole("button",{name:"Export frames to PDF…",exact:true}).click();
  const exported=await readFile((await (await download).path())!);
  const count=/\/Type \/Pages\b[^>]*\/Count (\d+)/.exec(exported.toString("latin1"));
  expect(count?.[1]).toBe("3");
  const {execFileSync}=await import("node:child_process");
  for (const index of ["1","2","3"]) {
    const args=["-f",index,"-l",index,"-r","72","-singlefile","-"];
    const baseline=execFileSync("pdftoppm",args,{input:files["frames.pdf"]});
    expect(execFileSync("pdftoppm",args,{input:exported}).equals(baseline)).toBe(true);
  }
});

test("native Sections paint their own fill and hide nested artwork when folded",async({page})=>{
  await login(page);
  const files=unzipSync(await readFile(new URL("../fixtures/native-section-contents.zip",import.meta.url)));
  for (const [name,rgba] of [["shown",[255,0,0,255]],["hidden",[255,255,255,255]]] as const) {
    await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({
      name:name+".figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(files[name+".figcraft"]),
    });
    await expectCanvasPixel(page,60,60,rgba);
  }
});

test("external design HTML pastes editable layers before image or text and falls back on invalid markers", async ({page}) => {
  await login(page);
  const fixtures=unzipSync(await readFile(new URL("../fixtures/native-design-clipboard.zip",import.meta.url)));
  const original=unzipSync(await readFile(new URL("../fixtures/native-fig-imports.zip",import.meta.url)));
  const canvas=page.getByLabel("Design canvas",{exact:true});
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  const paste=async(data:string,text:string,image=false)=>{
    await canvas.focus();
    await canvas.evaluate((target,{data,text,image})=>{
      const transfer=new DataTransfer();
      transfer.setData("text/html","<span><!--(figma)"+data+"(/figma)--></span>");
      transfer.setData("text/plain",text);
      if (image) transfer.items.add(new File(["invalid image"],"alternative.png",{type:"image/png"}));
      target.dispatchEvent(new ClipboardEvent("paste",{clipboardData:transfer,bubbles:true,cancelable:true}));
    },{data,text,image});
  };
  await paste(Buffer.from(fixtures["copied-card.fig"]).toString("base64"),"Alternative text",true);
  await expect(layers.getByRole("button",{name:"Card",exact:true})).toBeVisible();
  await expect(layers.getByRole("button",{name:"Dot",exact:true})).toBeVisible();
  await canvas.press("ControlOrMeta+z");
  await expect(layers.getByRole("button",{name:"Card",exact:true})).toHaveCount(0);
  await paste("invalid!","Fallback from clipboard");
  await expect(layers.getByRole("button",{name:"Fallback from clipboard",exact:true})).toBeVisible();
  await paste(Buffer.from(original["missing-images.fig"]).toString("base64"),"Image fallback");
  await expect(page.getByText(/clipboard didn't carry the images of: Rectangle/)).toBeVisible();
  const importReport = page.getByRole("dialog", { name: "Import report", exact: true });
  await expect(importReport).toHaveCount(0);
  await paste(Buffer.from(original["vector-outlines.fig"]).toString("base64"), "Vector fallback");
  await expect(importReport.getByText("Pasted design layers", { exact: true })).toBeVisible();
  await expect(importReport.getByText("Vectors without geometry are empty (×2)", { exact: true })).toBeVisible();
  await expect(importReport.getByText("Placed on the current page")).toBeVisible();
  await importReport.getByRole("button", { name: "Close" }).click();
});

test("copy properties transfers appearance across tabs and undo restores the destination", async ({ page }) => {
  await login(page);
  await createNamedRectangle(page, "Style source", 20, 30);
  const appearance = page.getByRole("region", { name: "Appearance" });
  await appearance.getByLabel("Node opacity").fill("0.4");
  await appearance.getByRole("button", { name: "Apply layer" }).click();
  const canvas = page.getByLabel("Design canvas", { exact: true });
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+Alt+c");
  const bar = page.locator(".figcraft-document-bar");
  await bar.getByText("File", { exact: true }).click();
  await expect(bar.getByRole("button", { name: "Revert to saved" })).toBeDisabled();
  await bar.getByText("Open recent", { exact: true }).click();
  await expect(bar.getByRole("button", { name: "Clear recent" })).toBeDisabled();
  await bar.getByRole("button", { name: "New file", exact: true }).click();
  await createNamedRectangle(page, "Destination", 60, 80);
  await bar.getByText("Edit", { exact: true }).click();
  await bar.getByRole("button", { name: "Paste properties", exact: true }).click();
  await expect.poll(async () => Number(await appearance.getByLabel("Node opacity").inputValue())).toBeCloseTo(0.4);
  await expect(appearance.getByLabel("Name", { exact: true })).toHaveValue("Destination");
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect(appearance.getByLabel("Node opacity")).toHaveValue("1");
});

test("linked layer paste retains the native library record and image across recovery and download", async ({ page, context }) => {
  await login(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles(new URL("../fixtures/native-library-component-consumer.figcraft", import.meta.url).pathname);
  const layers = page.getByRole("region", { name: "Layers", exact: true });
  await layers.getByRole("button", { name: "Button", exact: true }).click();
  const canvas = page.getByLabel("Design canvas", { exact: true });
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+c");
  const bar = page.locator(".figcraft-document-bar");
  await bar.getByText("File", { exact: true }).click();
  await bar.getByRole("button", { name: "New file", exact: true }).click();
  await canvas.focus(); await page.keyboard.press("ControlOrMeta+v");
  await expect(layers.getByRole("button", { name: "Button", exact: true })).toBeVisible();
  await expect(page.getByText("Recovery saved on this device", { exact: true })).toBeVisible();
  await page.reload();
  await expect(layers.getByRole("button", { name: "Button", exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await bar.getByRole("button", { name: "Save as", exact: true }).click();
  const doc = (await decodeFigcraft(await readFile((await (await download).path())!))).document;
  const [record] = doc.libraryStore!.components;
  expect(record).toMatchObject({ key: "5", library: "e36d4acf0f4beca8", root: "3" });
  expect(doc.nodes["2"]).toMatchObject({ kind: "instance", component: record.root, source: record.root });
  expect(Object.keys(doc.images ?? {})).toHaveLength(1);
});

test("export selection downloads a scaled PNG and keeps the drawing unsaved", async ({ page }) => {
  await login(page);
  await createNamedRectangle(page, "Cover", 30, 20, 15, 12);
  const bar = page.locator(".figcraft-document-bar");
  await bar.getByText("File", { exact: true }).click();
  await bar.getByRole("button", { name: "Export…", exact: true }).click();
  const result = page.waitForEvent("download");
  await page.getByRole("dialog", { name: "Export" }).getByRole("button", { name: "PNG @2x" }).click();
  const download = await result, bytes = await readFile((await download.path())!);
  expect(download.suggestedFilename()).toBe("Cover@2x.png");
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([30, 24]);
  await expect(bar.getByText("Unsaved · Local document", { exact: true })).toBeVisible();
});

test("the export dialog downloads colour-tagged baseline JPEG and lossless WebP presets", async ({ page }) => {
  await login(page); await createNamedRectangle(page, "Swatch", 10, 20, 12, 15);
  const bar = page.locator(".figcraft-document-bar");
  for (const format of ["jpg", "webp"] as const) {
    await bar.getByText("File", { exact: true }).click();
    await bar.getByRole("button", { name: "Export…", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("dialog", { name: "Export" }).getByRole("button", { name: format.toUpperCase() + " @2x" }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe("Swatch@2x." + format);
    const bytes = await readFile((await saved.path())!);
    if (format === "jpg") {
      expect(bytes.readUInt16BE(0)).toBe(0xffd8);
      expect(bytes.includes(Buffer.from("ICC_PROFILE"))).toBe(true);
    } else expect(bytes.includes(Buffer.from("VP8L"))).toBe(true);
  }
  await expect(bar.getByText("Unsaved · Local document", { exact: true })).toBeVisible();
});

test("layer export settings recover, preview and download one file or a named ZIP", async ({page}) => {
  await login(page);
  await createNamedRectangle(page,"Icons/Chip",10,10,16,12);
  const panel = page.getByRole("group",{name:"Layer export",exact:true});
  await panel.getByRole("button",{name:"Add export setting"}).click();
  await panel.getByText("Preview",{exact:true}).click();
  await panel.locator("canvas").scrollIntoViewIfNeeded();
  await expect.poll(() => panel.locator("canvas").evaluate(node=>(node as HTMLCanvasElement).width)).toBeGreaterThan(1);
  let pending = page.waitForEvent("download");
  await panel.getByRole("button",{name:"Export Icons/Chip"}).click();
  expect((await pending).suggestedFilename()).toBe("Chip.png");
  await panel.getByRole("button",{name:"Add export setting"}).click();
  const second = panel.getByRole("group",{name:"Export setting 2"});
  await second.getByLabel("Export format").selectOption("jpg");
  await second.getByLabel("Export suffix").fill("-print");
  await second.getByLabel("Export suffix").press("Enter");
  await second.getByText("Export options",{exact:true}).click();
  await second.getByLabel("Colour profile").selectOption("displayP3");
  pending = page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const native = await decodeFigcraft(await readFile((await (await pending).path())!));
  expect(native.document.nodes["2"].exports?.[1]).toMatchObject({format:"jpg",suffix:"-print",colorProfile:"displayP3"});
  await expect(page.getByText("Recovery saved on this device",{exact:true})).toBeVisible();
  await page.reload();
  await page.getByText("Icons/Chip",{exact:true}).first().click();
  const bar = page.locator(".figcraft-document-bar");
  await bar.getByText("File",{exact:true}).click(); await bar.getByRole("button",{name:"Export…",exact:true}).click();
  const dialog = page.getByRole("dialog",{name:"Export",exact:true});
  await expect(dialog.getByText("Icons/Chip-print.jpg",{exact:true})).toBeVisible();
  pending = page.waitForEvent("download");
  await dialog.getByRole("button",{name:"Export 1 layer",exact:true}).click();
  const archive = await pending;
  expect(archive.suggestedFilename()).toBe("Untitled.zip");
  const members = unzipSync(await readFile((await archive.path())!));
  expect(Object.keys(members)).toEqual(["Icons/Chip.png","Icons/Chip-print.jpg"]);
  expect(Buffer.from(members["Icons/Chip-print.jpg"]).includes(Buffer.from("ICC_PROFILE"))).toBe(true);
  expect(Buffer.from(members["Icons/Chip.png"]).readUInt32BE(16)).toBe(16);
  const canvas = page.locator(".figcraft-canvas-area canvas").first();
  await canvas.click({position:{x:160,y:90}});
  pending = page.waitForEvent("download");
  await page.getByRole("button",{name:"Export page as PNG",exact:true}).click();
  expect((await pending).suggestedFilename()).toBe("Page 1.png");
});

test("the signed-in editor downloads editable SVG paths and saved SVG assets", async ({page})=>{
  await login(page); await createNamedRectangle(page,"Design & Art",8,9,31,24);
  const bar=page.locator(".figcraft-document-bar"), panel=page.getByRole("group",{name:"Layer export",exact:true});
  await bar.getByText("File",{exact:true}).click(); await bar.getByRole("button",{name:"Export…",exact:true}).click();
  let pending=page.waitForEvent("download");
  await page.getByRole("dialog",{name:"Export",exact:true}).getByRole("button",{name:"SVG",exact:true}).click();
  const first=await pending;
  expect(first.suggestedFilename()).toBe("Design & Art.svg");
  expect(await readFile((await first.path())!,"utf8")).toContain('viewBox="0 0 31 24"');
  await panel.getByRole("button",{name:"Add export setting"}).click();
  const setting=panel.getByRole("group",{name:"Export setting 1"});
  await setting.getByLabel("Export format").selectOption("svg");
  await setting.getByText("Export options",{exact:true}).click();
  await setting.getByLabel("Include id attribute").check();
  pending=page.waitForEvent("download");
  await panel.getByRole("button",{name:"Export Design & Art"}).click();
  const source=await readFile((await (await pending).path())!,"utf8");
  expect(source).toContain('<g id="Design_&amp;_Art"><path');
  expect(source).not.toContain("<image");
});

test("Copy as CSS, text and node link uses native output and fences synthetic clipboard writes", async ({ page, context }) => {
  await login(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  const files = unzipSync(await readFile(new URL("../fixtures/native-clipboard-code.zip", import.meta.url)));
  const expected = JSON.parse(strFromU8(files["css.json"]));
  await page.getByLabel("Open Figcraft file", { exact: true }).setInputFiles({
    name: "Clipboard.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(files["Clipboard.figcraft"]),
  });
  const bar = page.locator(".figcraft-document-bar"), layers = page.getByRole("region", { name: "Layers", exact: true });
  const canvas = page.getByLabel("Design canvas", { exact: true });
  const read = () => page.evaluate(() => navigator.clipboard.readText());
  const editItem = async (name: string) => {
    await bar.getByText("Edit", { exact: true }).click();
    await bar.getByText("Copy as", { exact: true }).click();
    return bar.getByRole("button", { name, exact: true });
  };
  await layers.getByRole("button", { name: "Label A", exact: true }).click();
  await (await editItem("Copy as CSS")).click();
  await expect.poll(read).toBe(expected["3"]);
  await canvas.press("ControlOrMeta+a");
  await (await editItem("Copy as text")).click();
  await expect.poll(read).toBe("First line\nSecond line");
  await (await editItem("Copy as CSS")).click();
  await expect.poll(read).toBe(expected["9007199254740993"]);
  await page.evaluate(() => navigator.clipboard.writeText("Preserve this clipboard"));
  await (await editItem("Copy link to selection")).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(read).toBe("Preserve this clipboard");
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  await (await editItem("Copy as CSS")).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(read).toBe("Preserve this clipboard");
  await (await editItem("Copy as text")).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(read).toBe("Preserve this clipboard");
  await (await editItem("Copy link to selection")).click();
  await expect.poll(read).toBe("figcraft://node/9007199254740993");
  await layers.getByRole("button", { name: "Card */ outline", exact: true }).click();
  await (await editItem("Copy as text")).click();
  await expect.poll(read).toBe("");
  const at = await canvasPoint(page, 25, 30);
  await page.mouse.click(at.x, at.y, { button: "right" });
  const menu = page.getByRole("group", { name: "Canvas actions", exact: true });
  await menu.getByText("Copy as", { exact: true }).click();
  await expect(menu.getByRole("button", { name: "Copy as text", exact: true })).toHaveCount(0);
  await menu.getByRole("button", { name: "Copy link to selection", exact: true }).click();
  await expect.poll(read).toBe("figcraft://node/9007199254740993");
});

test("Copy as SVG and PNG writes the selected art through menus and the two-times PNG shortcut",async ({page,context})=>{
  await login(page);
  await context.grantPermissions(["clipboard-read","clipboard-write"],{origin:new URL(page.url()).origin});
  await createNamedRectangle(page,"Clipboard art",10,15,40,20);
  const bar=page.locator(".figcraft-document-bar"), canvas=page.getByLabel("Design canvas",{exact:true});
  await bar.getByText("Edit",{exact:true}).click();
  await bar.getByText("Copy as",{exact:true}).click();
  await bar.getByRole("button",{name:"Copy as SVG",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toContain('<svg width="40" height="20"');
  async function pngSize() {
    return page.evaluate(async()=>{
      const item=(await navigator.clipboard.read()).find(i=>i.types.includes("image/png"));
      if (!item) return [];
      const bitmap=await createImageBitmap(await item.getType("image/png"));
      try {return [bitmap.width,bitmap.height];} finally {bitmap.close();}
    });
  }
  const at=await canvasPoint(page,25,22);
  await page.mouse.click(at.x,at.y,{button:"right"});
  const menu=page.getByRole("group",{name:"Canvas actions",exact:true});
  await menu.getByText("Copy as",{exact:true}).click();
  await menu.getByRole("button",{name:"Copy as PNG",exact:true}).click();
  await expect.poll(pngSize).toEqual([80,40]);
  await page.evaluate(()=>navigator.clipboard.writeText("before shortcut"));
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+Shift+c");
  await expect.poll(pngSize).toEqual([80,40]);
});

test("open, drop and paste SVG as editable layers, undo and reopen the saved archive",async({page,context})=>{
  await login(page);
  await context.grantPermissions(["clipboard-read","clipboard-write"],{origin:new URL(page.url()).origin});
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect id="Editable shape" width="40" height="20" fill="red"/></svg>';
  const picker=page.getByLabel("Open Figcraft file",{exact:true}),canvas=page.getByLabel("Design canvas",{exact:true});
  await picker.setInputFiles({name:"Badge.svg",buffer:Buffer.from(svg),mimeType:"image/svg+xml"});
  await expect(page.getByRole("heading",{name:"Badge",exact:true})).toBeVisible();
  const saved=async()=>{
    const download=page.waitForEvent("download");
    await page.getByRole("button",{name:"Save as",exact:true}).click();
    const bytes=await readFile((await (await download).path())!);
    return {bytes,document:(await decodeFigcraft(bytes)).document};
  };
  const opened=await saved();
  expect(opened.document.nodes["2"]).toMatchObject({kind:"frame",clip:true,width:40,height:20});
  expect(opened.document.nodes["3"]).toMatchObject({kind:"rectangle",name:"Editable shape",parent:"2"});
  const at=await canvasPoint(page,70,90);
  const data=await page.evaluateHandle(svg=>{
    const transfer=new DataTransfer();transfer.items.add(new File([svg],"Dropped.svg",{type:"image/svg+xml"}));return transfer;
  },svg);
  await canvas.dispatchEvent("drop",{clientX:at.x,clientY:at.y,dataTransfer:data});
  await expect(page.getByRole("region",{name:"Layers",exact:true})).toContainText("Dropped");
  const dropped=await saved();
  expect(Object.values(dropped.document.nodes).find(n=>n.name==="Dropped")).toMatchObject({x:70,y:90,kind:"frame"});
  await canvas.focus();await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("region",{name:"Layers",exact:true})).not.toContainText("Dropped");
  await page.evaluate(svg=>navigator.clipboard.writeText("<!-- external SVG -->"+svg),svg);
  await canvas.focus();await page.keyboard.press("ControlOrMeta+v");
  const layers=page.getByRole("region",{name:"Layers",exact:true});
  await expect(layers).toContainText("Pasted SVG");
  const pasted=await saved();
  expect(Object.values(pasted.document.nodes).filter(n=>n.kind==="rectangle" && n.name==="Editable shape")).toHaveLength(2);
  await picker.setInputFiles({name:"Saved copy.figcraft",buffer:pasted.bytes,mimeType:"application/octet-stream"});
  await expect(layers).toContainText("Pasted SVG");
  expect(Object.values((await saved()).document.nodes).filter(n=>n.kind==="rectangle")).toHaveLength(2);
});

test("Android XML downloads honour the saved layer name and compatibility setting",async({page})=>{
  await login(page); await createNamedRectangle(page,"Design & Art",8,9,31,24);
  const bar=page.locator(".figcraft-document-bar"), panel=page.getByRole("group",{name:"Layer export",exact:true});
  await bar.getByText("File",{exact:true}).click();
  await bar.getByRole("button",{name:"Export…",exact:true}).click();
  let pending=page.waitForEvent("download");
  await page.getByRole("dialog",{name:"Export",exact:true}).getByRole("button",{name:"Android XML",exact:true}).click();
  const first=await pending;
  expect(first.suggestedFilename()).toBe("Design & Art.xml");
  expect(await readFile((await first.path())!,"utf8")).toContain('android:viewportWidth="31"');
  await panel.getByRole("button",{name:"Add export setting"}).click();
  const setting=panel.getByRole("group",{name:"Export setting 1"});
  await setting.getByLabel("Export format").selectOption("vectorDrawable");
  await setting.getByText("Export options",{exact:true}).click();
  await setting.getByLabel("Include id attribute").check();
  await setting.getByLabel("Compatibility").selectOption("exact");
  pending=page.waitForEvent("download");
  await panel.getByRole("button",{name:"Export Design & Art"}).click();
  const source=await readFile((await (await pending).path())!,"utf8");
  expect(source).toContain('android:name="Design &amp; Art"');
  expect(source).toContain('android:pathData="M0,0 L31,0 L31,24 L0,24 Z"');
});

test("one-off PDF print controls persist across tabs and match the native printed page", async ({ page }) => {
  await login(page);
  const files = unzipSync(await readFile(new URL("../fixtures/native-pdf-print-dialog.zip", import.meta.url)));
  const open = page.getByLabel("Open Figcraft file", { exact: true });
  await open.setInputFiles({ name: "Cover.figcraft", mimeType: "application/octet-stream", buffer: Buffer.from(files["Cover.figcraft"]) });
  const bar = page.locator(".figcraft-document-bar"), dialog = page.getByRole("dialog", { name: "Export", exact: true });
  const options = dialog.getByRole("group", { name: "PDF print options", exact: true });
  const show = async () => {
    await bar.getByText("File", { exact: true }).click();
    await bar.getByRole("button", { name: "Export…", exact: true }).click();
  };
  await show();
  await options.getByLabel("Bleed marks", { exact: true }).check();
  await expect(options.getByText("Bleed marks need a bleed")).toBeVisible();
  const bleed = options.getByLabel("Bleed", { exact: true });
  await bleed.fill("3 mm"); await bleed.press("Enter");
  await expect(bleed).toHaveValue("3 mm");
  await bleed.fill("3 in"); await bleed.press("Enter");
  await expect(bleed).toHaveValue("3 mm");
  await bleed.fill("0.125 in"); await bleed.press("Enter");
  await expect(bleed).toHaveValue("9 pt");
  await options.getByLabel("Crop marks").check();
  await options.getByLabel("CMYK colour").check();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const tabs = page.getByRole("tablist", { name: "Open files" }).getByRole("tab");
  await tabs.first().click(); await show();
  await expect(bleed).toHaveValue("9 pt");
  await expect(options.getByLabel("CMYK colour")).toBeChecked();
  await dialog.getByRole("button", { name: "PDF", exact: true }).click();
  await expect(page.getByText("Nothing to export", { exact: true })).toBeVisible();
  await tabs.last().click(); await show();
  const pending = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "PDF", exact: true }).click();
  const result = await readFile((await (await pending).path())!);
  expect(result.toString("latin1")).toContain("/TrimBox [33 33 64 57] /BleedBox [24 24 73 66]");
  const { execFileSync } = await import("node:child_process");
  const render = (pdf: Uint8Array) => execFileSync("pdftoppm", ["-r", "72", "-singlefile", "-"], { input: pdf });
  expect(render(result).equals(render(files["Cover.pdf"]))).toBe(true);
  await tabs.first().click();
  await page.getByRole("button", { name: "Create frame", exact: true }).click();
  await bar.getByText("File", { exact: true }).click();
  const frames = page.waitForEvent("download");
  await bar.getByRole("button", { name: "Export frames to PDF…", exact: true }).click();
  const unmarked = await readFile((await (await frames).path())!, "latin1");
  expect(unmarked).not.toContain("/BleedBox");
});

test("signed-in PDF downloads preserve selection size, saved print options and frame page count",async({page})=>{
  await login(page);
  await createNamedRectangle(page,"Cover",8,9,31,24);
  const bar=page.locator(".figcraft-document-bar"), panel=page.getByRole("group",{name:"Layer export",exact:true});
  await bar.getByText("File",{exact:true}).click();
  const frames=bar.getByRole("button",{name:"Export frames to PDF…",exact:true});
  await expect(frames).toBeDisabled();
  await bar.getByRole("button",{name:"Export…",exact:true}).click();
  let pending=page.waitForEvent("download");
  await page.getByRole("dialog",{name:"Export",exact:true}).getByRole("button",{name:"PDF",exact:true}).click();
  let saved=await pending;
  expect(saved.suggestedFilename()).toBe("Cover.pdf");
  expect(await readFile((await saved.path())!,"latin1")).toContain("/MediaBox [0 0 31 24]");
  await panel.getByRole("button",{name:"Add export setting"}).click();
  const setting=panel.getByRole("group",{name:"Export setting 1"});
  await setting.getByLabel("Export format").selectOption("pdf");
  await setting.getByText("Print options",{exact:true}).click();
  const bleed=setting.getByLabel("Bleed",{exact:true});
  await bleed.fill("6 pt"); await bleed.press("Enter");
  await setting.getByLabel("Crop marks").check();
  pending=page.waitForEvent("download");
  await panel.getByRole("button",{name:"Export Cover",exact:true}).click();
  saved=await pending;
  expect(await readFile((await saved.path())!,"latin1")).toContain("/TrimBox [30 30 61 54] /BleedBox [24 24 67 60]");
  const create=page.getByRole("button",{name:"Create frame",exact:true});
  await create.click(); await create.click();
  await bar.getByText("File",{exact:true}).click();
  pending=page.waitForEvent("download");
  await frames.click();
  saved=await pending;
  expect(saved.suggestedFilename()).toBe("Untitled.pdf");
  expect(await readFile((await saved.path())!,"latin1")).toContain("/Type /Pages /Count 2");
});

test("Import appends drawing pages, preserves the open tab, and supports undo, redo and canvas drop",async({page})=>{
  await login(page);
  await createNamedRectangle(page,"Destination",6,8,34,22);
  const source=await readFile(new URL("../fixtures/native-component-library-v1.figcraft",import.meta.url));
  const bar=page.locator(".figcraft-document-bar");
  await bar.getByText("File",{exact:true}).click();
  const chooser=page.waitForEvent("filechooser");
  await bar.getByRole("button",{name:"Import…",exact:true}).click();
  await (await chooser).setFiles({name:"Library.figcraft",mimeType:"application/octet-stream",buffer:source});
  const snapshot=async()=>{
    const download=page.waitForEvent("download");
    await page.getByRole("button",{name:"Save as",exact:true}).click();
    return (await decodeFigcraft(await readFile((await (await download).path())!))).document;
  };
  const canvas=page.getByLabel("Design canvas",{exact:true});
  await expect.poll(async()=>(await snapshot()).pages.length).toBe(2);
  const imported=await snapshot();
  expect(imported.nodes[imported.currentPage].name).toBe("Page 1");
  expect(Object.values(imported.nodes).some(n=>n.name==="Destination")).toBe(true);
  await canvas.focus();await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot()).pages).toHaveLength(1);
  await canvas.focus();await page.keyboard.press("ControlOrMeta+Shift+z");
  expect((await snapshot()).pages).toHaveLength(2);
  const transfer=await page.evaluateHandle(data=>{
    const t=new DataTransfer();
    t.items.add(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],"Dropped.figcraft"));
    return t;
  },source.toString("base64"));
  await canvas.dispatchEvent("drop",{dataTransfer:transfer,clientX:500,clientY:300});
  await expect.poll(async()=>(await snapshot()).pages.length).toBe(3);
  await expect(page.getByRole("heading",{name:"Untitled",exact:true})).toBeVisible();
});

test("REST design JSON opens as editable layers and imports additional pages into the same drawing",async({page})=>{
  await login(page);
  const open=page.getByLabel("Open Figcraft file",{exact:true}),importInto=page.getByLabel("Import into current document",{exact:true});
  const corpus=JSON.parse(await readFile(new URL("../fixtures/native-rest-documents.json",import.meta.url),"utf8")) as
    {name:string;source:unknown;archive:string}[];
  const input=(name:string)=>({name:name+".json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(corpus.find(c=>c.name===name)!.source))});
  await open.setInputFiles(input("linked components"));
  await expect(page.getByRole("heading",{name:"REST fixture",exact:true})).toBeVisible();
  const snapshot=async()=>{
    const download=page.waitForEvent("download");
    await page.getByRole("button",{name:"Save as",exact:true}).click();
    return (await decodeFigcraft(await readFile((await (await download).path())!))).document;
  };
  const source=corpus.find(c=>c.name==="linked components")!;
  const native=(await decodeFigcraft(Uint8Array.from(Buffer.from(source.archive,"base64")))).document;
  expect((await snapshot()).nodes).toEqual(native.nodes);
  await importInto.setInputFiles(input("text runs"));
  await expect.poll(async()=>(await snapshot()).pages.length).toBe(2);
  const appended=await snapshot();
  const text=Object.values(appended.nodes).find(n=>n.kind==="text");
  expect(text?.kind==="text" && text.text.characters).toBe("😁abc🌟def");
  await page.getByLabel("Design canvas",{exact:true}).focus();
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot()).nodes).toEqual(native.nodes);
});

test("dropping a REST design folder imports its real image and variable siblings",async({page,context},info)=>{
  await login(page);
  const folder=info.outputPath("REST drawing");
  await mkdir(join(folder,"images"),{recursive:true});
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNIcAAAAASUVORK5CYII=","base64");
  const corpus=JSON.parse(await readFile(new URL("../fixtures/native-rest-documents.json",import.meta.url),"utf8")) as {name:string;variables?:unknown}[];
  const source={nodes:{a:{document:{type:"RECTANGLE",name:"Logo",fills:[{type:"IMAGE",imageRef:"logo"}]}}}};
  await writeFile(join(folder,"design.json"),JSON.stringify(source));
  await writeFile(join(folder,"variables.json"),JSON.stringify(corpus.find(c=>c.name==="companion variables")!.variables));
  await writeFile(join(folder,"images","logo.png"),png);
  const cdp=await context.newCDPSession(page);
  const bounds=(await page.getByLabel("Design canvas",{exact:true}).boundingBox())!;
  const event={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2,data:{items:[],files:[folder],dragOperationsMask:1}};
  for (const type of ["dragEnter","dragOver","drop"] as const) await cdp.send("Input.dispatchDragEvent",{type,...event});
  await cdp.detach();
  await expect.poll(async()=>{
    const download=page.waitForEvent("download");
    await page.getByRole("button",{name:"Save as",exact:true}).click();
    const {document}=await decodeFigcraft(await readFile((await (await download).path())!));
    return {pages:document.pages.length,keys:Object.keys(document.images ?? {}),variables:document.variables?.variables.map(v=>v.id)};
  }).toMatchObject({pages:2,keys:[createHash("sha256").update(png).digest("hex")],variables:expect.arrayContaining(["w","b","red"])});
});

test("open a native binary Fig drawing, edit a shape, append a bare canvas and undo",async({page})=>{
  await login(page);
  const corpus=unzipSync(await readFile(new URL("../fixtures/native-fig-imports.zip",import.meta.url)));
  const source=corpus["primitives.fig"];
  const expected=(await decodeFigcraft(corpus["primitives-zip.figcraft"])).document;
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:"Shapes.fig",mimeType:"application/octet-stream",buffer:Buffer.from(source)});
  await expect(page.getByRole("heading",{name:expected.name,exact:true})).toBeVisible();
  const saved=async()=>{
    const dl=page.waitForEvent("download");
    await page.getByRole("button",{name:"Save as",exact:true}).click();
    return (await decodeFigcraft(await readFile((await (await dl).path())!))).document;
  };
  expect((await saved()).nodes).toEqual(expected.nodes);
  await page.getByRole("button",{name:"Create rectangle",exact:true}).click();
  const afterEdit=await saved();
  expect(Object.keys(afterEdit.nodes).length).toBe(Object.keys(expected.nodes).length+1);
  await page.getByLabel("Import into current document",{exact:true}).setInputFiles({
    name:"Text.fig",mimeType:"application/octet-stream",buffer:Buffer.from(unzipSync(corpus["text-runs.fig"])["canvas.fig"])});
  await expect.poll(async()=>(await saved()).pages.length).toBe(expected.pages.length+1);
  expect(Object.values((await saved()).nodes).some(n=>n.kind==="text" && n.text.characters.includes("😁"))).toBe(true);
  await page.getByLabel("Design canvas",{exact:true}).focus();
  await page.keyboard.press("ControlOrMeta+z");
  expect((await saved()).nodes).toEqual(afterEdit.nodes);
});

test("opening a Fig library preserves hidden mains and renamed nested source links after download",async({page})=>{
  await login(page);
  const {unzipSync}=await import("fflate");
  const files=unzipSync(await readFile(new URL("../fixtures/native-fig-components.zip",import.meta.url)));
  for (const name of ["library transitive mains","nested aliased rename","scaled overrides"]) {
    const expected=(await decodeFigcraft(files[name+".figcraft"])).document;
    await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:name+".fig",mimeType:"application/octet-stream",buffer:Buffer.from(files[name+".fig"])});
    await expect(page.getByRole("heading",{name:expected.name,exact:true})).toBeVisible();
    const dl=page.waitForEvent("download");
    await page.getByRole("button",{name:"Save as",exact:true}).click();
    const actual=(await decodeFigcraft(await readFile((await (await dl).path())!))).document;
    expect(actual.nodes).toEqual(expected.nodes);
    expect(actual.pages).toEqual(expected.pages);
    expect(actual.libraryStore).toEqual(expected.libraryStore);
    if (actual.libraryStore?.root) expect(actual.pages).not.toContain(actual.libraryStore.root);
  }
});

test("a Fig text path and Unicode wrap positions survive opening and saving in the signed-in editor",async({page})=>{
  await login(page);
  const files=unzipSync(await readFile(new URL("../fixtures/native-fig-text.zip",import.meta.url)));
  for (const name of ["reverse line","soft wrap Unicode","no marker"]) {
    const native=(await decodeFigcraft(files[name+".figcraft"])).document;
    await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles({name:name+".fig",mimeType:"application/octet-stream",buffer:Buffer.from(files[name+".fig"])});
    await expect(page.getByRole("heading",{name:native.name,exact:true})).toBeVisible();
    const dl=page.waitForEvent("download");
    await page.getByRole("button",{name:"Save as",exact:true}).click();
    const saved=(await decodeFigcraft(await readFile((await (await dl).path())!))).document;
    expect(saved.nodes).toEqual(native.nodes);
  }
});

test("export the whole signed-in drawing as Fig and reopen the download with its component overrides",async({page})=>{
  await login(page);
  const source=JSON.parse(await readFile(new URL("../fixtures/native-rest-documents.json",import.meta.url),"utf8")) as {name:string;archive:string}[];
  const fixture=source.find(c=>c.name==="linked components")!;
  const corpus=unzipSync(await readFile(new URL("../fixtures/native-fig-imports.zip",import.meta.url)));
  const expected=(await decodeFigcraft(corpus["linked-components-zip.figcraft"])).document;
  const picker=page.getByLabel("Open Figcraft file",{exact:true});
  await picker.setInputFiles({name:"Source.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(fixture.archive,"base64")});
  await expect(page.getByRole("heading",{name:expected.name,exact:true})).toBeVisible();
  const bar=page.locator(".figcraft-document-bar");
  await bar.getByText("File",{exact:true}).click();
  await bar.getByRole("button",{name:"Export…",exact:true}).click();
  const downloading=page.waitForEvent("download");
  await page.getByRole("dialog",{name:"Export"}).getByRole("button",{name:".fig (experimental)",exact:true}).click();
  const dl=await downloading,buffer=await readFile((await dl.path())!);
  expect(dl.suggestedFilename()).toBe(expected.name+".fig");
  const zip=unzipSync(buffer),meta=JSON.parse(strFromU8(zip["meta.json"]));
  expect(meta.file_name).toBe(expected.name);
  expect(meta.client_meta.thumbnail_size.width).toBeGreaterThan(0);
  expect(zip["thumbnail.png"].slice(1,4)).toEqual(Uint8Array.from([80,78,71]));
  await picker.setInputFiles({name:"Reopened.fig",mimeType:"application/octet-stream",buffer});
  await expect(page.getByRole("tab",{name:expected.name,exact:true})).toHaveCount(2);
  const saving=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=await decodeFigcraft(await readFile((await (await saving).path())!));
  expect(saved.document).toEqual(expected);
});

test("Sketch open, save, append and undo preserve native symbol overrides and embedded pixels",async({page})=>{
  await login(page);
  const corpus=unzipSync(await readFile(new URL("../fixtures/native-sketch-files.zip",import.meta.url)));
  const source="symbols_tests-string_override-0", extra="style_tests-bitmap_image_under_its_fills-0";
  const original=(await decodeFigcraft(corpus[source+".figcraft"])).document;
  const imageDoc=(await decodeFigcraft(corpus[extra+".figcraft"])).document;
  const file=(id:string)=>({name:"Original.sketch",mimeType:"application/octet-stream",buffer:Buffer.from(corpus[id+".sketch"])});
  const save=async()=>{
    const download=page.waitForEvent("download");
    await page.getByRole("button",{name:"Save as",exact:true}).click();
    return (await decodeFigcraft(await readFile((await (await download).path())!))).document;
  };
  await page.getByLabel("Open Figcraft file",{exact:true}).setInputFiles(file(source));
  await expect(page.getByRole("heading",{name:"Original",exact:true})).toBeVisible();
  expect(await save()).toEqual(original);
  await page.getByLabel("Import into current document",{exact:true}).setInputFiles(file(extra));
  await expect.poll(async()=>(await save()).pages.length).toBe(original.pages.length+imageDoc.pages.length);
  const appended=await save();
  for (const [id,image] of Object.entries(imageDoc.images ?? {})) {
    expect(await appended.images?.[id].bytes.arrayBuffer()).toEqual(await image.bytes.arrayBuffer());
  }
  await page.getByLabel("Design canvas",{exact:true}).focus();
  await page.keyboard.press("ControlOrMeta+z");
  expect(await save()).toEqual(original);
});

test("Slice shortcut draws an editable export region with a switchable canvas guide",async({page})=>{
  await login(page);
  const canvas=page.getByLabel("Design canvas",{exact:true});
  await canvas.focus();
  await page.keyboard.press("s");
  await expect(page.getByRole("button",{name:"Slice",exact:true})).toHaveAttribute("aria-pressed","true");
  const start=await canvasPoint(page,120,120),end=await canvasPoint(page,230,174);
  await page.mouse.move(start.x,start.y);
  await page.mouse.down();
  await page.mouse.move(end.x,end.y,{steps:4});
  await page.mouse.up();
  await expect(page.getByRole("button",{name:"Slice 1",exact:true})).toBeVisible();
  const outside=await canvasPoint(page,240,186);
  await page.mouse.click(outside.x,outside.y);
  const row=()=>canvas.evaluate((el:HTMLCanvasElement)=>{
    const x=Math.round((130-Number(el.dataset.viewOriginX))*Number(el.dataset.viewZoom));
    const y=Math.round((120-Number(el.dataset.viewOriginY))*Number(el.dataset.viewZoom));
    return Array.from(el.getContext("2d")!.getImageData(x,y,70,1).data).filter((_,i)=>i%4===0);
  });
  await expect.poll(async()=>new Set(await row()).size).toBeGreaterThan(1);
  await page.getByText("View",{exact:true}).filter({visible:true}).first().click();
  await page.getByRole("button",{name:"Slices",exact:true}).click();
  await expect.poll(async()=>new Set(await row()).size).toBe(1);
  const download=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const saved=(await decodeFigcraft(await readFile((await (await download).path())!))).document;
  expect(Object.values(saved.nodes).find(n=>n.kind==="slice")).toMatchObject({
    name:"Slice 1",x:120,y:120,width:110,height:54,fill:"transparent"
  });
});

test("Penpot open, native save, image append, undo and device recovery retain the imported design system",async({page})=>{
  await login(page);
  const corpus=unzipSync(await readFile(new URL("../fixtures/native-penpot-files.zip",import.meta.url)));
  const source="tests-penpot_themes_become_modes_with_aliases_math_and_active_theme-0", extra="export_tests-image_fills_write_media_and_storage_objects-0";
  const original=(await decodeFigcraft(corpus[source+".figcraft"])).document;
  const imageDoc=(await decodeFigcraft(corpus[extra+".figcraft"])).document;
  const file=(stem:string)=>({name:"Original.penpot",mimeType:"application/octet-stream",buffer:Buffer.from(corpus[stem+".penpot"])});
  const save=async()=>{
    const downloaded=page.waitForEvent("download");
    await page.getByRole("button",{name:"Save as",exact:true}).click();
    return (await decodeFigcraft(await readFile((await (await downloaded).path())!))).document;
  };
  const chooser=page.getByLabel("Open Figcraft file",{exact:true});
  expect(await chooser.getAttribute("accept")).toContain(".penpot");
  await chooser.setInputFiles(file(source));
  await expect(page.getByRole("heading",{name:original.name,exact:true})).toBeVisible();
  expect(await save()).toEqual(original);
  await page.getByLabel("Import into current document",{exact:true}).setInputFiles(file(extra));
  await expect.poll(async()=>(await save()).pages.length).toBe(original.pages.length+imageDoc.pages.length);
  const appended=await save();
  expect(Object.keys(imageDoc.images ?? {})).not.toHaveLength(0);
  for (const [id,img] of Object.entries(imageDoc.images ?? {}))
    expect(await appended.images?.[id].bytes.arrayBuffer()).toEqual(await img.bytes.arrayBuffer());
  await page.getByLabel("Design canvas",{exact:true}).focus();
  await page.keyboard.press("ControlOrMeta+z");
  expect(await save()).toEqual(original);
  await page.getByLabel("Design canvas",{exact:true}).focus();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByText("Recovery saved on this device",{exact:true})).toBeVisible();
  await page.reload();
  await expect.poll(async()=>(await save()).pages.length).toBe(appended.pages.length);
  expect(await save()).toEqual(appended);
});

test("signed-in Penpot download reopens as an editable document with native text runs",async({page})=>{
  await login(page);
  const files=unzipSync(await readFile(new URL("../fixtures/native-penpot-authored-exports.zip",import.meta.url)));
  const stem="unicode-overlap-and-blank-paragraphs",input=files[stem+".input.figcraft"];
  const expected=(await decodeFigcraft(files[stem+".figcraft"])).document;
  const chooser=page.getByLabel("Open Figcraft file",{exact:true});
  await chooser.setInputFiles({name:"Source.figcraft",mimeType:"application/octet-stream",buffer:Buffer.from(input)});
  await expect(page.getByRole("heading",{name:expected.name,exact:true})).toBeVisible();
  const bar=page.locator(".figcraft-document-bar");
  await bar.getByText("File",{exact:true}).click();
  await bar.getByRole("button",{name:"Export…",exact:true}).click();
  const exporting=page.waitForEvent("download");
  await page.getByRole("dialog",{name:"Export"}).getByRole("button",{name:"Penpot (.penpot)",exact:true}).click();
  const download=await exporting;
  expect(download.suggestedFilename()).toBe(expected.name+".penpot");
  await chooser.setInputFiles({name:"Reopened.penpot",mimeType:"application/zip",buffer:await readFile((await download.path())!)});
  await expect(page.getByRole("tab",{name:expected.name,exact:true})).toHaveCount(2);
  const saving=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save as",exact:true}).click();
  const actual=await decodeFigcraft(await readFile((await (await saving).path())!));
  expect(actual.document).toEqual(expected);
});
