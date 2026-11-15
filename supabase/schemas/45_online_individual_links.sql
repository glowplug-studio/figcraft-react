-- Native individual management uses file-owner authority, not the URL's operator key.
-- A monotonic position preserves insertion order even when creation timestamps tie.
create function figcraft_private.manage_online_link(actor uuid,target uuid,operation text,
    link_id text,new_link jsonb,address inet) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
    entries jsonb;
    maximum numeric := figcraft_private.host_link_limit();
begin
    if actor is null or target is null or operation is null or operation not in ('links','createLink','revoke') then
        raise exception 'invalid link management request' using errcode='22023';
    end if;
    -- Match the existing file-before-admission lock order, including revocation triggers.
    if operation='revoke' then
        begin
            perform 1 from public.online_files where id=target and owner_id=actor for update nowait;
            if not found then return jsonb_build_object('state','unavailable'); end if;
            perform 1 from public.online_file_connections where file_id=target order by id for update nowait;
        exception when lock_not_available then return jsonb_build_object('state','contended');
        end;
    else
        perform 1 from public.online_files where id=target and owner_id=actor for update;
        if not found then return jsonb_build_object('state','unavailable'); end if;
    end if;
    if operation='links' then
        select coalesce(jsonb_agg(jsonb_build_object('id',id,'access',access_level,'label',label,
            'created',trunc(extract(epoch from created_at))::text) order by position),'[]'::jsonb)
            into entries from public.online_file_links where file_id=target;
        return jsonb_build_object('state','listed','links',entries);
    end if;
    if not figcraft_private.take_admin_request(address,null) then return jsonb_build_object('state','busy'); end if;
    -- A refused native mutation still spends admission. Keep its expected refusal
    -- outside the exception rollback that would otherwise refund that allowance.
    if operation='revoke' then
        if link_id is null or not exists(select from public.online_file_links where file_id=target and id=link_id) then
            return jsonb_build_object('state','missing');
        end if;
        perform figcraft_private.change_online_file_links(actor,target,array[link_id],'[]'::jsonb,maximum);
    else
        if (select count(*) from public.online_file_links where file_id=target)>=maximum then
            return jsonb_build_object('state','limit','maximum',maximum::text);
        end if;
        if new_link is null or jsonb_typeof(new_link) is distinct from 'object' then
            raise exception 'invalid new link' using errcode='22023';
        end if;
        perform figcraft_private.change_online_file_links(actor,target,'{}'::text[],jsonb_build_array(new_link),maximum);
    end if;
    return jsonb_build_object('state','done');
end;
$$;
revoke all on function figcraft_private.manage_online_link(uuid,uuid,text,text,jsonb,inet) from public, anon, authenticated, service_role;
grant execute on function figcraft_private.manage_online_link(uuid,uuid,text,text,jsonb,inet) to service_role;

create function public.manage_online_link(actor uuid,target uuid,operation text,link_id text,new_link jsonb,address inet)
returns jsonb language sql security invoker set search_path = ''
as $$ select figcraft_private.manage_online_link(actor,target,operation,link_id,new_link,address); $$;
revoke all on function public.manage_online_link(uuid,uuid,text,text,jsonb,inet) from public, anon, authenticated, service_role;
grant execute on function public.manage_online_link(uuid,uuid,text,text,jsonb,inet) to service_role;
