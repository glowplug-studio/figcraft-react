-- Physical addresses are available only to the database functions that admit and remove peers.
create unlogged table figcraft_private.live_connection_addresses (
    connection_id uuid primary key references public.online_file_connections(id) on delete cascade,
    address inet not null
);
create unlogged table figcraft_private.live_barred_addresses (
    file_id uuid not null references figcraft_private.live_rooms(file_id) on delete cascade,
    address inet not null,
    primary key (file_id,address)
);
alter table figcraft_private.live_connection_addresses enable row level security;
alter table figcraft_private.live_barred_addresses enable row level security;
revoke all on figcraft_private.live_connection_addresses,figcraft_private.live_barred_addresses from public,anon,authenticated,service_role;

-- The journal survives idle rooms. The native hub's per-file address set does not.
create function figcraft_private.clear_idle_live_addresses() returns trigger
language plpgsql security definer set search_path='' as $$
begin
    delete from figcraft_private.live_barred_addresses where file_id=new.file_id;
    return null;
end;
$$;
revoke all on function figcraft_private.clear_idle_live_addresses() from public,anon,authenticated,service_role;
create trigger clear_idle_live_addresses after update of members on figcraft_private.online_room_activity
    for each row when (new.members=0) execute function figcraft_private.clear_idle_live_addresses();

create function figcraft_private.admit_live_address(actor uuid,auth_session uuid,tab uuid,target uuid,
    presented_hash text,resume_hash text,peer_limit integer,scanned_snapshot uuid,scanned_floor bigint,address inet)
returns jsonb language plpgsql security definer set search_path='' as $$
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
$$;
revoke all on function figcraft_private.admit_live_address(uuid,uuid,uuid,uuid,text,text,integer,uuid,bigint,inet) from public,anon,authenticated,service_role;
grant execute on function figcraft_private.admit_live_address(uuid,uuid,uuid,uuid,text,text,integer,uuid,bigint,inet) to service_role;

create function public.join_live_file_at_address(actor uuid,auth_session uuid,tab uuid,target uuid,presented_hash text,
    resume_hash text,peer_limit integer,scanned_snapshot uuid,scanned_floor bigint,address inet)
returns jsonb language sql security invoker set search_path='' as $$
    select figcraft_private.admit_live_address(actor,auth_session,tab,target,presented_hash,resume_hash,peer_limit,scanned_snapshot,scanned_floor,address);
$$;
revoke all on function public.join_live_file_at_address(uuid,uuid,uuid,uuid,text,text,integer,uuid,bigint,inet) from public,anon,authenticated,service_role;
grant execute on function public.join_live_file_at_address(uuid,uuid,uuid,uuid,text,text,integer,uuid,bigint,inet) to service_role;

create function public.join_live_file(actor uuid,auth_session uuid,tab uuid,target uuid,presented_hash text,
    resume_hash text,peer_limit integer default 256,scanned_snapshot uuid default null,scanned_floor bigint default null)
returns jsonb language sql security invoker set search_path='' as $$
    select figcraft_private.admit_live_address(actor,auth_session,tab,target,presented_hash,resume_hash,peer_limit,scanned_snapshot,scanned_floor,'127.0.0.1'::inet);
$$;
revoke all on function public.join_live_file(uuid,uuid,uuid,uuid,text,text,integer,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.join_live_file(uuid,uuid,uuid,uuid,text,text,integer,uuid,bigint) to service_role;

-- The host verifies any operator key. Regular callers must own the file and have a current
-- physical connection in it. Removal locks the same room as resume and journal admission.
create function figcraft_private.remove_live_participant(actor uuid,login uuid,tab uuid,target uuid,peer bigint,
    server_operator boolean) returns jsonb language plpgsql security definer set search_path='' as $$
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
$$;
revoke all on function figcraft_private.remove_live_participant(uuid,uuid,uuid,uuid,bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function figcraft_private.remove_live_participant(uuid,uuid,uuid,uuid,bigint,boolean) to service_role;

create function public.remove_live_participant(actor uuid,login uuid,tab uuid,target uuid,peer bigint,server_operator boolean default false)
returns jsonb language sql security invoker set search_path='' as $$
    select figcraft_private.remove_live_participant(actor,login,tab,target,peer,server_operator);
$$;
revoke all on function public.remove_live_participant(uuid,uuid,uuid,uuid,bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function public.remove_live_participant(uuid,uuid,uuid,uuid,bigint,boolean) to service_role;
