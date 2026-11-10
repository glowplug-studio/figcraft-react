import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseOnlineFileStore } from "../../src/backends/supabase/online-files";
import { finaliseOnlineFile } from "../../src/backends/supabase/publication";
import { applyOwnerSharing, changeFileLinks, ownerSharingStatus } from "../../examples/nextjs/lib/sharing/links";
import { readSharedDrawing } from "../../examples/nextjs/lib/sharing/join";
import { lookupCode } from "../../examples/nextjs/lib/sharing/code-lookup";
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

  it("reserves the last address slot atomically across two owners and releases it on removal", async () => {
    const users = [owner, stranger];
    const ids = [randomUUID(), randomUUID()];
    const proof = await Promise.all(ids.map(() => publishedLinkDigests(createPublishedLinks())));
    const addresses = ["2001:db8:ff10:11::1", "2001:db8:ff10:11::2"];
    const publish = (index: number, address = addresses[index]) => finaliseOnlineFile(users[index].client, local!.admin,
      ids[index], proof[index], {address, max_files_per_ip: 1});
    for (const [i, id] of ids.entries()) {
      const path = users[i].id + "/" + id + ".figcraft";
      paths.push(path);
      const uploaded = await users[i].client.storage.from(bucket).upload(path, archive, {contentType: "application/octet-stream"});
      expect(uploaded.error).toBeNull();
    }
    const attempts = await Promise.allSettled([publish(0), publish(1)]);
    const winner = attempts.findIndex(result => result.status === "fulfilled");
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const other = 1 - winner;
    expect(attempts[other]).toMatchObject({status: "rejected", reason: {message: "Your address has reached its retained file limit"}});
    expect((await local!.admin.from("online_file_links").select("id").eq("file_id", ids[other])).data).toEqual([]);
    expect(await publish(winner, "192.0.2.50")).toMatchObject({id: ids[winner]});
    expect((await users[winner].client.storage.from(bucket).remove([users[winner].id + "/" + ids[winner] + ".figcraft"])).error).toBeNull();
    expect(await publish(other)).toMatchObject({id: ids[other]});
  });

  it("backfills the measured size of a prior immutable listing before admitting a new file", async () => {
    const prior = randomUUID(), current = randomUUID();
    const storage = owner.client.storage.from(bucket);
    for (const id of [prior, current]) {
      const path = owner.id + "/" + id + ".figcraft";
      paths.push(path);
      const uploaded = await storage.upload(path, archive, {contentType: "application/octet-stream"});
      expect(uploaded.error).toBeNull();
      if (id === prior) {
        const object = await storage.info(path);
        expect(object.error).toBeNull();
        expect((await local!.admin.from("online_files").insert({id, owner_id: owner.id, snapshot_id: object.data!.id,
          name: "Existing drawing"})).error).toBeNull();
      }
    }
    const missing = () => local!.admin.rpc("unmeasured_online_files");
    expect((await missing()).data).toEqual(expect.arrayContaining([expect.objectContaining({file_id: prior})]));
    await expect(finaliseOnlineFile(owner.client, local!.admin, current, undefined, {
      address: "198.51.100.1", max_total_bytes: 600,
    })).rejects.toThrow("retained byte limit");
    expect((await missing()).data).toEqual([]);
    expect((await storage.info(owner.id + "/" + prior + ".figcraft")).error).toBeNull();
    expect(await finaliseOnlineFile(owner.client, local!.admin, current)).toMatchObject({id: current});
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
    const leaving = randomUUID();
    const credentials = (await stranger.client.auth.getSession()).data.session!;
    const duringRead = createClient(local!.url, local!.key, {
      accessToken: async () => credentials.access_token,
      global: {fetch: async (input, init) => {
        const response = await fetch(input, init);
        if (response.ok && String(input).includes("/storage/v1/object/")) {
          const result = await writer.from("online_file_connections").delete().eq("id", leaving);
          expect(result.error).toBeNull();
        }
        return response;
      }},
    });
    await expect(readSharedDrawing(duringRead, writer, stranger.id, session, leaving, file, keys.edit.token))
      .rejects.toThrow("unavailable");
    expect((await writer.from("online_file_connections").select("id").eq("id", leaving)).data).toEqual([]);
    await expect(join(keys.edit.token)).rejects.toThrow("unavailable");
    await changeFileLinks(writer, owner.id, file, [keys.view.id]);
    expect((await guest.download(path)).error).toBeTruthy();
    await expect(join(keys.view.token)).rejects.toThrow("unavailable");
    expect((await join(keys.edit.token, randomUUID())).access).toBe("edit");
    expect((await guest.createSignedUrl(path, 3600)).error).toBeTruthy();
    await store.remove(file);
    expect((await guest.download(path)).error).toBeTruthy();
  });

  it("keeps owner share receipts stable through competing starts, stop and delayed replay", async () => {
    const writer = local!.admin, file = randomUUID(), first = randomUUID(), stop = randomUUID();
    const seed = "73".repeat(32);
    const published = createPublishedLinks(), proof = await publishedLinkDigests(published);
    paths.push(owner.id + "/" + file + ".figcraft");
    const store = new SupabaseOnlineFileStore(owner.client, owner.id, id => finaliseOnlineFile(owner.client, writer, id, proof));
    await store.publish(file, new Blob([archive]));
    const start = () => applyOwnerSharing(writer, owner.id, file, null, first, [], seed);
    const [a, b] = await Promise.all([start(), start()]);
    expect(a).toEqual(b);
    expect(a.map(row => row.access)).toEqual(["edit", "view", "comment"]);
    const ids = a.map(row => row.id);
    const network = "2001:db8:" + randomUUID().slice(0,4) + ":";
    const attempts = await Promise.all(Array.from({length: 12}, () => lookupCode(writer, network + "1::1", a[0].code!)));
    expect(attempts.filter(receipt => receipt.status === 200)).toHaveLength(10);
    expect(attempts.filter(receipt => receipt.status === 429)).toHaveLength(2);
    for (const receipt of attempts.filter(receipt => receipt.status === 200)) {
      expect(receipt.body).toEqual({file, token: a[0].token});
    }
    const callerIp = network + "201::1";
    for (const role of a) expect(await lookupCode(writer, callerIp, role.code!)).toEqual({status: 200, body: {file, token: role.token}});
    expect((await stranger.client.rpc("lookup_online_code", {address: callerIp, symbols: "000000000"})).error?.code).toBe("42501");
    const state = () => ownerSharingStatus(writer, owner.id, file);
    expect((await state()).ids.sort()).toEqual([...ids, published.edit.id, published.view.id].sort());
    await expect(applyOwnerSharing(writer, stranger.id, file, null, first, [], seed)).rejects.toThrow("unavailable");
    await expect(applyOwnerSharing(writer, owner.id, file, null, first, [], "36".repeat(32))).rejects.toMatchObject({code:"22023"});
    const rows = await writer.from("online_file_links").select("id,code_hash,wrapped_token").in("id", ids);
    expect(rows.error).toBeNull();
    for (const receipt of a) {
      const symbols = parseJoinCode(receipt.code!);
      if (symbols.kind !== "online") throw new Error("Expected an online code");
      const row = rows.data!.find(link => link.id === receipt.id)!;
      expect(new JoinCodeKey(symbols.code).open({hash: row.code_hash, token: row.wrapped_token})).toBe(receipt.token);
    }
    await expect(applyOwnerSharing(writer, owner.id, file, first, stop, [published.view.id], null)).rejects.toMatchObject({code:"22023"});
    await Promise.all([1,2].map(() => applyOwnerSharing(writer, owner.id, file, first, stop, ids, null)));
    await expect(start()).rejects.toThrow("Sharing changed elsewhere");
    expect(await state()).toMatchObject({revision:stop});
    expect((await lookupCode(writer, callerIp, a[0].code!)).status).toBe(410);
    expect((await state()).ids.sort()).toEqual([published.edit.id,published.view.id].sort());
    const renewed = await applyOwnerSharing(writer, owner.id, file, stop, randomUUID(), [], seed);
    expect(renewed.every(link => !ids.includes(link.id))).toBe(true);
    expect((await owner.client.from("online_file_share_changes").select("*")).error).toBeTruthy();
    await store.remove(file);
    expect((await writer.from("online_file_share_changes").select("file_id").eq("file_id",file)).data).toEqual([]);
  }, 30_000);

  it("ends only revoked connections and rejects unrelated private subscribers", async () => {
    const writer = local!.admin, file = randomUUID(), viewTab = randomUUID(), editTab = randomUUID();
    const keys = createPublishedLinks(), proof = await publishedLinkDigests(keys);
    paths.push(owner.id + "/" + file + ".figcraft");
    const store = new SupabaseOnlineFileStore(owner.client, owner.id, id => finaliseOnlineFile(owner.client, writer, id, proof));
    await store.publish(file, new Blob([archive]));
    const session = (await stranger.client.auth.getClaims()).data!.claims.session_id as string;
    const topic = (tab: string) => "figcraft-connection:" + session + ":" + tab;
    const active = (account: typeof stranger, tab: string) => account.client.rpc("online_connection_active", {tab});
    const subscribe = (channel: RealtimeChannel) => new Promise<string>(resolve => {
      channel.subscribe(status => resolve(status), 8000);
    });
    const view = stranger.client.channel(topic(viewTab), {config: {private: true}});
    const edit = stranger.client.channel(topic(editTab), {config: {private: true}});
    const unrelated = owner.client.channel(topic(viewTab), {config: {private: true}});
    const events: string[] = [];
    try {
      await readSharedDrawing(stranger.client, writer, stranger.id, session, viewTab, file, keys.view.token);
      await readSharedDrawing(stranger.client, writer, stranger.id, session, editTab, file, keys.edit.token);
      expect((await active(stranger, viewTab)).data).toBe(true);
      expect((await active(owner, viewTab)).data).toBe(false);
      await stranger.client.realtime.setAuth();
      await owner.client.realtime.setAuth();
      view.on("broadcast", {event: "ended"}, ({payload}) => events.push("view:" + payload.reason));
      edit.on("broadcast", {event: "ended"}, ({payload}) => events.push("edit:" + payload.reason));
      unrelated.on("broadcast", {event: "ended"}, () => events.push("unrelated"));
      expect(await subscribe(view)).toBe("SUBSCRIBED");
      expect(await subscribe(edit)).toBe("SUBSCRIBED");
      expect(await subscribe(unrelated)).toBe("CHANNEL_ERROR");
      await expect(view.httpSend("ended", {reason: "removed"})).rejects.toThrow("Unauthorized");
      await changeFileLinks(writer, owner.id, file, [keys.view.id]);
      await expect.poll(() => events, {timeout: 8000}).toEqual(["view:stopped"]);
      expect((await active(stranger, viewTab)).data).toBe(false);
      expect((await active(stranger, editTab)).data).toBe(true);
      await store.remove(file);
      await expect.poll(() => events, {timeout: 8000}).toEqual(["view:stopped", "edit:removed"]);
      expect((await active(stranger, editTab)).data).toBe(false);
    } finally {
      await Promise.all([stranger.client.removeChannel(view), stranger.client.removeChannel(edit), owner.client.removeChannel(unrelated)]);
    }
  }, 45_000);

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
