-- A direct Storage deletion can discard an owner's unlisted stage. Serialise
-- that decision with finalisation and retirement, including a concurrent retry.
create function figcraft_private.can_discard_online_stage(target uuid) returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
begin
    perform pg_advisory_xact_lock(650130,3);
    return exists(select from storage.objects o where o.id=target and o.bucket_id='figcraft-files'
        and o.owner_id=(select auth.uid())::text) and not exists(select from public.online_files where snapshot_id=target);
end;
$$;
revoke all on function figcraft_private.can_discard_online_stage(uuid) from public, anon, authenticated, service_role;
grant execute on function figcraft_private.can_discard_online_stage(uuid) to authenticated;
create policy "Owners discard unlisted Figcraft snapshots" on storage.objects
    for delete to authenticated using (bucket_id='figcraft-files' and owner_id=(select auth.uid())::text
        and figcraft_private.can_discard_online_stage(id));

-- Authenticated ownership is checked before charging the transport-derived
-- source address. Returning an invalid-name result retains its admission cost.
create function figcraft_private.manage_owned_online_file(actor uuid,target uuid,title text,address inet)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    listing public.online_files;
    secret text;
    path text;
    opened timestamptz;
begin
    if actor is null or target is null then raise exception 'missing file identity' using errcode='22023'; end if;
    perform pg_advisory_xact_lock(650130,3);
    if title is null then
        -- Leaving a room locks a connection first; its activity trigger can
        -- then take a foreign-key lock on the file. Yield both locks together
        -- before spending admission if that departure is already underway.
        begin
            select * into listing from public.online_files where id=target and owner_id=actor for update nowait;
            if found then
                perform 1 from public.online_file_connections where file_id=target order by id for update nowait;
            end if;
        exception when lock_not_available then return jsonb_build_object('state','contended');
        end;
    else
        select * into listing from public.online_files where id=target and owner_id=actor for no key update;
    end if;
    if listing.id is null then return jsonb_build_object('state','unavailable'); end if;
    if not figcraft_private.take_admin_request(address,null) then return jsonb_build_object('state','busy'); end if;
    if title is not null then
        begin
            update public.online_files set name=title where id=target returning * into listing;
        exception when invalid_parameter_value then return jsonb_build_object('state','invalid');
        end;
        select a.opened_at into opened from figcraft_private.online_room_activity a where a.file_id=target;
        return jsonb_build_object('state','renamed','file',jsonb_build_object(
            'id',listing.id,'name',listing.name,'created_at',listing.created_at,
            'online_expiry_epoch',figcraft_private.online_file_expiry(extract(epoch from listing.created_at),
                extract(epoch from listing.document_updated_at),extract(epoch from opened),
                trunc(figcraft_private.host_idle_seconds()),listing.published_without_key)::text));
    end if;
    select name into strict path from storage.objects where id=listing.snapshot_id;
    delete from public.online_files where id=target;
    secret := encode(extensions.gen_random_bytes(32),'hex');
    insert into figcraft_private.online_retirements(snapshot_id,owner_id,token_hash)
        values(listing.snapshot_id,actor::text,sha256(convert_to(secret,'UTF8')));
    return jsonb_build_object('state','removed','path',path,'claim',secret);
end;
$$;
revoke all on function figcraft_private.manage_owned_online_file(uuid,uuid,text,inet) from public, anon, authenticated, service_role;
grant execute on function figcraft_private.manage_owned_online_file(uuid,uuid,text,inet) to service_role;
create function public.manage_owned_online_file(actor uuid,target uuid,title text,address inet) returns jsonb
language sql security invoker set search_path = ''
as $$ select figcraft_private.manage_owned_online_file(actor,target,title,address); $$;
revoke all on function public.manage_owned_online_file(uuid,uuid,text,inet) from public, anon, authenticated, service_role;
grant execute on function public.manage_owned_online_file(uuid,uuid,text,inet) to service_role;
