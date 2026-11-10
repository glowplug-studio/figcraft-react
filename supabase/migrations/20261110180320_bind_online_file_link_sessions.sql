SET local check_function_bodies = off;

CREATE SCHEMA "figcraft_private";

CREATE TABLE "public"."online_file_connections" (
  "id"           uuid NOT NULL,
  "link_id"      text NOT NULL,
  "session_id"   uuid NOT NULL,
  "principal_id" uuid NOT NULL,
  CONSTRAINT "online_file_connections_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."online_file_connections"
  ENABLE ROW LEVEL SECURITY;

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
    where c.principal_id = (select auth.uid())
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

ALTER TABLE "public"."online_file_connections"
  ADD CONSTRAINT "online_file_connections_link_id_fkey" FOREIGN KEY (link_id) REFERENCES public.online_file_links(id) ON DELETE CASCADE;

ALTER TABLE "public"."online_file_connections"
  ADD CONSTRAINT "online_file_connections_principal_id_fkey" FOREIGN KEY (principal_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."online_file_connections"
  ADD CONSTRAINT "online_file_connections_session_id_fkey" FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;

CREATE INDEX online_file_connections_link_idx ON public.online_file_connections USING btree (link_id);

CREATE INDEX online_file_connections_principal_idx ON public.online_file_connections USING btree (principal_id);

CREATE INDEX online_file_connections_session_idx ON public.online_file_connections USING btree (session_id, principal_id);

DROP POLICY "Owners read private Figcraft snapshots" ON storage.objects;
create policy "Owners and current link sessions read snapshots" on storage.objects
    for select to authenticated
    using (bucket_id = 'figcraft-files' and (
        owner_id = (select auth.uid())::text or (
            (select storage.allow_only_operation('object.get_authenticated'))
            and id in (select figcraft_private.shared_snapshot_ids())
        )
    ));

REVOKE ALL ON FUNCTION "figcraft_private"."shared_snapshot_ids"() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION "figcraft_private"."shared_snapshot_ids"() TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."join_online_file"(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION "public"."join_online_file"(uuid, uuid, uuid, uuid, text) TO "postgres", "service_role";

GRANT USAGE ON SCHEMA "figcraft_private" TO "authenticated";

GRANT CREATE, USAGE ON SCHEMA "figcraft_private" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."online_file_connections" TO "postgres";

REVOKE ALL ON TABLE "public"."online_file_connections" FROM PUBLIC, anon, authenticated, service_role;

GRANT DELETE, INSERT, SELECT ON TABLE "public"."online_file_connections" TO "service_role";
