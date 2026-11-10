-- The same database supplies host expiry information and schedules cleanup.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table figcraft_private.online_retention_settings (
    singleton boolean primary key default true check (singleton),
    idle_seconds numeric not null check (idle_seconds = trunc(idle_seconds)
        and idle_seconds between 0 and 18446744073709551615::numeric)
);
alter table figcraft_private.online_retention_settings enable row level security;
revoke all on figcraft_private.online_retention_settings from public, anon, authenticated, service_role;

create function figcraft_private.host_idle_seconds() returns numeric
language sql stable security definer set search_path = ''
as $$ select coalesce((select idle_seconds from figcraft_private.online_retention_settings where singleton),2592000); $$;
revoke all on function figcraft_private.host_idle_seconds() from public, anon, authenticated, service_role;

create function figcraft_private.sweep_online_files() returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
    api text;
    publishable text;
    target uuid;
    receipt record;
    dispatched integer := 0;
    idle numeric := figcraft_private.host_idle_seconds();
begin
    if not pg_try_advisory_xact_lock(650130, 4) then return 0; end if;
    select decrypted_secret into api from vault.decrypted_secrets where name = 'figcraft_storage_api_url';
    select decrypted_secret into publishable from vault.decrypted_secrets where name = 'figcraft_storage_publishable_key';
    if nullif(api,'') is null or publishable is null or not starts_with(publishable,'sb_publishable_') then
        return 0;
    end if;

    -- Take the same publication lock before reclaiming rows or admitting
    -- individual claims. Network requests only leave the queue after commit.
    perform pg_advisory_xact_lock(650130, 3);
    delete from public.online_file_connections where heard_at <= figcraft_private.connection_cutoff();
    for target in
        select o.id from storage.objects o
        left join public.online_files f on f.snapshot_id = o.id
        left join figcraft_private.online_room_activity a on a.file_id = f.id
        left join figcraft_private.online_retirements r on r.snapshot_id = o.id
        where o.bucket_id = 'figcraft-files' and (
            r.snapshot_id is not null
            or (f.id is null and o.created_at <= statement_timestamp() - interval '10 minutes')
            or (f.id is not null and coalesce(a.members,0) = 0 and
                figcraft_private.online_file_expiry(extract(epoch from f.created_at),
                    extract(epoch from f.document_updated_at), extract(epoch from a.opened_at),
                    idle, f.published_without_key) <= floor(extract(epoch from statement_timestamp())))
        ) order by o.id
    loop
        begin
            select * into receipt from figcraft_private.claim_online_retirement(target,idle);
            if found then
                perform net.http_delete(
                    url := rtrim(api,'/') || '/object/figcraft-files',
                    headers := jsonb_build_object('apikey',publishable,'content-type','application/json',
                        'x-figcraft-retirement',receipt.claim),
                    body := jsonb_build_object('prefixes',jsonb_build_array(receipt.object_path)));
                dispatched := dispatched + 1;
            end if;
        exception when others then
            -- A corrupt or concurrently removed item cannot roll back the rest.
            raise warning 'Figcraft cleanup failed on object % (SQLSTATE %)', target, sqlstate;
        end;
    end loop;
    return dispatched;
end;
$$;
revoke all on function figcraft_private.sweep_online_files() from public, anon, authenticated, service_role;

-- Cron jobs are configuration rows, outside a pg-delta schema diff.
select cron.schedule('figcraft-online-expiry','*/10 * * * *','select figcraft_private.sweep_online_files()');
select cron.schedule('figcraft-online-expiry-startup','@reboot','select figcraft_private.sweep_online_files()');
