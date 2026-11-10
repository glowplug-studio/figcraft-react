-- Preserve what the operator saw at submission, even if the file, account or
-- grant is later removed. User and service API roles cannot enumerate reports.
create table figcraft_private.online_participant_reports (
    number bigint generated always as identity primary key,
    reported_at bigint not null,
    file_id uuid not null,
    file_name text not null,
    link_id text not null,
    address inet not null,
    reason text not null check (char_length(reason) between 1 and 500)
);
alter table figcraft_private.online_participant_reports enable row level security;
revoke all on figcraft_private.online_participant_reports from public, anon, authenticated, service_role;

create function figcraft_private.clean_report_reason(reason text) returns text
language sql immutable strict security invoker set search_path = ''
as $$
    select left(btrim(regexp_replace(reason,U&'[[:cntrl:]\061c\200e\200f\202a-\202e\2066-\2069]',' ','g'),
        U&'\0009\000a\000b\000c\000d\0020\0085\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000'),500);
$$;
revoke all on function figcraft_private.clean_report_reason(text) from public, anon, authenticated, service_role;

create function figcraft_private.take_report(address inet, sampled timestamptz) returns boolean
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
$$;
revoke all on function figcraft_private.take_report(inet,timestamptz) from public, anon, authenticated, service_role;

create function figcraft_private.keep_participant_report(actor uuid, auth_session uuid, tab uuid, address inet, reason text)
returns text language plpgsql security definer set search_path = ''
as $$
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
        select floor(extract(epoch from clock_timestamp()))::bigint,connection.file_id,title,connection.link_id,host(block)::inet,cleaned
        from figcraft_private.publication_blocks(address) where multiplier=1;
    delete from figcraft_private.online_participant_reports where number <= (
        select number from figcraft_private.online_participant_reports order by number desc offset 1000 limit 1
    );
    return 'kept';
end;
$$;
revoke all on function figcraft_private.keep_participant_report(uuid,uuid,uuid,inet,text) from public,anon,authenticated,service_role;
grant execute on function figcraft_private.keep_participant_report(uuid,uuid,uuid,inet,text) to service_role;

create function public.submit_participant_report(actor uuid, auth_session uuid, tab uuid, address inet, reason text)
returns text language sql security invoker set search_path = ''
as $$select figcraft_private.keep_participant_report(actor,auth_session,tab,address,reason);$$;
revoke all on function public.submit_participant_report(uuid,uuid,uuid,inet,text) from public,anon,authenticated,service_role;
grant execute on function public.submit_participant_report(uuid,uuid,uuid,inet,text) to service_role;
