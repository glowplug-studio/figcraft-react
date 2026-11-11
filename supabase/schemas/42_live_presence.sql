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

create function figcraft_private.live_presence_targets(actor uuid, login uuid, tab uuid, target uuid, anonymous_name boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
    sender bigint;
    registration figcraft_private.live_presence_connections;
    used smallint[];
    targets jsonb;
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
    select coalesce(jsonb_agg('figcraft-connection:'||c.session_id::text||':'||c.id::text),'[]'::jsonb)
        into targets from public.online_file_connections c
        join figcraft_private.live_clients lc on lc.connection_id=c.id and lc.file_id=c.file_id
        where c.file_id=target and c.id<>tab and c.heard_at>figcraft_private.connection_cutoff();
    return jsonb_build_object('client',sender,'colour',registration.colour,'guest',registration.guest_number,
        'generation',(extract(epoch from registration.generation)*1000000)::bigint::text,'targets',targets);
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
