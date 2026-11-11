SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION figcraft_private.connection_ending (
  tab uuid
)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    select m.payload->>'reason' from realtime.messages m
    where m.extension = 'broadcast' and m.private is true and m.event = 'ended'
        and m.inserted_at >= statement_timestamp() - interval '45 seconds'
        and m.topic = 'figcraft-connection:' || ((select auth.jwt())->>'session_id') || ':' || tab::text
        and m.payload->>'reason' in ('stopped','removed')
    order by m.inserted_at desc limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.online_connection_ending (
  tab uuid
)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$ select figcraft_private.connection_ending(tab); $function$;

REVOKE ALL ON FUNCTION "figcraft_private"."connection_ending"(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."connection_ending"(uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."online_connection_ending"(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."online_connection_ending"(uuid) TO "authenticated", "postgres";
