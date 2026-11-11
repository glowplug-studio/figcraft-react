-- The guest can check its own tab after subscribing or reconnecting.
create function figcraft_private.connection_active(tab uuid) returns boolean
language sql volatile security definer set search_path = ''
as $$
    with renewed as (
        update public.online_file_connections
            set heard_at = greatest(heard_at,statement_timestamp())
            where id = tab and principal_id = (select auth.uid())
            and session_id = (select nullif(auth.jwt()->>'session_id', '')::uuid)
            and heard_at > figcraft_private.connection_cutoff()
            returning id
    )
    select exists(select from renewed);
$$;
revoke all on function figcraft_private.connection_active(uuid) from public, anon, authenticated;
grant execute on function figcraft_private.connection_active(uuid) to authenticated;

create function public.online_connection_active(tab uuid) returns boolean
language sql volatile security invoker set search_path = ''
as $$ select figcraft_private.connection_active(tab); $$;
revoke all on function public.online_connection_active(uuid) from public, anon, authenticated;
grant execute on function public.online_connection_active(uuid) to authenticated;

-- A revoked grant can vanish between redemption and the private subscription.
-- Return only the recent terminal reason on this login's physical-tab topic.
create function figcraft_private.connection_ending(tab uuid) returns text
language sql stable security definer set search_path = ''
as $$
    select m.payload->>'reason' from realtime.messages m
    where m.extension = 'broadcast' and m.private is true and m.event = 'ended'
        and m.inserted_at >= statement_timestamp() - interval '45 seconds'
        and m.topic = 'figcraft-connection:' || ((select auth.jwt())->>'session_id') || ':' || tab::text
        and m.payload->>'reason' in ('stopped','removed')
    order by m.inserted_at desc limit 1;
$$;
revoke all on function figcraft_private.connection_ending(uuid) from public, anon, authenticated, service_role;
grant execute on function figcraft_private.connection_ending(uuid) to authenticated;

create function public.online_connection_ending(tab uuid) returns text
language sql stable security invoker set search_path = ''
as $$ select figcraft_private.connection_ending(tab); $$;
revoke all on function public.online_connection_ending(uuid) from public, anon, authenticated, service_role;
grant execute on function public.online_connection_ending(uuid) to authenticated;

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
