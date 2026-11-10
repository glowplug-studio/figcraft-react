-- New public-host attempts spend an allowance before snapshot validation.
-- A refusal is a normal return so the refill and LRU changes commit.
create function figcraft_private.take_online_publication(address inet, hourly bigint, sampled timestamptz)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
    blocks cidr[];
    b cidr;
    budget figcraft_private.online_code_budgets;
    capacity double precision;
    available double precision;
begin
    if address is null or hourly is null or hourly < 1 or hourly > 4294967295 then
        raise exception 'invalid publication admission' using errcode = '22023';
    end if;
    sampled := figcraft_private.admission_clock(sampled);
    select array_agg(block order by multiplier) into blocks from figcraft_private.publication_blocks(address);
    foreach b in array blocks loop
        budget := figcraft_private.admission_bucket(b,blocks,sampled);
        capacity := hourly * case masklen(b) when 48 then 4 when 56 then 2 else 1 end;
        available := least(capacity, coalesce(budget.publish_tokens,capacity) +
            greatest(0,extract(epoch from sampled-budget.publish_used_at)) * (capacity / 3600));
        update figcraft_private.online_code_budgets set publish_tokens = available,
            publish_used_at = greatest(publish_used_at,sampled) where block = b;
        if available < 1 then return false; end if;
    end loop;

    capacity := hourly * 32;
    select least(capacity, coalesce(publish_tokens,capacity) +
        greatest(0,extract(epoch from sampled-publish_used_at)) * (capacity / 3600))
        into available from figcraft_private.online_code_global where singleton;
    update figcraft_private.online_code_global set publish_tokens = available,
        publish_used_at = greatest(publish_used_at,sampled) where singleton;
    if available < 1 then return false; end if;
    update figcraft_private.online_code_global set publish_tokens = publish_tokens - 1 where singleton;
    update figcraft_private.online_code_budgets set publish_tokens = publish_tokens - 1 where block = any(blocks);
    return true;
end;
$$;
revoke all on function figcraft_private.take_online_publication(inet,bigint,timestamptz) from public, anon, authenticated, service_role;

create function figcraft_private.admit_online_publication(address inet, hourly bigint)
returns boolean language sql volatile security definer set search_path = ''
as $$ select figcraft_private.take_online_publication(address,hourly,null); $$;
revoke all on function figcraft_private.admit_online_publication(inet,bigint) from public, anon, authenticated;
grant execute on function figcraft_private.admit_online_publication(inet,bigint) to service_role;

create function public.admit_online_publication(address inet, hourly bigint default 10)
returns boolean language sql volatile security invoker set search_path = ''
as $$ select figcraft_private.admit_online_publication(address,hourly); $$;
revoke all on function public.admit_online_publication(inet,bigint) from public, anon, authenticated;
grant execute on function public.admit_online_publication(inet,bigint) to service_role;
