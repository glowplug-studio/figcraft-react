SET local check_function_bodies = off;

DROP INDEX "figcraft_private"."online_code_budgets_age";

ALTER TABLE "figcraft_private"."online_code_budgets"
  ADD COLUMN "admin_tokens" double precision;

ALTER TABLE "figcraft_private"."online_code_budgets"
  ADD COLUMN "admin_used_at" timestamp WITH time zone;

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
            and greatest(used_at,publish_used_at,report_used_at,admin_used_at) <= (select greatest(used_at,publish_used_at,report_used_at,admin_used_at)
            from figcraft_private.online_code_budgets order by greatest(used_at,publish_used_at,report_used_at,admin_used_at) offset 5000 limit 1);
    end if;
    insert into figcraft_private.online_code_budgets(block,tokens,used_at)
        values(b,case masklen(b) when 48 then 40 when 56 then 20 else 10 end,sampled) returning * into budget;
    return budget;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.apply_addressed_share_change (
  actor      uuid,
  target     uuid,
  expected   uuid,
  revision   uuid,
  revoke_ids text[],
  new_links  jsonb,
  address    inet
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.take_admin_request (
  address inet,
  sampled timestamp with time zone
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.apply_addressed_share_change (
  actor      uuid,
  target     uuid,
  expected   uuid,
  revision   uuid,
  revoke_ids text[],
  new_links  jsonb,
  address    inet
)
  RETURNS boolean
  LANGUAGE sql
  SET search_path TO ''
  AS $function$ select figcraft_private.apply_addressed_share_change(actor,target,expected,revision,revoke_ids,new_links,address); $function$;

CREATE INDEX online_code_budgets_age ON figcraft_private.online_code_budgets USING btree (GREATEST(used_at, publish_used_at, report_used_at, admin_used_at));

REVOKE ALL ON FUNCTION "figcraft_private"."apply_addressed_share_change"(uuid, uuid, uuid, uuid, text[], jsonb, inet) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."apply_addressed_share_change"(uuid, uuid, uuid, uuid, text[], jsonb, inet) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."take_admin_request"(inet, timestamp WITH time zone) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."take_admin_request"(inet, timestamp WITH time zone) TO "postgres";

REVOKE ALL ON FUNCTION "public"."apply_addressed_share_change"(uuid, uuid, uuid, uuid, text[], jsonb, inet) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."apply_addressed_share_change"(uuid, uuid, uuid, uuid, text[], jsonb, inet) TO "postgres", "service_role";
