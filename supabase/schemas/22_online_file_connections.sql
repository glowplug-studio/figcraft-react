create schema if not exists figcraft_private;
revoke all on schema figcraft_private from public, anon;
grant usage on schema figcraft_private to authenticated;

-- A guest tab joins through one exact link in one authenticated session.
create table public.online_file_connections (
    id uuid primary key,
    link_id text not null references public.online_file_links (id) on delete cascade,
    session_id uuid not null references auth.sessions (id) on delete cascade,
    principal_id uuid not null references auth.users (id) on delete cascade
);
create index online_file_connections_link_idx on public.online_file_connections (link_id);
create index online_file_connections_session_idx on public.online_file_connections (session_id, principal_id);
create index online_file_connections_principal_idx on public.online_file_connections (principal_id);
alter table public.online_file_connections enable row level security;
revoke all on public.online_file_connections from public, anon, authenticated, service_role;
grant select, insert, delete on public.online_file_connections to service_role;

-- The route authenticates the presented token and computes its digest. Digests
-- never serve as bearer tokens on the public API.
create function public.join_online_file(
    actor uuid, auth_session uuid, tab uuid, target uuid, presented_hash text
) returns table (access_level text, object_path text)
language plpgsql security invoker set search_path = ''
as $$
declare
    chosen public.online_file_links;
begin
    select l.* into chosen from public.online_file_links l
        where l.file_id = target and l.token_hash = presented_hash for key share;
    if not found then raise exception 'the invite is unavailable' using errcode = '42501'; end if;
    insert into public.online_file_connections (id, link_id, session_id, principal_id)
        values (tab, chosen.id, auth_session, actor) on conflict (id) do nothing;
    if not exists (select 1 from public.online_file_connections c where c.id = tab and c.link_id = chosen.id
        and c.session_id = auth_session and c.principal_id = actor) then
        raise exception 'the connection is unavailable' using errcode = '42501';
    end if;
    return query select chosen.access_level, f.owner_id::text || '/' || f.id::text || '.figcraft'
        from public.online_files f where f.id = target;
end;
$$;
revoke all on function public.join_online_file(uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.join_online_file(uuid,uuid,uuid,uuid,text) to service_role;

-- This internal RLS lookup has no caller-supplied principal or session.
create function figcraft_private.shared_snapshot_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
    select f.snapshot_id from public.online_file_connections c
    join public.online_file_links l on l.id = c.link_id
    join public.online_files f on f.id = l.file_id
    where c.principal_id = (select auth.uid())
        and c.session_id = (select nullif(auth.jwt()->>'session_id', '')::uuid);
$$;
revoke all on function figcraft_private.shared_snapshot_ids() from public, anon, authenticated;
grant execute on function figcraft_private.shared_snapshot_ids() to authenticated;

create policy "Owners and current link sessions read snapshots" on storage.objects
    for select to authenticated
    using (bucket_id = 'figcraft-files' and (
        owner_id = (select auth.uid())::text or (
            (select storage.allow_only_operation('object.get_authenticated'))
            and id in (select figcraft_private.shared_snapshot_ids())
        )
    ));
