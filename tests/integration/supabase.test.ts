import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { localSupabase } from "../support/localSupabase";
import { createSupabaseBackend } from "../../src/backends/supabase";

// Explicit opt-in keeps pure package tests independent of external services.
// Required release verification runs FIGCRAFT_LOCAL_INTEGRATION=1 npm test.
describe.skipIf(process.env.FIGCRAFT_LOCAL_INTEGRATION !== "1")("real local Supabase Auth boundary", () => {
  const backend = process.env.FIGCRAFT_LOCAL_INTEGRATION === "1" ? localSupabase() : undefined;
  const users: string[] = [];
  afterAll(async () => { if (backend) for (const id of users) await backend.admin.auth.admin.deleteUser(id); });
  it("connects with the browser-safe adapter and denies anonymous account administration", async () => {
    const client = createSupabaseBackend({ url: backend!.url, publishableKey: backend!.key });
    const { data } = await client.auth.getClaims();
    expect(data).toBeNull();
    const denied = await client.auth.admin.listUsers();
    expect(denied.error).not.toBeNull();
    const response = await fetch(`${backend!.url}/auth/v1/settings`, { headers: { apikey: backend!.key } });
    expect(response.status).toBe(200);
  });
  it("validates login and refresh; user metadata cannot authorise account reads or mutations", async () => {
    const email = `figcraft-${randomUUID()}@example.test`;
    const password = `Figcraft-${randomUUID()}!`;
    const created = await backend!.admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    const id = created.data.user!.id; users.push(id);
    const login = await backend!.client.auth.signInWithPassword({ email, password });
    expect(login.error).toBeNull();
    expect((await backend!.client.auth.getClaims()).data?.claims.sub).toBe(id);
    expect((await backend!.client.auth.refreshSession()).error).toBeNull();
    await backend!.client.auth.updateUser({ data: { role: "service_role", capabilities: ["document.edit"] } });
    expect((await backend!.client.auth.admin.listUsers()).error).not.toBeNull();
    expect((await backend!.client.auth.admin.updateUserById(id, { app_metadata: { role: "admin" } })).error).not.toBeNull();
    expect((await backend!.client.auth.signOut()).error).toBeNull();
    expect((await backend!.client.auth.getClaims()).data).toBeNull();
    expect((await backend!.client.auth.signInWithPassword({ email, password: "incorrect" })).error).not.toBeNull();
  });
});
