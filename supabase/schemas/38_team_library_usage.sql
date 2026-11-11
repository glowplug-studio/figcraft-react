-- Reported names distinguish consumer files in the native protocol. No auth
-- account, IP address or private document contents belong to these statistics.
create table figcraft_private.library_consumers (
    file_id uuid not null references public.online_files(id) on delete cascade,
    consumer text not null check (char_length(consumer) between 1 and 256),
    ordinal bigint generated always as identity,
    components jsonb not null default '[]',
    detached jsonb not null default '[]',
    styles jsonb not null default '[]',
    variables jsonb not null default '[]',
    updated bigint not null default 0,
    detached_updated bigint not null default 0,
    primary key(file_id,consumer)
);
create table figcraft_private.library_action_peaks (
    file_id uuid not null,
    consumer text not null,
    component numeric(20,0) not null,
    inserted bigint not null default 0, detached bigint not null default 0,
    primary key(file_id,consumer,component),
    foreign key(file_id,consumer) references figcraft_private.library_consumers(file_id,consumer) on delete cascade
);
create table figcraft_private.library_action_weeks (
    file_id uuid not null references public.online_files(id) on delete cascade,
    week bigint not null,
    ordinal bigint generated always as identity,
    component numeric(20,0) not null,
    insertions bigint not null default 0, detachments bigint not null default 0,
    primary key(file_id,week,component)
);
alter table figcraft_private.library_consumers enable row level security;
alter table figcraft_private.library_action_peaks enable row level security;
alter table figcraft_private.library_action_weeks enable row level security;
revoke all on figcraft_private.library_consumers,figcraft_private.library_action_peaks,figcraft_private.library_action_weeks
    from public, anon, authenticated, service_role;

-- Each incoming list has already been cleaned and ordered at trusted ingress.
-- Existing components continue growing when the 1,000 independent peaks are full.
create function figcraft_private.grow_library_actions(target uuid, label text, counts jsonb, is_detach boolean, monday bigint)
returns boolean language sql security invoker set search_path = ''
as $$
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
$$;
revoke all on function figcraft_private.grow_library_actions(uuid,text,jsonb,boolean,bigint) from public, anon, authenticated, service_role;

create function figcraft_private.report_library_usage(target uuid, presented_hash text, report jsonb, sampled timestamptz) returns void
language plpgsql security definer set search_path = ''
as $$
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
$$;
revoke all on function figcraft_private.report_library_usage(uuid,text,jsonb,timestamptz) from public, anon, authenticated, service_role;

create function figcraft_private.submit_library_usage(target uuid,presented_hash text,report jsonb) returns void
language sql security definer set search_path = ''
as $$ select figcraft_private.report_library_usage(target,presented_hash,report,null); $$;
revoke all on function figcraft_private.submit_library_usage(uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function figcraft_private.submit_library_usage(uuid,text,jsonb) to service_role;
create function public.report_library_usage(target uuid,presented_hash text,report jsonb) returns void
language sql security invoker set search_path = ''
as $$ select figcraft_private.submit_library_usage(target,presented_hash,report); $$;
revoke all on function public.report_library_usage(uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.report_library_usage(uuid,text,jsonb) to service_role;

create function figcraft_private.read_library_usage(target uuid,presented_hash text,days integer)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
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
$$;
revoke all on function figcraft_private.read_library_usage(uuid,text,integer) from public, anon, authenticated, service_role;
grant execute on function figcraft_private.read_library_usage(uuid,text,integer) to service_role;
create function public.read_library_usage(target uuid,presented_hash text,days integer default 30)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select figcraft_private.read_library_usage(target,presented_hash,days); $$;
revoke all on function public.read_library_usage(uuid,text,integer) from public, anon, authenticated, service_role;
grant execute on function public.read_library_usage(uuid,text,integer) to service_role;
