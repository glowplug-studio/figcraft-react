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
delete from public.online_file_links where token_hash=encode(sha256(convert_to('view','UTF8')),'hex') and file_id=md5('library-file')::uuid;
select throws_ok($$select pg_temp.fetch('view')$$,'42501','The invite is unavailable','revoked link cannot fetch or probe a version');
delete from public.online_files where id=md5('library-file')::uuid;
select is((select count(*) from public.claim_online_retirement(md5('library-object3')::uuid,1)),1::bigint,'deleting the team file releases its library archive');
select * from finish();
rollback;
