begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id) values (md5('lease-guest')::uuid), (md5('lease-owner')::uuid);
insert into auth.sessions(id,user_id) values (md5('lease-login')::uuid,md5('lease-guest')::uuid);
insert into storage.objects(id,bucket_id,name) values (md5('lease-object')::uuid,'figcraft-files','lease-fixture.figcraft');
insert into public.online_files(id,owner_id,snapshot_id,name)
    values (md5('lease-file')::uuid,md5('lease-owner')::uuid,md5('lease-object')::uuid,'Lease fixture');
insert into public.online_file_links(id,file_id,access_level,label,token_hash)
    values (left(md5('lease-link'),16),md5('lease-file')::uuid,'view','Guest',repeat('a',64));
select set_config('request.jwt.claims',jsonb_build_object('sub',md5('lease-guest')::uuid,
    'session_id',md5('lease-login')::uuid)::text,true);
create function pg_temp.join_tab(n integer) returns text language sql as $$
    select access_level from public.join_online_file(md5('lease-guest')::uuid,md5('lease-login')::uuid,
        md5('lease-tab'||n)::uuid,md5('lease-file')::uuid,repeat('a',64));
$$;

select is(pg_temp.join_tab(1),'view','a valid link starts the first tab');
select is(pg_temp.join_tab(2),'view','a second tab receives its own deadline');
select ok(not has_column_privilege('authenticated','public.online_file_connections','heard_at','update'),
    'a guest cannot choose its own heartbeat time');
select ok(not has_function_privilege('authenticated','figcraft_private.connection_cutoff()','execute'),
    'the private store clock is not callable by the browser');
select is((select count(*) from figcraft_private.shared_snapshot_ids()),2::bigint,'both tabs are live initially');

-- Run both statements in one call so statement_timestamp() is identical on both
-- sides of the exact boundary, even immediately after a database restart.
create function pg_temp.check_at_cutoff(delta interval) returns boolean language plpgsql as $$
begin
    update public.online_file_connections set heard_at=figcraft_private.connection_cutoff()+delta
        where id=md5('lease-tab1')::uuid;
    return public.online_connection_active(md5('lease-tab1')::uuid);
end;
$$;
select ok(pg_temp.check_at_cutoff(interval '1 microsecond'),'one microsecond before expiry can renew');
select ok(not pg_temp.check_at_cutoff(interval '0'),'at the silence deadline the heartbeat is refused');
select is((select count(*) from figcraft_private.shared_snapshot_ids()),1::bigint,'only the independently live tab still grants Storage access');
update public.online_file_connections set heard_at=pg_postmaster_start_time()-interval '1 microsecond'
    where id=md5('lease-tab2')::uuid;
select ok(not public.online_connection_active(md5('lease-tab2')::uuid),'a previous store lifetime cannot renew');
select is((select count(*) from figcraft_private.shared_snapshot_ids()),0::bigint,'neither expired tab grants Storage access');
select is(pg_temp.join_tab(1),'view','a fresh redemption of the valid link can rejoin');
select ok(not exists(select from public.online_file_connections where id=md5('lease-tab2')::uuid),
    'new admission reclaims other abandoned rows');
select * from finish();
rollback;
