-- Budgets belong to the shared store, so changing Next.js workers does not
-- replenish either an address's guesses or the server-wide allowance.
create table figcraft_private.online_code_budgets (
    block cidr primary key,
    tokens double precision not null,
    used_at timestamptz not null,
    wrong integer not null default 0,
    wrong_at timestamptz,
    locked_until timestamptz
);
create index online_code_budgets_age on figcraft_private.online_code_budgets(used_at);
create table figcraft_private.online_code_global (
    singleton boolean primary key check (singleton),
    tokens double precision not null,
    sampled_at timestamptz not null,
    store_started timestamptz not null
);
alter table figcraft_private.online_code_budgets enable row level security;
alter table figcraft_private.online_code_global enable row level security;
revoke all on figcraft_private.online_code_budgets, figcraft_private.online_code_global from public, anon, authenticated, service_role;

-- The online code, its two domain separators and the XOR pad follow the native
-- JoinCodeKey format. Test clocks are available only to the database owner.
create function figcraft_private.resolve_online_code(address inet, symbols text, sampled timestamptz)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    blocks cidr[];
    b cidr;
    scale_factor integer;
    allowance double precision;
    global_tokens double precision;
    until_time timestamptz;
    key_bytes bytea;
    hash_hex text;
    pad bytea;
    unwrapped bytea;
    found_link public.online_file_links;
    result jsonb;
    budget figcraft_private.online_code_budgets;
begin
    if address is null then raise exception 'invalid lookup'; end if;
    -- Keep the admission check, key stretching and outcome in one transaction.
    -- Nothing outside this lookup (including normal link joins) takes this lock.
    perform pg_advisory_xact_lock(650130, 2);
    sampled := coalesce(sampled,clock_timestamp());
    if not exists(select from figcraft_private.online_code_global where store_started = pg_postmaster_start_time()) then
        delete from figcraft_private.online_code_budgets where block is not null;
        insert into figcraft_private.online_code_global values(true, 1000, sampled, pg_postmaster_start_time())
            on conflict (singleton) do update set tokens = 1000, sampled_at = excluded.sampled_at, store_started = excluded.store_started;
    end if;
    if address <<= inet '::ffff:0:0/96' then
        address := inet '0.0.0.0' + (address - inet '::ffff:0:0');
    end if;
    blocks := case when family(address) = 4 then array[network(set_masklen(address,32))]
        else array[network(set_masklen(address,64)),network(set_masklen(address,56)),network(set_masklen(address,48))] end;

    select max(locked_until) into until_time from figcraft_private.online_code_budgets where block = any(blocks);
    if until_time > sampled then
        return jsonb_build_object('status','locked','minutes',1 + floor(extract(epoch from until_time - sampled)/60)::integer);
    end if;
    foreach b in array blocks loop
        scale_factor := case masklen(b) when 48 then 4 when 56 then 2 else 1 end;
        select * into budget from figcraft_private.online_code_budgets where block = b;
        if not found then
            if (select count(*) from figcraft_private.online_code_budgets) >= 10000 then
                delete from figcraft_private.online_code_budgets where not (block = any(blocks)) and used_at <= (
                    select used_at from figcraft_private.online_code_budgets order by used_at offset 5000 limit 1);
            end if;
            insert into figcraft_private.online_code_budgets(block,tokens,used_at) values(b, 10*scale_factor,sampled);
        else
            allowance := least(10*scale_factor, budget.tokens + greatest(0,extract(epoch from sampled-budget.used_at))*scale_factor/6);
            update figcraft_private.online_code_budgets set tokens = allowance, used_at = greatest(used_at,sampled) where block = b;
            if allowance < 1 then return jsonb_build_object('status','rate'); end if;
        end if;
    end loop;
    update figcraft_private.online_code_budgets set tokens = tokens-1 where block = any(blocks);
    select least(1000,tokens + greatest(0,extract(epoch from sampled-sampled_at))/3.6)
        into global_tokens from figcraft_private.online_code_global where singleton;
    update figcraft_private.online_code_global set tokens = global_tokens, sampled_at = greatest(sampled_at,sampled) where singleton;
    if global_tokens < 1 then return jsonb_build_object('status','busy'); end if;

    if symbols ~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{9}$' then
        key_bytes := sha256(convert_to('figcraft join code','UTF8') || decode('00','hex') || convert_to(symbols,'UTF8'));
        for i in 1..10000 loop key_bytes := sha256(key_bytes); end loop;
        hash_hex := encode(sha256(decode('66696e6400','hex') || key_bytes),'hex');
        select * into found_link from public.online_file_links where code_hash = hash_hex;
        if found then
            pad := sha256(decode('7772617000','hex') || key_bytes);
            unwrapped := decode(found_link.wrapped_token,'hex');
            for i in 0..length(unwrapped)-1 loop
                unwrapped := set_byte(unwrapped,i,get_byte(unwrapped,i) # get_byte(pad,i));
            end loop;
            if encode(sha256(unwrapped),'hex') = found_link.token_hash then
                result := jsonb_build_object('file',found_link.file_id,'token',convert_from(unwrapped,'UTF8'));
            end if;
        end if;
    end if;
    update figcraft_private.online_code_budgets set wrong = 0 where block = any(blocks) and wrong <> 0
        and wrong_at < sampled - interval '15 minutes';
    if result is not null then return result; end if;
    update figcraft_private.online_code_global set tokens = tokens-1 where singleton;
    foreach b in array blocks loop
        scale_factor := case masklen(b) when 48 then 4 when 56 then 2 else 1 end;
        update figcraft_private.online_code_budgets set wrong_at = sampled,
            locked_until = case when wrong+1 >= 10*scale_factor then sampled + interval '15 minutes' else locked_until end,
            wrong = case when wrong+1 >= 10*scale_factor then 0 else wrong+1 end where block = b;
    end loop;
    if exists(select from figcraft_private.retired_online_codes where code_hash = hash_hex and store_started = pg_postmaster_start_time()) then
        return jsonb_build_object('status','gone');
    end if;
    return jsonb_build_object('status','unknown');
end;
$$;
revoke all on function figcraft_private.resolve_online_code(inet,text,timestamptz) from public, anon, authenticated, service_role;

create function figcraft_private.lookup_online_code(address inet, symbols text) returns jsonb
language sql security definer set search_path = ''
as $$ select figcraft_private.resolve_online_code(address, symbols, null); $$;
revoke all on function figcraft_private.lookup_online_code(inet,text) from public, anon, authenticated;
grant usage on schema figcraft_private to service_role;
grant execute on function figcraft_private.lookup_online_code(inet,text) to service_role;

create function public.lookup_online_code(address inet, symbols text) returns jsonb
language sql security invoker set search_path = ''
as $$ select figcraft_private.lookup_online_code(address, symbols); $$;
revoke all on function public.lookup_online_code(inet,text) from public, anon, authenticated;
grant execute on function public.lookup_online_code(inet,text) to service_role;
