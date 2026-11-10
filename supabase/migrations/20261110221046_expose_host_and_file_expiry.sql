BEGIN;
SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION figcraft_private.visible_online_expiry (
  target uuid
)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    select figcraft_private.online_file_expiry(extract(epoch from f.created_at),
        extract(epoch from f.document_updated_at),extract(epoch from a.opened_at),
        trunc(figcraft_private.host_idle_seconds()),f.published_without_key)::text
    from public.online_files f left join figcraft_private.online_room_activity a on a.file_id=f.id
    where f.id=target and (f.owner_id=(select auth.uid()) or f.snapshot_id in
        (select figcraft_private.shared_snapshot_ids()));
$function$;

CREATE OR REPLACE FUNCTION public.online_expiry_epoch (
  listing public.online_files
)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$ select figcraft_private.visible_online_expiry(listing.id); $function$;

CREATE OR REPLACE FUNCTION public.online_host_information (
  target uuid DEFAULT NULL::uuid
)
  RETURNS TABLE (
    idle_seconds text,
    expires      text
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$ select trunc(figcraft_private.host_idle_seconds())::text, figcraft_private.visible_online_expiry(target); $function$;

REVOKE ALL ON FUNCTION "figcraft_private"."host_idle_seconds"() FROM "authenticated";

GRANT EXECUTE ON FUNCTION "figcraft_private"."host_idle_seconds"() TO "authenticated";

REVOKE ALL ON FUNCTION "figcraft_private"."visible_online_expiry"(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."visible_online_expiry"(uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."online_expiry_epoch"(public.online_files) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."online_expiry_epoch"(public.online_files) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."online_host_information"(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."online_host_information"(uuid) TO "authenticated", "postgres";
COMMIT;
