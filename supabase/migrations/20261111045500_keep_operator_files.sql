SET local check_function_bodies = off;

DROP FUNCTION "public"."online_host_information"(uuid);

CREATE TABLE "figcraft_private"."online_publication_policy" (
  "singleton"         boolean NOT NULL DEFAULT true,
  "open_publish"      boolean NOT NULL DEFAULT true,
  "server_key_sha256" text,
  "max_file_mb"       integer,
  CONSTRAINT "online_publication_policy_max_file_mb_check" CHECK (((max_file_mb >= 1) AND (max_file_mb <= 4096))),
  CONSTRAINT "online_publication_policy_pkey" PRIMARY KEY (singleton),
  CONSTRAINT "online_publication_policy_server_key_sha256_check" CHECK ((server_key_sha256 ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "online_publication_policy_singleton_check" CHECK (singleton)
);

ALTER TABLE "figcraft_private"."online_publication_policy"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."online_files"
  ALTER COLUMN "owner_id" DROP NOT NULL;

CREATE OR REPLACE FUNCTION figcraft_private.admit_keyed_publication (
  address inet
)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$ select figcraft_private.take_admin_request(address,null); $function$;

CREATE OR REPLACE FUNCTION figcraft_private.apply_addressed_share_change (
  actor      uuid,
  target     uuid,
  expected   uuid,
  revision   uuid,
  revoke_ids text[],
  new_links  jsonb,
  address    inet
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    current_revision uuid;
    changes integer;
begin
    if revoke_ids is null or cardinality(revoke_ids)>3 or jsonb_typeof(new_links) is distinct from 'array'
        or revision is null then raise exception 'invalid sharing change' using errcode='22023'; end if;
    if jsonb_array_length(new_links) not in (0,3) then raise exception 'invalid sharing change' using errcode='22023'; end if;
    -- Reports hold file/key-share before spending admission credit. Exclude
    -- that lock before taking the budget lock and later revoking guest links.
    perform 1 from public.online_files f where f.id=target and f.owner_id is not distinct from actor for update;
    if not found then raise exception 'this file is unavailable' using errcode='42501'; end if;
    select c.revision into current_revision from public.online_file_share_changes c where c.file_id=target;
    if current_revision is distinct from revision and current_revision is not distinct from expected then
        changes := cardinality(revoke_ids) + 2 * jsonb_array_length(new_links);
        for request in 1..changes loop
            if not figcraft_private.take_admin_request(address,null) then return false; end if;
        end loop;
    end if;
    perform public.apply_online_share_change(actor,target,expected,revision,revoke_ids,new_links);
    return true;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.change_online_file_links (
  actor      uuid,
  target     uuid,
  revoke_ids text[],
  new_links  jsonb,
  link_limit numeric
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
    retained bigint;
begin
    perform 1 from public.online_files where id = target and owner_id is not distinct from actor for no key update;
    if not found then
        raise exception 'this file is unavailable' using errcode = '42501';
    end if;
    if revoke_ids is null or new_links is null or jsonb_typeof(new_links) <> 'array'
            or link_limit is null or link_limit < 0 then
        raise exception 'invalid link change' using errcode = '22023';
    end if;

    if exists (
        select 1 from unnest(revoke_ids) as requested(id)
        where not exists (
            select 1 from public.online_file_links as link where link.file_id = target and link.id = requested.id
        )
    ) then
        raise exception 'that file has no such link' using errcode = '22023';
    end if;
    delete from public.online_file_links where file_id = target and id = any(revoke_ids);
    select count(*) into retained from public.online_file_links where file_id = target;
    if jsonb_array_length(new_links) > greatest(0, link_limit - retained) then
        raise exception 'a file has at most % links: revoke one first', link_limit using errcode = '22023';
    end if;

    insert into public.online_file_links (id, file_id, access_level, label, token_hash, code_hash, wrapped_token)
    select item.id, target, item.access_level, item.label, item.token_hash, item.code_hash, item.wrapped_token
    from jsonb_to_recordset(new_links) as item(
        id text, access_level text, label text, token_hash text, code_hash text, wrapped_token text
    );
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
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.host_publication_policy()
  RETURNS TABLE (
    open_publish boolean,
    file_mb      integer
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    select coalesce(p.open_publish,true),
        coalesce(p.max_file_mb,case when p.open_publish is false then 64 else 16 end)
    from (values(true)) as defaults(singleton)
    left join figcraft_private.online_publication_policy p using(singleton);
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
    policy record;
begin
    -- Admission and reservation are one transaction across all host workers.
    perform pg_advisory_xact_lock(650130, 3);
    if exists (select from figcraft_private.online_retirements r where r.snapshot_id = snapshot) then
        raise exception 'this upload is being removed; retry publication' using errcode = '55000';
    end if;
    select exists(select from public.online_files f
        where f.id = target and f.owner_id = actor and f.snapshot_id = snapshot) into existing;
    if not existing then
        select * into policy from figcraft_private.host_publication_policy();
        if actor is null or not policy.open_publish then
            raise exception 'This server takes files only from people who have its key' using errcode = '42501';
        end if;
        if measured > policy.file_mb::bigint * 1048576 then
            raise exception 'This server keeps files up to % MiB',policy.file_mb using errcode = 'FC002';
        end if;
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

CREATE OR REPLACE FUNCTION figcraft_private.keep_operator_publication (
  target    uuid,
  snapshot  uuid,
  title     text,
  links     jsonb,
  measured  bigint,
  max_files integer DEFAULT 1000
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
    existing public.online_files;
    policy record;
begin
    perform pg_advisory_xact_lock(650130,3);
    perform 1 from storage.objects o where o.id=snapshot and o.bucket_id='figcraft-files' and o.owner_id is null
        and o.name ~ ('^operator/' || target::text || '/[0-9a-f]{64}[.]figcraft$') for key share;
    if not found or exists(select from figcraft_private.online_retirements r where r.snapshot_id=snapshot) then
        raise exception 'operator upload is unavailable' using errcode='42501';
    end if;
    select f.* into existing from public.online_files f where f.id=target;
    if found then
        if existing.owner_id is not null or existing.snapshot_id<>snapshot or existing.published_without_key then
            raise exception 'this file already has a different publication receipt' using errcode='22023';
        end if;
    else
        select * into policy from figcraft_private.host_publication_policy();
        if measured is null or measured<17 or max_files is null or max_files<1 then
            raise exception 'invalid operator publication measurement' using errcode='22023';
        end if;
        if measured > policy.file_mb::bigint * 1048576 or (select count(*) from public.online_files)>=max_files then
            raise exception 'This server has reached its file size or count limit' using errcode='FC002';
        end if;
    end if;
    return query select * from public.finalise_online_publication(null,target,snapshot,title,links,true);
    if existing.id is null then
        insert into figcraft_private.online_file_usage(file_id,publisher,snapshot_bytes) values(target,null,measured);
    end if;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.operator_publication_verifier()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$ select server_key_sha256 from figcraft_private.online_publication_policy where singleton; $function$;

CREATE OR REPLACE FUNCTION public.admit_keyed_publication (
  address inet
)
  RETURNS boolean
  LANGUAGE sql
  SET search_path TO ''
  AS $function$ select figcraft_private.admit_keyed_publication(address); $function$;

CREATE OR REPLACE FUNCTION public.apply_online_share_change (
  actor      uuid,
  target     uuid,
  expected   uuid,
  revision   uuid,
  revoke_ids text[],
  new_links  jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
    prior public.online_file_share_changes;
    fingerprint text;
begin
    perform 1 from public.online_files f where f.id = target and f.owner_id is not distinct from actor for no key update;
    if not found then raise exception 'this file is unavailable' using errcode = '42501'; end if;
    if revision is null or revision = expected or new_links is null or jsonb_typeof(new_links) <> 'array'
        or revoke_ids is null then raise exception 'invalid sharing change' using errcode = '22023'; end if;

    select * into prior from public.online_file_share_changes c where c.file_id = target;
    fingerprint := encode(sha256(convert_to(jsonb_build_array(expected, revoke_ids, new_links)::text, 'UTF8')), 'hex');
    if prior.revision = revision then
        if prior.proof <> fingerprint then raise exception 'different sharing change' using errcode = '22023'; end if;
        return;
    end if;
    if prior.revision is distinct from expected then raise exception 'sharing changed elsewhere' using errcode = '40001'; end if;

    if jsonb_array_length(new_links) <> 0 and (jsonb_array_length(new_links) <> 3 or
        (select array_agg(v->>'access_level' order by v->>'access_level') from jsonb_array_elements(new_links) v)
        is distinct from array['comment','edit','view']::text[] or
        exists (select 1 from jsonb_array_elements(new_links) v where v->>'code_hash' is null or v->>'wrapped_token' is null
            or v->>'label' is distinct from ('Shared (' || (v->>'access_level') || ')'))) then
        raise exception 'invalid shared links' using errcode = '22023';
    end if;
    if exists (select 1 from public.online_file_links l where l.file_id = target and l.id = any(revoke_ids)
        and l.label is distinct from ('Shared (' || l.access_level || ')')) then
        raise exception 'only shared links may be stopped' using errcode = '22023';
    end if;
    perform figcraft_private.change_online_file_links(actor, target, revoke_ids, new_links, figcraft_private.host_link_limit());
    insert into public.online_file_share_changes as c (file_id, revision, proof)
        values (target, revision, fingerprint) on conflict (file_id)
        do update set revision = excluded.revision, proof = excluded.proof;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalise_online_publication (
  actor       uuid,
  target      uuid,
  snapshot    uuid,
  title       text,
  links       jsonb,
  verify_pair boolean
)
  RETURNS TABLE (
    id         uuid,
    name       text,
    created_at timestamp with time zone
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
    listing public.online_files;
    fingerprint text;
    proposed jsonb;
    existing_links jsonb;
begin
    if links is null or jsonb_typeof(links) <> 'object' or verify_pair is null then
        raise exception 'invalid published links' using errcode = '22023';
    end if;
    if not coalesce(links #>> '{edit,id}' ~ '^[0-9a-f]{16}$'
        and links #>> '{view,id}' ~ '^[0-9a-f]{16}$'
        and links #>> '{edit,hash}' ~ '^[0-9a-f]{64}$'
        and links #>> '{view,hash}' ~ '^[0-9a-f]{64}$'
        and links #>> '{edit,id}' <> links #>> '{view,id}'
        and links #>> '{edit,hash}' <> links #>> '{view,hash}', false) then
        raise exception 'invalid published links' using errcode = '22023';
    end if;

    insert into public.online_files (id, owner_id, snapshot_id, name, published_without_key)
        values (target, actor, snapshot, title, actor is not null) on conflict on constraint online_files_pkey do nothing;
    select f.* into strict listing from public.online_files f
        where f.id = target and f.owner_id is not distinct from actor and f.snapshot_id = snapshot for no key update;

    -- Rebuild the input before hashing. Only the accepted ID and digest fields participate.
    select jsonb_object_agg(role, jsonb_build_object('id', links->role->>'id', 'hash', links->role->>'hash')),
           jsonb_agg(jsonb_build_object('id', links->role->>'id', 'access_level', role,
                      'label', 'Published (' || role || ')', 'token_hash', links->role->>'hash'))
        into links, proposed from unnest(array['edit', 'view']) role;
    fingerprint := encode(sha256(convert_to(links::text, 'UTF8')), 'hex');

    if listing.published_link_fingerprint is null then
        -- Earlier provider versions could install links separately from finalisation.
        select jsonb_object_agg(l.access_level, jsonb_build_object('id', l.id, 'hash', l.token_hash))
            into existing_links from public.online_file_links l where l.file_id = target
            and l.access_level in ('edit','view') and l.label = 'Published (' || l.access_level || ')';
        if existing_links is null then
            perform public.change_online_file_links(actor, target, array[]::text[], proposed, 100);
            listing.published_link_fingerprint := fingerprint;
        else
            listing.published_link_fingerprint := encode(sha256(convert_to(existing_links::text, 'UTF8')), 'hex');
        end if;
        update public.online_files f set published_link_fingerprint = listing.published_link_fingerprint where f.id = target;
    end if;
    if verify_pair and listing.published_link_fingerprint <> fingerprint then
        raise exception 'this file already has a different publication receipt' using errcode = '22023';
    end if;
    return query select listing.id, listing.name, listing.created_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.join_online_file (
  actor          uuid,
  auth_session   uuid,
  tab            uuid,
  target         uuid,
  presented_hash text
)
  RETURNS TABLE (
    access_level text,
    object_path  text
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
    chosen public.online_file_links;
begin
    -- Match the owner's file-then-link lock order during revocation and removal.
    perform 1 from public.online_files f where f.id = target for key share;
    if not found then raise exception 'the invite is unavailable' using errcode = '42501'; end if;
    select l.* into chosen from public.online_file_links l
        where l.file_id = target and l.token_hash = presented_hash for key share;
    if not found then raise exception 'the invite is unavailable' using errcode = '42501'; end if;
    delete from public.online_file_connections where heard_at <= figcraft_private.connection_cutoff();
    insert into public.online_file_connections (id, link_id, file_id, session_id, principal_id)
        values (tab, chosen.id, chosen.file_id, auth_session, actor) on conflict (id) do nothing;
    if not exists (select 1 from public.online_file_connections c where c.id = tab and c.link_id = chosen.id
        and c.session_id = auth_session and c.principal_id = actor) then
        raise exception 'the connection is unavailable' using errcode = '42501';
    end if;
    return query select chosen.access_level, o.name
        from public.online_files f join storage.objects o on o.id=f.snapshot_id where f.id=target;
end;
$function$;

CREATE OR REPLACE FUNCTION public.keep_operator_publication (
  target    uuid,
  snapshot  uuid,
  title     text,
  links     jsonb,
  measured  bigint,
  max_files integer DEFAULT 1000
)
  RETURNS TABLE (
    id         uuid,
    name       text,
    created_at timestamp with time zone
  )
  LANGUAGE sql
  SET search_path TO ''
  AS $function$ select * from figcraft_private.keep_operator_publication(target,snapshot,title,links,measured,max_files); $function$;

CREATE OR REPLACE FUNCTION public.online_host_information (
  target uuid DEFAULT NULL::uuid
)
  RETURNS TABLE (
    idle_seconds     text,
    expires          text,
    operator_contact text,
    terms_url        text,
    accepts_reports  boolean,
    open_publish     boolean,
    file_mb          integer
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$ select trunc(figcraft_private.host_idle_seconds())::text, figcraft_private.visible_online_expiry(target),
    c.operator_contact,c.terms_url,true,p.open_publish,p.file_mb from figcraft_private.host_contact() c
    cross join figcraft_private.host_publication_policy() p; $function$;

CREATE OR REPLACE FUNCTION public.operator_publication_verifier()
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$ select figcraft_private.operator_publication_verifier(); $function$;

ALTER TABLE "public"."online_files"
  ADD CONSTRAINT "online_files_check" CHECK (((owner_id IS NOT NULL) OR (NOT published_without_key)));

REVOKE ALL ON FUNCTION "figcraft_private"."admit_keyed_publication"(inet) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."admit_keyed_publication"(inet) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."host_publication_policy"() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."host_publication_policy"() TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."keep_operator_publication"(uuid, uuid, text, jsonb, bigint, integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."keep_operator_publication"(uuid, uuid, text, jsonb, bigint, integer) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."operator_publication_verifier"() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."operator_publication_verifier"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."admit_keyed_publication"(inet) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."admit_keyed_publication"(inet) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."keep_operator_publication"(uuid, uuid, text, jsonb, bigint, integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."keep_operator_publication"(uuid, uuid, text, jsonb, bigint, integer) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."online_host_information"(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."online_host_information"(uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."operator_publication_verifier"() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."operator_publication_verifier"() TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."online_publication_policy" TO "postgres";
