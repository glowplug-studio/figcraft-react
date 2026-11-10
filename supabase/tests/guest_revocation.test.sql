begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
select ok(not has_function_privilege('anon','public.online_connection_active(uuid)','execute'), 'anonymous callers cannot check a connection');
select ok(has_function_privilege('authenticated','public.online_connection_active(uuid)','execute'), 'signed-in callers can revalidate their tab');
select ok(not has_function_privilege('authenticated','figcraft_private.notify_link_removal()','execute'), 'clients cannot execute the termination trigger');
select ok(exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages'
    and policyname='Guests receive notices for their login session' and cmd='SELECT'), 'the guest broadcast policy grants receive only');
select * from finish();
rollback;
