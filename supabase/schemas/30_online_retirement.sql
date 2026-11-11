-- Removing a listing stops serving the drawing immediately. The claim stays
-- until Storage removes the exact object, including after a worker restart.
create table figcraft_private.online_retirements (
    snapshot_id uuid primary key references storage.objects(id) on delete cascade,
    owner_id text not null,
    token_hash bytea not null unique check (octet_length(token_hash) = 32)
);
create index online_retirements_owner_idx on figcraft_private.online_retirements(owner_id);
alter table figcraft_private.online_retirements enable row level security;
revoke all on figcraft_private.online_retirements from public, anon, authenticated, service_role;

create function figcraft_private.own_retired_snapshots() returns setof uuid
language sql stable security definer set search_path = ''
as $$ select snapshot_id from figcraft_private.online_retirements where owner_id = (select auth.uid())::text; $$;
revoke all on function figcraft_private.own_retired_snapshots() from public, anon, authenticated, service_role;
grant execute on function figcraft_private.own_retired_snapshots() to authenticated;

create function figcraft_private.presented_retirement() returns uuid
language sql stable security definer set search_path = ''
as $$
    select snapshot_id from figcraft_private.online_retirements
    where token_hash = sha256(convert_to(nullif(current_setting('request.headers', true),'')::jsonb
        ->> 'x-figcraft-retirement','UTF8'));
$$;
revoke all on function figcraft_private.presented_retirement() from public, anon, authenticated, service_role;
grant execute on function figcraft_private.presented_retirement() to anon;

create policy "Retirement worker locates its exact object for deletion" on storage.objects
    for select to anon using (bucket_id = 'figcraft-files'
        and (select storage.allow_only_operation('object.delete_many'))
        and id = (select figcraft_private.presented_retirement()));
create policy "Retirement worker deletes its exact object" on storage.objects
    for delete to anon using (bucket_id = 'figcraft-files'
        and (select storage.allow_only_operation('object.delete_many'))
        and id = (select figcraft_private.presented_retirement()));

-- Store::expires uses whole Unix seconds and saturating u64 addition.
create function figcraft_private.online_file_expiry(created numeric, changed numeric, opened numeric,
    idle_seconds numeric, published_without_key boolean) returns numeric
language sql immutable security invoker set search_path = ''
as $$
    select case when published_without_key and idle_seconds > 0 then
        least(18446744073709551615::numeric, floor(greatest(created, changed, opened, 0)) + idle_seconds) end;
$$;
revoke all on function figcraft_private.online_file_expiry(numeric,numeric,numeric,numeric,boolean)
    from public, anon, authenticated, service_role;

create function figcraft_private.claim_online_retirement(target uuid, idle_seconds numeric)
returns table(object_path text, claim text)
language plpgsql security definer set search_path = ''
as $$
declare
    obj storage.objects;
    listing public.online_files;
    room figcraft_private.online_room_activity;
    deadline numeric;
    secret text;
begin
    if idle_seconds is null or idle_seconds <> trunc(idle_seconds) or
        idle_seconds not between 0 and 18446744073709551615::numeric then
        raise exception 'invalid idle period' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(650130, 3);
    -- Eligible objects occupy one of the two immutable publication namespaces.
    select o.* into obj from storage.objects o where o.id=target and o.bucket_id='figcraft-files' and (
        (o.owner_id is not null and split_part(o.name,'/',1)=o.owner_id and
         o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]figcraft$') or
        (o.owner_id is null and
         o.name ~ '^operator/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}[.]figcraft$'))
        for key share;
    if not found then return; end if;
    if not exists(select from figcraft_private.online_retirements where snapshot_id = target) then
        select f.* into listing from public.online_files f where f.snapshot_id = target;
        if found then
            if not listing.published_without_key then return; end if;
            if obj.name <> (listing.owner_id::text || '/' || listing.id::text || '.figcraft') then return; end if;
            delete from public.online_file_connections where file_id = listing.id
                and heard_at <= figcraft_private.connection_cutoff();
            -- Admission holds a file key-share lock through the grant insert.
            -- Skip an in-flight open or removal. Waiting here could deadlock
            -- with an admission that is reclaiming the same stale connections.
            -- Re-read room activity only after acquiring the listing lock.
            select f.* into listing from public.online_files f where f.snapshot_id = target for update skip locked;
            if not found then return; end if;
            select * into room from figcraft_private.online_room_activity where file_id = listing.id;
            if room.members > 0 then return; end if;
            deadline := figcraft_private.online_file_expiry(extract(epoch from listing.created_at),
                extract(epoch from listing.document_updated_at), extract(epoch from room.opened_at),
                idle_seconds, listing.published_without_key);
            if deadline is null or deadline > floor(extract(epoch from statement_timestamp())) then return; end if;
            delete from public.online_files where id = listing.id and snapshot_id = target;
        elsif obj.created_at is null or obj.created_at > statement_timestamp() - interval '10 minutes' then
            -- Give the two-request browser publication one complete sweep
            -- interval. A device retains its bytes until finalisation succeeds.
            return;
        end if;
    end if;
    secret := encode(extensions.gen_random_bytes(32),'hex');
    insert into figcraft_private.online_retirements(snapshot_id, owner_id, token_hash)
        values(target, coalesce(obj.owner_id,'operator'), sha256(convert_to(secret,'UTF8')))
        on conflict(snapshot_id) do update set token_hash=excluded.token_hash;
    return query select obj.name, secret;
end;
$$;
revoke all on function figcraft_private.claim_online_retirement(uuid,numeric) from public, anon, authenticated, service_role;

-- Privileged workers request one retryable capability; Storage executes the
-- delete using the publishable client and its two operation-scoped policies.
create function public.claim_online_retirement(target uuid, idle_seconds numeric default 2592000)
returns table(object_path text, claim text)
language sql volatile security invoker set search_path = ''
as $$ select * from figcraft_private.claim_online_retirement(target,idle_seconds); $$;
revoke all on function public.claim_online_retirement(uuid,numeric) from public, anon, authenticated, service_role;
grant execute on function public.claim_online_retirement(uuid,numeric), figcraft_private.claim_online_retirement(uuid,numeric)
    to service_role;
