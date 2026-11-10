begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.uid(label text) returns uuid language sql immutable as $$
    select md5('team-directory-' || label)::uuid;
$$;
insert into auth.users(id) values(pg_temp.uid('owner')), (pg_temp.uid('guest'));
insert into auth.sessions(id,user_id) values(pg_temp.uid('session'),pg_temp.uid('guest'));
select set_config('request.jwt.claim.sub',pg_temp.uid('guest')::text,true);
create function pg_temp.lookup() returns jsonb language sql volatile as $$
    select public.resolve_team_file(pg_temp.uid('1'));
$$;
select ok(not has_function_privilege('anon','public.online_team_directory()','execute'),'anonymous callers cannot list');
select ok(not has_function_privilege('anon','public.resolve_team_file(uuid)','execute'),'anonymous callers cannot resolve');
select ok(not has_table_privilege('authenticated','figcraft_private.team_file_links','select'),'authenticated callers cannot enumerate tokens');
select ok(not has_table_privilege('authenticated','figcraft_private.team_directory_settings','update'),'only the operator configures the directory');
select is(public.online_team_directory(),'{"state":"none"}'::jsonb,'directory is off by default');
select is(pg_temp.lookup()->>'status','disabled','off is distinct from an unshared file');
insert into figcraft_private.team_directory_settings(access_level,web_url) values('view','https://team.example/app/');
select is(public.online_team_directory()->'files','[]'::jsonb,'enabled empty directory');
select throws_ok($$update figcraft_private.team_directory_settings set web_url='https://example.org/?redirect=invalid'$$,'23514',null,'operator URL cannot contain a query');
insert into storage.objects(id,bucket_id,name,owner_id)
select pg_temp.uid('bytes'||i),'figcraft-files',pg_temp.uid('owner')::text||'/'||pg_temp.uid(i::text)::text||'.figcraft',pg_temp.uid('owner')::text
    from generate_series(1,504) i;
insert into public.online_files(id,owner_id,snapshot_id,name,created_at)
select pg_temp.uid(i::text),pg_temp.uid('owner'),pg_temp.uid('bytes'||i),'File '||lpad(i::text,4,'0'),'2026-01-01' from generate_series(1,504) i;
insert into public.online_file_links(id,file_id,access_level,label,token_hash)
values('0000000000000000',pg_temp.uid('1'),'edit','Published (edit)',repeat('0',64));
select is(public.online_team_directory()->'files','[]'::jsonb,'publication alone does not list files');
select is(pg_temp.lookup()->>'status','unshared','published-only file denied');
insert into public.online_file_links(id,file_id,access_level,label,token_hash,code_hash,wrapped_token)
select lpad(to_hex(i),16,'0'),pg_temp.uid(i::text),'edit','Shared (edit)',lpad(to_hex(i),64,'0'),lpad(to_hex(i),64,'0'),'ff'
    from generate_series(1,504) i;
update public.online_files set document_updated_at='2026-01-02' where id=pg_temp.uid('503');
select is(jsonb_array_length(public.online_team_directory()->'files'),500,'500 most recently updated shared files');
select is(public.online_team_directory()#>>'{files,0,name}','File 0503','newest journal update first');
select is(public.online_team_directory()#>>'{files,499,name}','File 0499','name tie-break before truncation');
select is(public.online_team_directory()#>'{files,1}',jsonb_build_object('file',pg_temp.uid('1'),'name','File 0001',
    'updated','1767225600','people',0,'access','view'),'row contains only native directory fields');
create temp table receipts as select pg_temp.lookup()->>'token' as original;
select ok((select original from receipts) ~ '^[A-Za-z0-9_-]{22}$','resolver issued an admission secret');
select is(pg_temp.lookup()->>'token',(select original from receipts),'a second resolution returns the original team link');
select ok(position((select original from receipts) in public.online_team_directory()::text)=0,'listing contains no team secret');
select is((select access_level from public.join_online_file(pg_temp.uid('guest'),pg_temp.uid('session'),pg_temp.uid('tab'),
    pg_temp.uid('1'),encode(sha256(convert_to((select original from receipts),'UTF8')),'hex'))),'view','team grant admits an independent viewer');
select is(public.online_team_directory()#>>'{files,1,people}','1','directory counts live guests');
update public.online_file_connections set heard_at=now()-interval '1 hour' where id=pg_temp.uid('tab');
select is(public.online_team_directory()#>>'{files,1,people}','0','silent guests have left the directory count');
insert into public.online_file_links(id,file_id,access_level,label,token_hash,code_hash,wrapped_token)
values('eeeeeeeeeeeeeeee',pg_temp.uid('1'),'view','Shared (view)',repeat('c',64),repeat('d',64),'ff');
delete from public.online_file_links where id='0000000000000001';
select is(pg_temp.lookup()->>'token',(select original from receipts),'one remaining coded owner link keeps the same grant');
delete from public.online_file_links where id='eeeeeeeeeeeeeeee';
select is(pg_temp.lookup()->>'status','unshared','last coded link removes the team entry');
select is((select count(*) from public.online_file_connections where id=pg_temp.uid('tab')),0::bigint,'stopping sharing ends the team connection');
select is((select count(*) from public.online_file_links where file_id=pg_temp.uid('1')),1::bigint,'original publication grant survives unshare');
insert into public.online_file_links(id,file_id,access_level,label,token_hash,code_hash,wrapped_token)
values('eeeeeeeeeeeeeeee',pg_temp.uid('1'),'view','Shared (view)',repeat('c',64),repeat('e',64),'ff');
select isnt(pg_temp.lookup()->>'token',(select original from receipts),'restarting sharing issues a fresh grant');
update receipts set original=pg_temp.lookup()->>'token';
update figcraft_private.team_directory_settings set access_level='comment';
update figcraft_private.team_directory_settings set access_level='view';
select isnt(pg_temp.lookup()->>'token',(select original from receipts),'restoring access before any lookup cannot revive a prior secret');
update receipts set original=pg_temp.lookup()->>'token';
delete from figcraft_private.team_directory_settings;
insert into figcraft_private.team_directory_settings(access_level) values('edit');
select isnt(pg_temp.lookup()->>'token',(select original from receipts),'disabling the directory permanently revokes its grant');
select is((select access_level from public.online_file_links where label='Team (edit)' and file_id=pg_temp.uid('1')),'edit','new grants use the configured role');
delete from public.online_file_links where label like 'Team (%)';
insert into public.online_file_links(id,file_id,access_level,label,token_hash)
select left(md5('cap'||i),16),pg_temp.uid('1'),'edit','Extra',encode(sha256(convert_to('cap'||i,'UTF8')),'hex') from generate_series(1,98) i;
select is(pg_temp.lookup()->>'status','full','100 retained links cannot be exceeded');
select is((select count(*) from figcraft_private.team_file_links),0::bigint,'failed issuance leaves no reusable grant');
insert into figcraft_private.online_link_settings(max_links) values(101);
select ok(pg_temp.lookup() ? 'token','higher operator cap admits one additional team link');
update figcraft_private.online_link_settings set max_links=1;
select ok(pg_temp.lookup() ? 'token','a reduced cap still permits reusing the existing team link');
truncate figcraft_private.team_directory_settings;
select is((select count(*) from figcraft_private.team_file_links),0::bigint,'clearing operator configuration invalidates old grants');
insert into figcraft_private.team_directory_settings(access_level) values('view');
select is(pg_temp.lookup(),'{"status":"full","limit":"1"}'::jsonb,'new issue reports the configured lower cap');
select ok(not has_function_privilege('authenticated','figcraft_private.change_online_file_links(uuid,uuid,text[],jsonb,numeric)','execute'),
    'clients cannot manufacture grants through the internal owner operation');
select ok(not has_table_privilege('authenticated','figcraft_private.online_link_settings','update'),'a guest cannot raise the configured limit');
select throws_ok($$select public.apply_online_share_change(pg_temp.uid('owner'),pg_temp.uid('2'),null,
    pg_temp.uid('revision'),array[]::text[],(select jsonb_agg(jsonb_build_object(
        'id',left(md5(role),16),'access_level',role,'label','Shared ('||role||')','token_hash',repeat(md5(role),2),
        'code_hash',repeat(md5(role||'code'),2),'wrapped_token','ff')) from unnest(array['edit','comment','view']) role))$$,
    '22023','a file has at most 1 links: revoke one first','owner sharing and team resolution obey the same configured limit');
select * from finish();
rollback;
