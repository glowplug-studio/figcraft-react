begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
create function pg_temp.uid(value text) returns uuid language sql immutable as $$select md5('directory-'||value)::uuid;$$;
insert into auth.users(id) values(pg_temp.uid('owner')), (pg_temp.uid('other'));
insert into storage.objects(id,bucket_id,name,owner_id) values(pg_temp.uid('bytes'),'figcraft-files',
    pg_temp.uid('owner')::text||'/'||pg_temp.uid('file')::text||'.figcraft',pg_temp.uid('owner')::text);
insert into public.online_files(id,owner_id,snapshot_id,name) values(pg_temp.uid('file'),pg_temp.uid('owner'),pg_temp.uid('bytes'),'Listing');
insert into public.online_file_links(id,file_id,access_level,label,token_hash)
    values('0000000000000002',pg_temp.uid('file'),'view','Viewer',repeat('2',64)),
          ('0000000000000001',pg_temp.uid('file'),'edit','Editor',repeat('1',64));
select ok(not has_function_privilege('anon','public.online_owned_link_ids(public.online_files)','execute'),'anonymous listing lookup denied');
select ok(not has_function_privilege('service_role','figcraft_private.owned_link_ids(uuid)','execute'),'no service role grant on the account lookup');
select ok(not has_table_privilege('authenticated','public.online_file_links','select'),'stored credentials remain private');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid('owner'))::text,true);
select is((select public.online_owned_link_ids(f) from public.online_files f where id=pg_temp.uid('file')),
    array['0000000000000001','0000000000000002'],'the owner reads identifiers in one listing');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid('other'))::text,true);
select is(public.online_owned_link_ids(jsonb_populate_record(null::public.online_files,
    jsonb_build_object('id',pg_temp.uid('file'),'owner_id',pg_temp.uid('other')))),null::text[],'forged composite cannot disclose another owner’s link identifiers');
select is(figcraft_private.owned_link_ids(pg_temp.uid('file')),null::text[],'direct helper checks the actual owner');
reset role;
delete from public.online_file_links where file_id=pg_temp.uid('file');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid('owner'))::text,true);
select is((select public.online_owned_link_ids(f) from public.online_files f where id=pg_temp.uid('file')),
    array[]::text[],'an owner can distinguish an empty link set from an unavailable file');
reset role;
select * from finish();
rollback;
