-- Session allocation only. Pointer positions, selections, display names and signals are never written here.
alter table figcraft_private.live_rooms add column guest_names_issued bigint not null default 0;
create table figcraft_private.live_presence_connections (
    connection_id uuid primary key references public.online_file_connections(id) on delete cascade,
    colour smallint not null check (colour between 0 and 7),
    guest_number bigint,
    generation timestamptz not null default clock_timestamp()
);
alter table figcraft_private.live_presence_connections enable row level security;
revoke all on figcraft_private.live_presence_connections from public,anon,authenticated,service_role;

create function figcraft_private.live_recipient_topics(target uuid, tab uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
    select coalesce(jsonb_agg('figcraft-connection:'||c.session_id::text||':'||c.id::text),'[]'::jsonb)
        from public.online_file_connections c
        join figcraft_private.live_clients lc on lc.connection_id=c.id and lc.file_id=c.file_id
        where c.file_id=target and c.id<>tab and c.heard_at>figcraft_private.connection_cutoff();
$$;
revoke all on function figcraft_private.live_recipient_topics(uuid,uuid) from public,anon,authenticated,service_role;

create function figcraft_private.live_presence_targets(actor uuid, login uuid, tab uuid, target uuid, anonymous_name boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
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
$$;
revoke all on function figcraft_private.live_presence_targets(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function figcraft_private.live_presence_targets(uuid,uuid,uuid,uuid,boolean) to service_role;

create function public.live_presence_targets(actor uuid, login uuid, tab uuid, target uuid, anonymous_name boolean)
returns jsonb language sql security invoker set search_path='' as $$
    select figcraft_private.live_presence_targets(actor,login,tab,target,anonymous_name);
$$;
revoke all on function public.live_presence_targets(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.live_presence_targets(uuid,uuid,uuid,uuid,boolean) to service_role;

-- Capture the current physical generation before the foreign keys clear its allocation.
create function figcraft_private.leave_live_connection(actor uuid, login uuid, tab uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
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
$$;
revoke all on function figcraft_private.leave_live_connection(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function figcraft_private.leave_live_connection(uuid,uuid,uuid) to service_role;

create function public.leave_live_connection(actor uuid, login uuid, tab uuid)
returns jsonb language sql security invoker set search_path='' as $$
    select figcraft_private.leave_live_connection(actor,login,tab);
$$;
revoke all on function public.leave_live_connection(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.leave_live_connection(uuid,uuid,uuid) to service_role;

-- A welcome needs the current display names before peers send their next pointer sample.
-- Only a live grant can read this roster. Leaving the physical connection removes its name.
create unlogged table figcraft_private.live_peer_names (
    connection_id uuid primary key references figcraft_private.live_presence_connections(connection_id) on delete cascade,
    display_name text not null check(char_length(display_name) between 1 and 64)
);
alter table figcraft_private.live_peer_names enable row level security;
revoke all on figcraft_private.live_peer_names from public,anon,authenticated,service_role;

create function figcraft_private.live_participants(actor uuid,login uuid,tab uuid,target uuid,display text,welcome boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
    receipt jsonb;
    peers jsonb;
    actual text;
begin
    if display is null or char_length(display)>64 or display ~ '[[:cntrl:]]' then
        raise exception 'invalid display name' using errcode='22023';
    end if;
    receipt:=figcraft_private.live_presence_targets(actor,login,tab,target,display='');
    actual:=coalesce(nullif(display,''),'Guest '||coalesce(receipt->>'guest',receipt->>'client'));
    if not exists(select 1 from figcraft_private.live_peer_names n where n.connection_id=tab and n.display_name=actual) then
        insert into figcraft_private.live_peer_names as n(connection_id,display_name) values(tab,actual)
            on conflict(connection_id) do update set display_name=excluded.display_name where n.display_name<>excluded.display_name;
    end if;
    if welcome then
        select coalesce(jsonb_agg(jsonb_build_object('client',lc.client_id,'colour',pc.colour,'name',n.display_name,
            'generation',(extract(epoch from pc.generation)*1000000)::bigint::text) order by lc.client_id),'[]'::jsonb)
        into peers from figcraft_private.live_clients lc
        join public.online_file_connections c on c.id=lc.connection_id and c.file_id=lc.file_id
        join figcraft_private.live_presence_connections pc on pc.connection_id=c.id
        join figcraft_private.live_peer_names n on n.connection_id=c.id
        where c.file_id=target and c.id<>tab and c.heard_at>figcraft_private.connection_cutoff();
    end if;
    return receipt||jsonb_build_object('name',actual,'peers',peers);
end;
$$;
revoke all on function figcraft_private.live_participants(uuid,uuid,uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function figcraft_private.live_participants(uuid,uuid,uuid,uuid,text,boolean) to service_role;

create function public.live_participants(actor uuid,login uuid,tab uuid,target uuid,display text,welcome boolean)
returns jsonb language sql security invoker set search_path='' as $$
    select figcraft_private.live_participants(actor,login,tab,target,display,welcome);
$$;
revoke all on function public.live_participants(uuid,uuid,uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.live_participants(uuid,uuid,uuid,uuid,text,boolean) to service_role;
