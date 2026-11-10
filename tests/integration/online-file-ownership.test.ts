import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseOnlineFileStore } from "../../src/backends/supabase/online-files";
import { finaliseOnlineFile } from "../../src/backends/supabase/publication";
import { changeFileLinks } from "../../examples/nextjs/lib/sharing/links";
import { readSharedDrawing } from "../../examples/nextjs/lib/sharing/join";
import { JoinCodeKey } from "../../examples/nextjs/lib/sharing/codes";
import { createPublishedLinks, publishedLinkDigests } from "../../src/backends/published-links";
import { parseJoinCode } from "../../src/engine/sharing/join-code";
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
    return { id: data.user.id, client, email, password };
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

  it("atomically issues, rotates and revokes scoped file links without persisting bearer secrets", async () => {
    const id = randomUUID();
    const path = owner.id + "/" + id + ".figcraft";
    paths.push(path);
    const keys = createPublishedLinks();
    const proof = await publishedLinkDigests(keys);
    const store = new SupabaseOnlineFileStore(owner.client, owner.id, file => finaliseOnlineFile(owner.client, local!.admin, file, proof));
    await store.publish(id, new Blob([archive]));
    const writer = local!.admin;
    const read = () => writer.from("online_file_links").select("*").eq("file_id", id);
    await expect(changeFileLinks(writer, stranger.id, id, [], "shared")).rejects.toMatchObject({ code: "42501" });
    await expect(changeFileLinks(owner.client, owner.id, id, [], "shared")).rejects.toBeTruthy();
    const published = (["edit", "view"] as const).map(access => ({ ...keys[access], access, code: undefined }));
    expect(published.map(link => link.access)).toEqual(["edit", "view"]);
    expect(published.every(link => !link.code)).toBe(true);
    const shared = await changeFileLinks(writer, owner.id, id, [], "shared");
    expect(shared.map(link => link.access)).toEqual(["edit", "view", "comment"]);
    const stored = (await read()).data!;
    expect(stored).toHaveLength(5);
    for (const link of [...published, ...shared]) {
      const row = stored.find(row => row.id === link.id)!;
      expect(row.token_hash).toBe(createHash("sha256").update(link.token).digest("hex"));
      expect(JSON.stringify(stored)).not.toContain(link.token);
      if (link.code) {
        const parsed = parseJoinCode(link.code);
        if (parsed.kind !== "online") throw new Error("Expected an online invite");
        expect(JSON.stringify(stored)).not.toContain(parsed.code);
        expect(new JoinCodeKey(parsed.code).open({ hash: row.code_hash, token: row.wrapped_token })).toBe(link.token);
      }
    }
    for (const client of [owner.client, stranger.client, local!.client]) {
      expect((await client.from("online_file_links").select("*")).error).toBeTruthy();
    }
    const ids = shared.map(link => link.id);
    await expect(changeFileLinks(writer, owner.id, id, ids, "shared", 4)).rejects.toMatchObject({ code: "22023" });
    expect((await read()).data!.map(row => row.id).sort()).toEqual(stored.map(row => row.id).sort());
    const rotated = await changeFileLinks(writer, owner.id, id, ids, "shared");
    expect(rotated.some(link => ids.includes(link.id))).toBe(false);
    await expect(changeFileLinks(writer, owner.id, id, ids)).rejects.toMatchObject({ code: "22023" });
    await changeFileLinks(writer, owner.id, id, rotated.map(link => link.id));
    expect((await read()).data!.map(row => row.id).sort()).toEqual(published.map(row => row.id).sort());
    const competing = await Promise.allSettled([
      changeFileLinks(writer, owner.id, id, [], "shared", 5),
      changeFileLinks(writer, owner.id, id, [], "shared", 5),
    ]);
    expect(competing.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await read()).data).toHaveLength(5);
    await store.remove(id);
    expect((await read()).data).toEqual([]);
  });

  it("installs the original pair once across retries and rolls back an invalid pair", async () => {
    const keys = createPublishedLinks();
    const proof = await publishedLinkDigests(keys);
    const failed = randomUUID(), file = randomUUID();
    const storage = owner.client.storage.from(bucket);
    const writer = local!.admin;
    for (const id of [file, failed]) {
      const path = owner.id + "/" + id + ".figcraft";
      paths.push(path);
      expect((await storage.upload(path, archive, { contentType: "application/octet-stream" })).error).toBeNull();
    }
    await Promise.all([finaliseOnlineFile(owner.client, writer, file, proof), finaliseOnlineFile(owner.client, writer, file, proof)]);
    const list = () => writer.from("online_file_links").select("id,token_hash,access_level").eq("file_id", file);
    expect((await list()).data).toHaveLength(2);
    // A duplicate link ID triggers a database failure after the new listing insert.
    await expect(finaliseOnlineFile(owner.client, writer, failed, proof)).rejects.toMatchObject({ code: "23505" });
    expect((await owner.client.from("online_files").select("id").eq("id", failed)).data).toEqual([]);
    const other = await publishedLinkDigests(createPublishedLinks());
    await expect(finaliseOnlineFile(owner.client, writer, file, other)).rejects.toMatchObject({ code: "22023" });
    await expect(finaliseOnlineFile(stranger.client, writer, file, proof)).rejects.toBeTruthy();
    await changeFileLinks(writer, owner.id, file, [keys.edit.id]);
    await finaliseOnlineFile(owner.client, writer, file, proof);
    await finaliseOnlineFile(owner.client, writer, file);
    expect((await list()).data).toEqual([{ id: keys.view.id, token_hash: proof.view.hash, access_level: "view" }]);
    expect((await owner.client.from("online_files").update({ published_link_fingerprint: null }).eq("id", file)).error).toBeTruthy();
  });

  it("binds an invite to its Auth session and denies signed URLs, writes and downloads after revocation", async () => {
    const keys = createPublishedLinks();
    const proof = await publishedLinkDigests(keys);
    const file = randomUUID(), tab = randomUUID(), path = owner.id + "/" + file + ".figcraft";
    paths.push(path);
    const writer = local!.admin;
    const store = new SupabaseOnlineFileStore(owner.client, owner.id, id => finaliseOnlineFile(owner.client, writer, id, proof));
    await store.publish(file, new Blob([archive]));
    const guest = stranger.client.storage.from(bucket);
    const session = (await stranger.client.auth.getClaims()).data!.claims.session_id as string;
    const join = (token: string, connection = tab) => readSharedDrawing(stranger.client, writer, stranger.id, session, connection, file, token);
    expect((await guest.download(path)).error).toBeTruthy();
    await expect(join(proof.view.hash)).rejects.toThrow("unavailable");
    const first = await join(keys.view.token);
    expect(first.access).toBe("view");
    expect(new Uint8Array(await first.bytes.arrayBuffer())).toEqual(archive);
    expect((await join(keys.view.token)).access).toBe("view");
    expect((await guest.createSignedUrl(path, 3600)).error).toBeTruthy();
    expect((await guest.update(path, archive, { contentType: "application/octet-stream" })).error).toBeTruthy();
    expect((await stranger.client.from("online_files").select("id").eq("id", file)).data).toEqual([]);
    expect((await stranger.client.from("online_file_connections").select("*")).error).toBeTruthy();
    const other = createClient(local!.url, local!.key, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await other.auth.signInWithPassword({ email: stranger.email, password: stranger.password })).error).toBeNull();
    expect((await other.storage.from(bucket).download(path)).error).toBeTruthy();
    await expect(join(keys.edit.token)).rejects.toThrow("unavailable");
    await changeFileLinks(writer, owner.id, file, [keys.view.id]);
    expect((await guest.download(path)).error).toBeTruthy();
    await expect(join(keys.view.token)).rejects.toThrow("unavailable");
    expect((await join(keys.edit.token, randomUUID())).access).toBe("edit");
    expect((await guest.createSignedUrl(path, 3600)).error).toBeTruthy();
    await store.remove(file);
    expect((await guest.download(path)).error).toBeTruthy();
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
