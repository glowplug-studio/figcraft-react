begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
select ok(not has_function_privilege('anon','public.apply_online_share_change(uuid,uuid,uuid,uuid,text[],jsonb)','execute'), 'anonymous callers cannot issue roles');
select ok(not has_function_privilege('authenticated','public.apply_online_share_change(uuid,uuid,uuid,uuid,text[],jsonb)','execute'), 'signed-in clients cannot issue roles directly');
select ok(has_function_privilege('service_role','public.apply_online_share_change(uuid,uuid,uuid,uuid,text[],jsonb)','execute'), 'the verified server can change a set');
select ok(not has_table_privilege('authenticated','public.online_file_share_changes','select,insert,update,delete'), 'clients cannot see proofs or edit revisions');
select ok((select relrowsecurity from pg_class where oid='public.online_file_share_changes'::regclass), 'revision rows enforce row-level security');
select ok(exists(select from pg_constraint where conrelid='public.online_file_share_changes'::regclass
    and confrelid='public.online_files'::regclass and confdeltype='c'), 'removing the file clears its sharing revision');
select * from finish();
rollback;
