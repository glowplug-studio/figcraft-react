-- The host reports the configured idle period publicly to signed-in clients.
-- The per-file deadline is visible only to the owner or a current guest.
create function figcraft_private.visible_online_expiry(target uuid) returns text
language sql stable security definer set search_path = ''
as $$
    select figcraft_private.online_file_expiry(extract(epoch from f.created_at),
        extract(epoch from f.document_updated_at),extract(epoch from a.opened_at),
        trunc(figcraft_private.host_idle_seconds()),f.published_without_key)::text
    from public.online_files f left join figcraft_private.online_room_activity a on a.file_id=f.id
    where f.id=target and (f.owner_id=(select auth.uid()) or f.snapshot_id in
        (select figcraft_private.shared_snapshot_ids()));
$$;
revoke all on function figcraft_private.visible_online_expiry(uuid) from public, anon, authenticated, service_role;
grant execute on function figcraft_private.visible_online_expiry(uuid), figcraft_private.host_idle_seconds() to authenticated;

-- Computed PostgREST field for the ordinary owner listing/rename response.
create function public.online_expiry_epoch(listing public.online_files) returns text
language sql stable security invoker set search_path = ''
as $$ select figcraft_private.visible_online_expiry(listing.id); $$;
revoke all on function public.online_expiry_epoch(public.online_files) from public, anon, authenticated, service_role;
grant execute on function public.online_expiry_epoch(public.online_files) to authenticated;

create function public.online_host_information(target uuid default null)
returns table(idle_seconds text, expires text)
language sql stable security invoker set search_path = ''
as $$ select trunc(figcraft_private.host_idle_seconds())::text, figcraft_private.visible_online_expiry(target); $$;
revoke all on function public.online_host_information(uuid) from public, anon, authenticated, service_role;
grant execute on function public.online_host_information(uuid) to authenticated;
