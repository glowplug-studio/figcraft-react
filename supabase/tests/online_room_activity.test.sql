begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.id(label text) returns uuid language sql immutable as $$
    select md5('room-activity-' || label)::uuid;
$$;
insert into auth.users(id) values (pg_temp.id('guest')), (pg_temp.id('owner'));
insert into auth.sessions(id,user_id) values (pg_temp.id('login'),pg_temp.id('guest'));
insert into storage.objects(id,bucket_id,name) values (pg_temp.id('snapshot'),'figcraft-files','room-activity.figcraft');
insert into public.online_files(id,owner_id,snapshot_id,name)
    values (pg_temp.id('file'),pg_temp.id('owner'),pg_temp.id('snapshot'),'Room activity');
insert into public.online_file_links(id,file_id,access_level,label,token_hash)
    values ('0123456789abcdef',pg_temp.id('file'),'edit','Edit',repeat('a',64)),
           ('fedcba9876543210',pg_temp.id('file'),'view','View',repeat('b',64));
create function pg_temp.admit(tab text, secret text) returns text language sql as $$
    select access_level from public.join_online_file(pg_temp.id('guest'),pg_temp.id('login'),
        pg_temp.id(tab),pg_temp.id('file'),repeat(secret,64));
$$;
create temporary view room as select * from figcraft_private.online_room_activity where file_id=pg_temp.id('file');
select ok(not exists(select from room),'publishing alone never opens the room');
select ok(not has_table_privilege('authenticated','figcraft_private.online_room_activity','update'),
    'browser accounts cannot set room times or counts');
select is(pg_temp.admit('first','a'),'edit','first editor is admitted');
create temporary table initial_open as select opened_at from room;
select is((select members from room),1::bigint,'first open is counted');
select is(pg_temp.admit('first','a'),'edit','duplicate admission returns the same grant');
select is(pg_temp.admit('second','b'),'view','a viewer joins alongside the editor');
select is((select members from room),2::bigint,'a retried grant is counted once');

select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id('guest'),'session_id',pg_temp.id('login'))::text,true);
select ok(public.online_connection_active(pg_temp.id('first')),'heartbeat renews the editor');
update public.online_files set name='Renamed' where id=pg_temp.id('file');
select is((select opened_at from room),(select opened_at from initial_open),'additional joins, renewals and rename preserve first-open time');
delete from public.online_file_connections where id=pg_temp.id('first');
select is((select members from room),1::bigint,'voluntary leave retains the viewer');
select is((select opened_at from room),(select opened_at from initial_open),'intermediate leave does not reset idle time');
delete from public.online_file_links where id='fedcba9876543210';
select is((select members from room),0::bigint,'revocation closes the last connection');
select ok((select opened_at > (select opened_at from initial_open) and opened_at=latest_departure from room),
    'last leave resets the idle clock');
select is(pg_temp.admit('third','a'),'edit','the remaining edit link can reopen a room');
select ok((select latest_departure is null from room),'a new room starts a fresh occupancy interval');
delete from auth.sessions where id=pg_temp.id('login');
select is((select members from room),0::bigint,'Auth session removal closes its room');

-- An old grant can be swept days later. Charge only time it could have been
-- connected, regardless of the order in which stale rows are reclaimed.
insert into auth.sessions(id,user_id) values (pg_temp.id('login'),pg_temp.id('guest'));
select pg_temp.admit('older','a'),pg_temp.admit('newer','a');
create temporary table ended_at as select pg_postmaster_start_time() - interval '1 day' as latest;
update figcraft_private.online_room_activity set opened_at=(select latest-interval '1 day' from ended_at)
    where file_id=pg_temp.id('file');
update public.online_file_connections set heard_at=(select latest-interval '45 seconds' from ended_at)
    where id=pg_temp.id('newer');
update public.online_file_connections set heard_at=(select latest-interval '2 hours' from ended_at)
    where id=pg_temp.id('older');
delete from public.online_file_connections where id=pg_temp.id('newer');
delete from public.online_file_connections where id=pg_temp.id('older');
select is((select opened_at from room),(select latest from ended_at),'out-of-order late cleanup uses the final silence deadline');

select pg_temp.admit('restart','a');
update figcraft_private.online_room_activity set opened_at=pg_postmaster_start_time()-interval '1 hour'
    where file_id=pg_temp.id('file');
update public.online_file_connections set heard_at=pg_postmaster_start_time()-interval '1 second'
    where id=pg_temp.id('restart');
delete from public.online_file_connections where id=pg_temp.id('restart');
select is((select opened_at from room),pg_postmaster_start_time(),'a restart caps the last leave before its heartbeat deadline');
select pg_temp.admit('delete','a');
delete from public.online_files where id=pg_temp.id('file');
select ok(not exists(select from room),'deleting an occupied file removes its activity without resurrecting it');
select * from finish();
rollback;
