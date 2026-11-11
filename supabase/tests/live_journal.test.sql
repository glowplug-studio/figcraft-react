begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id) values(md5('journal guest')::uuid);
insert into auth.sessions(id,user_id) values(md5('journal login')::uuid,md5('journal guest')::uuid);
insert into storage.objects(id,bucket_id,name) values(md5('journal object')::uuid,'figcraft-files','journal.figcraft');
insert into public.online_files(id,owner_id,snapshot_id,name) values(md5('journal file')::uuid,md5('journal guest')::uuid,md5('journal object')::uuid,'Shared');
insert into public.online_file_links(id,file_id,access_level,label,token_hash) values(left(md5('journal link'),16),md5('journal file')::uuid,'edit','Participant',repeat('c',64));
select public.join_live_file(md5('journal guest')::uuid,md5('journal login')::uuid,md5('journal tab')::uuid,md5('journal file')::uuid,
    repeat('c',64),repeat('d',64),256,md5('journal object')::uuid,0);
create function pg_temp.submit(n numeric,s numeric,yes boolean,bytes bigint default 1,checkpoint jsonb default null) returns text language sql as $$
    select public.commit_live_batch(md5('journal guest')::uuid,md5('journal login')::uuid,md5('journal tab')::uuid,md5('journal file')::uuid,
        s,1,n,yes,'[{"type":"setDoc","prop":"name","value":"name"}]','{"nodes":[],"entries":[]}',checkpoint,bytes);
$$;
create function pg_temp.pull(s numeric) returns jsonb language sql as $$
    select public.read_live_journal(md5('journal guest')::uuid,md5('journal login')::uuid,md5('journal tab')::uuid,md5('journal file')::uuid,s,false);
$$;
select ok(not has_function_privilege('authenticated','public.read_live_journal(uuid,uuid,uuid,uuid,numeric,boolean)','execute')
    and not has_function_privilege('anon','public.commit_live_batch(uuid,uuid,uuid,uuid,numeric,bigint,numeric,boolean,jsonb,jsonb,jsonb,bigint)','execute'),'browser roles cannot call host procedures');
select ok(not has_table_privilege('service_role','figcraft_private.live_batches','select') and
    not has_table_privilege('authenticated','figcraft_private.live_batches','insert'),'journal rows have no direct API access');
select is(pg_temp.pull(null)->>'sequence','0','new room starts at sequence zero');
select is(pg_temp.submit(1,0,true),'accepted','first committed edit');
select is(pg_temp.submit(1,0,true),'processed','lost acknowledgement is idempotent');
select is(pg_temp.submit(2,0,true),'retry','a stale authority retries validation');
select is(pg_temp.submit(2,1,false),'refused','refusal persists');
select is(pg_temp.pull(0)->'refused','["2"]'::jsonb,'refusal is recoverable on reconnect');
select is(pg_temp.pull(0)->>'sequence','1','refusal did not advance the drawing');
select throws_ok($$select pg_temp.submit(3,1,true,67108865)$$,'22023','snapshot required before journal pruning','pruning cannot destroy recovery state');
select is(pg_temp.pull(0)->>'lastBatch','2','incomplete compaction rolls back');
select is(pg_temp.submit(3,1,true,67108865,'{"fixture":true}'),'accepted','atomic checkpoint before pruning');
select is(pg_temp.pull(0)->>'checkpointSeq','2','old peer receives snapshot sequence');
select is(pg_temp.pull(0)->'batches','[]'::jsonb,'oversized log is cleared');
select is(pg_temp.pull(2)->>'reset','false','up-to-date cursor receives a delta');
update public.online_file_links set access_level='comment' where id=left(md5('journal link'),16);
select throws_ok($$select pg_temp.submit(4,2,true)$$,'42501','access denied','database rechecks comment grant before accepting');
delete from public.online_file_links where id=left(md5('journal link'),16);
select throws_ok($$select pg_temp.pull(2)$$,'42501','live connection unavailable','revocation blocks subsequent reads');
select * from finish();
rollback;
