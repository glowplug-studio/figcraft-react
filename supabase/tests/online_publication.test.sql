begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
select ok(not has_function_privilege('anon','public.finalise_online_publication(uuid,uuid,uuid,text,jsonb,boolean)','execute'), 'anonymous callers cannot publish unchecked archives');
select ok(not has_function_privilege('authenticated','public.finalise_online_publication(uuid,uuid,uuid,text,jsonb,boolean)','execute'), 'signed-in callers cannot bypass the validator');
select ok(not has_column_privilege('authenticated','public.online_files','published_link_fingerprint','update'), 'the original link receipt cannot be reset by a client');
select * from finish();
rollback;
