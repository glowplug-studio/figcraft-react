begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.uid(label text) returns uuid language sql immutable as $$
    select md5('file-retirement-' || label)::uuid;
$$;
create function pg_temp.path(label text) returns text language sql immutable as $$
    select pg_temp.uid('owner')::text || '/' || pg_temp.uid(label)::text || '.figcraft';
$$;
insert into auth.users(id) values (pg_temp.uid('owner'));
insert into auth.sessions(id,user_id) values (pg_temp.uid('session'),pg_temp.uid('owner'));
insert into storage.objects(id,bucket_id,name,owner_id,created_at)
select pg_temp.uid('bytes-'||label),'figcraft-files',pg_temp.path(label),pg_temp.uid('owner')::text,
    now()-interval '45 days' from unnest(array['idle','keyed','updated','open','disabled','orphan','new']) label;
insert into public.online_files(id,owner_id,snapshot_id,name,created_at,published_without_key,document_updated_at)
select pg_temp.uid(label),pg_temp.uid('owner'),pg_temp.uid('bytes-'||label),label,
    now()-interval '45 days',label<>'keyed',case when label='updated' then now() end
    from unnest(array['idle','keyed','updated','open','disabled']) label;
create function pg_temp.claim(label text, idle numeric default 2592000) returns bigint language sql as $$
    select count(*) from public.claim_online_retirement(pg_temp.uid('bytes-'||label),idle);
$$;
select ok(not has_function_privilege('anon','public.claim_online_retirement(uuid,numeric)','execute'), 'anonymous callers cannot claim an object');
select ok(not has_function_privilege('authenticated','public.claim_online_retirement(uuid,numeric)','execute'), 'owners cannot override the idle clock');
select ok(not has_table_privilege('authenticated','figcraft_private.online_retirements','select'), 'socket clients cannot enumerate retirement claims');
select throws_ok($$select pg_temp.claim('idle',-1)$$,'22023','invalid idle period','negative idle duration is refused');
select is(pg_temp.claim('keyed'),0::bigint,'operator-key publication survives');
select is(pg_temp.claim('disabled',0),0::bigint,'disabled expiry keeps even an old listing');
select is(pg_temp.claim('updated'),0::bigint,'a recent document change protects an older listing');
insert into public.online_file_links(id,file_id,access_level,label,token_hash)
values ('1122334455667788',pg_temp.uid('open'),'edit','Edit',repeat('a',64));
select access_level from public.join_online_file(pg_temp.uid('owner'),pg_temp.uid('session'),pg_temp.uid('tab'),pg_temp.uid('open'),repeat('a',64));
update figcraft_private.online_room_activity set opened_at=now()-interval '45 days' where file_id=pg_temp.uid('open');
select is(pg_temp.claim('open'),0::bigint,'an occupied room cannot be retired even after its deadline');
update public.online_file_connections set heard_at=now()-interval '5 minutes' where id=pg_temp.uid('tab');
select is(pg_temp.claim('open'),0::bigint,'a recently timed-out last member starts a new idle period');
select ok(not exists(select from public.online_file_connections where id=pg_temp.uid('tab')),'retirement evaluation collected the abandoned grant');
select is(pg_temp.claim('idle'),1::bigint,'eligible idle listing issues a capability');
select ok(not exists(select from public.online_files where id=pg_temp.uid('idle')),'the drawing stops being served before physical deletion');
select ok(exists(select from storage.objects where id=pg_temp.uid('bytes-idle')),'only the Storage API removes object metadata and bytes');
select is(pg_temp.claim('idle',0),1::bigint,'a committed retirement can resume after configuration changes');
select throws_ok($$select * from public.keep_online_publication(pg_temp.uid('owner'),pg_temp.uid('idle'),
    pg_temp.uid('bytes-idle'),'Retry','{}'::jsonb,true,'127.0.0.1'::inet,17)$$,
    '55000','this upload is being removed; retry publication','a delayed validated receipt cannot revive a claimed object');
select is(pg_temp.claim('orphan'),1::bigint,'an old unregistered canonical upload can be reclaimed');
update storage.objects set created_at=now() where id=pg_temp.uid('bytes-new');
select is(pg_temp.claim('new'),0::bigint,'a fresh staged upload is left for the device to finalise');
insert into storage.objects(id,bucket_id,name,owner_id,created_at)
values (pg_temp.uid('other'),'figcraft-files','other-folder/old.figcraft',pg_temp.uid('owner')::text,now()-interval '1 year');
select is((select count(*) from public.claim_online_retirement(pg_temp.uid('other'))),0::bigint,'unrecognised objects are outside the cleanup namespace');
select * from finish();
rollback;
