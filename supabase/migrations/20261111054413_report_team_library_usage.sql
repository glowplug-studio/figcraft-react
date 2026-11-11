SET local check_function_bodies = off;

CREATE TABLE "figcraft_private"."library_action_peaks" (
  "file_id"   uuid          NOT NULL,
  "consumer"  text          NOT NULL,
  "component" numeric(20,0) NOT NULL,
  "inserted"  bigint        NOT NULL DEFAULT 0,
  "detached"  bigint        NOT NULL DEFAULT 0,
  CONSTRAINT "library_action_peaks_pkey" PRIMARY KEY (file_id, consumer, component)
);

ALTER TABLE "figcraft_private"."library_action_peaks"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "figcraft_private"."library_action_weeks" (
  "file_id"     uuid          NOT NULL,
  "week"        bigint        NOT NULL,
  "ordinal"     bigint        GENERATED ALWAYS AS IDENTITY NOT NULL,
  "component"   numeric(20,0) NOT NULL,
  "insertions"  bigint        NOT NULL DEFAULT 0,
  "detachments" bigint        NOT NULL DEFAULT 0,
  CONSTRAINT "library_action_weeks_pkey" PRIMARY KEY (file_id, week, component)
);

ALTER TABLE "figcraft_private"."library_action_weeks"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "figcraft_private"."library_consumers" (
  "file_id"          uuid   NOT NULL,
  "consumer"         text   NOT NULL,
  "ordinal"          bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "components"       jsonb  NOT NULL DEFAULT '[]'::jsonb,
  "detached"         jsonb  NOT NULL DEFAULT '[]'::jsonb,
  "styles"           jsonb  NOT NULL DEFAULT '[]'::jsonb,
  "variables"        jsonb  NOT NULL DEFAULT '[]'::jsonb,
  "updated"          bigint NOT NULL DEFAULT 0,
  "detached_updated" bigint NOT NULL DEFAULT 0,
  CONSTRAINT "library_consumers_consumer_check" CHECK (((char_length(consumer) >= 1) AND (char_length(consumer) <= 256))),
  CONSTRAINT "library_consumers_pkey" PRIMARY KEY (file_id, consumer)
);

ALTER TABLE "figcraft_private"."library_consumers"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION figcraft_private.grow_library_actions (
  target    uuid,
  label     text,
  counts    jsonb,
  is_detach boolean,
  monday    bigint
)
  RETURNS boolean
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    with incoming as (
        select (value->>0)::numeric as id,(value->>1)::bigint as n from jsonb_array_elements(counts)
    ), compared as (
        select i.*,p.component is null as fresh,coalesce(p.inserted,0) as ins,coalesce(p.detached,0) as det
        from incoming i left join figcraft_private.library_action_peaks p on p.file_id=target and p.consumer=label and p.component=i.id
    ), allowed as (
        select * from compared where not fresh
        union all (select * from compared where fresh order by id limit greatest(0,1000-
            (select count(*) from figcraft_private.library_action_peaks where file_id=target and consumer=label)))
    ), grown as (
        select *,n-case when is_detach then det else ins end as growth from allowed
        where n>case when is_detach then det else ins end
    ), saved as (
        insert into figcraft_private.library_action_peaks(file_id,consumer,component,inserted,detached)
            select target,label,id,case when is_detach then ins else n end,case when is_detach then n else det end from grown
            on conflict(file_id,consumer,component) do update set inserted=excluded.inserted,detached=excluded.detached
    ), weekly as (
    insert into figcraft_private.library_action_weeks as w(file_id,week,component,insertions,detachments)
        select target,monday,id,case when is_detach then 0 else growth end,case when is_detach then growth else 0 end from grown order by id
        on conflict(file_id,week,component) do update set insertions=least(4294967295,w.insertions+excluded.insertions),
            detachments=least(4294967295,w.detachments+excluded.detachments) returning 1
    ) select exists(select from weekly);
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.read_library_usage (
  target         uuid,
  presented_hash text,
  days           integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    since bigint := greatest(0,floor(extract(epoch from statement_timestamp()))::bigint-least(greatest(days,1),365)*86400);
    oldest bigint := extract(epoch from date_trunc('week',statement_timestamp(),'UTC'))::bigint-52*604800;
begin
    if not exists(select from public.online_file_links where file_id=target and token_hash=presented_hash) then
        raise exception 'The invite is unavailable' using errcode='42501';
    end if;
    return jsonb_build_object('files',coalesce((select jsonb_agg(jsonb_build_object('file',consumer,'updated',updated,
        'components',components,'detached',detached,'styles',styles,'variables',variables) order by ordinal)
        from figcraft_private.library_consumers where file_id=target),'[]'),
        'weeks',coalesce((select jsonb_agg(jsonb_build_object('week',week,'component',component::text,
            'insertions',insertions,'detachments',detachments) order by week,component)
            from figcraft_private.library_action_weeks where file_id=target and week+604800>since and week>=oldest),'[]'));
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.report_library_usage (
  target         uuid,
  presented_hash text,
  report         jsonb,
  sampled        timestamp with time zone
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    label text := report->>'file';
    stamp bigint;
    monday bigint;
    grew boolean := false;
begin
    perform 1 from public.online_files where id=target for key share;
    perform 1 from public.online_file_links where file_id=target and token_hash=presented_hash for key share;
    if not found then raise exception 'The invite is unavailable' using errcode='42501'; end if;
    perform 1 from figcraft_private.team_libraries where file_id=target for update;
    if not found or label='' then return; end if;
    sampled := coalesce(sampled,clock_timestamp());
    stamp := floor(extract(epoch from sampled));
    monday := greatest(0,extract(epoch from date_trunc('week',sampled,'UTC'))::bigint);
    insert into figcraft_private.library_consumers as c(file_id,consumer,components,updated)
        values(target,label,report->'components',stamp)
        on conflict(file_id,consumer) do update set components=excluded.components,updated=excluded.updated
        where c.components<>excluded.components or c.updated=0;
    if report ? 'detached' then
        grew := figcraft_private.grow_library_actions(target,label,report->'detached',true,monday);
        update figcraft_private.library_consumers set detached=report->'detached',detached_updated=stamp
            where file_id=target and consumer=label and detached<>report->'detached';
    end if;
    if report ? 'inserted' then grew := figcraft_private.grow_library_actions(target,label,report->'inserted',false,monday) or grew; end if;
    if report ? 'styles' or report ? 'variables' then
        update figcraft_private.library_consumers set styles=coalesce(report->'styles','[]'),variables=coalesce(report->'variables','[]')
            where file_id=target and consumer=label and
                (styles<>coalesce(report->'styles','[]') or variables<>coalesce(report->'variables','[]'));
    end if;
    delete from figcraft_private.library_consumers where file_id=target and consumer in
        (select consumer from figcraft_private.library_consumers where file_id=target
            order by greatest(updated,detached_updated) desc,ordinal offset 200);
    if not grew then return; end if;
    delete from figcraft_private.library_action_weeks where file_id=target and week<=monday-53*604800;
    delete from figcraft_private.library_action_weeks w using
        (select week,component from figcraft_private.library_action_weeks where file_id=target order by week desc,ordinal offset 20000) excess
        where w.file_id=target and w.week=excess.week and w.component=excess.component;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.submit_library_usage (
  target         uuid,
  presented_hash text,
  report         jsonb
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$ select figcraft_private.report_library_usage(target,presented_hash,report,null); $function$;

CREATE OR REPLACE FUNCTION public.read_library_usage (
  target         uuid,
  presented_hash text,
  days           integer DEFAULT 30
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$ select figcraft_private.read_library_usage(target,presented_hash,days); $function$;

CREATE OR REPLACE FUNCTION public.report_library_usage (
  target         uuid,
  presented_hash text,
  report         jsonb
)
  RETURNS void
  LANGUAGE sql
  SET search_path TO ''
  AS $function$ select figcraft_private.submit_library_usage(target,presented_hash,report); $function$;

ALTER TABLE "figcraft_private"."library_action_weeks"
  ADD CONSTRAINT "library_action_weeks_file_id_fkey" FOREIGN KEY (file_id) REFERENCES public.online_files(id) ON DELETE CASCADE;

ALTER TABLE "figcraft_private"."library_consumers"
  ADD CONSTRAINT "library_consumers_file_id_fkey" FOREIGN KEY (file_id) REFERENCES public.online_files(id) ON DELETE CASCADE;

ALTER TABLE "figcraft_private"."library_action_peaks"
  ADD CONSTRAINT "library_action_peaks_file_id_consumer_fkey" FOREIGN KEY (file_id, consumer) REFERENCES figcraft_private.library_consumers(file_id, consumer) ON DELETE CASCADE;

REVOKE ALL ON FUNCTION "figcraft_private"."grow_library_actions"(uuid, text, jsonb, boolean, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."grow_library_actions"(uuid, text, jsonb, boolean, bigint) TO "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."read_library_usage"(uuid, text, integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."read_library_usage"(uuid, text, integer) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."report_library_usage"(uuid, text, jsonb, timestamp WITH time zone) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."report_library_usage"(uuid, text, jsonb, timestamp WITH time zone) TO "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."submit_library_usage"(uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."submit_library_usage"(uuid, text, jsonb) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."read_library_usage"(uuid, text, integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."read_library_usage"(uuid, text, integer) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."report_library_usage"(uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."report_library_usage"(uuid, text, jsonb) TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."library_action_peaks" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."library_action_weeks" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."library_consumers" TO "postgres";
