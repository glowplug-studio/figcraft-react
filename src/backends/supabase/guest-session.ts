import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { GuestSessionEnd } from "../online-files";

// A welcomed native session sends a ping every 15 seconds and ends after 45 seconds of silence.
const keepaliveMs = 15_000;
const silenceMs = 45_000;

/** A private broadcast wakes an open tab. Heartbeats renew the authenticated database grant. */
export function watchSupabaseGuest(client: SupabaseClient, connection: string, ended: (reason: GuestSessionEnd) => void, edits?: () => void) {
  let closed = false;
  let channel: RealtimeChannel | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let subscribed = false;
  let heartbeat: ReturnType<typeof setInterval>;
  let deadline: ReturnType<typeof setTimeout>;

  const heard = () => {
    clearTimeout(deadline);
    deadline = setTimeout(() => finish("unavailable"), silenceMs);
  };

  const dispose = () => {
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(deadline);
    clearTimeout(retry);
    if (channel) void client.removeChannel(channel);
    channel = undefined;
    window.removeEventListener("online", reconcile);
    document.removeEventListener("visibilitychange", visible);
  };
  const finish = (reason: GuestSessionEnd) => {
    if (closed) return;
    dispose();
    ended(reason);
  };
  function retryCheck() {
    if (closed) return;
    clearTimeout(retry);
    retry = setTimeout(() => { void reconcile(); }, 5000);
  }
  async function reconcile() {
    if (closed) return;
    try {
      const {data, error} = await client.rpc("online_connection_active", {tab: connection});
      if (closed) return;
      if (error) { retryCheck(); return; }
      if (data === false) { finish("unavailable"); return; }
      if (data !== true) { retryCheck(); return; }
      heard();
      if (!channel) await connect();
      if (!subscribed) retryCheck();
    } catch { retryCheck(); }
  }
  function visible() { if (document.visibilityState === "visible") void reconcile(); }
  async function connect() {
    const {data} = await client.auth.getClaims();
    if (closed || channel) return;
    const session = data?.claims.session_id;
    if (typeof session !== "string") { retryCheck(); return; }
    channel = client.channel("figcraft-connection:" + session + ":" + connection, {config: {private: true}});
    channel.on("broadcast", {event: "ended"}, ({payload}) => {
      if (payload?.reason === "stopped" || payload?.reason === "removed") finish(payload.reason);
    }).on("broadcast",{event:"edits"},() => { if (!closed) edits?.(); }).subscribe(status => {
      if (closed) return;
      subscribed = status === "SUBSCRIBED";
      if (subscribed) edits?.();
      if (subscribed) {
        clearTimeout(retry);
        void reconcile();
      } else retryCheck();
    });
  }
  window.addEventListener("online", reconcile);
  document.addEventListener("visibilitychange", visible);
  heard();
  heartbeat = setInterval(() => { void reconcile(); }, keepaliveMs);
  void reconcile();
  return dispose;
}
