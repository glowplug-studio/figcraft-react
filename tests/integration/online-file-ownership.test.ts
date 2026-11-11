import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SupabaseOnlineFileStore } from "../../src/backends/supabase/online-files";
import { finaliseOnlineFile, finaliseOperatorFile } from "../../src/backends/supabase/publication";
import { applyOwnerSharing, changeFileLinks, ownerSharingStatus } from "../../examples/nextjs/lib/sharing/links";
import { readSharedDrawing } from "../../examples/nextjs/lib/sharing/join";
import { lookupCode } from "../../examples/nextjs/lib/sharing/code-lookup";
import { JoinCodeKey } from "../../examples/nextjs/lib/sharing/codes";
import { createPublishedLinks, publishedLinkDigests } from "../../src/backends/published-links";
import { parseJoinCode } from "../../src/engine/sharing/join-code";
import {localOperatorSql} from "../support/localOperatorSql";
import {enableLocalTeamDirectory} from "../support/localTeamDirectory";
import { localSupabase } from "../support/localSupabase";

const enabled = process.env.FIGCRAFT_LOCAL_INTEGRATION === "1";
const bucket = "figcraft-files";

describe.skipIf(!enabled)("private online files on real local Supabase", () => {
  const local = enabled ? localSupabase() : undefined;
  const users: string[] = [];
  const paths: string[] = [];
  let fixtureIngress: string;
  beforeEach(() => {
    const entropy = randomUUID().replaceAll("-", "");
    fixtureIngress = "fd" + entropy.slice(0, 2) + ":" + entropy.slice(2, 6) + ":" + entropy.slice(6, 10);
  });
  function finaliseForTest(...[user, writer, id, links, capacity]: Parameters<typeof finaliseOnlineFile>) {
    return finaliseOnlineFile(user, writer, id, links, capacity ?? {address: fixtureIngress + "::1"});
  }
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
      const published = await finaliseForTest(owner.client, local!.admin, file);
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
    await expect(finaliseForTest(stranger.client, local!.admin, id)).rejects.toBeTruthy();
    await expect(store.publish(invalid, new Blob(["not a drawing"]))).rejects.toBeTruthy();
    expect(await store.owned([invalid])).toEqual([]);
    expect((await store.rename(id, "Public name")).name).toBe("Public name");
    const downloaded = await store.open(id);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(archive);
    await store.remove(id);
    await expect(store.open(id)).rejects.toThrow("no longer on its server");
  });

  it("retains operator files and live grants after deleting the uploading account", async () => {
    const uploader = await account(), writer = local!.admin, file = randomUUID();
    const links = createPublishedLinks(), proof = await publishedLinkDigests(links);
    const capacity = {address:fixtureIngress + "::1"};
    const stage = uploader.id + "/" + file + ".figcraft";
    const stored = "operator/" + file + "/" + createHash("sha256").update(archive).digest("hex") + ".figcraft";
    paths.push(stage,stored);
    const store = new SupabaseOnlineFileStore(uploader.client,uploader.id,
      id => finaliseOperatorFile(uploader.client,writer,id,proof,capacity,64));
    const blob = new Blob([archive]);
    const [one,two] = await Promise.all([store.publish(file,blob),store.publish(file,blob)]);
    expect(one).toEqual(two);
    expect(one).toMatchObject({id:file,managedByKey:true,expires:null});
    expect(await store.owned([file])).toEqual([]);
    expect((await uploader.client.storage.from(bucket).download(stored)).error).toBeTruthy();
    await expect(finaliseOperatorFile(uploader.client,writer,file,await publishedLinkDigests(createPublishedLinks()),capacity,64))
      .rejects.toMatchObject({code:"22023"});
    await expect(ownerSharingStatus(writer,uploader.id,file)).rejects.toThrow("unavailable");
    const state = await ownerSharingStatus(writer,null,file);
    expect(state.ids.sort()).toEqual([links.edit.id,links.view.id].sort());
    const shared = await applyOwnerSharing(writer,null,file,null,randomUUID(),[],createHash("sha256").update(randomUUID()).digest("hex"),capacity.address);
    expect(shared).toHaveLength(3);
    const disposed = await uploader.client.storage.from(bucket).remove([stage,stored]);
    expect(disposed.error).toBeNull();
    expect(disposed.data?.map(object => object.name)).toEqual([stage]);
    expect((await writer.auth.admin.deleteUser(uploader.id)).error).toBeNull();
    users.splice(users.indexOf(uploader.id),1);
    const session = (await stranger.client.auth.getClaims()).data!.claims.session_id as string;
    for (const level of ["edit","view"] as const) {
      const joined = await readSharedDrawing(stranger.client,writer,stranger.id,session,randomUUID(),file,links[level].token);
      expect(joined.access).toBe(level);
      expect(new Uint8Array(await joined.bytes.arrayBuffer())).toEqual(archive);
    }
    expect((await writer.storage.from(bucket).remove([stored])).error).toBeNull();
    expect((await writer.from("online_files").select("id").eq("id",file)).data).toEqual([]);
  });

  it("atomically issues, rotates and revokes scoped file links without persisting bearer secrets", async () => {
    const id = randomUUID();
    const path = owner.id + "/" + id + ".figcraft";
    paths.push(path);
    const keys = createPublishedLinks();
    const proof = await publishedLinkDigests(keys);
    const store = new SupabaseOnlineFileStore(owner.client, owner.id, file => finaliseForTest(owner.client, local!.admin, file, proof));
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
    await Promise.all([finaliseForTest(owner.client, writer, file, proof), finaliseForTest(owner.client, writer, file, proof)]);
    const list = () => writer.from("online_file_links").select("id,token_hash,access_level").eq("file_id", file);
    expect((await list()).data).toHaveLength(2);
    // A duplicate link ID triggers a database failure after the new listing insert.
    await expect(finaliseForTest(owner.client, writer, failed, proof)).rejects.toMatchObject({ code: "23505" });
    expect((await owner.client.from("online_files").select("id").eq("id", failed)).data).toEqual([]);
    const other = await publishedLinkDigests(createPublishedLinks());
    await expect(finaliseForTest(owner.client, writer, file, other)).rejects.toMatchObject({ code: "22023" });
    await expect(finaliseForTest(stranger.client, writer, file, proof)).rejects.toBeTruthy();
    await changeFileLinks(writer, owner.id, file, [keys.edit.id]);
    await finaliseForTest(owner.client, writer, file, proof);
    await finaliseForTest(owner.client, writer, file);
    expect((await list()).data).toEqual([{ id: keys.view.id, token_hash: proof.view.hash, access_level: "view" }]);
    expect((await owner.client.from("online_files").update({ published_link_fingerprint: null }).eq("id", file)).error).toBeTruthy();
  });

  it("reserves the last address slot atomically across two owners and releases it on removal", async () => {
    const users = [owner, stranger];
    const ids = [randomUUID(), randomUUID()];
    const proof = await Promise.all(ids.map(() => publishedLinkDigests(createPublishedLinks())));
    const addresses = [fixtureIngress + ":11::1", fixtureIngress + ":11::2"];
    const publish = (index: number, address = addresses[index]) => finaliseForTest(users[index].client, local!.admin,
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
    await expect(finaliseForTest(owner.client, local!.admin, current, undefined, {
      address: fixtureIngress + "::2", max_total_bytes: 600,
    })).rejects.toThrow("retained byte limit");
    expect((await missing()).data).toEqual([]);
    expect((await storage.info(owner.id + "/" + prior + ".figcraft")).error).toBeNull();
    expect(await finaliseForTest(owner.client, local!.admin, current)).toMatchObject({id: current});
  });

  it("charges failed staged drawings and exempts committed publication acknowledgements", async () => {
    const files = [randomUUID(), randomUUID(), randomUUID()];
    const storage = owner.client.storage.from(bucket);
    for (const [i, file] of files.entries()) {
      const path = owner.id + "/" + file + ".figcraft";
      paths.push(path);
      expect((await storage.upload(path, i === 0 ? new Blob(["invalid"]) : archive,
        {contentType: "application/octet-stream"})).error).toBeNull();
    }
    const keep = (i: number, host: number) => finaliseForTest(owner.client, local!.admin, files[i], undefined,
      {address: fixtureIngress + ":" + host + "::1", publishes_per_hour: 1});
    await expect(keep(0, 1)).rejects.toThrow();
    await expect(keep(1, 1)).rejects.toThrow("try again in an hour");
    const first = await keep(1, 2);
    expect(await keep(1, 2)).toEqual(first);
    await expect(keep(2, 2)).rejects.toThrow("try again in an hour");
    const rows = await owner.client.from("online_files").select("id").in("id", files);
    expect(rows.data).toEqual([{id: files[1]}]);
  });

  it("admits exactly the configured burst across concurrent host requests", async () => {
    const take = () => local!.admin.rpc("admit_online_publication", {address: fixtureIngress + "::1", hourly: 3});
    const receipts = await Promise.all(Array.from({length: 12}, take));
    expect(receipts.every(result => result.error === null)).toBe(true);
    expect(receipts.filter(result => result.data === true)).toHaveLength(3);
  });

  it("keeps independent room grants during concurrent joins, voluntary leaves and link revocation", async () => {
    const file = randomUUID();
    const keys = createPublishedLinks();
    const proof = await publishedLinkDigests(keys);
    const writer = local!.admin;
    const store = new SupabaseOnlineFileStore(owner.client, owner.id, id => finaliseForTest(owner.client, writer, id, proof));
    paths.push(owner.id + "/" + file + ".figcraft");
    await store.publish(file, new Blob([archive]));
    const session = (await stranger.client.auth.getClaims()).data!.claims.session_id;
    const editors = Array.from({length: 4}, () => randomUUID());
    const viewers = Array.from({length: 4}, () => randomUUID());
    const admit = (tab: string, hash: string) => writer.rpc("join_online_file", {
      actor: stranger.id, auth_session: session, tab, target: file, presented_hash: hash,
    });
    const tabs = [...editors, ...viewers];
    const admissions = await Promise.all([...tabs, ...tabs].map(tab =>
      admit(tab, editors.includes(tab) ? proof.edit.hash : proof.view.hash)));
    expect(admissions.every(result => result.error === null)).toBe(true);
    const grants = async () => {
      const result = await writer.from("online_file_connections").select("id").eq("file_id", file);
      expect(result.error).toBeNull();
      return result.data!.map(row => row.id as string).sort();
    };
    expect(await grants()).toEqual([...tabs].sort());

    const [left, , contested] = await Promise.all([
      writer.from("online_file_connections").delete().in("id", editors.slice(1)),
      changeFileLinks(writer, owner.id, file, [keys.view.id]),
      admit(randomUUID(), proof.view.hash),
    ]);
    expect(left.error).toBeNull();
    // A join either precedes revocation and is swept, or sees the refused link.
    expect([undefined, "42501"]).toContain(contested.error?.code);
    expect(await grants()).toEqual([editors[0]]);
    expect((await stranger.client.rpc("online_connection_active", {tab: editors[0]})).data).toBe(true);
    expect((await stranger.client.rpc("online_connection_active", {tab: viewers[0]})).data).toBe(false);
    const reopened = await Promise.all(editors.slice(1).map(tab => admit(tab, proof.edit.hash)));
    expect(reopened.every(result => result.error === null)).toBe(true);
    const [closing] = await Promise.all([
      writer.from("online_file_connections").delete().in("id", editors.slice(1)),
      store.remove(file),
    ]);
    expect(closing.error).toBeNull();
    expect(await grants()).toEqual([]);
  });

  it("retires an idle listing and retries Storage deletion without touching a replacement", async () => {
    const file = randomUUID(), path = owner.id + "/" + file + ".figcraft";
    paths.push(path);
    const writer = local!.admin, links = createPublishedLinks(), proof = await publishedLinkDigests(links);
    const bytes = new Blob([archive]);
    const store = new SupabaseOnlineFileStore(owner.client, owner.id, id => finaliseForTest(owner.client, writer, id, proof));
    await store.publish(file, bytes);
    const info = await owner.client.storage.from(bucket).info(path);
    if (info.error) throw info.error;
    const snapshot = info.data.id;
    const claim = async () => {
      const result = await writer.rpc("claim_online_retirement", {target: snapshot, idle_seconds: 1});
      if (result.error) throw result.error;
      return result.data as {object_path: string; claim: string}[];
    };
    const worker = (token?: string) => createClient(local!.url, local!.key, {
      auth: {persistSession: false, autoRefreshToken: false},
      global: {headers: token ? {"x-figcraft-retirement": token} : {}},
    }).storage.from(bucket);
    const age = await writer.from("online_files").update({created_at: new Date(Date.now() - 60_000).toISOString()}).eq("id", file);
    expect(age.error).toBeNull();
    const [first] = await claim();
    expect(first?.object_path).toBe(path);
    expect(await store.owned([file])).toEqual([]);
    expect((await owner.client.storage.from(bucket).download(path)).error).toBeTruthy();
    const session = (await stranger.client.auth.getClaims()).data!.claims.session_id as string;
    await expect(readSharedDrawing(stranger.client, writer, stranger.id, session, randomUUID(), file, links.view.token))
      .rejects.toThrow("unavailable");
    await expect(finaliseForTest(owner.client, writer, file, proof)).rejects.toBeTruthy();
    const [retry] = await claim();
    expect(retry.claim !== first.claim).toBe(true);
    for (const credential of [undefined, randomUUID(), first.claim]) {
      await worker(credential).remove([path]);
      expect((await writer.storage.from(bucket).info(path)).data?.id).toBe(snapshot);
    }
    expect((await worker(retry.claim).download(path)).error).toBeTruthy();
    const removed = await worker(retry.claim).remove([path]);
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
    expect((await writer.storage.from(bucket).download(path)).error).toBeTruthy();
    expect(await claim()).toHaveLength(0);
    await store.publish(file, bytes);
    await worker(retry.claim).remove([path]);
    const replacement = await owner.client.storage.from(bucket).info(path);
    expect(replacement.error).toBeNull();
    expect(replacement.data?.id === snapshot).toBe(false);
    expect(new Uint8Array(await (await store.open(file)).arrayBuffer())).toEqual(archive);
  });

  it("serialises a due file's retirement with admission of a real guest", async () => {
    const file = randomUUID(), path = owner.id + "/" + file + ".figcraft";
    paths.push(path);
    const writer = local!.admin, links = createPublishedLinks(), proof = await publishedLinkDigests(links);
    const store = new SupabaseOnlineFileStore(owner.client, owner.id, id => finaliseForTest(owner.client, writer, id, proof));
    await store.publish(file, new Blob([archive]));
    const object = await owner.client.storage.from(bucket).info(path);
    if (object.error) throw object.error;
    const age = await writer.from("online_files").update({created_at: new Date(Date.now() - 60_000).toISOString()}).eq("id", file);
    expect(age.error).toBeNull();
    const tab = randomUUID(), session = (await stranger.client.auth.getClaims()).data!.claims.session_id as string;
    // Hold the exact file lock that an in-flight admission takes. The sweeper
    // must leave it alone while admission may still be reclaiming stale grants.
    const lock = spawn("docker", ["exec", "-i", "supabase_db_figcraft-react", "psql",
      "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"]);
    const lines = createInterface({input:lock.stdout});
    const closed = once(lock, "close");
    try {
      const locked = once(lines, "line", {signal:AbortSignal.timeout(4000)});
      lock.stdin.write("begin; select 'locked' from public.online_files where id='" + file + "' for key share;\n");
      expect((await locked)[0]).toBe("locked");
      const whileOpening = await writer.rpc("claim_online_retirement", {target:object.data.id, idle_seconds:1})
        .abortSignal(AbortSignal.timeout(3000));
      expect(whileOpening.error).toBeNull();
      expect(whileOpening.data).toHaveLength(0);
    } finally {
      lock.stdin.end("rollback;\n");
      await closed;
      lines.close();
    }
    const [joined, swept] = await Promise.allSettled([
      readSharedDrawing(stranger.client, writer, stranger.id, session, tab, file, links.view.token),
      writer.rpc("claim_online_retirement", {target: object.data.id, idle_seconds: 1}).throwOnError(),
    ]);
    if (swept.status === "rejected") throw swept.reason;
    const claimed = swept.value.data.length > 0;
    expect(claimed).toBe(joined.status === "rejected");
    if (joined.status === "rejected") expect(joined.reason.message).toContain("unavailable");
    else expect(joined.value.bytes.size).toBe(archive.byteLength);
    expect((await stranger.client.rpc("online_connection_active", {tab})).data).toBe(!claimed);
    expect(await store.owned([file])).toHaveLength(claimed ? 0 : 1);
  });

  it("resolves concurrent team joins once and revokes their real Storage access on unshare", async () => {
    const file = randomUUID(), path = owner.id + "/" + file + ".figcraft";
    paths.push(path);
    const writer = local!.admin;
    const store = new SupabaseOnlineFileStore(owner.client, owner.id, id => finaliseForTest(owner.client, writer, id));
    const guest = new SupabaseOnlineFileStore(stranger.client, stranger.id, () => Promise.reject());
    await store.publish(file,new Blob([archive]));
    await expect(guest.resolveTeamFile(file)).rejects.toThrow("no team list");
    expect((await local!.client.rpc("online_team_directory")).error).toBeTruthy();
    const disable = enableLocalTeamDirectory(local!, "comment", "https://team.example/");
    try {
      await expect(guest.resolveTeamFile(file)).rejects.toThrow("isn't shared");
      const links = await changeFileLinks(writer,owner.id,file,[],"shared");
      const directory = await guest.teamDirectory();
      expect(directory.state === "listed" && directory.files.some(row => row.file === file && row.access === "comment")).toBe(true);
      const ownerLinks = await ownerSharingStatus(writer,owner.id,file);
      const receipts = await Promise.all(Array.from({length:12},() => guest.resolveTeamFile(file)));
      const {token} = receipts[0];
      expect(await ownerSharingStatus(writer,owner.id,file)).toEqual(ownerLinks);
      expect(new Set(receipts.map(r => r.token)).size).toBe(1);
      expect(JSON.stringify(directory)).not.toContain(token);
      const session = (await stranger.client.auth.getClaims()).data!.claims.session_id as string;
      const admitted = await readSharedDrawing(stranger.client,writer,stranger.id,session,randomUUID(),file,token);
      expect(admitted.access).toBe("comment");
      const storage = stranger.client.storage.from(bucket);
      expect((await storage.download(path)).error).toBeNull();
      if (process.env.FIGCRAFT_VERIFY_TEAM_RESTART === "1") {
        // This dedicated check only restarts the isolated local two-account fixture.
        const container = "supabase_db_figcraft-react";
        const extra = execFileSync("docker",["exec","-i",container,"psql","-XqAt","-U","postgres","-d","postgres"],{
          input:"select count(*) from auth.users where id not in ('" + owner.id + "','" + stranger.id + "')",
          encoding:"utf8",
        });
        expect(extra.trim()).toBe("0");
        execFileSync("docker",["restart",container],{stdio:"pipe",timeout:60_000});
        await expect.poll(() => guest.resolveTeamFile(file).catch(() => null),
          {timeout:60_000,interval:500}).toEqual({file,token});
        expect((await storage.download(path)).error).toBeTruthy();
        expect((await readSharedDrawing(stranger.client,writer,stranger.id,session,randomUUID(),file,token)).access).toBe("comment");
      }
      const [stopped, resolving] = await Promise.allSettled([
        changeFileLinks(writer,owner.id,file,links.map(row => row.id)), guest.resolveTeamFile(file),
      ]);
      expect(stopped.status).toBe("fulfilled");
      if (resolving.status === "fulfilled") expect(resolving.value.token).toBe(token);
      await expect(guest.resolveTeamFile(file)).rejects.toThrow("isn't shared");
      expect((await storage.download(path)).error).toBeTruthy();
      await expect(readSharedDrawing(stranger.client,writer,stranger.id,session,randomUUID(),file,token)).rejects.toThrow();
      await changeFileLinks(writer,owner.id,file,[],"shared");
      expect((await guest.resolveTeamFile(file)).token).not.toBe(token);
    } finally { disable(); }
  }, 90_000);

  it("keeps participant reports private across concurrent requests, restart and revocation", async () => {
    const file = randomUUID(), tab = randomUUID(), keys = createPublishedLinks();
    const proof = await publishedLinkDigests(keys);
    const writer = local!.admin;
    const store = new SupabaseOnlineFileStore(owner.client, owner.id, id => finaliseForTest(owner.client, writer, id, proof));
    paths.push(owner.id + "/" + file + ".figcraft");
    await store.publish(file, new Blob([archive]));
    const session = (await stranger.client.auth.getClaims()).data!.claims.session_id as string;
    const params = {actor:stranger.id, auth_session:session, tab, address:fixtureIngress + "::1", reason:"Fixture"};
    const sql = (query: string) => localOperatorSql(local!,query,{file,owner:owner.id,viewer:stranger.id});
    const count = () => sql("select count(*) from figcraft_private.online_participant_reports where file_id=:'file'");
    try {
      await readSharedDrawing(stranger.client,writer,stranger.id,session,tab,file,keys.view.token);
      expect((await stranger.client.rpc("submit_participant_report",params)).error?.code).toBe("42501");
      expect((await writer.rpc("submit_participant_report",{...params,actor:owner.id})).data).toBe("unavailable");
      const receipts = await Promise.all(Array.from({length:12},() => writer.rpc("submit_participant_report",params)));
      expect(receipts.every(r => r.error === null)).toBe(true);
      expect(receipts.filter(r => r.data === "kept")).toHaveLength(10);
      expect(receipts.filter(r => r.data === "rate")).toHaveLength(2);
      expect(count()).toBe("10");
      if (process.env.FIGCRAFT_VERIFY_REPORT_RESTART === "1") {
        expect(sql("select count(*) from auth.users where id not in (:'owner',:'viewer')")).toBe("0");
        execFileSync("docker",["restart","supabase_db_figcraft-react"],{stdio:"pipe",timeout:60_000});
        await expect.poll(async () => (await writer.rpc("submit_participant_report",params)).data,
          {timeout:60_000,interval:500}).toBe("unavailable");
        expect(count()).toBe("10");
        await readSharedDrawing(stranger.client,writer,stranger.id,session,tab,file,keys.view.token);
      }
      const [revoked, racing] = await Promise.all([
        writer.from("online_file_links").delete().eq("file_id",file).eq("id",keys.view.id),
        writer.rpc("submit_participant_report",{...params,address:fixtureIngress + ":100::1"}),
      ]);
      expect(revoked.error).toBeNull();
      expect(racing.error).toBeNull();
      expect(["kept","unavailable"]).toContain(racing.data);
      expect((await writer.rpc("submit_participant_report",params)).data).toBe("unavailable");
      await store.remove(file);
      expect(count()).toBe(racing.data === "kept" ? "11" : "10");
    } finally {
      sql("delete from figcraft_private.online_participant_reports where file_id=:'file'");
    }
  },90_000);

  it("binds an invite to its Auth session and denies signed URLs, writes and downloads after revocation", async () => {
    const keys = createPublishedLinks();
    const proof = await publishedLinkDigests(keys);
    const file = randomUUID(), tab = randomUUID(), path = owner.id + "/" + file + ".figcraft";
    paths.push(path);
    const writer = local!.admin;
    const store = new SupabaseOnlineFileStore(owner.client, owner.id, id => finaliseForTest(owner.client, writer, id, proof));
    await store.publish(file, new Blob([archive]));
    const guest = stranger.client.storage.from(bucket);
    const session = (await stranger.client.auth.getClaims()).data!.claims.session_id as string;
    const join = (token: string, connection = tab) => readSharedDrawing(stranger.client, writer, stranger.id, session, connection, file, token);
    expect((await guest.download(path)).error).toBeTruthy();
    await expect(join(proof.view.hash)).rejects.toThrow("unavailable");
    const hosting = async () => {
      const result = await stranger.client.rpc("online_host_information", {target:file})
        .single<{idle_seconds:string; expires:string | null}>();
      if (result.error) throw result.error;
      return result.data;
    };
    expect(await hosting()).toEqual({idle_seconds:"2592000",expires:null,operator_contact:"",terms_url:"",accepts_reports:true,open_publish:true,file_mb:16});
    const first = await join(keys.view.token);
    expect((await hosting()).expires).toMatch(/^\d+$/);
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
    expect((await hosting()).expires).toBeNull();
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
    const store = new SupabaseOnlineFileStore(owner.client, owner.id, id => finaliseForTest(owner.client, writer, id, proof));
    await store.publish(file, new Blob([archive]));
    const address = fixtureIngress + "::1";
    const start = () => applyOwnerSharing(writer, owner.id, file, null, first, [], seed, address);
    const sql = (query: string) => localOperatorSql(local!,query,{address});
    sql("select figcraft_private.take_admin_request(:'address',null)");
    sql("update figcraft_private.online_code_budgets set admin_tokens=5,admin_used_at=clock_timestamp() where block=network(set_masklen(:'address'::inet,64))");
    await expect(start()).rejects.toThrow("wait a minute");
    expect((await ownerSharingStatus(writer,owner.id,file)).revision).toBeNull();
    expect((await ownerSharingStatus(writer,owner.id,file)).ids).toHaveLength(2);
    sql("update figcraft_private.online_code_budgets set admin_tokens=60,admin_used_at=clock_timestamp()+interval '1 minute' where block=network(set_masklen(:'address'::inet,64))");
    const [a, b] = await Promise.all([start(), start()]);
    expect(a).toEqual(b);
    expect(Number(sql("select admin_tokens from figcraft_private.online_code_budgets where block=network(set_masklen(:'address'::inet,64))"))).toBeCloseTo(54,0);
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
    await expect(applyOwnerSharing(writer, stranger.id, file, null, first, [], seed, address)).rejects.toThrow("unavailable");
    await expect(applyOwnerSharing(writer, owner.id, file, null, first, [], "36".repeat(32), address)).rejects.toMatchObject({code:"22023"});
    const rows = await writer.from("online_file_links").select("id,code_hash,wrapped_token").in("id", ids);
    expect(rows.error).toBeNull();
    for (const receipt of a) {
      const symbols = parseJoinCode(receipt.code!);
      if (symbols.kind !== "online") throw new Error("Expected an online code");
      const row = rows.data!.find(link => link.id === receipt.id)!;
      expect(new JoinCodeKey(symbols.code).open({hash: row.code_hash, token: row.wrapped_token})).toBe(receipt.token);
    }
    await expect(applyOwnerSharing(writer, owner.id, file, first, stop, [published.view.id], null, address)).rejects.toMatchObject({code:"22023"});
    await Promise.all([1,2].map(() => applyOwnerSharing(writer, owner.id, file, first, stop, ids, null, address)));
    await expect(start()).rejects.toThrow("Sharing changed elsewhere");
    expect(await state()).toMatchObject({revision:stop});
    expect((await lookupCode(writer, callerIp, a[0].code!)).status).toBe(410);
    expect((await state()).ids.sort()).toEqual([published.edit.id,published.view.id].sort());
    const renewed = await applyOwnerSharing(writer, owner.id, file, stop, randomUUID(), [], seed, address);
    expect(renewed.every(link => !ids.includes(link.id))).toBe(true);
    expect((await owner.client.from("online_file_share_changes").select("*")).error).toBeTruthy();
    await store.remove(file);
    expect((await writer.from("online_file_share_changes").select("file_id").eq("file_id",file)).data).toEqual([]);
  }, 30_000);

  it("ends only revoked connections and rejects unrelated private subscribers", async () => {
    const writer = local!.admin, file = randomUUID(), viewTab = randomUUID(), editTab = randomUUID();
    const keys = createPublishedLinks(), proof = await publishedLinkDigests(keys);
    paths.push(owner.id + "/" + file + ".figcraft");
    const store = new SupabaseOnlineFileStore(owner.client, owner.id, id => finaliseForTest(owner.client, writer, id, proof));
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
