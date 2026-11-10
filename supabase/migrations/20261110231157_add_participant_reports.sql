SET local check_function_bodies = off;

DROP INDEX "figcraft_private"."online_code_budgets_age";

DROP FUNCTION "public"."online_host_information"(uuid);

CREATE TABLE "figcraft_private"."online_host_contact" (
  "singleton"        boolean NOT NULL DEFAULT true,
  "operator_contact" text    NOT NULL DEFAULT ''::text,
  "terms_url"        text    NOT NULL DEFAULT ''::text,
  CONSTRAINT "online_host_contact_operator_contact_check" CHECK (((char_length(operator_contact) <= 120) AND (operator_contact !~ '[[:cntrl:]]'::text))),
  CONSTRAINT "online_host_contact_pkey" PRIMARY KEY (singleton),
  CONSTRAINT "online_host_contact_singleton_check" CHECK (singleton),
  CONSTRAINT "online_host_contact_terms_url_check"
    CHECK (((terms_url = ''::text) OR ((terms_url ~ '^https?://'::text) AND (octet_length(terms_url) <= 500) AND (terms_url !~ '[[:space:][:cntrl:]]'::text))))
);

ALTER TABLE "figcraft_private"."online_host_contact"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "figcraft_private"."online_participant_reports" (
  "number"      bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "reported_at" bigint NOT NULL,
  "file_id"     uuid   NOT NULL,
  "file_name"   text   NOT NULL,
  "link_id"     text   NOT NULL,
  "address"     inet   NOT NULL,
  "reason"      text   NOT NULL,
  CONSTRAINT "online_participant_reports_pkey" PRIMARY KEY (number),
  CONSTRAINT "online_participant_reports_reason_check" CHECK (((char_length(reason) >= 1) AND (char_length(reason) <= 500)))
);

ALTER TABLE "figcraft_private"."online_participant_reports"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "figcraft_private"."online_code_budgets"
  ADD COLUMN "report_tokens" double precision;

ALTER TABLE "figcraft_private"."online_code_budgets"
  ADD COLUMN "report_used_at" timestamp WITH time zone;

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
            and greatest(used_at,publish_used_at,report_used_at) <= (select greatest(used_at,publish_used_at,report_used_at)
            from figcraft_private.online_code_budgets order by greatest(used_at,publish_used_at,report_used_at) offset 5000 limit 1);
    end if;
    insert into figcraft_private.online_code_budgets(block,tokens,used_at)
        values(b,case masklen(b) when 48 then 40 when 56 then 20 else 10 end,sampled) returning * into budget;
    return budget;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.clean_report_reason (
  reason text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  STRICT
  SET search_path TO ''
  AS $function$
    select left(btrim(regexp_replace(reason,U&'[[:cntrl:]\061c\200e\200f\202a-\202e\2066-\2069]',' ','g'),
        U&'\0009\000a\000b\000c\000d\0020\0085\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000'),500);
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.host_contact()
  RETURNS TABLE (
    operator_contact text,
    terms_url        text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    select coalesce(c.operator_contact,''),coalesce(c.terms_url,'')
    from (values(true)) as defaults(singleton)
    left join figcraft_private.online_host_contact c using(singleton);
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.keep_participant_report (
  actor        uuid,
  auth_session uuid,
  tab          uuid,
  address      inet,
  reason       text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    connection public.online_file_connections;
    title text;
    cleaned text := figcraft_private.clean_report_reason(reason);
begin
    if coalesce(cleaned,'') = '' then return 'empty'; end if;
    select c.* into connection from public.online_file_connections c where c.id=tab
        and c.principal_id=actor and c.session_id=auth_session;
    if not found then return 'unavailable'; end if;
    -- Use the same file → link → connection order as join and owner revocation.
    select f.name into title from public.online_files f where f.id=connection.file_id for key share;
    if not found then return 'unavailable'; end if;
    perform 1 from public.online_file_links l where l.id=connection.link_id for key share;
    if not found then return 'unavailable'; end if;
    perform 1 from public.online_file_connections c where c.id=tab and c.link_id=connection.link_id
        and c.principal_id=actor and c.session_id=auth_session and c.heard_at>figcraft_private.connection_cutoff() for share;
    if not found then return 'unavailable'; end if;
    if not figcraft_private.take_report(address,null) then return 'rate'; end if;
    insert into figcraft_private.online_participant_reports(reported_at,file_id,file_name,link_id,address,reason)
        values(floor(extract(epoch from clock_timestamp()))::bigint,connection.file_id,title,connection.link_id,address,cleaned);
    delete from figcraft_private.online_participant_reports where number <= (
        select number from figcraft_private.online_participant_reports order by number desc offset 1000 limit 1
    );
    return 'kept';
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.take_report (
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
        capacity := case masklen(b) when 48 then 40 when 56 then 20 else 10 end;
        available := least(capacity, coalesce(budget.report_tokens,capacity) +
            greatest(0,extract(epoch from sampled-budget.report_used_at)) * (capacity / 3600));
        update figcraft_private.online_code_budgets set report_tokens=available,
            report_used_at=greatest(report_used_at,sampled) where block=b;
        if available < 1 then return false; end if;
    end loop;
    update figcraft_private.online_code_budgets set report_tokens=report_tokens-1 where block=any(blocks);
    return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.online_host_information (
  target uuid DEFAULT NULL::uuid
)
  RETURNS TABLE (
    idle_seconds     text,
    expires          text,
    operator_contact text,
    terms_url        text,
    accepts_reports  boolean
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$ select trunc(figcraft_private.host_idle_seconds())::text, figcraft_private.visible_online_expiry(target),
    c.operator_contact,c.terms_url,true from figcraft_private.host_contact() c; $function$;

CREATE OR REPLACE FUNCTION public.submit_participant_report (
  actor        uuid,
  auth_session uuid,
  tab          uuid,
  address      inet,
  reason       text
)
  RETURNS text
  LANGUAGE sql
  SET search_path TO ''
  AS $function$select figcraft_private.keep_participant_report(actor,auth_session,tab,address,reason);$function$;

CREATE INDEX online_code_budgets_age ON figcraft_private.online_code_budgets USING btree (GREATEST(used_at, publish_used_at, report_used_at));

REVOKE ALL ON FUNCTION "figcraft_private"."clean_report_reason"(text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."clean_report_reason"(text) TO "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."host_contact"() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."host_contact"() TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."keep_participant_report"(uuid, uuid, uuid, inet, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."keep_participant_report"(uuid, uuid, uuid, inet, text) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."take_report"(inet, timestamp WITH time zone) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."take_report"(inet, timestamp WITH time zone) TO "postgres";

REVOKE ALL ON FUNCTION "public"."online_host_information"(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."online_host_information"(uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."submit_participant_report"(uuid, uuid, uuid, inet, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."submit_participant_report"(uuid, uuid, uuid, inet, text) TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."online_host_contact" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."online_participant_reports" TO "postgres";
