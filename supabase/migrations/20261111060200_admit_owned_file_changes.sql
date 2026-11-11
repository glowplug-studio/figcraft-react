SET local check_function_bodies = off;

REVOKE ALL ("name") ON TABLE "public"."online_files" FROM "authenticated";

DROP POLICY "Owners rename their online files" ON "public"."online_files";

DROP POLICY "Owners remove private Figcraft snapshots" ON "storage"."objects";

CREATE OR REPLACE FUNCTION figcraft_private.can_discard_online_stage (
  target uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
    perform pg_advisory_xact_lock(650130,3);
    return exists(select from storage.objects o where o.id=target and o.bucket_id='figcraft-files'
        and o.owner_id=(select auth.uid())::text) and not exists(select from public.online_files where snapshot_id=target);
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.manage_owned_online_file (
  actor   uuid,
  target  uuid,
  title   text,
  address inet
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    listing public.online_files;
    secret text;
    path text;
    opened timestamptz;
begin
    if actor is null or target is null then raise exception 'missing file identity' using errcode='22023'; end if;
    perform pg_advisory_xact_lock(650130,3);
    if title is null then
        -- Leaving a room locks a connection first; its activity trigger can
        -- then take a foreign-key lock on the file. Yield both locks together
        -- before spending admission if that departure is already underway.
        begin
            select * into listing from public.online_files where id=target and owner_id=actor for update nowait;
            if found then
                perform 1 from public.online_file_connections where file_id=target order by id for update nowait;
            end if;
        exception when lock_not_available then return jsonb_build_object('state','contended');
        end;
    else
        select * into listing from public.online_files where id=target and owner_id=actor for no key update;
    end if;
    if listing.id is null then return jsonb_build_object('state','unavailable'); end if;
    if not figcraft_private.take_admin_request(address,null) then return jsonb_build_object('state','busy'); end if;
    if title is not null then
        begin
            update public.online_files set name=title where id=target returning * into listing;
        exception when invalid_parameter_value then return jsonb_build_object('state','invalid');
        end;
        select a.opened_at into opened from figcraft_private.online_room_activity a where a.file_id=target;
        return jsonb_build_object('state','renamed','file',jsonb_build_object(
            'id',listing.id,'name',listing.name,'created_at',listing.created_at,
            'online_expiry_epoch',figcraft_private.online_file_expiry(extract(epoch from listing.created_at),
                extract(epoch from listing.document_updated_at),extract(epoch from opened),
                trunc(figcraft_private.host_idle_seconds()),listing.published_without_key)::text));
    end if;
    select name into strict path from storage.objects where id=listing.snapshot_id;
    delete from public.online_files where id=target;
    secret := encode(extensions.gen_random_bytes(32),'hex');
    insert into figcraft_private.online_retirements(snapshot_id,owner_id,token_hash)
        values(listing.snapshot_id,actor::text,sha256(convert_to(secret,'UTF8')));
    return jsonb_build_object('state','removed','path',path,'claim',secret);
end;
$function$;

CREATE OR REPLACE FUNCTION public.manage_owned_online_file (
  actor   uuid,
  target  uuid,
  title   text,
  address inet
)
  RETURNS jsonb
  LANGUAGE sql
  SET search_path TO ''
  AS $function$ select figcraft_private.manage_owned_online_file(actor,target,title,address); $function$;

CREATE POLICY "Owners discard unlisted Figcraft snapshots" ON "storage"."objects"
  FOR DELETE
  TO "authenticated"
  USING (((bucket_id = 'figcraft-files'::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND figcraft_private.can_discard_online_stage(id)));

REVOKE ALL ON FUNCTION "figcraft_private"."can_discard_online_stage"(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."can_discard_online_stage"(uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."manage_owned_online_file"(uuid, uuid, text, inet) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."manage_owned_online_file"(uuid, uuid, text, inet) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."manage_owned_online_file"(uuid, uuid, text, inet) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."manage_owned_online_file"(uuid, uuid, text, inet) TO "postgres", "service_role";
