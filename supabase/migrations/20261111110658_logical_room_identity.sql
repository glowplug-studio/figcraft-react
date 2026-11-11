SET local check_function_bodies = off;

DROP FUNCTION "figcraft_private"."issue_live_client"(uuid, uuid, uuid, uuid, uuid, text, bigint, integer);

ALTER TABLE "figcraft_private"."live_rooms"
  ADD COLUMN "room_id" uuid NOT NULL DEFAULT gen_random_uuid();

CREATE OR REPLACE FUNCTION figcraft_private.issue_live_client (
  actor         uuid,
  auth_session  uuid,
  tab           uuid,
  target        uuid,
  snapshot      uuid,
  resume_hash   text,
  scanned_floor bigint,
  peer_limit    integer
)
  RETURNS bigint
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    select (figcraft_private.issue_live_identity(actor,auth_session,tab,target,snapshot,resume_hash,
        scanned_floor,peer_limit)->>'client')::bigint;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.issue_live_identity (
  actor         uuid,
  auth_session  uuid,
  tab           uuid,
  target        uuid,
  snapshot      uuid,
  resume_hash   text,
  scanned_floor bigint,
  peer_limit    integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    current_room figcraft_private.live_rooms;
    issued bigint;
    bound bigint;
    prior_tab uuid;
    digest bytea;
begin
    if peer_limit is null or peer_limit < 0 or resume_hash is null or resume_hash !~ '^[a-f0-9]{64}$'
        or scanned_floor not between 0 and 4294967294 then
        raise exception 'invalid live client parameters' using errcode='22023';
    end if;
    perform 1 from public.online_files f where f.id=target and f.snapshot_id=snapshot for key share;
    if not found then raise exception 'file unavailable' using errcode='42501'; end if;
    perform 1 from public.online_file_connections c where c.id=tab and c.file_id=target and c.session_id=auth_session
        and c.principal_id=actor and c.heard_at>figcraft_private.connection_cutoff() for key share;
    if not found then raise exception 'connection unavailable' using errcode='42501'; end if;
    if scanned_floor is not null then
        insert into figcraft_private.live_rooms(file_id,scanned_snapshot,highest_client)
            values(target,snapshot,scanned_floor) on conflict(file_id) do nothing;
    end if;
    select r.* into current_room from figcraft_private.live_rooms r where r.file_id=target for update;
    if not found then return null; end if;
    if current_room.scanned_snapshot<>snapshot then
        if scanned_floor is null then return null; end if;
        update figcraft_private.live_rooms set scanned_snapshot=snapshot, highest_client=greatest(highest_client,scanned_floor)
            where file_id=target returning * into current_room;
    end if;
    digest := decode(resume_hash,'hex');
    select c.client_id,c.connection_id into issued,prior_tab from figcraft_private.live_clients c
        where c.file_id=target and c.session_id=auth_session and c.resume_digest=digest;
    select c.client_id into bound from figcraft_private.live_clients c where c.connection_id=tab;
    if bound is not null and bound is distinct from issued then
        raise exception 'connection already bound' using errcode='42501';
    end if;
    if (prior_tab is null or not exists(select from public.online_file_connections p where p.id=prior_tab
            and p.heard_at>figcraft_private.connection_cutoff()))
        and (select count(*) from figcraft_private.live_clients c join public.online_file_connections p on p.id=c.connection_id
            where c.file_id=target and p.heard_at>figcraft_private.connection_cutoff())>=least(peer_limit,4096) then
        raise exception 'the session is full' using errcode='54000';
    end if;
    if issued is not null then
        update figcraft_private.live_clients set connection_id=tab where file_id=target and client_id=issued;
        if prior_tab is distinct from tab then
            delete from public.online_file_connections where id=prior_tab;
        end if;
        return jsonb_build_object('client',issued,'room',current_room.room_id);
    end if;
    if current_room.highest_client>=4294967294 then raise exception 'no client ids left in this session' using errcode='54000'; end if;
    issued := current_room.highest_client+1;
    update figcraft_private.live_rooms set highest_client=issued where file_id=target;
    insert into figcraft_private.live_clients(file_id,client_id,session_id,resume_digest,connection_id)
        values(target,issued,auth_session,digest,tab);
    if issued>65536 and (select count(*) from figcraft_private.live_clients c where c.file_id=target)>65536 then
        delete from figcraft_private.live_clients where file_id=target and client_id=(
            select c.client_id from figcraft_private.live_clients c where c.file_id=target and c.connection_id is null
            order by c.client_id limit 1);
    end if;
    return jsonb_build_object('client',issued,'room',current_room.room_id);
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

REVOKE ALL ON FUNCTION "figcraft_private"."issue_live_client"(uuid, uuid, uuid, uuid, uuid, text, bigint, integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."issue_live_client"(uuid, uuid, uuid, uuid, uuid, text, bigint, integer) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."issue_live_identity"(uuid, uuid, uuid, uuid, uuid, text, bigint, integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."issue_live_identity"(uuid, uuid, uuid, uuid, uuid, text, bigint, integer) TO "postgres", "service_role";
