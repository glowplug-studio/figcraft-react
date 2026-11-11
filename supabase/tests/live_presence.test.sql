begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select ok(has_function_privilege('service_role','public.live_presence_targets(uuid,uuid,uuid,uuid,boolean)','execute'),
    'trusted host resolves current live recipients');
select ok(not has_function_privilege('anon','public.live_presence_targets(uuid,uuid,uuid,uuid,boolean)','execute'),
    'anonymous clients cannot enumerate connection topics');
select ok(not has_function_privilege('authenticated','public.live_presence_targets(uuid,uuid,uuid,uuid,boolean)','execute'),
    'a browser cannot provide an actor or login');
select ok(not has_function_privilege('authenticated','figcraft_private.live_presence_targets(uuid,uuid,uuid,uuid,boolean)','execute'),
    'private implementation denies direct browser execution');
select ok(not has_table_privilege('authenticated','figcraft_private.live_presence_connections','select'),
    'browser cannot read peer registrations');
select ok(not has_table_privilege('service_role','figcraft_private.live_presence_connections','insert'),
    'writes must pass the physical connection authority');
select ok((select relrowsecurity from pg_class where oid='figcraft_private.live_presence_connections'::regclass),
    'private registration rows have RLS');
select throws_ok($$select public.live_presence_targets(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),true)$$,
    '42501','live connection unavailable','an unknown physical session cannot register itself');
select ok(has_function_privilege('service_role','public.leave_live_connection(uuid,uuid,uuid)','execute'),
    'trusted host can release a physical session');
select ok(not has_function_privilege('anon','public.leave_live_connection(uuid,uuid,uuid)','execute')
    and not has_function_privilege('authenticated','public.leave_live_connection(uuid,uuid,uuid)','execute'),
    'browser roles cannot release arbitrary grants');
select ok(not has_function_privilege('authenticated','figcraft_private.leave_live_connection(uuid,uuid,uuid)','execute'),
    'private departure implementation denies browser execution');
select ok(not has_function_privilege('authenticated','figcraft_private.live_recipient_topics(uuid,uuid)','execute')
    and not has_function_privilege('anon','figcraft_private.live_recipient_topics(uuid,uuid)','execute'),
    'recipient lookup stays private');
select is(public.leave_live_connection(gen_random_uuid(),gen_random_uuid(),gen_random_uuid()),null::jsonb,
    'an unknown connection has no departure to deliver');
select * from finish();
rollback;
