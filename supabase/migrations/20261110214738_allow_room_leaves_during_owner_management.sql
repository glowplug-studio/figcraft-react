SET local check_function_bodies = off;

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
    perform 1 from public.online_files f where f.id = target and f.owner_id = actor for no key update;
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
    perform public.change_online_file_links(actor, target, revoke_ids, new_links, 100);
    insert into public.online_file_share_changes as c (file_id, revision, proof)
        values (target, revision, fingerprint) on conflict (file_id)
        do update set revision = excluded.revision, proof = excluded.proof;
end;
$function$;

CREATE OR REPLACE FUNCTION public.change_online_file_links (
  actor      uuid,
  target     uuid,
  revoke_ids text[],
  new_links  jsonb,
  link_limit integer
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
    retained integer;
begin
    perform 1 from public.online_files where id = target and owner_id = actor for no key update;
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

    insert into public.online_files (id, owner_id, snapshot_id, name)
        values (target, actor, snapshot, title) on conflict on constraint online_files_pkey do nothing;
    select f.* into strict listing from public.online_files f
        where f.id = target and f.owner_id = actor and f.snapshot_id = snapshot for no key update;

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
