-- Native load touches a room on first admission; idle touches it after the
-- last member leaves. Keep one row per file, irrespective of heartbeat rate.
create table figcraft_private.online_room_activity (
    file_id uuid primary key references public.online_files(id) on delete cascade,
    members bigint not null check (members >= 0),
    opened_at timestamptz not null,
    latest_departure timestamptz
);
alter table figcraft_private.online_room_activity enable row level security;
revoke all on figcraft_private.online_room_activity from public, anon, authenticated, service_role;

create function figcraft_private.track_room_activity() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
    departed timestamptz;
begin
    if tg_op = 'INSERT' then
        insert into figcraft_private.online_room_activity as room (file_id, members, opened_at)
            values (new.file_id, 1, new.heard_at)
            on conflict (file_id) do update set
                members = room.members + 1,
                opened_at = case when room.members = 0 then greatest(room.opened_at, excluded.opened_at)
                    else room.opened_at end,
                latest_departure = case when room.members = 0 then null else room.latest_departure end;
    else
        -- Late cleanup must date a silent departure at its deadline. A database
        -- restart ends previous connections even when their deadline was later.
        departed := least(clock_timestamp(), old.heard_at + interval '45 seconds',
            case when old.heard_at <= pg_postmaster_start_time() then pg_postmaster_start_time() end);
        update figcraft_private.online_room_activity set
            members = members - 1,
            latest_departure = greatest(latest_departure, departed),
            opened_at = case when members = 1 then greatest(opened_at, latest_departure, departed)
                else opened_at end
            where file_id = old.file_id;
    end if;
    return null;
end;
$$;
revoke all on function figcraft_private.track_room_activity() from public, anon, authenticated, service_role;

create trigger track_online_room_activity after insert or delete on public.online_file_connections
    for each row execute function figcraft_private.track_room_activity();
