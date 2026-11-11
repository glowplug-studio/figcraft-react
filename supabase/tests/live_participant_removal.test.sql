begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.id(text) returns uuid language sql immutable as $$select md5('removal/'||$1)::uuid$$;
insert into auth.users(id) select pg_temp.id(n) from unnest(array['owner','guest']) n;
insert into auth.sessions(id,user_id) select pg_temp.id(n||'/login'),pg_temp.id(n) from unnest(array['owner','guest']) n;
insert into storage.objects(id,bucket_id,name) select pg_temp.id(f||'/object'),'figcraft-files',f||'-removal.figcraft' from unnest(array['one','two']) f;
insert into public.online_files(id,owner_id,snapshot_id,name)
    select pg_temp.id(f),pg_temp.id('owner'),pg_temp.id(f||'/object'),f from unnest(array['one','two']) f;
insert into public.online_file_links(id,file_id,access_level,label,token_hash)
    select left(md5(f),16),pg_temp.id(f),'edit','Participant',repeat('1',64) from unnest(array['one','two']) f;

create function pg_temp.admit(person text,physical text,f text,ip inet) returns bigint language sql as $$
    select (public.join_live_file_at_address(pg_temp.id(person),pg_temp.id(person||'/login'),pg_temp.id(physical),pg_temp.id(f),
        repeat('1',64),encode(sha256(convert_to(physical,'UTF8')),'hex'),256,pg_temp.id(f||'/object'),0,ip)->>'client')::bigint;
$$;
create function pg_temp.expel(person text,physical text,f text,client bigint,operator boolean default false) returns jsonb language sql as $$
    select public.remove_live_participant(pg_temp.id(person),pg_temp.id(person||'/login'),pg_temp.id(physical),pg_temp.id(f),client,operator);
$$;
select ok(not has_function_privilege('authenticated','public.remove_live_participant(uuid,uuid,uuid,uuid,bigint,boolean)','execute')
    and not has_function_privilege('anon','public.join_live_file_at_address(uuid,uuid,uuid,uuid,text,text,integer,uuid,bigint,inet)','execute')
    and not has_function_privilege('service_role','figcraft_private.admit_live_file(uuid,uuid,uuid,uuid,text,text,integer,uuid,bigint)','execute'),
    'only trusted scoped admission and management entry points are callable');
select ok(not has_table_privilege('authenticated','figcraft_private.live_connection_addresses','select')
    and not has_table_privilege('service_role','figcraft_private.live_barred_addresses','insert'),'address information is private');
select is(pg_temp.admit('owner','o','one','192.0.2.1'),1::bigint,'owner joins');
select is(pg_temp.admit('guest','a','one','2001:db8::2'),2::bigint,'guest joins from IPv6');
select is(pg_temp.admit('guest','b','one','2001:db8::2'),3::bigint,'another session from the same address is admitted');
select is(pg_temp.admit('owner','o2','two','192.0.2.1'),1::bigint,'owner opens a second file');
select throws_ok($$select pg_temp.expel('guest','a','one',3)$$,'42501','only the file owner can remove people','ordinary edit access cannot expel');
select throws_ok($$select pg_temp.expel('owner','o2','one',2)$$,'42501','the session is unavailable','ownership needs the active file grant');
select throws_ok($$select pg_temp.expel('owner','o','one',1)$$,'FC044','nobody with that client id is in this file','cannot select yourself from the People menu');
select throws_ok($$select public.remove_live_participant(pg_temp.id('owner'),pg_temp.id('guest/login'),pg_temp.id('o'),pg_temp.id('one'),2,true)$$,
    '42501','the session is unavailable','operator ingress also requires a verified login principal');
select is((pg_temp.expel('owner','o','one',2)->>'removed')::bigint,2::bigint,'owner expels selected client');
select ok(exists(select from realtime.messages where topic='figcraft-connection:'||pg_temp.id('guest/login')||':'||pg_temp.id('a')
    and event='ended' and payload->>'reason'='expelled'),'dedicated terminal reason reaches precisely that login and tab');
select ok(not exists(select from public.online_file_connections where id=pg_temp.id('a'))
    and exists(select from public.online_file_connections where id=pg_temp.id('b')),'another session on the same address stays open');
select throws_ok($$select pg_temp.admit('guest','again','one','2001:db8::2')$$,'FC043','you were removed from this session','a fresh valid token and tab cannot evade the address bar');
select ok(not exists(select from public.online_file_connections where id=pg_temp.id('again')),'refused admission leaves no provisional grant');
select is(pg_temp.admit('guest','other','two','2001:db8::2'),2::bigint,'the address still works in another file');
select is(pg_temp.admit('guest','new-ip','one','192.0.2.20'),4::bigint,'a different address works and the previous refusal spent no client id');
insert into figcraft_private.live_barred_addresses select pg_temp.id('one'),'198.51.100.0'::inet+i from generate_series(0,254) i;
select is((pg_temp.expel('guest',null,'one',4,true)->>'removed')::bigint,4::bigint,'verified operator can expel without an editor grant');
select is((select count(*) from figcraft_private.live_barred_addresses where file_id=pg_temp.id('one')),256::bigint,'room retains at most 256 addresses');
select is(pg_temp.admit('guest','quota','one','192.0.2.20'),5::bigint,'at capacity the victim is disconnected but its address is not added');
delete from public.online_file_connections where file_id=pg_temp.id('one');
select is((select count(*) from figcraft_private.live_barred_addresses where file_id=pg_temp.id('one')),0::bigint,'last departure clears the file ban');
select is(pg_temp.admit('guest','after-idle','one','2001:db8::2'),6::bigint,'reopened file admits the address and retains its durable allocation');
select * from finish();
rollback;
