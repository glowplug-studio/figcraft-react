begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_table_privilege('authenticated','figcraft_private.team_libraries','select')
    and not has_function_privilege('authenticated','public.fetch_team_library(uuid,text,text,inet)','execute')
    and not has_function_privilege('anon','public.keep_team_library(uuid,text,uuid,uuid,text,text,numeric,bigint)','execute'),
    'library storage and authenticated host operations are private');
truncate figcraft_private.online_code_budgets,figcraft_private.online_code_global;
create function pg_temp.download_trace() returns text language plpgsql as $$
declare
    bits text := '';
    k integer;
    ip inet;
    amount bigint;
    ms integer;
begin
    for i in 0..2399 loop
        k := (i*37+i/11)%23;
        amount := ((i*3+i/7)%37)*1048576;
        ms := (i/800)*60000+(i%800)*7;
        ip := case i%5 when 0 then ('192.0.2.'||(k%7+1))::inet
            when 1 then ('::ffff:192.0.2.'||(k%7+1))::inet
            else ('2001:db8:32:'||to_hex((k%3)*256+k%9)||'::'||(i%99+1))::inet end;
        bits := bits || case when figcraft_private.take_library_download(ip,amount,'2026-01-01Z'::timestamptz+ms*interval '1 millisecond')
            then '1' else '0' end;
    end loop;
    return bits;
end;
$$;
select is(encode(sha256(convert_to(pg_temp.download_trace(),'UTF8')),'hex'),
    '5af83f531b8252d023ad75e8ff696188981f3e8895b94cf568ffd4274662be62','2400 fetch decisions match Abuse::allow and the native global served bucket in both modes');
truncate figcraft_private.online_code_budgets,figcraft_private.online_code_global;
select ok(figcraft_private.take_library_download('192.0.2.55',33554432,'2026-01-01Z'),'full burst may serve an oversized archive');
select ok(not figcraft_private.take_library_download('192.0.2.55',1,'2026-01-01 00:00:16Z'),'one byte cannot be served until the debt has been repaid');
select ok(figcraft_private.take_library_download('192.0.2.55',1048576,'2026-01-01 00:00:17Z'),'one MiB is available exactly one second after debt repayment');

delete from figcraft_private.online_publication_policy;
insert into storage.objects(id,bucket_id,name,created_at)
    values(md5('library-base')::uuid,'figcraft-files','operator/'||md5('library-file')::uuid::text||'/'||repeat('d',64)||'.figcraft',now()-interval '3 hours');
insert into public.online_files(id,snapshot_id,name,published_without_key)
    values(md5('library-file')::uuid,md5('library-base')::uuid,'Library file',false);
insert into public.online_file_links(id,file_id,access_level,label,token_hash)
    select left(md5(level),16),md5('library-file')::uuid,level,'Published ('||level||')',encode(sha256(convert_to(level,'UTF8')),'hex')
    from unnest(array['edit','view','comment']) level;
insert into storage.objects(id,bucket_id,name,created_at) select md5('library-object'||i)::uuid,'figcraft-files',
    'library/'||md5('library-file')::uuid::text||'/'||repeat(i::text,64)||'.figcraft',now()-interval '2 hours' from generate_series(1,3) i;
create function pg_temp.store(i integer, revision numeric, library text default 'kit', level text default 'edit', op integer default null)
returns text language sql as $$
    select public.keep_team_library(md5('library-file')::uuid,encode(sha256(convert_to(level,'UTF8')),'hex'),md5('library-object'||i)::uuid,
        md5('operation'||coalesce(op,i))::uuid,library,'Kit',revision,1048576);
$$;
create function pg_temp.fetch(level text, have text default null) returns jsonb language sql as $$
    select public.fetch_team_library(md5('library-file')::uuid,encode(sha256(convert_to(level,'UTF8')),'hex'),have,'192.0.2.88');
$$;
select is(pg_temp.fetch('view')->>'state','empty','viewer sees empty before first publication');
select throws_ok($$select pg_temp.store(1,4294967297)$$,'FC003','A first library version may be at most 4294967296','first version rejects a jump over 2^32');
select throws_ok($$select pg_temp.store(1,1,'kit','view')$$,'42501','Publishing a team library requires an edit link','a view link cannot publish');
select is(pg_temp.store(1,4294967296),'4294967296','exact first revision limit is accepted');
select is(pg_temp.store(1,4294967296),'4294967296','retry returns the same receipt');
select is((select count(*) from public.claim_online_retirement(md5('library-object1')::uuid,1)),0::bigint,'current immutable library archive survives the sweep');
select throws_ok($$select pg_temp.store(2,4294967297,'foreign')$$,'FC003','This file already holds a different team library','identity cannot be replaced');
select throws_ok($$select pg_temp.store(2,4294967298)$$,'FC003','The next library version must follow 4294967296','skipped successor is refused');
select is(pg_temp.fetch('comment','4294967296')->>'state','unchanged','same revision needs no download');
select is((select count(*) from figcraft_private.online_code_budgets where block=inet '192.0.2.88'),0::bigint,'unchanged reply spends no bytes');
select is(pg_temp.fetch('view')->>'version','4294967296','view link fetches the current revision as exact text');
select is(pg_temp.store(2,4294967297),'4294967297','successor replaces prior snapshot atomically');
select is((select count(*) from public.claim_online_retirement(md5('library-object1')::uuid,1)),1::bigint,'superseded immutable archive may be reclaimed');
insert into auth.users(id) values(md5('team-library-account')::uuid);
update public.online_files set owner_id=md5('team-library-account')::uuid,published_without_key=true where id=md5('library-file')::uuid;
select throws_ok($$select pg_temp.store(3,4294967298)$$,'42501','Only files published with the server key can hold a team library on this public server','an open host refuses a library for a keyless file');
insert into figcraft_private.online_publication_policy(open_publish) values(false);
update figcraft_private.team_libraries set version=18446744073709551614 where file_id=md5('library-file')::uuid;
select is(pg_temp.store(3,18446744073709551615),'18446744073709551615','private host accepts an edit grant and preserves the exact last u64 revision');
select is(pg_temp.fetch('view','18446744073709551615')->>'state','unchanged','the last u64 revision survives the fetch protocol');
select throws_ok($$select pg_temp.store(3,18446744073709551616)$$,'22023','Invalid team library manifest','version cannot exceed u64');
select ok(not has_function_privilege('authenticated','public.read_library_usage(uuid,text,integer)','execute')
    and not has_function_privilege('anon','public.report_library_usage(uuid,text,jsonb)','execute')
    and not has_function_privilege('service_role','figcraft_private.report_library_usage(uuid,text,jsonb,timestamptz)','execute')
    and not has_table_privilege('authenticated','figcraft_private.library_consumers','select'),'only trusted ingress submits or reads reports and cannot set the clock');
create function pg_temp.sample(body jsonb,stamp timestamptz default now()) returns void language sql as $$
    select figcraft_private.report_library_usage(md5('library-file')::uuid,encode(sha256(convert_to('view','UTF8')),'hex'),body,stamp);
$$;
create function pg_temp.stats(days integer default 30) returns jsonb language sql as $$
    select public.read_library_usage(md5('library-file')::uuid,encode(sha256(convert_to('edit','UTF8')),'hex'),days);
$$;
do $$
declare stamp timestamptz; n integer; key text; attr text; pairs jsonb;
begin
    for i in 0..2099 loop
        stamp := to_timestamp(1735516800+(i/35)*604800);
        n := (i/19+i%7)%91;
        key := ((i*13+i/19)%27)::text;
        attr := case when i%3=0 then 'detached' else 'inserted' end;
        pairs := jsonb_build_array(jsonb_build_array(key,case when n=0 then 2 else n end));
        perform pg_temp.sample(jsonb_build_object('file','fixture'||(i%7),'components','[]'::jsonb,attr,pairs),stamp);
    end loop;
end;
$$;
select is((select encode(sha256(convert_to(string_agg(concat_ws(',',week,component,insertions,detachments)||chr(10),'' order by week,component),'UTF8')),'hex')
    from figcraft_private.library_action_weeks),'b3303050209dd2abe76f8f506bd2dc14162ad7ae70351be93634f8f047d7a6c2',
    '2100 mixed reports across 60 weeks and seven consumers match the pinned Rust growth and retention trace');
truncate figcraft_private.library_consumers,figcraft_private.library_action_peaks,figcraft_private.library_action_weeks;
select pg_temp.sample('{"file":"Manual","components":[["8",3]],"detached":[["8",1]],"inserted":[["8",4]],"styles":[["S",2]],"variables":[["V",2]]}',date_trunc('week',now(),'UTC')-interval '1 second');
select pg_temp.sample('{"file":"Manual","components":[["8",3]],"detached":[["8",1]],"inserted":[["8",4]]}',now());
select is((select updated from figcraft_private.library_consumers),extract(epoch from date_trunc('week',now(),'UTC'))::bigint-1,'unchanged report preserves its usage timestamp');
select pg_temp.sample('{"file":"Manual","components":[],"detached":[],"inserted":[["8",1]]}');
select pg_temp.sample('{"file":"Manual","components":[],"detached":[["8",2]],"inserted":[["8",5]]}');
select is((select sum(insertions)::bigint from figcraft_private.library_action_weeks),5::bigint,'undo, resend and subsequent growth count only increases past the original peak');
select is((select count(distinct week) from figcraft_private.library_action_weeks),2::bigint,'Sunday and Monday reports use separate UTC weeks');
select is(pg_temp.stats()->'files'->0->'styles','[["S",2]]'::jsonb,'absent asset reports preserve existing counts');
select is(pg_temp.stats()->'files'->0->'detached','[["8",2]]'::jsonb,'detached totals are independent of the action period');
insert into figcraft_private.library_action_weeks(file_id,week,component,insertions)
    select md5('library-file')::uuid,extract(epoch from date_trunc('week',now(),'UTC'))::bigint-86400*7*i,999,1
    from unnest(array[2,6,14]) i;
select is((select count(*) from jsonb_array_elements(pg_temp.stats(30)->'weeks') w where w->>'component'='999'),1::bigint,'30-day period includes the two-week fixture only');
select is((select count(*) from jsonb_array_elements(pg_temp.stats(90)->'weeks') w where w->>'component'='999'),2::bigint,'90-day period includes the six-week fixture');
select is((select count(*) from jsonb_array_elements(pg_temp.stats(365)->'weeks') w where w->>'component'='999'),3::bigint,'year period includes the fourteen-week fixture');
select pg_temp.sample('{"file":"Large A","components":[],"inserted":[["8",4294967295]]}');
select pg_temp.sample('{"file":"Large B","components":[],"inserted":[["8",4294967295]]}');
select is((select max(insertions) from figcraft_private.library_action_weeks),4294967295::bigint,'per-component weekly total saturates at u32 max');
select pg_temp.sample(jsonb_build_object('file','Peak cap','components','[]'::jsonb,'inserted',
    (select jsonb_agg(jsonb_build_array(i::text,1) order by i) from generate_series(1,1000)i)));
select pg_temp.sample('{"file":"Peak cap","components":[],"inserted":[["1000",3],["1001",9]]}');
select is((select count(*) from figcraft_private.library_action_peaks where consumer='Peak cap'),1000::bigint,'new IDs cannot displace the first 1000 peaks');
select is((select inserted from figcraft_private.library_action_peaks where consumer='Peak cap' and component=1000),3::bigint,'a known peak keeps growing at capacity');
do $$ begin
    for i in 1..201 loop perform pg_temp.sample(jsonb_build_object('file','file'||i,'components','[]'::jsonb),now()+i*interval '1 second'); end loop;
end $$;
select is((select count(*) from figcraft_private.library_consumers),200::bigint,'most recent 200 named consumers survive');
select ok(not exists(select from figcraft_private.library_action_peaks where consumer='Peak cap'),'eviction cascades to per-file peaks');
truncate figcraft_private.library_action_weeks;
insert into figcraft_private.library_action_weeks(file_id,week,component,insertions)
    select md5('library-file')::uuid,extract(epoch from date_trunc('week',now(),'UTC'))::bigint-7*86400,i,1 from generate_series(1,20000)i;
select pg_temp.sample('{"file":"file201","components":[],"inserted":[["1",2]]}');
select is((select count(*) from figcraft_private.library_action_weeks),20000::bigint,'new activity retains at most 20000 weekly rows');
select ok(not exists(select from figcraft_private.library_action_weeks where component=20000),'equal-week cutoff retains earlier rows first');
delete from public.online_file_links where token_hash=encode(sha256(convert_to('view','UTF8')),'hex') and file_id=md5('library-file')::uuid;
select throws_ok($$select pg_temp.fetch('view')$$,'42501','The invite is unavailable','revoked link cannot fetch or probe a version');
select throws_ok($$select pg_temp.sample('{"file":"Revoked","components":[]}')$$,'42501','The invite is unavailable','revoked viewer cannot submit library usage');
select throws_ok($$select public.read_library_usage(md5('library-file')::uuid,'alien',30)$$,'42501','The invite is unavailable','unrelated grant cannot read private usage');
delete from public.online_files where id=md5('library-file')::uuid;
select is((select count(*) from public.claim_online_retirement(md5('library-object3')::uuid,1)),1::bigint,'deleting the team file releases its library archive');
select * from finish();
rollback;
