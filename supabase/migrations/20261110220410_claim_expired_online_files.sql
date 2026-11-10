BEGIN;
SET local check_function_bodies = off;

CREATE TABLE "figcraft_private"."online_retirements" (
  "snapshot_id" uuid  NOT NULL,
  "owner_id"    text  NOT NULL,
  "token_hash"  bytea NOT NULL,
  CONSTRAINT "online_retirements_pkey" PRIMARY KEY (snapshot_id),
  CONSTRAINT "online_retirements_token_hash_check" CHECK ((octet_length(token_hash) = 32)),
  CONSTRAINT "online_retirements_token_hash_key" UNIQUE (token_hash)
);

ALTER TABLE "figcraft_private"."online_retirements"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."online_files"
  ADD COLUMN "published_without_key" boolean NOT NULL DEFAULT true;

ALTER TABLE "public"."online_files"
  ADD COLUMN "document_updated_at" timestamp WITH time zone;

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
            -- Read room activity in a new statement after acquiring this lock.
            select f.* into listing from public.online_files f where f.snapshot_id = target for update;
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

CREATE OR REPLACE FUNCTION figcraft_private.keep_online_publication (
  actor            uuid,
  target           uuid,
  snapshot         uuid,
  title            text,
  links            jsonb,
  verify_pair      boolean,
  address          inet,
  measured         bigint,
  max_files        integer DEFAULT 1000,
  max_files_per_ip integer DEFAULT 20,
  max_bytes_per_ip bigint  DEFAULT 268435456,
  max_total_bytes  bigint  DEFAULT '10737418240'::bigint
)
  RETURNS TABLE (
    id         uuid,
    name       text,
    created_at timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    existing boolean;
    stored_address inet;
    usage record;
    file_count bigint;
    total_bytes numeric;
begin
    -- Admission and reservation are one transaction across all host workers.
    perform pg_advisory_xact_lock(650130, 3);
    if exists (select from figcraft_private.online_retirements r where r.snapshot_id = snapshot) then
        raise exception 'this upload is being removed; retry publication' using errcode = '55000';
    end if;
    select exists(select from public.online_files f
        where f.id = target and f.owner_id = actor and f.snapshot_id = snapshot) into existing;
    if not existing then
        if address is null or measured is null or measured < 17 or max_files is null or max_files < 0
           or max_files_per_ip is null or max_files_per_ip < 0 or max_bytes_per_ip is null or max_bytes_per_ip < 0
           or max_total_bytes is null or max_total_bytes < 0 then
            raise exception 'invalid publication measurement or host limits' using errcode = '22023';
        end if;
        if exists(select from figcraft_private.unmeasured_online_files()) then
            raise exception 'retained sizes require measurement' using errcode = 'FC001';
        end if;
        select count(*), coalesce(sum(u.snapshot_bytes::numeric + u.log_bytes), 0)
        into file_count, total_bytes from figcraft_private.online_file_usage u;
        for usage in
            select b.block, b.multiplier, count(u.file_id) as files,
                coalesce(sum(u.snapshot_bytes::numeric + u.log_bytes), 0) as bytes
            from figcraft_private.publication_blocks(address) b left join figcraft_private.online_file_usage u
                on u.publisher <<= b.block
            group by b.block, b.multiplier order by b.multiplier
        loop
            if usage.multiplier = 1 then stored_address := usage.block::inet; end if;
            if usage.files >= max_files_per_ip::bigint * usage.multiplier then
                raise exception 'Your address has reached its retained file limit' using errcode = 'FC002';
            end if;
            if usage.bytes + measured > max_bytes_per_ip::numeric * usage.multiplier then
                raise exception 'Your address has reached its retained byte limit' using errcode = 'FC002';
            end if;
        end loop;
        if file_count >= max_files then
            raise exception 'This server has reached its retained file limit' using errcode = 'FC002';
        end if;
        if total_bytes + measured > max_total_bytes then
            raise exception 'This server has reached its retained byte limit' using errcode = 'FC002';
        end if;
    end if;
    return query select * from public.finalise_online_publication(actor,target,snapshot,title,links,verify_pair);
    if not existing then
        insert into figcraft_private.online_file_usage(file_id,publisher,snapshot_bytes)
            values(target,stored_address,measured);
    end if;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.online_file_expiry (
  created               numeric,
  changed               numeric,
  opened                numeric,
  idle_seconds          numeric,
  published_without_key boolean
)
  RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
    select case when published_without_key and idle_seconds > 0 then
        least(18446744073709551615::numeric, floor(greatest(created, changed, opened, 0)) + idle_seconds) end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.own_retired_snapshots()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$ select snapshot_id from figcraft_private.online_retirements where owner_id = (select auth.uid())::text; $function$;

CREATE OR REPLACE FUNCTION figcraft_private.presented_retirement()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    select snapshot_id from figcraft_private.online_retirements
    where token_hash = sha256(convert_to(nullif(current_setting('request.headers', true),'')::jsonb
        ->> 'x-figcraft-retirement','UTF8'));
$function$;

CREATE OR REPLACE FUNCTION public.claim_online_retirement (
  target       uuid,
  idle_seconds numeric DEFAULT 2592000
)
  RETURNS TABLE (
    object_path text,
    claim       text
  )
  LANGUAGE sql
  SET search_path TO ''
  AS $function$ select * from figcraft_private.claim_online_retirement(target,idle_seconds); $function$;

ALTER TABLE "figcraft_private"."online_retirements"
  ADD CONSTRAINT "online_retirements_snapshot_id_fkey" FOREIGN KEY (snapshot_id) REFERENCES storage.objects(id) ON DELETE CASCADE;

CREATE INDEX online_retirements_owner_idx ON figcraft_private.online_retirements USING btree (owner_id);

REVOKE ALL ON FUNCTION "figcraft_private"."claim_online_retirement"(uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."claim_online_retirement"(uuid, numeric) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."online_file_expiry"(numeric, numeric, numeric, numeric, boolean) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."online_file_expiry"(numeric, numeric, numeric, numeric, boolean) TO "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."own_retired_snapshots"() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."own_retired_snapshots"() TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."presented_retirement"() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."presented_retirement"() TO "anon", "postgres";

REVOKE ALL ON FUNCTION "public"."claim_online_retirement"(uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."claim_online_retirement"(uuid, numeric) TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."online_retirements" TO "postgres";
REVOKE ALL ON TABLE figcraft_private.online_retirements FROM PUBLIC, anon, authenticated, service_role;

-- pg-delta scopes application schemas. Capture the three policies on the managed Storage table explicitly.
DROP POLICY "Owners and current link sessions read snapshots" ON storage.objects;
create policy "Owners and current link sessions read snapshots" on storage.objects
    for select to authenticated
    using (bucket_id = 'figcraft-files' and (
        (owner_id = (select auth.uid())::text and (
            (select storage.allow_only_operation('object.delete_many'))
            or id not in (select figcraft_private.own_retired_snapshots())
        )) or (
            (select storage.allow_only_operation('object.get_authenticated'))
            and id in (select figcraft_private.shared_snapshot_ids())
        )
    ));

create policy "Retirement worker locates its exact object for deletion" on storage.objects
    for select to anon using (bucket_id = 'figcraft-files'
        and (select storage.allow_only_operation('object.delete_many'))
        and id = (select figcraft_private.presented_retirement()));
create policy "Retirement worker deletes its exact object" on storage.objects
    for delete to anon using (bucket_id = 'figcraft-files'
        and (select storage.allow_only_operation('object.delete_many'))
        and id = (select figcraft_private.presented_retirement()));

COMMIT;
