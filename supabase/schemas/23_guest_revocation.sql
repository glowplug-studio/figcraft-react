-- The guest can check its own tab after subscribing or reconnecting.
create function figcraft_private.connection_active(tab uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (select 1 from public.online_file_connections c
        where c.id = tab and c.principal_id = (select auth.uid())
        and c.session_id = (select nullif(auth.jwt()->>'session_id', '')::uuid));
$$;
revoke all on function figcraft_private.connection_active(uuid) from public, anon, authenticated;
grant execute on function figcraft_private.connection_active(uuid) to authenticated;

create function public.online_connection_active(tab uuid) returns boolean
language sql stable security invoker set search_path = ''
as $$ select figcraft_private.connection_active(tab); $$;
revoke all on function public.online_connection_active(uuid) from public, anon, authenticated;
grant execute on function public.online_connection_active(uuid) to authenticated;

create policy "Guests receive notices for their login session" on realtime.messages
    for select to authenticated using (
        extension = 'broadcast' and topic = (select realtime.topic())
        and starts_with(topic, 'figcraft-connection:' || ((select auth.jwt()) ->> 'session_id') || ':')
    );

-- Notify before the link's FK removes its connections. A voluntary tab close
-- deletes just its connection and does not generate a stopped-sharing notice.
create function figcraft_private.notify_link_removal() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
    connection record;
    reason text;
begin
    if exists (select 1 from public.online_files f where f.id = old.file_id) then
        reason := 'stopped';
    else
        reason := 'removed';
    end if;
    for connection in select c.id, c.session_id from public.online_file_connections c
        where c.link_id = old.id
    loop
        perform realtime.send(jsonb_build_object('reason', reason), 'ended',
            'figcraft-connection:' || connection.session_id::text || ':' || connection.id::text, true);
    end loop;
    return old;
end;
$$;
revoke all on function figcraft_private.notify_link_removal() from public, anon, authenticated;
create trigger notify_link_removal before delete on public.online_file_links
    for each row execute function figcraft_private.notify_link_removal();
