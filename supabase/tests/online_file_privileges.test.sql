begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select ok(not has_table_privilege('anon', 'public.online_files', 'select'), 'anonymous callers cannot read listings');
select ok(not has_table_privilege('anon', 'public.online_files', 'truncate'), 'anonymous callers cannot truncate all files');
select ok(not has_table_privilege('authenticated', 'public.online_files', 'truncate'), 'owners cannot truncate all files');
select ok(not has_table_privilege('authenticated', 'public.online_files', 'insert'), 'a client cannot publish an unvalidated listing');
select ok(not has_column_privilege('authenticated', 'public.online_files', 'name', 'update'), 'direct owner renames cannot bypass ingress admission');
select ok(not has_column_privilege('authenticated', 'public.online_files', 'owner_id', 'update'), 'file ownership cannot be reassigned');
select ok(not has_column_privilege('authenticated', 'public.online_files', 'snapshot_id', 'update'), 'a direct request cannot replace the archive');
select ok(not has_function_privilege('anon', 'public.clean_online_file_rename()', 'execute'), 'the rename trigger is private');
select ok(not has_table_privilege('authenticated', 'public.online_files', 'delete'), 'client removal must use the Storage operation');

select * from finish();
rollback;
