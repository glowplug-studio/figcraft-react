SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION figcraft_private.leave_live_connection (
  actor uuid,
  login uuid,
  tab   uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    target uuid;
    receipt jsonb;
begin
    select file_id into target from public.online_file_connections
        where id=tab and principal_id=actor and session_id=login;
    if not found then return null; end if;
    perform from public.online_files where id=target for key share;
    perform from figcraft_private.live_rooms where file_id=target for update;
    perform from public.online_file_connections where id=tab and file_id=target
        and principal_id=actor and session_id=login for update;
    if not found then return null; end if;
    select jsonb_build_object('client',lc.client_id,'colour',pc.colour,
        'generation',(extract(epoch from pc.generation)*1000000)::bigint::text,
        'targets',figcraft_private.live_recipient_topics(target,tab))
        into receipt from figcraft_private.live_clients lc
        join figcraft_private.live_presence_connections pc on pc.connection_id=lc.connection_id
        where lc.file_id=target and lc.connection_id=tab and lc.session_id=login;
    delete from public.online_file_connections where id=tab;
    return receipt;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.live_presence_targets (
  actor          uuid,
  login          uuid,
  tab            uuid,
  target         uuid,
  anonymous_name boolean
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    sender bigint;
    registration figcraft_private.live_presence_connections;
    used smallint[];
begin
    -- Match admission lock order. Subsequent samples only read their existing allocation.
    if not exists(select 1 from figcraft_private.live_presence_connections where connection_id=tab) then
        perform 1 from public.online_files where id=target for key share;
        perform 1 from figcraft_private.live_rooms where file_id=target for update;
    end if;
    select g.client into strict sender from figcraft_private.live_grant(actor,login,tab,target) g;
    select * into registration from figcraft_private.live_presence_connections where connection_id=tab;
    if not found then
        select coalesce(array_agg(pc.colour),'{}') into used
        from public.online_file_connections c
        join figcraft_private.live_presence_connections pc on pc.connection_id=c.id
        where c.file_id=target and c.heard_at>figcraft_private.connection_cutoff();
        select n into registration.colour from generate_series(0,7) n where not n=any(used) order by n limit 1;
        if registration.colour is null then registration.colour:=cardinality(used)%8; end if;
        if anonymous_name then
            update figcraft_private.live_rooms set guest_names_issued=guest_names_issued+1
                where file_id=target returning guest_names_issued into registration.guest_number;
        end if;
        insert into figcraft_private.live_presence_connections(connection_id,colour,guest_number)
            values(tab,registration.colour,registration.guest_number) returning * into registration;
    end if;
    return jsonb_build_object('client',sender,'colour',registration.colour,'guest',registration.guest_number,
        'generation',(extract(epoch from registration.generation)*1000000)::bigint::text,'targets',figcraft_private.live_recipient_topics(target,tab));
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.live_recipient_topics (
  target uuid,
  tab    uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
    select coalesce(jsonb_agg('figcraft-connection:'||c.session_id::text||':'||c.id::text),'[]'::jsonb)
        from public.online_file_connections c
        join figcraft_private.live_clients lc on lc.connection_id=c.id and lc.file_id=c.file_id
        where c.file_id=target and c.id<>tab and c.heard_at>figcraft_private.connection_cutoff();
$function$;

CREATE OR REPLACE FUNCTION public.leave_live_connection (
  actor uuid,
  login uuid,
  tab   uuid
)
  RETURNS jsonb
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    select figcraft_private.leave_live_connection(actor,login,tab);
$function$;

REVOKE ALL ON FUNCTION "figcraft_private"."leave_live_connection"(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."leave_live_connection"(uuid, uuid, uuid) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."live_recipient_topics"(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."live_recipient_topics"(uuid, uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."leave_live_connection"(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."leave_live_connection"(uuid, uuid, uuid) TO "postgres", "service_role";
