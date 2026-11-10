SET local check_function_bodies = off;

ALTER TABLE "public"."online_file_connections"
  ADD COLUMN "heard_at" timestamp WITH time zone NOT NULL DEFAULT clock_timestamp();

CREATE OR REPLACE FUNCTION figcraft_private.connection_active (
  tab uuid
)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    with renewed as (
        update public.online_file_connections
            set heard_at = greatest(heard_at,statement_timestamp())
            where id = tab and principal_id = (select auth.uid())
            and session_id = (select nullif(auth.jwt()->>'session_id', '')::uuid)
            and heard_at > figcraft_private.connection_cutoff()
            returning id
    )
    select exists(select from renewed);
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.connection_cutoff()
  RETURNS timestamp WITH time zone
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$ select greatest(statement_timestamp() - interval '45 seconds', pg_postmaster_start_time()); $function$;

CREATE OR REPLACE FUNCTION figcraft_private.shared_snapshot_ids()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    select f.snapshot_id from public.online_file_connections c
    join public.online_file_links l on l.id = c.link_id
    join public.online_files f on f.id = l.file_id
    where c.heard_at > figcraft_private.connection_cutoff()
        and c.principal_id = (select auth.uid())
        and c.session_id = (select nullif(auth.jwt()->>'session_id', '')::uuid);
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
    select l.* into chosen from public.online_file_links l
        where l.file_id = target and l.token_hash = presented_hash for key share;
    if not found then raise exception 'the invite is unavailable' using errcode = '42501'; end if;
    delete from public.online_file_connections where heard_at <= figcraft_private.connection_cutoff();
    insert into public.online_file_connections (id, link_id, session_id, principal_id)
        values (tab, chosen.id, auth_session, actor) on conflict (id) do nothing;
    if not exists (select 1 from public.online_file_connections c where c.id = tab and c.link_id = chosen.id
        and c.session_id = auth_session and c.principal_id = actor) then
        raise exception 'the connection is unavailable' using errcode = '42501';
    end if;
    return query select chosen.access_level, f.owner_id::text || '/' || f.id::text || '.figcraft'
        from public.online_files f where f.id = target;
end;
$function$;

CREATE OR REPLACE FUNCTION public.online_connection_active (
  tab uuid
)
  RETURNS boolean
  LANGUAGE sql
  SET search_path TO ''
  AS $function$ select figcraft_private.connection_active(tab); $function$;

CREATE INDEX online_file_connections_heard_idx ON public.online_file_connections USING btree (heard_at);

REVOKE ALL ON FUNCTION "figcraft_private"."connection_cutoff"() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION "figcraft_private"."connection_cutoff"() TO "postgres", "service_role";
