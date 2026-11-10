SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION figcraft_private.connection_active (
  tab uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    select exists (select 1 from public.online_file_connections c
        where c.id = tab and c.principal_id = (select auth.uid())
        and c.session_id = (select nullif(auth.jwt()->>'session_id', '')::uuid));
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.notify_link_removal()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    connection record;
    reason text;
begin
    if exists (select 1 from public.online_files f where f.id = old.file_id) then
        reason := 'stopped';
    else
        reason := 'removed';
    end if;
    for connection in select c.id, c.session_id from public.online_file_connections c
        where c.link_id = old.id
    loop
        perform realtime.send(jsonb_build_object('reason', reason), 'ended',
            'figcraft-connection:' || connection.session_id::text || ':' || connection.id::text, true);
    end loop;
    return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.online_connection_active (
  tab uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$ select figcraft_private.connection_active(tab); $function$;

CREATE TRIGGER notify_link_removal
  BEFORE DELETE ON public.online_file_links
  FOR EACH ROW
  EXECUTE FUNCTION figcraft_private.notify_link_removal();

CREATE POLICY "Guests receive notices for their login session" ON "realtime"."messages"
  FOR SELECT
  TO "authenticated"
  USING
    (((EXTENSION = 'broadcast'::text) AND (topic = ( SELECT realtime.topic() AS topic)) AND starts_with(topic, (('figcraft-connection:'::text || (( SELECT auth.jwt() AS jwt) ->>
    'session_id'::text)) || ':'::text))));

REVOKE ALL ON FUNCTION "figcraft_private"."connection_active"(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION "figcraft_private"."connection_active"(uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."notify_link_removal"() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION "figcraft_private"."notify_link_removal"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."online_connection_active"(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION "public"."online_connection_active"(uuid) TO "authenticated", "postgres", "service_role";
