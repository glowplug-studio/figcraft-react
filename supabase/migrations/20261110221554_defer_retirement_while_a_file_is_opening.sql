SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION figcraft_private.claim_online_retirement (
  target       uuid,
  idle_seconds numeric
)
  RETURNS TABLE (
    object_path text,
    claim       text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
    -- Match Storage deletion's object-before-listing order. Only Figcraft's
    -- immutable owner/UUID namespace participates in staging recovery.
    select o.* into obj from storage.objects o where o.id = target
        and o.bucket_id = 'figcraft-files' and o.owner_id is not null
        and split_part(o.name,'/',1) = o.owner_id
        and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]figcraft$'
        for key share;
    if not found then return; end if;
    if not exists(select from figcraft_private.online_retirements where snapshot_id = target) then
        select f.* into listing from public.online_files f where f.snapshot_id = target;
        if found then
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
        values(target, obj.owner_id, sha256(convert_to(secret,'UTF8')))
        on conflict(snapshot_id) do update set token_hash=excluded.token_hash;
    return query select obj.name, secret;
end;
$function$;
