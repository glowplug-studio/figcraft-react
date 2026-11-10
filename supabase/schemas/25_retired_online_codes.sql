-- Native keeps the most recent 10,000 retired lookup digests for the life
-- of its store. Next.js workers share the database as their store process.
create table figcraft_private.retired_online_codes (
    slot integer primary key check (slot between 0 and 9999),
    serial_number bigint not null unique,
    code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
    store_started timestamptz not null default pg_postmaster_start_time()
);
create index retired_online_codes_lookup on figcraft_private.retired_online_codes(code_hash, store_started);
alter table figcraft_private.retired_online_codes enable row level security;
revoke all on figcraft_private.retired_online_codes from public, anon, authenticated, service_role;

create function figcraft_private.retire_online_code() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
    next_serial bigint;
begin
    -- Serialise the append across files. Rolled-back grant changes consume no slots.
    perform pg_advisory_xact_lock(650130, 1);
    select coalesce(max(serial_number) + 1, 0) into next_serial from figcraft_private.retired_online_codes;
    insert into figcraft_private.retired_online_codes as ring(slot, serial_number, code_hash)
        values (next_serial % 10000, next_serial, old.code_hash)
        on conflict (slot) do update set serial_number = excluded.serial_number,
            code_hash = excluded.code_hash, store_started = excluded.store_started;
    return null;
end;
$$;
revoke all on function figcraft_private.retire_online_code() from public, anon, authenticated, service_role;
create trigger retire_deleted_online_code after delete on public.online_file_links
    for each row when (old.code_hash is not null) execute function figcraft_private.retire_online_code();
create trigger retire_replaced_online_code after update of code_hash on public.online_file_links
    for each row when (old.code_hash is not null and old.code_hash is distinct from new.code_hash)
    execute function figcraft_private.retire_online_code();
