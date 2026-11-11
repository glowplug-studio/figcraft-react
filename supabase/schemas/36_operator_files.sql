-- A key-authenticated publication belongs to the host. Its private archive is
-- uploaded with the service identity, so deleting the uploader cannot delete it.
create function figcraft_private.keep_operator_publication(target uuid, snapshot uuid, title text,
    links jsonb, measured bigint, max_files integer default 1000)
returns table(id uuid,name text,created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
    existing public.online_files;
    policy record;
begin
    perform pg_advisory_xact_lock(650130,3);
    perform 1 from storage.objects o where o.id=snapshot and o.bucket_id='figcraft-files' and o.owner_id is null
        and o.name ~ ('^operator/' || target::text || '/[0-9a-f]{64}[.]figcraft$') for key share;
    if not found or exists(select from figcraft_private.online_retirements r where r.snapshot_id=snapshot) then
        raise exception 'operator upload is unavailable' using errcode='42501';
    end if;
    select f.* into existing from public.online_files f where f.id=target;
    if found then
        if existing.owner_id is not null or existing.snapshot_id<>snapshot or existing.published_without_key then
            raise exception 'this file already has a different publication receipt' using errcode='22023';
        end if;
    else
        select * into policy from figcraft_private.host_publication_policy();
        if measured is null or measured<17 or max_files is null or max_files<1 then
            raise exception 'invalid operator publication measurement' using errcode='22023';
        end if;
        if measured > policy.file_mb::bigint * 1048576 or (select count(*) from public.online_files)>=max_files then
            raise exception 'This server has reached its file size or count limit' using errcode='FC002';
        end if;
    end if;
    return query select * from public.finalise_online_publication(null,target,snapshot,title,links,true);
    if existing.id is null then
        insert into figcraft_private.online_file_usage(file_id,publisher,snapshot_bytes) values(target,null,measured);
    end if;
end;
$$;
revoke all on function figcraft_private.keep_operator_publication(uuid,uuid,text,jsonb,bigint,integer) from public, anon, authenticated, service_role;
grant execute on function figcraft_private.keep_operator_publication(uuid,uuid,text,jsonb,bigint,integer) to service_role;

create function public.keep_operator_publication(target uuid, snapshot uuid, title text,
    links jsonb, measured bigint, max_files integer default 1000)
returns table(id uuid,name text,created_at timestamptz)
language sql security invoker set search_path = ''
as $$ select * from figcraft_private.keep_operator_publication(target,snapshot,title,links,measured,max_files); $$;
revoke all on function public.keep_operator_publication(uuid,uuid,text,jsonb,bigint,integer) from public,anon,authenticated,service_role;
grant execute on function public.keep_operator_publication(uuid,uuid,text,jsonb,bigint,integer) to service_role;

create function figcraft_private.admit_keyed_publication(address inet) returns boolean
language sql security definer set search_path = ''
as $$ select figcraft_private.take_admin_request(address,null); $$;
revoke all on function figcraft_private.admit_keyed_publication(inet) from public, anon, authenticated, service_role;
grant execute on function figcraft_private.admit_keyed_publication(inet) to service_role;

create function public.admit_keyed_publication(address inet) returns boolean
language sql security invoker set search_path = ''
as $$ select figcraft_private.admit_keyed_publication(address); $$;
revoke all on function public.admit_keyed_publication(inet) from public, anon, authenticated, service_role;
grant execute on function public.admit_keyed_publication(inet) to service_role;

-- Only the authenticated host process may fetch the operator's configured verifier.
create function figcraft_private.operator_publication_verifier() returns text
language sql stable security definer set search_path = ''
as $$ select server_key_sha256 from figcraft_private.online_publication_policy where singleton; $$;
revoke all on function figcraft_private.operator_publication_verifier() from public, anon, authenticated, service_role;
grant execute on function figcraft_private.operator_publication_verifier() to service_role;
create function public.operator_publication_verifier() returns text
language sql stable security invoker set search_path = ''
as $$ select figcraft_private.operator_publication_verifier(); $$;
revoke all on function public.operator_publication_verifier() from public, anon, authenticated, service_role;
grant execute on function public.operator_publication_verifier() to service_role;
