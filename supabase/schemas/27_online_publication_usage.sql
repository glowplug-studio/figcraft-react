-- Native Store::bytes counts the framed snapshot and its log. A new log has a
-- 13-byte header. Existing uploads have no historical ingress address.
create table figcraft_private.online_file_usage (
    file_id uuid primary key references public.online_files(id) on delete cascade,
    publisher inet,
    snapshot_bytes bigint not null check (snapshot_bytes >= 17),
    log_bytes bigint not null default 13 check (log_bytes >= 13)
);
alter table figcraft_private.online_file_usage enable row level security;
revoke all on figcraft_private.online_file_usage from public, anon, authenticated, service_role;

create function figcraft_private.publication_blocks(address inet)
returns table(block cidr, multiplier integer)
language sql immutable strict parallel safe set search_path = ''
as $$
    with canonical(ip) as (
        select case when address <<= inet '::ffff:0:0/96'
            then inet '0.0.0.0' + (address - inet '::ffff:0:0') else address end
    )
    select network(set_masklen(ip, bits)), scale
    from canonical cross join (values (4,32,1),(6,64,1),(6,56,2),(6,48,4)) as ranges(af,bits,scale)
    where family(ip) = af order by scale;
$$;
revoke all on function figcraft_private.publication_blocks(inet) from public, anon, authenticated, service_role;

-- Reads and writes for a pre-accounting installation are scoped to immutable
-- object IDs. Deleting or recreating a file during measurement cannot attach
-- the old size to a new listing.
create function figcraft_private.unmeasured_online_files()
returns table(file_id uuid, owner_id uuid, snapshot_id uuid)
language sql stable security definer set search_path = ''
as $$
    select f.id, f.owner_id, f.snapshot_id from public.online_files f
    where not exists (select from figcraft_private.online_file_usage u where u.file_id = f.id)
    order by f.id limit 8;
$$;
revoke all on function figcraft_private.unmeasured_online_files() from public, anon, authenticated;
grant execute on function figcraft_private.unmeasured_online_files() to service_role;

create function figcraft_private.record_prior_online_usage(target uuid, snapshot uuid, measured bigint)
returns void language sql security definer set search_path = ''
as $$
    insert into figcraft_private.online_file_usage(file_id,snapshot_bytes)
    select f.id, measured from public.online_files f where f.id = target and f.snapshot_id = snapshot
    on conflict (file_id) do nothing;
$$;
revoke all on function figcraft_private.record_prior_online_usage(uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function figcraft_private.record_prior_online_usage(uuid,uuid,bigint) to service_role;

create function figcraft_private.keep_online_publication(
    actor uuid, target uuid, snapshot uuid, title text, links jsonb, verify_pair boolean,
    address inet, measured bigint,
    max_files integer default 1000, max_files_per_ip integer default 20,
    max_bytes_per_ip bigint default 268435456, max_total_bytes bigint default 10737418240
) returns table(id uuid, name text, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
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
$$;
revoke all on function figcraft_private.keep_online_publication(uuid,uuid,uuid,text,jsonb,boolean,inet,bigint,integer,integer,bigint,bigint)
    from public, anon, authenticated;
grant execute on function figcraft_private.keep_online_publication(uuid,uuid,uuid,text,jsonb,boolean,inet,bigint,integer,integer,bigint,bigint)
    to service_role;

create function public.unmeasured_online_files()
returns table(file_id uuid, owner_id uuid, snapshot_id uuid)
language sql stable security invoker set search_path = ''
as $$
    select * from figcraft_private.unmeasured_online_files();
$$;
revoke all on function public.unmeasured_online_files() from public, anon, authenticated;
grant execute on function public.unmeasured_online_files() to service_role;

create function public.record_prior_online_usage(target uuid, snapshot uuid, measured bigint)
returns void
language sql volatile security invoker set search_path = ''
as $$
    select figcraft_private.record_prior_online_usage(target,snapshot,measured);
$$;
revoke all on function public.record_prior_online_usage(uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.record_prior_online_usage(uuid,uuid,bigint) to service_role;

create function public.keep_online_publication(actor uuid, target uuid, snapshot uuid, title text, links jsonb, verify_pair boolean,
    address inet, measured bigint, max_files integer default 1000, max_files_per_ip integer default 20,
    max_bytes_per_ip bigint default 268435456, max_total_bytes bigint default 10737418240)
returns table(id uuid, name text, created_at timestamptz)
language sql volatile security invoker set search_path = ''
as $$
    select * from figcraft_private.keep_online_publication(actor,target,snapshot,title,links,verify_pair,
        address,measured,max_files,max_files_per_ip,max_bytes_per_ip,max_total_bytes);
$$;
revoke all on function public.keep_online_publication(uuid,uuid,uuid,text,jsonb,boolean,inet,bigint,integer,integer,bigint,bigint) from public, anon, authenticated;
grant execute on function public.keep_online_publication(uuid,uuid,uuid,text,jsonb,boolean,inet,bigint,integer,integer,bigint,bigint) to service_role;
