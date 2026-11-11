begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
delete from public.online_files;
delete from figcraft_private.online_publication_policy;
select is((select file_mb from public.online_host_information()),16,'existing open hosts default to 16 MiB');
select ok((select open_publish from public.online_host_information()),'existing installations accept keyless publication');
select ok(not has_table_privilege('authenticated','figcraft_private.online_publication_policy','select')
    and not has_table_privilege('service_role','figcraft_private.online_publication_policy','update'),'operator settings are private');
select ok(has_function_privilege('service_role','public.operator_publication_verifier()','execute')
    and not has_function_privilege('authenticated','public.operator_publication_verifier()','execute')
    and not has_function_privilege('anon','public.operator_publication_verifier()','execute'),'only the trusted host can read the verifier');
select ok(not has_function_privilege('authenticated','public.keep_operator_publication(uuid,uuid,text,jsonb,bigint,integer)','execute')
    and not has_function_privilege('anon','public.admit_keyed_publication(inet)','execute'),'clients cannot spoof operator publication or admission');
insert into figcraft_private.online_publication_policy(open_publish) values(false);
select is((select file_mb from public.online_host_information()),64,'private hosts default to 64 MiB');
update figcraft_private.online_publication_policy set max_file_mb=1;
select is((select file_mb from public.online_host_information()),1,'explicit file cap applies in private mode');
select throws_ok($$update figcraft_private.online_publication_policy set max_file_mb=4097$$,'23514',null,'framed file cap is bounded');
insert into auth.users(id) values(md5('operator-uploader')::uuid);
insert into storage.objects(id,bucket_id,name,created_at)
    select md5('operator-object'||i)::uuid,'figcraft-files','operator/'||md5('operator-file'||i)::uuid::text||'/'||repeat('a',64)||'.figcraft',
        now()-interval '1 hour' from generate_series(1,3) i;
create function pg_temp.proof(i integer) returns jsonb language sql as $$
    select jsonb_build_object('edit',jsonb_build_object('id',left(md5('edit'||i),16),'hash',repeat('a',64)),
        'view',jsonb_build_object('id',left(md5('view'||i),16),'hash',repeat('b',64)));
$$;
create function pg_temp.keep(i integer, measured integer, proof integer default null, max_files integer default 1000)
returns integer language sql as $$
    select count(*)::integer from public.keep_operator_publication(md5('operator-file'||i)::uuid,
        md5('operator-object'||i)::uuid,'Keyed file',pg_temp.proof(coalesce(proof,i)),measured,max_files);
$$;
create function pg_temp.keyless(total bigint) returns integer language sql as $$
    select count(*)::integer from public.keep_online_publication(md5('operator-uploader')::uuid,
        md5('keyless-file')::uuid,md5('keyless-object')::uuid,'Keyless',pg_temp.proof(4),true,'192.0.2.1',100,10,20,1000000,total);
$$;
select throws_ok('select pg_temp.keyless(10000000)','42501','This server takes files only from people who have its key','private host refuses prior keyless applications');
select throws_ok('select pg_temp.keep(1,1048577)','FC002','This server has reached its file size or count limit','one byte over the configured cap fails');
select is(pg_temp.keep(1,1048576),1,'exact framed limit succeeds');
select ok((select owner_id is null and not published_without_key from public.online_files where id=md5('operator-file1')::uuid),'file has no account owner or public expiry');
select is(pg_temp.keep(1,1048576,1,1),1,'replay at capacity returns the same receipt');
select throws_ok('select pg_temp.keep(1,1048576,2)','22023','this file already has a different publication receipt','different grant fingerprint cannot claim existing file');
select throws_ok('select pg_temp.keep(2,20,2,1)','FC002','This server has reached its file size or count limit','host count cap includes keyed files');
select is((select count(*) from public.claim_online_retirement(md5('operator-object1')::uuid,1)),0::bigint,'kept keyed files have no idle deadline');
select is((select count(*) from public.claim_online_retirement(md5('operator-object3')::uuid,1)),1::bigint,'abandoned operator upload can be removed after grace');
select throws_ok('select pg_temp.keep(3,20)','42501','operator upload is unavailable','an object under retirement cannot be published');
update figcraft_private.online_publication_policy set open_publish=true;
select throws_ok('select pg_temp.keyless(1048688)','FC002','This server has reached its retained byte limit','global public allowance includes keyed bytes and journal');
select ok((select publisher is null and snapshot_bytes=1048576 from figcraft_private.online_file_usage),'keyed bytes have no public address charge');
select * from finish();
rollback;
