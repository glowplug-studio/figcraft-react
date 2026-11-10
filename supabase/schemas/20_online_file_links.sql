-- Link tokens and join codes are presented once. Persist only their digests
-- and the native code-wrapped token. The host checks the actor before lookup.
create table public.online_file_links (
    id text primary key check (id ~ '^[0-9a-f]{16}$'),
    file_id uuid not null references public.online_files (id) on delete cascade,
    access_level text not null check (access_level in ('view', 'comment', 'edit')),
    label text not null check (char_length(label) <= 256),
    token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
    code_hash text check (code_hash ~ '^[0-9a-f]{64}$'),
    wrapped_token text check (wrapped_token ~ '^([0-9a-f]{2}){1,32}$'),
    created_at timestamptz not null default now(),
    check ((code_hash is null) = (wrapped_token is null)),
    unique (file_id, token_hash)
);

create unique index online_file_links_code_idx on public.online_file_links (code_hash)
    where code_hash is not null;

alter table public.online_file_links enable row level security;

revoke all on public.online_file_links from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.online_file_links to service_role;

-- Apply an owner-authorised set of creations and revocations as one transaction.
-- Row locking serialises competing changes against the same file and its limit.
create function public.change_online_file_links(
    actor uuid, target uuid, revoke_ids text[], new_links jsonb, link_limit integer
) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
    retained integer;
begin
    perform 1 from public.online_files where id = target and owner_id = actor for update;
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
$$;

revoke all on function public.change_online_file_links(uuid, uuid, text[], jsonb, integer) from public, anon, authenticated;
grant execute on function public.change_online_file_links(uuid, uuid, text[], jsonb, integer) to service_role;
