SET local check_function_bodies = off;

DROP FUNCTION "public"."join_live_file"(uuid, uuid, uuid, uuid, text, text, integer, uuid, bigint);

CREATE UNLOGGED TABLE "figcraft_private"."live_barred_addresses" (
  "file_id" uuid NOT NULL,
  "address" inet NOT NULL,
  CONSTRAINT "live_barred_addresses_pkey" PRIMARY KEY (file_id, address)
);

ALTER TABLE "figcraft_private"."live_barred_addresses"
  ENABLE ROW LEVEL SECURITY;

CREATE UNLOGGED TABLE "figcraft_private"."live_connection_addresses" (
  "connection_id" uuid NOT NULL,
  "address"       inet NOT NULL,
  CONSTRAINT "live_connection_addresses_pkey" PRIMARY KEY (connection_id)
);

ALTER TABLE "figcraft_private"."live_connection_addresses"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION figcraft_private.admit_live_address (
  actor            uuid,
  auth_session     uuid,
  tab              uuid,
  target           uuid,
  presented_hash   text,
  resume_hash      text,
  peer_limit       integer,
  scanned_snapshot uuid,
  scanned_floor    bigint,
  address          inet
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    result jsonb;
begin
    if address is null or masklen(address)<>(case family(address) when 4 then 32 else 128 end) then
        raise exception 'invalid ingress address' using errcode='22023';
    end if;
    if not exists(select from auth.sessions s where s.id=auth_session and s.user_id=actor) then
        raise exception 'the invite is unavailable' using errcode='42501';
    end if;
    result:=figcraft_private.admit_live_file(actor,auth_session,tab,target,presented_hash,resume_hash,peer_limit,scanned_snapshot,scanned_floor);
    if result ? 'scan' then return result; end if;
    -- The allocator holds the room lock. A concurrent removal is ordered with this admission.
    if exists(select from figcraft_private.live_barred_addresses b where b.file_id=target and b.address=$10) then
        raise exception 'you were removed from this session' using errcode='FC043';
    end if;
    insert into figcraft_private.live_connection_addresses values(tab,address) on conflict(connection_id) do nothing;
    return result;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.admit_live_file (
  actor            uuid,
  auth_session     uuid,
  tab              uuid,
  target           uuid,
  presented_hash   text,
  resume_hash      text,
  peer_limit       integer DEFAULT 256,
  scanned_snapshot uuid    DEFAULT NULL::uuid,
  scanned_floor    bigint  DEFAULT NULL::bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
    grant_row record;
    object_id uuid;
    identity jsonb;
begin
    begin
        select * into strict grant_row from public.join_online_file(actor,auth_session,tab,target,presented_hash);
        select f.snapshot_id into strict object_id from public.online_files f where f.id=target;
        identity := figcraft_private.issue_live_identity(actor,auth_session,tab,target,object_id,resume_hash,
            case when scanned_snapshot=object_id then scanned_floor end,peer_limit);
        if identity is null then raise exception 'scan required' using errcode='FC040'; end if;
    exception when sqlstate 'FC040' then
        return jsonb_build_object('scan',object_id,'path',grant_row.object_path);
    end;
    return identity || jsonb_build_object('access',grant_row.access_level,'path',grant_row.object_path);
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.clear_idle_live_addresses()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
    delete from figcraft_private.live_barred_addresses where file_id=new.file_id;
    return null;
end;
$function$;

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
        and m.payload->>'reason' in ('stopped','removed','expelled')
    order by m.inserted_at desc limit 1;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.remove_live_participant (
  actor           uuid,
  login           uuid,
  tab             uuid,
  target          uuid,
  peer            bigint,
  server_operator boolean
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    victim record;
    departure jsonb;
begin
    if peer is null or peer not between 0 and 4294967295 then
        raise exception 'invalid client id' using errcode='22023';
    end if;
    if not exists(select from auth.sessions s where s.id=login and s.user_id=actor) then
        raise exception 'the session is unavailable' using errcode='42501';
    end if;
    perform from public.online_files f where f.id=target and (server_operator is true or f.owner_id=actor) for key share;
    if not found then raise exception 'only the file owner can remove people' using errcode='42501'; end if;
    perform from figcraft_private.live_rooms r where r.file_id=target for update;
    if not found then raise exception 'nobody is in this file' using errcode='FC044'; end if;
    if server_operator is not true and not exists(select from public.online_file_connections c
        join figcraft_private.live_clients lc on lc.file_id=c.file_id and lc.connection_id=c.id
        where c.file_id=target and c.id=tab and c.session_id=login and c.principal_id=actor
        and c.heard_at>figcraft_private.connection_cutoff()) then
        raise exception 'the session is unavailable' using errcode='42501';
    end if;
    select c.id,c.principal_id,c.session_id,a.address,n.display_name into victim
        from figcraft_private.live_clients lc join public.online_file_connections c on c.id=lc.connection_id and c.file_id=lc.file_id
        left join figcraft_private.live_connection_addresses a on a.connection_id=c.id
        left join figcraft_private.live_peer_names n on n.connection_id=c.id
        where lc.file_id=target and lc.client_id=peer and c.id is distinct from tab
        and c.heard_at>figcraft_private.connection_cutoff() for update of c;
    if not found then raise exception 'nobody with that client id is in this file' using errcode='FC044'; end if;
    if victim.address is not null and (select count(*) from figcraft_private.live_barred_addresses b where b.file_id=target)<256 then
        insert into figcraft_private.live_barred_addresses values(target,victim.address) on conflict do nothing;
    end if;
    perform realtime.send(jsonb_build_object('reason','expelled'),'ended',
        'figcraft-connection:'||victim.session_id::text||':'||victim.id::text,true);
    departure:=figcraft_private.leave_live_connection(victim.principal_id,victim.session_id,victim.id);
    return jsonb_build_object('removed',peer,'name',victim.display_name,'departure',departure);
end;
$function$;

CREATE OR REPLACE FUNCTION public.join_live_file (
  actor            uuid,
  auth_session     uuid,
  tab              uuid,
  target           uuid,
  presented_hash   text,
  resume_hash      text,
  peer_limit       integer DEFAULT 256,
  scanned_snapshot uuid    DEFAULT NULL::uuid,
  scanned_floor    bigint  DEFAULT NULL::bigint
)
  RETURNS jsonb
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    select figcraft_private.admit_live_address(actor,auth_session,tab,target,presented_hash,resume_hash,peer_limit,scanned_snapshot,scanned_floor,'127.0.0.1'::inet);
$function$;

CREATE OR REPLACE FUNCTION public.join_live_file_at_address (
  actor            uuid,
  auth_session     uuid,
  tab              uuid,
  target           uuid,
  presented_hash   text,
  resume_hash      text,
  peer_limit       integer,
  scanned_snapshot uuid,
  scanned_floor    bigint,
  address          inet
)
  RETURNS jsonb
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    select figcraft_private.admit_live_address(actor,auth_session,tab,target,presented_hash,resume_hash,peer_limit,scanned_snapshot,scanned_floor,address);
$function$;

CREATE OR REPLACE FUNCTION public.remove_live_participant (
  actor           uuid,
  login           uuid,
  tab             uuid,
  target          uuid,
  peer            bigint,
  server_operator boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    select figcraft_private.remove_live_participant(actor,login,tab,target,peer,server_operator);
$function$;

ALTER TABLE "figcraft_private"."live_barred_addresses"
  ADD CONSTRAINT "live_barred_addresses_file_id_fkey" FOREIGN KEY (file_id) REFERENCES figcraft_private.live_rooms(file_id) ON DELETE CASCADE;

ALTER TABLE "figcraft_private"."live_connection_addresses"
  ADD CONSTRAINT "live_connection_addresses_connection_id_fkey" FOREIGN KEY (connection_id) REFERENCES public.online_file_connections(id) ON DELETE CASCADE;

CREATE TRIGGER clear_idle_live_addresses
  AFTER UPDATE OF members ON figcraft_private.online_room_activity
  FOR EACH ROW
  WHEN ((new.members = 0))
  EXECUTE FUNCTION figcraft_private.clear_idle_live_addresses();

REVOKE ALL ON FUNCTION "figcraft_private"."admit_live_address"(uuid, uuid, uuid, uuid, text, text, integer, uuid, bigint, inet) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."admit_live_address"(uuid, uuid, uuid, uuid, text, text, integer, uuid, bigint, inet) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."admit_live_file"(uuid, uuid, uuid, uuid, text, text, integer, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."admit_live_file"(uuid, uuid, uuid, uuid, text, text, integer, uuid, bigint) TO "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."clear_idle_live_addresses"() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."clear_idle_live_addresses"() TO "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."remove_live_participant"(uuid, uuid, uuid, uuid, bigint, boolean) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."remove_live_participant"(uuid, uuid, uuid, uuid, bigint, boolean) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."join_live_file"(uuid, uuid, uuid, uuid, text, text, integer, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."join_live_file"(uuid, uuid, uuid, uuid, text, text, integer, uuid, bigint) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."join_live_file_at_address"(uuid, uuid, uuid, uuid, text, text, integer, uuid, bigint, inet) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."join_live_file_at_address"(uuid, uuid, uuid, uuid, text, text, integer, uuid, bigint, inet) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."remove_live_participant"(uuid, uuid, uuid, uuid, bigint, boolean) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."remove_live_participant"(uuid, uuid, uuid, uuid, bigint, boolean) TO "postgres", "service_role";

REVOKE ALL ON TABLE "figcraft_private"."live_barred_addresses" FROM PUBLIC, anon, authenticated, service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."live_barred_addresses" TO "postgres";

REVOKE ALL ON TABLE "figcraft_private"."live_connection_addresses" FROM PUBLIC, anon, authenticated, service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."live_connection_addresses" TO "postgres";
