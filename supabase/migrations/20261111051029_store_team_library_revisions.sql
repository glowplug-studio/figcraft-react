SET local check_function_bodies = off;

DROP INDEX "figcraft_private"."online_code_budgets_age";

CREATE TABLE "figcraft_private"."team_libraries" (
  "file_id"       uuid          NOT NULL,
  "snapshot_id"   uuid          NOT NULL,
  "submission"    uuid          NOT NULL,
  "library_id"    text          NOT NULL,
  "name"          text          NOT NULL,
  "version"       numeric(20,0) NOT NULL,
  "archive_bytes" bigint        NOT NULL,
  CONSTRAINT "team_libraries_archive_bytes_check" CHECK ((archive_bytes > 0)),
  CONSTRAINT "team_libraries_library_id_check" CHECK ((library_id ~ '^[a-zA-Z0-9_-]{1,64}$'::text)),
  CONSTRAINT "team_libraries_name_check" CHECK ((char_length(name) <= 200)),
  CONSTRAINT "team_libraries_pkey" PRIMARY KEY (file_id),
  CONSTRAINT "team_libraries_snapshot_id_key" UNIQUE (snapshot_id),
  CONSTRAINT "team_libraries_version_check" CHECK (((version >= (0)::numeric) AND (version <= '18446744073709551615'::numeric)))
);

ALTER TABLE "figcraft_private"."team_libraries"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "figcraft_private"."online_code_budgets"
  ADD COLUMN "download_tokens" double precision;

ALTER TABLE "figcraft_private"."online_code_budgets"
  ADD COLUMN "download_used_at" timestamp WITH time zone;

ALTER TABLE "figcraft_private"."online_code_global"
  ADD COLUMN "download_tokens" double precision;

ALTER TABLE "figcraft_private"."online_code_global"
  ADD COLUMN "download_used_at" timestamp WITH time zone;

CREATE OR REPLACE FUNCTION figcraft_private.admission_bucket (
  b             cidr,
  participating cidr[],
  sampled       timestamp with time zone
)
  RETURNS figcraft_private.online_code_budgets
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
    budget figcraft_private.online_code_budgets;
begin
    select * into budget from figcraft_private.online_code_budgets where block = b;
    if found then return budget; end if;
    if (select count(*) from figcraft_private.online_code_budgets) >= 10000 then
        delete from figcraft_private.online_code_budgets where not (block = any(participating))
            and greatest(used_at,publish_used_at,report_used_at,admin_used_at,download_used_at) <= (select greatest(used_at,publish_used_at,report_used_at,admin_used_at,download_used_at)
            from figcraft_private.online_code_budgets order by greatest(used_at,publish_used_at,report_used_at,admin_used_at,download_used_at) offset 5000 limit 1);
    end if;
    insert into figcraft_private.online_code_budgets(block,tokens,used_at)
        values(b,case masklen(b) when 48 then 40 when 56 then 20 else 10 end,sampled) returning * into budget;
    return budget;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.admission_clock (
  sampled timestamp with time zone
)
  RETURNS timestamp WITH time zone
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
    perform pg_advisory_xact_lock(650130, 2);
    sampled := coalesce(sampled,clock_timestamp());
    if not exists(select from figcraft_private.online_code_global where store_started = pg_postmaster_start_time()) then
        delete from figcraft_private.online_code_budgets where block is not null;
        insert into figcraft_private.online_code_global(singleton,tokens,sampled_at,store_started)
            values(true,1000,sampled,pg_postmaster_start_time()) on conflict (singleton) do update
            set tokens = 1000, sampled_at = excluded.sampled_at, store_started = excluded.store_started,
                publish_tokens = null, publish_used_at = null, download_tokens = null, download_used_at = null;
    end if;
    return sampled;
end;
$function$;

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
    -- Eligible objects occupy one of the two immutable publication namespaces.
    select o.* into obj from storage.objects o where o.id=target and o.bucket_id='figcraft-files' and (
        (o.owner_id is not null and split_part(o.name,'/',1)=o.owner_id and
         o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]figcraft$') or
        (o.owner_id is null and
         o.name ~ '^(operator|library)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}[.]figcraft$'))
        for key share;
    if not found then return; end if;
    if exists(select from figcraft_private.team_libraries l where l.snapshot_id=target) then return; end if;
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
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.fetch_team_library (
  target         uuid,
  presented_hash text,
  have           text,
  address        inet
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    kept figcraft_private.team_libraries;
    path text;
begin
    perform 1 from public.online_files where id=target for key share;
    perform 1 from public.online_file_links where file_id=target and token_hash=presented_hash for key share;
    if not found then raise exception 'The invite is unavailable' using errcode='42501'; end if;
    select * into kept from figcraft_private.team_libraries where file_id=target;
    if not found then return jsonb_build_object('state','empty'); end if;
    if have=kept.version::text then return jsonb_build_object('state','unchanged','version',have); end if;
    if not figcraft_private.take_library_download(address,kept.archive_bytes,null) then return jsonb_build_object('state','busy'); end if;
    select name into strict path from storage.objects where id=kept.snapshot_id;
    return jsonb_build_object('state','available','version',kept.version::text,'path',path);
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.keep_team_library (
  target         uuid,
  presented_hash text,
  snapshot       uuid,
  submission_id  uuid,
  identity       text,
  title          text,
  revision       numeric,
  measured       bigint
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    listing public.online_files;
    prior figcraft_private.team_libraries;
    access text;
    policy record;
begin
    perform pg_advisory_xact_lock(650130,3);
    select * into listing from public.online_files where id=target for update;
    select l.access_level into access from public.online_file_links l where l.file_id=target and l.token_hash=presented_hash for key share;
    if access is null then raise exception 'The invite is unavailable' using errcode='42501'; end if;
    if access <> 'edit' then raise exception 'Publishing a team library requires an edit link' using errcode='42501'; end if;
    select * into policy from figcraft_private.host_publication_policy();
    if policy.open_publish and listing.owner_id is not null then
        raise exception 'Only files published with the server key can hold a team library on this public server' using errcode='42501';
    end if;
    if revision is null or revision<>trunc(revision) or revision not between 0 and 18446744073709551615
        or identity is null or identity !~ '^[a-zA-Z0-9_-]{1,64}$' or submission_id is null then
        raise exception 'Invalid team library manifest' using errcode='22023';
    end if;
    perform 1 from storage.objects o where o.id=snapshot and o.bucket_id='figcraft-files' and o.owner_id is null
        and o.name ~ ('^library/'||target::text||'/[0-9a-f]{64}[.]figcraft$') for key share;
    if not found or exists(select from figcraft_private.online_retirements where snapshot_id=snapshot) then
        raise exception 'The library upload is unavailable' using errcode='42501';
    end if;
    select * into prior from figcraft_private.team_libraries where file_id=target;
    if found then
        if prior.snapshot_id=snapshot and prior.submission=submission_id and prior.version=revision and prior.library_id=identity then
            return prior.version::text;
        end if;
        if prior.library_id<>identity then raise exception 'This file already holds a different team library' using errcode='FC003'; end if;
        if revision<>prior.version+1 then raise exception 'The next library version must follow %',prior.version using errcode='FC003'; end if;
    elsif revision>4294967296 then
        raise exception 'A first library version may be at most 4294967296' using errcode='FC003';
    end if;
    if measured is null or measured<1 or measured>policy.file_mb::bigint*1048576 then
        raise exception 'The library exceeds the host file size limit' using errcode='FC002';
    end if;
    insert into figcraft_private.team_libraries(file_id,snapshot_id,submission,library_id,name,version,archive_bytes)
        values(target,snapshot,submission_id,identity,title,revision,measured)
        on conflict(file_id) do update set snapshot_id=excluded.snapshot_id,submission=excluded.submission,
            name=excluded.name,version=excluded.version,archive_bytes=excluded.archive_bytes;
    return revision::text;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.take_library_download (
  address inet,
  amount  bigint,
  sampled timestamp with time zone
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    blocks cidr[];
    b cidr;
    budget figcraft_private.online_code_budgets;
    available double precision;
    rate double precision;
    burst double precision;
begin
    if address is null or amount is null or amount<0 then raise exception 'invalid download admission' using errcode='22023'; end if;
    sampled := figcraft_private.admission_clock(sampled);
    select array_agg(block order by multiplier) into blocks from figcraft_private.publication_blocks(address);
    foreach b in array blocks loop
        budget := figcraft_private.admission_bucket(b,blocks,sampled);
        rate := 1048576 * case masklen(b) when 48 then 4 when 56 then 2 else 1 end;
        burst := 16 * rate;
        available := least(burst,coalesce(budget.download_tokens,burst)
            + greatest(0,extract(epoch from sampled-budget.download_used_at))*rate);
        update figcraft_private.online_code_budgets set download_tokens=available,
            download_used_at=greatest(download_used_at,sampled) where block=b;
        if available < least(burst,amount) then return false; end if;
    end loop;
    -- Native take_spread can put a large request into debt at a full burst.
    -- Per-address admission is already spent if the global bucket refuses.
    update figcraft_private.online_code_budgets set download_tokens=download_tokens-amount where block=any(blocks);
    burst := 536870912;
    select least(burst,coalesce(download_tokens,burst)
        + greatest(0,extract(epoch from sampled-download_used_at))*33554432) into available
        from figcraft_private.online_code_global where singleton;
    update figcraft_private.online_code_global set download_tokens=available,
        download_used_at=greatest(download_used_at,sampled) where singleton;
    if available < least(burst,amount) then return false; end if;
    update figcraft_private.online_code_global set download_tokens=download_tokens-amount where singleton;
    return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fetch_team_library (
  target         uuid,
  presented_hash text,
  have           text,
  address        inet
)
  RETURNS jsonb
  LANGUAGE sql
  SET search_path TO ''
  AS $function$ select figcraft_private.fetch_team_library(target,presented_hash,have,address); $function$;

CREATE OR REPLACE FUNCTION public.keep_team_library (
  target         uuid,
  presented_hash text,
  snapshot       uuid,
  submission_id  uuid,
  identity       text,
  title          text,
  revision       numeric,
  measured       bigint
)
  RETURNS text
  LANGUAGE sql
  SET search_path TO ''
  AS $function$ select figcraft_private.keep_team_library(target,presented_hash,snapshot,submission_id,identity,title,revision,measured); $function$;

ALTER TABLE "figcraft_private"."team_libraries"
  ADD CONSTRAINT "team_libraries_file_id_fkey" FOREIGN KEY (file_id) REFERENCES public.online_files(id) ON DELETE CASCADE;

ALTER TABLE "figcraft_private"."team_libraries"
  ADD CONSTRAINT "team_libraries_snapshot_id_fkey" FOREIGN KEY (snapshot_id) REFERENCES storage.objects(id) ON DELETE CASCADE;

CREATE INDEX online_code_budgets_age ON figcraft_private.online_code_budgets USING btree (GREATEST(used_at, publish_used_at, report_used_at, admin_used_at, download_used_at));

REVOKE ALL ON FUNCTION "figcraft_private"."fetch_team_library"(uuid, text, text, inet) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."fetch_team_library"(uuid, text, text, inet) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."keep_team_library"(uuid, text, uuid, uuid, text, text, numeric, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."keep_team_library"(uuid, text, uuid, uuid, text, text, numeric, bigint) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."take_library_download"(inet, bigint, timestamp WITH time zone) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."take_library_download"(inet, bigint, timestamp WITH time zone) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fetch_team_library"(uuid, text, text, inet) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."fetch_team_library"(uuid, text, text, inet) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."keep_team_library"(uuid, text, uuid, uuid, text, text, numeric, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."keep_team_library"(uuid, text, uuid, uuid, text, text, numeric, bigint) TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."team_libraries" TO "postgres";
