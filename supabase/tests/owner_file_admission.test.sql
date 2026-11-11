begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('authenticated','public.manage_owned_online_file(uuid,uuid,text,inet)','execute')
    and not has_function_privilege('anon','public.manage_owned_online_file(uuid,uuid,text,inet)','execute'),
    'clients cannot choose their administrator identity or ingress address');
insert into auth.users(id) values(md5('mutator')::uuid);
insert into storage.objects(id,bucket_id,name,owner_id)
    values(md5('mutating object')::uuid,'figcraft-files',md5('mutator')::uuid::text||'/'||md5('file')::uuid::text||'.figcraft',md5('mutator')::uuid::text);
insert into public.online_files(id,owner_id,snapshot_id,name) values(md5('file')::uuid,md5('mutator')::uuid,md5('mutating object')::uuid,'Before');
create function pg_temp.mutate(title text,actor text default 'mutator',ip inet default '192.0.2.119') returns jsonb language sql as $$
    select public.manage_owned_online_file(md5(actor)::uuid,md5('file')::uuid,title,ip);
$$;
select is(pg_temp.mutate('Alien','stranger')->>'state','unavailable','other account cannot manage this listing');
select is((select count(*) from figcraft_private.online_code_budgets where block='192.0.2.119/32'),0::bigint,'foreign owner requests never reach the native mutation budget');
select is(pg_temp.mutate('  Clean '||chr(8238))->>'state','renamed','authorised rename returned');
select is((select name from public.online_files where id=md5('file')::uuid),'Clean ','native cleaner trims before stripping bidi controls');
select is(pg_temp.mutate('  ')->>'state','invalid','blank rename fails after admission');
update figcraft_private.online_code_budgets set admin_tokens=0,admin_used_at=clock_timestamp()+interval '10 minutes' where block='192.0.2.119/32';
select is(pg_temp.mutate('Blocked')->>'state','busy','valid owner rename shares the exhausted administrator budget');
select is(pg_temp.mutate(null)->>'state','busy','removal uses the same exhausted address bucket');
select ok(exists(select from public.online_files where name='Clean '),'refused changes preserve the listing');
create temporary table receipt as select pg_temp.mutate(null,'mutator','198.51.100.119') as body;
select is((select body->>'state' from receipt),'removed','another address can remove the same file');
select ok(not exists(select from public.online_files where id=md5('file')::uuid),'accepted removal immediately hides the listing');
select is((select token_hash from figcraft_private.online_retirements where snapshot_id=md5('mutating object')::uuid),
    (select sha256(convert_to(body->>'claim','UTF8')) from receipt),'retryable Storage claim binds this exact immutable object');
select is(pg_temp.mutate(null)->>'state','unavailable','repeat removal cannot spend another token or act on another file');
select * from finish();
rollback;
