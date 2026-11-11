SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION figcraft_private.owned_link_ids (
  target uuid
)
  RETURNS text[]
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    select array(select l.id from public.online_file_links l where l.file_id=f.id order by l.id)
    from public.online_files f where f.id=target and f.owner_id=(select auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.online_owned_link_ids (
  listing public.online_files
)
  RETURNS text[]
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$ select figcraft_private.owned_link_ids(listing.id); $function$;

REVOKE ALL ON FUNCTION "figcraft_private"."owned_link_ids"(uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "figcraft_private"."owned_link_ids"(uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."online_owned_link_ids"(public.online_files) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."online_owned_link_ids"(public.online_files) TO "authenticated", "postgres";
