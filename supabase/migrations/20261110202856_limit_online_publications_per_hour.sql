SET local check_function_bodies = off;

DROP INDEX "figcraft_private"."online_code_budgets_age";

ALTER TABLE "figcraft_private"."online_code_budgets"
  ADD COLUMN "publish_tokens" double precision;

ALTER TABLE "figcraft_private"."online_code_budgets"
  ADD COLUMN "publish_used_at" timestamp WITH time zone;

ALTER TABLE "figcraft_private"."online_code_global"
  ADD COLUMN "publish_tokens" double precision;

ALTER TABLE "figcraft_private"."online_code_global"
  ADD COLUMN "publish_used_at" timestamp WITH time zone;

CREATE OR REPLACE FUNCTION figcraft_private.admission_bucket (
  b             cidr,
  participating cidr[],
  sampled       timestamp with time zone
)
  RETURNS figcraft_private.online_code_budgets
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
    budget figcraft_private.online_code_budgets;
begin
    select * into budget from figcraft_private.online_code_budgets where block = b;
    if found then return budget; end if;
    if (select count(*) from figcraft_private.online_code_budgets) >= 10000 then
        delete from figcraft_private.online_code_budgets where not (block = any(participating))
            and greatest(used_at,publish_used_at) <= (select greatest(used_at,publish_used_at)
            from figcraft_private.online_code_budgets order by greatest(used_at,publish_used_at) offset 5000 limit 1);
    end if;
    insert into figcraft_private.online_code_budgets(block,tokens,used_at)
        values(b,case masklen(b) when 48 then 40 when 56 then 20 else 10 end,sampled) returning * into budget;
    return budget;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.admission_clock (
  sampled timestamp with time zone
)
  RETURNS timestamp WITH time zone
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
    perform pg_advisory_xact_lock(650130, 2);
    sampled := coalesce(sampled,clock_timestamp());
    if not exists(select from figcraft_private.online_code_global where store_started = pg_postmaster_start_time()) then
        delete from figcraft_private.online_code_budgets where block is not null;
        insert into figcraft_private.online_code_global(singleton,tokens,sampled_at,store_started)
            values(true,1000,sampled,pg_postmaster_start_time()) on conflict (singleton) do update
            set tokens = 1000, sampled_at = excluded.sampled_at, store_started = excluded.store_started,
                publish_tokens = null, publish_used_at = null;
    end if;
    return sampled;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.admit_online_publication (
  address inet,
  hourly  bigint
)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$ select figcraft_private.take_online_publication(address,hourly,null); $function$;

CREATE OR REPLACE FUNCTION figcraft_private.resolve_online_code (
  address inet,
  symbols text,
  sampled timestamp with time zone
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
    sampled := figcraft_private.admission_clock(sampled);
    select array_agg(block order by multiplier) into blocks from figcraft_private.publication_blocks(address);

    select max(locked_until) into until_time from figcraft_private.online_code_budgets where block = any(blocks);
    if until_time > sampled then
        return jsonb_build_object('status','locked','minutes',1 + floor(extract(epoch from until_time - sampled)/60)::integer);
    end if;
    foreach b in array blocks loop
        scale_factor := case masklen(b) when 48 then 4 when 56 then 2 else 1 end;
        budget := figcraft_private.admission_bucket(b,blocks,sampled);
        allowance := least(10*scale_factor, budget.tokens + greatest(0,extract(epoch from sampled-budget.used_at))*scale_factor/6);
        update figcraft_private.online_code_budgets set tokens = allowance, used_at = greatest(used_at,sampled) where block = b;
        if allowance < 1 then return jsonb_build_object('status','rate'); end if;
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
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.take_online_publication (
  address inet,
  hourly  bigint,
  sampled timestamp with time zone
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.admit_online_publication (
  address inet,
  hourly  bigint DEFAULT 10
)
  RETURNS boolean
  LANGUAGE sql
  SET search_path TO ''
  AS $function$ select figcraft_private.admit_online_publication(address,hourly); $function$;

CREATE INDEX online_code_budgets_age ON figcraft_private.online_code_budgets USING btree (GREATEST(used_at, publish_used_at));

REVOKE ALL ON FUNCTION "figcraft_private"."admission_bucket"(cidr, cidr[], timestamp WITH time zone) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."admission_bucket"(cidr, cidr[], timestamp WITH time zone) TO "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."admission_clock"(timestamp WITH time zone) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."admission_clock"(timestamp WITH time zone) TO "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."admit_online_publication"(inet, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."admit_online_publication"(inet, bigint) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."take_online_publication"(inet, bigint, timestamp WITH time zone) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."take_online_publication"(inet, bigint, timestamp WITH time zone) TO "postgres";

REVOKE ALL ON FUNCTION "public"."admit_online_publication"(inet, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."admit_online_publication"(inet, bigint) TO "postgres", "service_role";
