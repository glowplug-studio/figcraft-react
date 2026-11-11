begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id) values(md5('id guest')::uuid);
insert into auth.sessions(id,user_id) values(md5('id session')::uuid,md5('id guest')::uuid);
insert into storage.objects(id,bucket_id,name) values(md5('id object')::uuid,'figcraft-files','ids.figcraft');
insert into public.online_files(id,owner_id,snapshot_id,name) values
    (md5('id file')::uuid,md5('id guest')::uuid,md5('id object')::uuid,'Client identifiers');
insert into public.online_file_links(id,file_id,access_level,label,token_hash) values
    (left(md5('id link'),16),md5('id file')::uuid,'edit','Participant',repeat('a',64));
create function pg_temp.connect(n integer) returns text language sql as $$
    select access_level from public.join_online_file(md5('id guest')::uuid,md5('id session')::uuid,
        md5('id tab'||n)::uuid,md5('id file')::uuid,repeat('a',64));
$$;
create function pg_temp.issue(n integer,secret text,floor bigint default null,capacity integer default 256) returns bigint language sql as $$
    select figcraft_private.issue_live_client(md5('id guest')::uuid,md5('id session')::uuid,md5('id tab'||n)::uuid,
        md5('id file')::uuid,md5('id object')::uuid,encode(sha256(convert_to(secret,'UTF8')),'hex'),floor,capacity);
$$;
select ok(not has_function_privilege('authenticated','public.join_live_file(uuid,uuid,uuid,uuid,text,text,integer,uuid,bigint)','execute')
    and not has_table_privilege('authenticated','figcraft_private.live_clients','select'),'the browser cannot issue or inspect identities');
select ok(not has_function_privilege('authenticated','figcraft_private.issue_live_identity(uuid,uuid,uuid,uuid,uuid,text,bigint,integer)','execute')
    and not has_function_privilege('anon','figcraft_private.issue_live_identity(uuid,uuid,uuid,uuid,uuid,text,bigint,integer)','execute'),
    'only the trusted host can obtain a logical room welcome');
select throws_ok($$select pg_temp.issue(1,'alpha',32)$$,'42501','connection unavailable','a validated physical grant is required');
select is(pg_temp.connect(1),'edit','first grant');
select is(pg_temp.issue(1,'alpha'),null::bigint,'request the floor for an unscanned immutable file');
select is(pg_temp.issue(1,'alpha',32),33::bigint,'allocate above the stored document spaces');
select is(pg_temp.issue(1,'alpha'),33::bigint,'lost reply reuses the allocation');
select throws_ok($$select pg_temp.issue(1,'beta')$$,'42501','connection already bound','another secret cannot replace an existing grant');
select is(pg_temp.connect(2),'edit','second grant');
select throws_ok($$select pg_temp.issue(2,'beta',null,1)$$,'54000','the session is full','a full room refuses a new client');
select is(pg_temp.issue(1,'alpha',null,1),33::bigint,'the connected client may resume when full');
select is(pg_temp.issue(2,'beta'),34::bigint,'another tab in the same login has a distinct number');
select is(pg_temp.connect(3),'edit','reconnecting grant');
select is(pg_temp.issue(3,'alpha'),33::bigint,'an authenticated resume recovers its original namespace');
delete from public.online_file_connections where id=md5('id tab1')::uuid;
select is((select connection_id from figcraft_private.live_clients where client_id=33),md5('id tab3')::uuid,
    'delayed departure of the old physical grant does not remove its replacement');
delete from public.online_file_connections where id=md5('id tab3')::uuid;
select is(pg_temp.connect(4),'edit','fresh grant after departure');
select is(pg_temp.issue(4,'gamma'),35::bigint,'disconnected client numbers are never reassigned');
update figcraft_private.live_rooms set highest_client=4294967294 where file_id=md5('id file')::uuid;
select is(pg_temp.connect(5),'edit','exhaustion fixture grant');
select throws_ok($$select pg_temp.issue(5,'last')$$,'54000','no client ids left in this session','maximum unsigned 32-bit namespace is reserved');
select is(pg_temp.issue(5,'alpha'),33::bigint,'a legitimate resume works in an exhausted room');
delete from public.online_files where id=md5('id file')::uuid;
select ok(not exists(select from figcraft_private.live_clients) and not exists(select from figcraft_private.live_rooms),
    'removal clears this isolated room and its credential digests');
select * from finish();
rollback;
