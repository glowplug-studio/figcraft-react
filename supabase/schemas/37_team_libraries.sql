-- A file serves one complete immutable library revision. It can outlive the
-- account that authored it. Deletion or replacement leaves the previous object
-- eligible for the same exact-object cleanup as abandoned file publications.
create table figcraft_private.team_libraries (
    file_id uuid primary key references public.online_files(id) on delete cascade,
    snapshot_id uuid not null unique references storage.objects(id) on delete cascade,
    submission uuid not null,
    library_id text not null check (library_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
    name text not null check (char_length(name)<=200),
    version numeric(20,0) not null check (version between 0 and 18446744073709551615),
    archive_bytes bigint not null check (archive_bytes>0)
);
alter table figcraft_private.team_libraries enable row level security;
revoke all on figcraft_private.team_libraries from public, anon, authenticated, service_role;

create function figcraft_private.take_library_download(address inet, amount bigint, sampled timestamptz) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
    blocks cidr[];
    b cidr;
    budget figcraft_private.online_code_budgets;
    available double precision;
    rate double precision;
    burst double precision;
begin
    if address is null or amount is null or amount<0 then raise exception 'invalid download admission' using errcode='22023'; end if;
    sampled := figcraft_private.admission_clock(sampled);
    select array_agg(block order by multiplier) into blocks from figcraft_private.publication_blocks(address);
    foreach b in array blocks loop
        budget := figcraft_private.admission_bucket(b,blocks,sampled);
        rate := 1048576 * case masklen(b) when 48 then 4 when 56 then 2 else 1 end;
        burst := 16 * rate;
        available := least(burst,coalesce(budget.download_tokens,burst)
            + greatest(0,extract(epoch from sampled-budget.download_used_at))*rate);
        update figcraft_private.online_code_budgets set download_tokens=available,
            download_used_at=greatest(download_used_at,sampled) where block=b;
        if available < least(burst,amount) then return false; end if;
    end loop;
    -- Native take_spread can put a large request into debt at a full burst.
    -- Per-address admission is already spent if the global bucket refuses.
    update figcraft_private.online_code_budgets set download_tokens=download_tokens-amount where block=any(blocks);
    burst := 536870912;
    select least(burst,coalesce(download_tokens,burst)
        + greatest(0,extract(epoch from sampled-download_used_at))*33554432) into available
        from figcraft_private.online_code_global where singleton;
    update figcraft_private.online_code_global set download_tokens=available,
        download_used_at=greatest(download_used_at,sampled) where singleton;
    if available < least(burst,amount) then return false; end if;
    update figcraft_private.online_code_global set download_tokens=download_tokens-amount where singleton;
    return true;
end;
$$;
revoke all on function figcraft_private.take_library_download(inet,bigint,timestamptz) from public, anon, authenticated, service_role;

create function figcraft_private.keep_team_library(target uuid, presented_hash text, snapshot uuid, submission_id uuid,
    identity text, title text, revision numeric, measured bigint) returns text
language plpgsql security definer set search_path = ''
as $$
declare
    listing public.online_files;
    prior figcraft_private.team_libraries;
    access text;
    policy record;
begin
    perform pg_advisory_xact_lock(650130,3);
    select * into listing from public.online_files where id=target for update;
    select l.access_level into access from public.online_file_links l where l.file_id=target and l.token_hash=presented_hash for key share;
    if access is null then raise exception 'The invite is unavailable' using errcode='42501'; end if;
    if access <> 'edit' then raise exception 'Publishing a team library requires an edit link' using errcode='42501'; end if;
    select * into policy from figcraft_private.host_publication_policy();
    if policy.open_publish and listing.owner_id is not null then
        raise exception 'Only files published with the server key can hold a team library on this public server' using errcode='42501';
    end if;
    if revision is null or revision<>trunc(revision) or revision not between 0 and 18446744073709551615
        or identity is null or identity !~ '^[a-zA-Z0-9_-]{1,64}$' or submission_id is null then
        raise exception 'Invalid team library manifest' using errcode='22023';
    end if;
    perform 1 from storage.objects o where o.id=snapshot and o.bucket_id='figcraft-files' and o.owner_id is null
        and o.name ~ ('^library/'||target::text||'/[0-9a-f]{64}[.]figcraft$') for key share;
    if not found or exists(select from figcraft_private.online_retirements where snapshot_id=snapshot) then
        raise exception 'The library upload is unavailable' using errcode='42501';
    end if;
    select * into prior from figcraft_private.team_libraries where file_id=target;
    if found then
        if prior.snapshot_id=snapshot and prior.submission=submission_id and prior.version=revision and prior.library_id=identity then
            return prior.version::text;
        end if;
        if prior.library_id<>identity then raise exception 'This file already holds a different team library' using errcode='FC003'; end if;
        if revision<>prior.version+1 then raise exception 'The next library version must follow %',prior.version using errcode='FC003'; end if;
    elsif revision>4294967296 then
        raise exception 'A first library version may be at most 4294967296' using errcode='FC003';
    end if;
    if measured is null or measured<1 or measured>policy.file_mb::bigint*1048576 then
        raise exception 'The library exceeds the host file size limit' using errcode='FC002';
    end if;
    insert into figcraft_private.team_libraries(file_id,snapshot_id,submission,library_id,name,version,archive_bytes)
        values(target,snapshot,submission_id,identity,title,revision,measured)
        on conflict(file_id) do update set snapshot_id=excluded.snapshot_id,submission=excluded.submission,
            name=excluded.name,version=excluded.version,archive_bytes=excluded.archive_bytes;
    return revision::text;
end;
$$;
revoke all on function figcraft_private.keep_team_library(uuid,text,uuid,uuid,text,text,numeric,bigint) from public, anon, authenticated, service_role;
grant execute on function figcraft_private.keep_team_library(uuid,text,uuid,uuid,text,text,numeric,bigint) to service_role;

create function public.keep_team_library(target uuid, presented_hash text, snapshot uuid, submission_id uuid,
    identity text, title text, revision numeric, measured bigint) returns text
language sql security invoker set search_path = ''
as $$ select figcraft_private.keep_team_library(target,presented_hash,snapshot,submission_id,identity,title,revision,measured); $$;
revoke all on function public.keep_team_library(uuid,text,uuid,uuid,text,text,numeric,bigint) from public, anon, authenticated, service_role;
grant execute on function public.keep_team_library(uuid,text,uuid,uuid,text,text,numeric,bigint) to service_role;

create function figcraft_private.fetch_team_library(target uuid, presented_hash text, have text, address inet)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    kept figcraft_private.team_libraries;
    path text;
begin
    perform 1 from public.online_files where id=target for key share;
    perform 1 from public.online_file_links where file_id=target and token_hash=presented_hash for key share;
    if not found then raise exception 'The invite is unavailable' using errcode='42501'; end if;
    select * into kept from figcraft_private.team_libraries where file_id=target;
    if not found then return jsonb_build_object('state','empty'); end if;
    if have=kept.version::text then return jsonb_build_object('state','unchanged','version',have); end if;
    if not figcraft_private.take_library_download(address,kept.archive_bytes,null) then return jsonb_build_object('state','busy'); end if;
    select name into strict path from storage.objects where id=kept.snapshot_id;
    return jsonb_build_object('state','available','version',kept.version::text,'path',path);
end;
$$;
revoke all on function figcraft_private.fetch_team_library(uuid,text,text,inet) from public, anon, authenticated, service_role;
grant execute on function figcraft_private.fetch_team_library(uuid,text,text,inet) to service_role;
create function public.fetch_team_library(target uuid, presented_hash text, have text, address inet)
returns jsonb language sql security invoker set search_path = ''
as $$ select figcraft_private.fetch_team_library(target,presented_hash,have,address); $$;
revoke all on function public.fetch_team_library(uuid,text,text,inet) from public, anon, authenticated, service_role;
grant execute on function public.fetch_team_library(uuid,text,text,inet) to service_role;
