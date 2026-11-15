begin;
create extension if not exists pgtap with schema extensions;
select plan(11);
select ok(not has_function_privilege('anon','public.manage_online_link(uuid,uuid,text,text,jsonb,inet)','execute'),'anonymous callers cannot impersonate the management host');
select ok(not has_function_privilege('authenticated','public.manage_online_link(uuid,uuid,text,text,jsonb,inet)','execute'),'signed-in callers cannot supply another actor to management');
select ok(not has_function_privilege('anon','figcraft_private.manage_online_link(uuid,uuid,text,text,jsonb,inet)','execute'),'anonymous callers cannot bypass the public boundary');
select ok(not has_function_privilege('authenticated','figcraft_private.manage_online_link(uuid,uuid,text,text,jsonb,inet)','execute'),'signed-in callers cannot bypass the private boundary');
select ok(has_function_privilege('service_role','public.manage_online_link(uuid,uuid,text,text,jsonb,inet)','execute'),'the verified host can perform management');
select ok(not has_column_privilege('authenticated','public.online_file_links','position','select'),'new ordering metadata does not expose the credential table');

create function pg_temp.uid(value text) returns uuid language sql immutable as $$select md5('individual-'||value)::uuid;$$;
insert into auth.users(id) values(pg_temp.uid('owner'));
insert into storage.objects(id,bucket_id,name,owner_id) values(pg_temp.uid('bytes'),'figcraft-files',
    pg_temp.uid('owner')::text||'/'||pg_temp.uid('file')::text||'.figcraft',pg_temp.uid('owner')::text);
insert into public.online_files(id,owner_id,snapshot_id,name) values(pg_temp.uid('file'),pg_temp.uid('owner'),pg_temp.uid('bytes'),'Management');
insert into public.online_file_links(id,file_id,access_level,label,token_hash)
    values('0000000000000001',pg_temp.uid('file'),'edit','Editor',repeat('1',64)),
          ('0000000000000002',pg_temp.uid('file'),'view','Viewer',repeat('2',64));
insert into figcraft_private.online_link_settings(singleton,max_links) values(true,2)
    on conflict(singleton) do update set max_links=excluded.max_links;
create function pg_temp.create_link() returns jsonb language sql as $$
    select public.manage_online_link(pg_temp.uid('owner'),pg_temp.uid('file'),'createLink',null,
        jsonb_build_object('id','0000000000000003','access_level','comment','label','Comment','token_hash',repeat('3',64)),
        'fd73:beef::1'::inet);
$$;
select is(pg_temp.create_link(),'{"state":"limit","maximum":"2"}'::jsonb,'individual creation honours the configured cap and exact decimal receipt');
update figcraft_private.online_link_settings set max_links=3;
select is(pg_temp.create_link(),'{"state":"done"}'::jsonb,'raising the configured cap permits creation');
update figcraft_private.online_link_settings set max_links=1;
select is(public.manage_online_link(pg_temp.uid('owner'),pg_temp.uid('file'),'revoke','0000000000000003',null,'fd73:beef::1'),
    '{"state":"done"}'::jsonb,'revocation still works when existing grants exceed a newly lowered cap');
select is(jsonb_array_length(public.manage_online_link(pg_temp.uid('owner'),pg_temp.uid('file'),'links',null,null,'fd73:beef::1')->'links'),
    2,'lowering the cap does not discard unrelated existing grants');
select is(pg_temp.create_link(),'{"state":"limit","maximum":"1"}'::jsonb,'lowered cap continues to refuse new grants');
select * from finish();
rollback;
