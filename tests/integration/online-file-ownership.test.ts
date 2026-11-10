import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseOnlineFileStore } from "../../src/backends/supabase/online-files";
import { finaliseOnlineFile } from "../../src/backends/supabase/publication";
import { localSupabase } from "../support/localSupabase";

const enabled = process.env.FIGCRAFT_LOCAL_INTEGRATION === "1";
const bucket = "figcraft-files";

describe.skipIf(!enabled)("private online files on real local Supabase", () => {
  const local = enabled ? localSupabase() : undefined;
  const users: string[] = [];
  const paths: string[] = [];
  async function account() {
    const email = `online-${randomUUID()}@example.test`;
    const password = randomUUID() + "Aa1!";
    const { data, error } = await local!.admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    const client = createClient(local!.url, local!.key, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
    return { id: data.user.id, client };
  }
  let owner: Awaited<ReturnType<typeof account>>;
  let stranger: typeof owner;
  let archive: Uint8Array<ArrayBuffer>;
  beforeAll(async () => {
    owner = await account();
    stranger = await account();
    const fixture = await readFile(new URL("../fixtures/native-pdf-print-dialog.zip", import.meta.url));
    archive = new Uint8Array(unzipSync(fixture)["Cover.figcraft"]);
  });
  afterAll(async () => {
    if (!local) return;
    if (paths.length) await local.admin.storage.from(bucket).remove(paths);
    for (const id of users) await local.admin.auth.admin.deleteUser(id);
  });

  it("retries interrupted publication, rejects malformed bytes and isolates validated files", async () => {
    const id = randomUUID();
    const invalid = randomUUID();
    paths.push(owner.id + "/" + id + ".figcraft", owner.id + "/" + invalid + ".figcraft");
    let loseReply = true;
    const store = new SupabaseOnlineFileStore(owner.client, owner.id, async file => {
      const published = await finaliseOnlineFile(owner.client, local!.admin, file);
      if (loseReply) { loseReply = false; throw new Error("response interrupted"); }
      return published;
    });
    const blob = new Blob([archive]);
    await expect(store.publish(id, blob)).rejects.toThrow("response interrupted");
    const [first, second] = await Promise.all([store.publish(id, blob), store.publish(id, blob)]);
    expect(first).toEqual(second);
    expect(first.name).toBe("Untitled");
    await expect(store.owned([invalid, id])).resolves.toEqual([first]);
    await expect(store.publish(id, new Blob(["changed"]))).rejects.toThrow("different snapshot");
    await expect(finaliseOnlineFile(stranger.client, local!.admin, id)).rejects.toBeTruthy();
    await expect(store.publish(invalid, new Blob(["not a drawing"]))).rejects.toBeTruthy();
    expect(await store.owned([invalid])).toEqual([]);
    expect((await store.rename(id, "Public name")).name).toBe("Public name");
    const downloaded = await store.open(id);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(archive);
    await store.remove(id);
    await expect(store.open(id)).rejects.toThrow("no longer on its server");
  });

  it("ties owner metadata to an immutable private archive and removes both together", async () => {
    const file = randomUUID();
    const path = owner.id + "/" + file + ".figcraft";
    paths.push(path);
    const mine = owner.client.storage.from(bucket);
    const foreign = stranger.client.storage.from(bucket);
    const anonymous = createClient(local!.url, local!.key, { auth: { persistSession: false } });
    const type = { contentType: "application/octet-stream" };
    expect((await anonymous.storage.from(bucket).upload(path, archive, type)).error).toBeTruthy();
    expect((await foreign.upload(path, archive, type)).error).toBeTruthy();
    const staged = await mine.upload(path, archive, type);
    expect(staged.error).toBeNull();
    expect((await mine.upload(path, archive, { ...type, upsert: true })).error).toBeTruthy();

    const row = { id: file, owner_id: owner.id, snapshot_id: staged.data!.id, name: "Cover" };
    expect((await owner.client.from("online_files").insert(row)).error).toBeTruthy();
    expect((await stranger.client.from("online_files").insert(row)).error).toBeTruthy();
    expect((await local!.admin.from("online_files").insert({ ...row, snapshot_id: randomUUID() })).error?.code).toBe("23503");
    expect((await local!.admin.from("online_files").insert(row)).error).toBeNull();
    const listing = () => owner.client.from("online_files").select("name").eq("id", file).single();
    expect((await listing()).data?.name).toBe("Cover");
    expect((await stranger.client.from("online_files").select("id").eq("id", file)).data).toEqual([]);
    expect((await anonymous.from("online_files").select("id")).error).toBeTruthy();
    expect((await foreign.download(path)).error).toBeTruthy();
    expect((await anonymous.storage.from(bucket).download(path)).error).toBeTruthy();
    expect((await mine.update(path, archive, type)).error).toBeTruthy();
    expect((await owner.client.from("online_files").update({ owner_id: stranger.id }).eq("id", file)).error).toBeTruthy();
    expect((await owner.client.from("online_files").update({ snapshot_id: randomUUID() }).eq("id", file)).error).toBeTruthy();

    await stranger.client.from("online_files").update({ name: "Spoof" }).eq("id", file);
    await foreign.remove([path]);
    expect((await listing()).data?.name).toBe("Cover");
    expect((await owner.client.from("online_files").update({ name: " \tRenamed\u202e " }).eq("id", file)).error).toBeNull();
    expect((await listing()).data?.name).toBe("Renamed");
    expect((await owner.client.from("online_files").update({ name: " \t " }).eq("id", file)).error?.code).toBe("22023");
    expect(new Uint8Array(await (await mine.download(path)).data!.arrayBuffer())).toEqual(archive);
    expect((await owner.client.from("online_files").delete().eq("id", file)).error).toBeTruthy();
    expect((await mine.remove([path])).error).toBeNull();
    expect((await owner.client.from("online_files").select("id").eq("id", file)).data).toEqual([]);
    expect((await mine.download(path)).error).toBeTruthy();
  });
});
