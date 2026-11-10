-- The validated archive, listing and its two original grants become visible together.
-- The fingerprint identifies the original pair even when a grant is subsequently revoked.
create function public.finalise_online_publication(
    actor uuid, target uuid, snapshot uuid, title text, links jsonb, verify_pair boolean
) returns table (id uuid, name text, created_at timestamptz)
language plpgsql security invoker set search_path = ''
as $$
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
        where f.id = target and f.owner_id = actor and f.snapshot_id = snapshot for update;

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
$$;

revoke all on function public.finalise_online_publication(uuid,uuid,uuid,text,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.finalise_online_publication(uuid,uuid,uuid,text,jsonb,boolean) to service_role;
