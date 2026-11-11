-- Native Action::Admin is independent of the public publication allowance.
-- The shared admission lock covers refill, eviction and spending across all blocks.
create function figcraft_private.take_admin_request(address inet, sampled timestamptz) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
    blocks cidr[];
    b cidr;
    budget figcraft_private.online_code_budgets;
    capacity double precision;
    available double precision;
begin
    if address is null then raise exception 'missing source address' using errcode = '22023'; end if;
    sampled := figcraft_private.admission_clock(sampled);
    select array_agg(block order by multiplier) into blocks from figcraft_private.publication_blocks(address);
    foreach b in array blocks loop
        budget := figcraft_private.admission_bucket(b,blocks,sampled);
        capacity := case masklen(b) when 48 then 240 when 56 then 120 else 60 end;
        available := least(capacity, coalesce(budget.admin_tokens,capacity) +
            greatest(0,extract(epoch from sampled-budget.admin_used_at)) * (capacity / 60));
        update figcraft_private.online_code_budgets set admin_tokens=available,
            admin_used_at=greatest(admin_used_at,sampled) where block=b;
        if available < 1 then return false; end if;
    end loop;
    update figcraft_private.online_code_budgets set admin_tokens=admin_tokens-1 where block=any(blocks);
    return true;
end;
$$;
revoke all on function figcraft_private.take_admin_request(inet,timestamptz) from public, anon, authenticated, service_role;

-- The browser atomically rotates links and their codes. The native server
-- receives one revoke per old link and a create and code request per new link.
create function figcraft_private.apply_addressed_share_change(actor uuid, target uuid, expected uuid, revision uuid,
    revoke_ids text[], new_links jsonb, address inet) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
    current_revision uuid;
    changes integer;
begin
    if revoke_ids is null or cardinality(revoke_ids)>3 or jsonb_typeof(new_links) is distinct from 'array'
        or revision is null then raise exception 'invalid sharing change' using errcode='22023'; end if;
    if jsonb_array_length(new_links) not in (0,3) then raise exception 'invalid sharing change' using errcode='22023'; end if;
    -- Reports hold file/key-share before spending admission credit. Exclude
    -- that lock before taking the budget lock and later revoking guest links.
    perform 1 from public.online_files f where f.id=target and f.owner_id=actor for update;
    if not found then raise exception 'this file is unavailable' using errcode='42501'; end if;
    select c.revision into current_revision from public.online_file_share_changes c where c.file_id=target;
    if current_revision is distinct from revision and current_revision is not distinct from expected then
        changes := cardinality(revoke_ids) + 2 * jsonb_array_length(new_links);
        for request in 1..changes loop
            if not figcraft_private.take_admin_request(address,null) then return false; end if;
        end loop;
    end if;
    perform public.apply_online_share_change(actor,target,expected,revision,revoke_ids,new_links);
    return true;
end;
$$;
revoke all on function figcraft_private.apply_addressed_share_change(uuid,uuid,uuid,uuid,text[],jsonb,inet) from public, anon, authenticated, service_role;
grant execute on function figcraft_private.apply_addressed_share_change(uuid,uuid,uuid,uuid,text[],jsonb,inet) to service_role;

create function public.apply_addressed_share_change(actor uuid, target uuid, expected uuid, revision uuid,
    revoke_ids text[], new_links jsonb, address inet) returns boolean
language sql security invoker set search_path = ''
as $$ select figcraft_private.apply_addressed_share_change(actor,target,expected,revision,revoke_ids,new_links,address); $$;
revoke all on function public.apply_addressed_share_change(uuid,uuid,uuid,uuid,text[],jsonb,inet) from public, anon, authenticated, service_role;
grant execute on function public.apply_addressed_share_change(uuid,uuid,uuid,uuid,text[],jsonb,inet) to service_role;
