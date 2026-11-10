-- A lost acknowledgement can be retried without another set of links or an
-- unbounded operation history. Each device still manages only its recorded links.
create table public.online_file_share_changes (
    file_id uuid primary key references public.online_files (id) on delete cascade,
    revision uuid not null,
    proof text not null
);
alter table public.online_file_share_changes enable row level security;
revoke all on public.online_file_share_changes from public, anon, authenticated, service_role;
grant select, insert, update on public.online_file_share_changes to service_role;

create function public.apply_online_share_change(actor uuid, target uuid, expected uuid, revision uuid,
    revoke_ids text[], new_links jsonb) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
    prior public.online_file_share_changes;
    fingerprint text;
begin
    perform 1 from public.online_files f where f.id = target and f.owner_id = actor for update;
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
$$;
revoke all on function public.apply_online_share_change(uuid,uuid,uuid,uuid,text[],jsonb) from public, anon, authenticated;
grant execute on function public.apply_online_share_change(uuid,uuid,uuid,uuid,text[],jsonb) to service_role;
