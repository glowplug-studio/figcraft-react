SET local check_function_bodies = off;

REVOKE ALL ON FUNCTION "public"."finalise_online_publication"(uuid, uuid, uuid, text, jsonb, boolean) FROM "service_role";

CREATE TABLE "figcraft_private"."online_file_usage" (
  "file_id"        uuid   NOT NULL,
  "publisher"      inet,
  "snapshot_bytes" bigint NOT NULL,
  "log_bytes"      bigint NOT NULL DEFAULT 13,
  CONSTRAINT "online_file_usage_log_bytes_check" CHECK ((log_bytes >= 13)),
  CONSTRAINT "online_file_usage_pkey" PRIMARY KEY (file_id),
  CONSTRAINT "online_file_usage_snapshot_bytes_check" CHECK ((snapshot_bytes >= 17))
);

ALTER TABLE "figcraft_private"."online_file_usage"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION figcraft_private.keep_online_publication (
  actor            uuid,
  target           uuid,
  snapshot         uuid,
  title            text,
  links            jsonb,
  verify_pair      boolean,
  address          inet,
  measured         bigint,
  max_files        integer DEFAULT 1000,
  max_files_per_ip integer DEFAULT 20,
  max_bytes_per_ip bigint  DEFAULT 268435456,
  max_total_bytes  bigint  DEFAULT '10737418240'::bigint
)
  RETURNS TABLE (
    id         uuid,
    name       text,
    created_at timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    existing boolean;
    stored_address inet;
    usage record;
    file_count bigint;
    total_bytes numeric;
begin
    -- Admission and reservation are one transaction across all host workers.
    perform pg_advisory_xact_lock(650130, 3);
    select exists(select from public.online_files f
        where f.id = target and f.owner_id = actor and f.snapshot_id = snapshot) into existing;
    if not existing then
        if address is null or measured is null or measured < 17 or max_files is null or max_files < 0
           or max_files_per_ip is null or max_files_per_ip < 0 or max_bytes_per_ip is null or max_bytes_per_ip < 0
           or max_total_bytes is null or max_total_bytes < 0 then
            raise exception 'invalid publication measurement or host limits' using errcode = '22023';
        end if;
        if exists(select from figcraft_private.unmeasured_online_files()) then
            raise exception 'retained sizes require measurement' using errcode = 'FC001';
        end if;
        select count(*), coalesce(sum(u.snapshot_bytes::numeric + u.log_bytes), 0)
        into file_count, total_bytes from figcraft_private.online_file_usage u;
        for usage in
            select b.block, b.multiplier, count(u.file_id) as files,
                coalesce(sum(u.snapshot_bytes::numeric + u.log_bytes), 0) as bytes
            from figcraft_private.publication_blocks(address) b left join figcraft_private.online_file_usage u
                on u.publisher <<= b.block
            group by b.block, b.multiplier order by b.multiplier
        loop
            if usage.multiplier = 1 then stored_address := usage.block::inet; end if;
            if usage.files >= max_files_per_ip::bigint * usage.multiplier then
                raise exception 'Your address has reached its retained file limit' using errcode = 'FC002';
            end if;
            if usage.bytes + measured > max_bytes_per_ip::numeric * usage.multiplier then
                raise exception 'Your address has reached its retained byte limit' using errcode = 'FC002';
            end if;
        end loop;
        if file_count >= max_files then
            raise exception 'This server has reached its retained file limit' using errcode = 'FC002';
        end if;
        if total_bytes + measured > max_total_bytes then
            raise exception 'This server has reached its retained byte limit' using errcode = 'FC002';
        end if;
    end if;
    return query select * from public.finalise_online_publication(actor,target,snapshot,title,links,verify_pair);
    if not existing then
        insert into figcraft_private.online_file_usage(file_id,publisher,snapshot_bytes)
            values(target,stored_address,measured);
    end if;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.publication_blocks (
  address inet
)
  RETURNS TABLE (
    block      cidr,
    multiplier integer
  )
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
  SET search_path TO ''
  AS $function$
    with canonical(ip) as (
        select case when address <<= inet '::ffff:0:0/96'
            then inet '0.0.0.0' + (address - inet '::ffff:0:0') else address end
    )
    select network(set_masklen(ip, bits)), scale
    from canonical cross join (values (4,32,1),(6,64,1),(6,56,2),(6,48,4)) as ranges(af,bits,scale)
    where family(ip) = af order by scale;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.record_prior_online_usage (
  target   uuid,
  snapshot uuid,
  measured bigint
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    insert into figcraft_private.online_file_usage(file_id,snapshot_bytes)
    select f.id, measured from public.online_files f where f.id = target and f.snapshot_id = snapshot
    on conflict (file_id) do nothing;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.unmeasured_online_files()
  RETURNS TABLE (
    file_id     uuid,
    owner_id    uuid,
    snapshot_id uuid
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    select f.id, f.owner_id, f.snapshot_id from public.online_files f
    where not exists (select from figcraft_private.online_file_usage u where u.file_id = f.id)
    order by f.id limit 8;
$function$;

CREATE OR REPLACE FUNCTION public.keep_online_publication (
  actor            uuid,
  target           uuid,
  snapshot         uuid,
  title            text,
  links            jsonb,
  verify_pair      boolean,
  address          inet,
  measured         bigint,
  max_files        integer DEFAULT 1000,
  max_files_per_ip integer DEFAULT 20,
  max_bytes_per_ip bigint  DEFAULT 268435456,
  max_total_bytes  bigint  DEFAULT '10737418240'::bigint
)
  RETURNS TABLE (
    id         uuid,
    name       text,
    created_at timestamp with time zone
  )
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    select * from figcraft_private.keep_online_publication(actor,target,snapshot,title,links,verify_pair,
        address,measured,max_files,max_files_per_ip,max_bytes_per_ip,max_total_bytes);
$function$;

CREATE OR REPLACE FUNCTION public.record_prior_online_usage (
  target   uuid,
  snapshot uuid,
  measured bigint
)
  RETURNS void
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    select figcraft_private.record_prior_online_usage(target,snapshot,measured);
$function$;

CREATE OR REPLACE FUNCTION public.unmeasured_online_files()
  RETURNS TABLE (
    file_id     uuid,
    owner_id    uuid,
    snapshot_id uuid
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
    select * from figcraft_private.unmeasured_online_files();
$function$;

ALTER TABLE "figcraft_private"."online_file_usage"
  ADD CONSTRAINT "online_file_usage_file_id_fkey" FOREIGN KEY (file_id) REFERENCES public.online_files(id) ON DELETE CASCADE;

REVOKE ALL ON FUNCTION "figcraft_private"."keep_online_publication"(uuid, uuid, uuid, text, jsonb, boolean, inet, bigint, integer, integer, bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
  ON FUNCTION "figcraft_private"."keep_online_publication"(uuid, uuid, uuid, text, jsonb, boolean, inet, bigint, integer, integer, bigint, bigint)
  TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."publication_blocks"(inet) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."publication_blocks"(inet) TO "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."record_prior_online_usage"(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."record_prior_online_usage"(uuid, uuid, bigint) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."unmeasured_online_files"() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."unmeasured_online_files"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."keep_online_publication"(uuid, uuid, uuid, text, jsonb, boolean, inet, bigint, integer, integer, bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."keep_online_publication"(uuid, uuid, uuid, text, jsonb, boolean, inet, bigint, integer, integer, bigint, bigint) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."record_prior_online_usage"(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."record_prior_online_usage"(uuid, uuid, bigint) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."unmeasured_online_files"() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."unmeasured_online_files"() TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."online_file_usage" TO "postgres";
