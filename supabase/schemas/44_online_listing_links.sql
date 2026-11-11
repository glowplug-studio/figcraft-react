-- A computed listing field returns only link identifiers, for the file's actual account owner.
-- Never trust the owner_id in a caller-constructed composite row.
create function figcraft_private.owned_link_ids(target uuid) returns text[]
language sql stable security definer set search_path = ''
as $$
    select array(select l.id from public.online_file_links l where l.file_id=f.id order by l.id)
    from public.online_files f where f.id=target and f.owner_id=(select auth.uid());
$$;
revoke all on function figcraft_private.owned_link_ids(uuid) from public, anon, authenticated, service_role;
grant execute on function figcraft_private.owned_link_ids(uuid) to authenticated;

create function public.online_owned_link_ids(listing public.online_files) returns text[]
language sql stable security invoker set search_path = ''
as $$ select figcraft_private.owned_link_ids(listing.id); $$;
revoke all on function public.online_owned_link_ids(public.online_files) from public, anon, authenticated, service_role;
grant execute on function public.online_owned_link_ids(public.online_files) to authenticated;
