BEGIN;

SET local check_function_bodies = off;

-- Quiesce listing and grant mutations while translating existing connections.
LOCK TABLE public.online_files, public.online_file_links, public.online_file_connections IN SHARE ROW EXCLUSIVE MODE;

DROP INDEX "public"."online_file_connections_link_idx";

ALTER TABLE "public"."online_file_connections"
  DROP CONSTRAINT "online_file_connections_link_id_fkey";

CREATE TABLE "figcraft_private"."online_room_activity" (
  "file_id"          uuid                     NOT NULL,
  "members"          bigint                   NOT NULL,
  "opened_at"        timestamp with time zone NOT NULL,
  "latest_departure" timestamp with time zone,
  CONSTRAINT "online_room_activity_members_check" CHECK ((members >= 0)),
  CONSTRAINT "online_room_activity_pkey" PRIMARY KEY (file_id)
);

ALTER TABLE "figcraft_private"."online_room_activity"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."online_file_connections"
  ADD COLUMN "file_id" uuid;

UPDATE public.online_file_connections c SET file_id = l.file_id
    FROM public.online_file_links l WHERE l.id = c.link_id;
ALTER TABLE public.online_file_connections ALTER COLUMN file_id SET NOT NULL;

-- Previous releases did not record room-open history. Give existing files a
-- full idle interval from upgrade and preserve every still-retained grant.
INSERT INTO figcraft_private.online_room_activity (file_id, members, opened_at)
    SELECT f.id, count(c.id), statement_timestamp()
    FROM public.online_files f LEFT JOIN public.online_file_connections c ON c.file_id = f.id
    GROUP BY f.id;

CREATE OR REPLACE FUNCTION figcraft_private.track_room_activity()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    departed timestamptz;
begin
    if tg_op = 'INSERT' then
        insert into figcraft_private.online_room_activity as room (file_id, members, opened_at)
            values (new.file_id, 1, new.heard_at)
            on conflict (file_id) do update set
                members = room.members + 1,
                opened_at = case when room.members = 0 then greatest(room.opened_at, excluded.opened_at)
                    else room.opened_at end,
                latest_departure = case when room.members = 0 then null else room.latest_departure end;
    else
        -- Late cleanup must date a silent departure at its deadline. A database
        -- restart ends previous connections even when their deadline was later.
        departed := least(clock_timestamp(), old.heard_at + interval '45 seconds',
            case when old.heard_at <= pg_postmaster_start_time() then pg_postmaster_start_time() end);
        update figcraft_private.online_room_activity set
            members = members - 1,
            latest_departure = greatest(latest_departure, departed),
            opened_at = case when members = 1 then greatest(opened_at, latest_departure, departed)
                else opened_at end
            where file_id = old.file_id;
    end if;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.join_online_file (
  actor          uuid,
  auth_session   uuid,
  tab            uuid,
  target         uuid,
  presented_hash text
)
  RETURNS TABLE (
    access_level text,
    object_path  text
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
    chosen public.online_file_links;
begin
    -- Match the owner's file-then-link lock order during revocation and removal.
    perform 1 from public.online_files f where f.id = target for key share;
    if not found then raise exception 'the invite is unavailable' using errcode = '42501'; end if;
    select l.* into chosen from public.online_file_links l
        where l.file_id = target and l.token_hash = presented_hash for key share;
    if not found then raise exception 'the invite is unavailable' using errcode = '42501'; end if;
    delete from public.online_file_connections where heard_at <= figcraft_private.connection_cutoff();
    insert into public.online_file_connections (id, link_id, file_id, session_id, principal_id)
        values (tab, chosen.id, chosen.file_id, auth_session, actor) on conflict (id) do nothing;
    if not exists (select 1 from public.online_file_connections c where c.id = tab and c.link_id = chosen.id
        and c.session_id = auth_session and c.principal_id = actor) then
        raise exception 'the connection is unavailable' using errcode = '42501';
    end if;
    return query select chosen.access_level, f.owner_id::text || '/' || f.id::text || '.figcraft'
        from public.online_files f where f.id = target;
end;
$function$;

ALTER TABLE "figcraft_private"."online_room_activity"
  ADD CONSTRAINT "online_room_activity_file_id_fkey" FOREIGN KEY (file_id) REFERENCES public.online_files(id) ON DELETE CASCADE;

ALTER TABLE "public"."online_file_links"
  ADD CONSTRAINT "online_file_links_id_file_id_key" UNIQUE (id, file_id);

ALTER TABLE "public"."online_file_connections"
  ADD CONSTRAINT "online_file_connections_link_id_file_id_fkey" FOREIGN KEY (link_id, file_id) REFERENCES public.online_file_links(id, file_id) ON DELETE CASCADE;

CREATE INDEX online_file_connections_link_idx ON public.online_file_connections USING btree (link_id, file_id);

CREATE TRIGGER track_online_room_activity
  AFTER INSERT OR DELETE ON public.online_file_connections
  FOR EACH ROW
  EXECUTE FUNCTION figcraft_private.track_room_activity();

REVOKE ALL ON FUNCTION "figcraft_private"."track_room_activity"() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."track_room_activity"() TO "postgres";

REVOKE ALL ON TABLE figcraft_private.online_room_activity FROM PUBLIC, anon, authenticated, service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."online_room_activity" TO "postgres";

COMMIT;
