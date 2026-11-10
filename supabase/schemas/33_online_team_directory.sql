-- A configured server can adjust the native per-file link cap independently of discovery.
create table figcraft_private.online_link_settings (
    singleton boolean primary key default true check (singleton),
    max_links numeric not null check (max_links = trunc(max_links) and max_links between 1 and 18446744073709551615)
);
alter table figcraft_private.online_link_settings enable row level security;
revoke all on figcraft_private.online_link_settings from public, anon, authenticated, service_role;
create function figcraft_private.host_link_limit() returns numeric
language sql stable security definer set search_path = ''
as $$select coalesce((select max_links from figcraft_private.online_link_settings where singleton),100);$$;
revoke all on function figcraft_private.host_link_limit() from public, anon, authenticated, service_role;
grant execute on function figcraft_private.host_link_limit() to service_role;

-- No configuration row means the operator has left team discovery off.
create table figcraft_private.team_directory_settings (
    singleton boolean primary key default true check (singleton),
    access_level text not null check (access_level in ('edit','view','comment')),
    web_url text not null default '' check (web_url = '' or
        (web_url ~ '^https?://' and octet_length(web_url) <= 500 and web_url !~ '[?#[:space:][:cntrl:]]'))
);
alter table figcraft_private.team_directory_settings enable row level security;
revoke all on figcraft_private.team_directory_settings from public, anon, authenticated, service_role;

-- The token is reusable while the operator and owner continue to offer the
-- file. Only the lookup function reads it. Ordinary admission uses its digest.
create table figcraft_private.team_file_links (
    file_id uuid primary key,
    link_id text not null unique,
    token text not null,
    foreign key (link_id,file_id) references public.online_file_links(id,file_id) on delete cascade
);
alter table figcraft_private.team_file_links enable row level security;
revoke all on figcraft_private.team_file_links from public, anon, authenticated, service_role;

create function figcraft_private.online_team_directory() returns jsonb
language sql stable security definer set search_path = ''
as $$
    select coalesce((
        select jsonb_build_object('state','listed','web',s.web_url,'files',(
            select coalesce(jsonb_agg(jsonb_build_object(
                'file',f.id,'name',f.name,'updated',f.updated::text,'access',s.access_level,
                'people',(select count(*) from public.online_file_connections c where c.file_id=f.id
                    and c.heard_at > figcraft_private.connection_cutoff())
            ) order by f.updated desc, f.name collate "C", f.id),'[]'::jsonb)
            from (
                select f.id, f.name, floor(extract(epoch from coalesce(f.document_updated_at,f.created_at))) as updated
                from public.online_files f where exists (
                    select from public.online_file_links l where l.file_id=f.id and l.code_hash is not null
                ) order by updated desc, f.name collate "C", f.id limit 500
            ) f
        )) from figcraft_private.team_directory_settings s where (select auth.uid()) is not null
    ),jsonb_build_object('state','none'));
$$;

create function figcraft_private.resolve_team_file(target uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
    team_access text;
    issued_token text;
    issued_id text;
    max_links numeric;
begin
    if (select auth.uid()) is null then
        raise exception 'sign in to join a team file' using errcode = '42501';
    end if;
    select s.access_level into team_access from figcraft_private.team_directory_settings s for share;
    if not found then return jsonb_build_object('status','disabled'); end if;
    perform 1 from public.online_files f where f.id=target for no key update;
    if not found or not exists (select from public.online_file_links l
        where l.file_id=target and l.code_hash is not null) then
        return jsonb_build_object('status','unshared');
    end if;
    select t.token into issued_token from figcraft_private.team_file_links t where t.file_id=target;
    if not found then
        -- Same host cap and file lock as owner-issued links.
        max_links := figcraft_private.host_link_limit();
        if (select count(*) from public.online_file_links l where l.file_id=target) >= max_links then
            return jsonb_build_object('status','full','limit',trunc(max_links)::text);
        end if;
        issued_id := encode(extensions.gen_random_bytes(8),'hex');
        issued_token := translate(rtrim(encode(extensions.gen_random_bytes(16),'base64'),'='),'+/','-_');
        insert into public.online_file_links(id,file_id,access_level,label,token_hash)
            values(issued_id,target,team_access,'Team (' || team_access || ')',
                encode(sha256(convert_to(issued_token,'UTF8')),'hex'));
        insert into figcraft_private.team_file_links(file_id,link_id,token) values(target,issued_id,issued_token);
    end if;
    return jsonb_build_object('file',target,'token',issued_token);
end;
$$;

-- All removals go through the ordinary link table, which sends the existing
-- per-session revocation notice and removes previously admitted connections.
create function figcraft_private.revoke_unshared_team_link() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    if not exists (select from public.online_file_links l where l.file_id=old.file_id and l.code_hash is not null) then
        delete from public.online_file_links l using figcraft_private.team_file_links t
            where t.file_id=old.file_id and l.id=t.link_id;
    end if;
    return null;
end;
$$;
create trigger revoke_unshared_team_link after delete on public.online_file_links
    for each row when (old.code_hash is not null) execute function figcraft_private.revoke_unshared_team_link();
create trigger revoke_uncoded_team_link after update of code_hash on public.online_file_links
    for each row when (old.code_hash is not null and new.code_hash is null)
    execute function figcraft_private.revoke_unshared_team_link();

create function figcraft_private.drop_previous_team_access() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    delete from public.online_file_links l using figcraft_private.team_file_links t where l.id=t.link_id;
    return null;
end;
$$;
create trigger drop_changed_team_access after update of access_level on figcraft_private.team_directory_settings
    for each row when (old.access_level is distinct from new.access_level)
    execute function figcraft_private.drop_previous_team_access();
create trigger drop_disabled_team_access after delete on figcraft_private.team_directory_settings
    for each row execute function figcraft_private.drop_previous_team_access();

create trigger drop_truncated_team_access after truncate on figcraft_private.team_directory_settings
    for each statement execute function figcraft_private.drop_previous_team_access();

create function public.online_team_directory() returns jsonb
language sql stable security invoker set search_path = ''
as $$select figcraft_private.online_team_directory();$$;
create function public.resolve_team_file(target uuid) returns jsonb
language sql volatile security invoker set search_path = ''
as $$select figcraft_private.resolve_team_file(target);$$;

revoke all on function figcraft_private.revoke_unshared_team_link(), figcraft_private.drop_previous_team_access(),
    figcraft_private.online_team_directory(), figcraft_private.resolve_team_file(uuid),
    public.online_team_directory(), public.resolve_team_file(uuid) from public, anon, authenticated, service_role;
grant execute on function figcraft_private.online_team_directory(), figcraft_private.resolve_team_file(uuid),
    public.online_team_directory(), public.resolve_team_file(uuid) to authenticated;
