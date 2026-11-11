begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('anon','public.online_connection_active(uuid)','execute'), 'anonymous callers cannot check a connection');
select ok(has_function_privilege('authenticated','public.online_connection_active(uuid)','execute'), 'signed-in callers can revalidate their tab');
select ok(not has_function_privilege('authenticated','figcraft_private.notify_link_removal()','execute'), 'clients cannot execute the termination trigger');
select ok(exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages'
    and policyname='Guests receive notices for their login session' and cmd='SELECT'), 'the guest broadcast policy grants receive only');
select ok(not has_function_privilege('anon','public.online_connection_ending(uuid)','execute'),
    'anonymous callers cannot inspect terminal notices');
select set_config('request.jwt.claims',jsonb_build_object('sub',md5('notice-guest')::uuid,
    'session_id',md5('notice-login')::uuid)::text,true);
create function pg_temp.topic(tab text) returns text language sql as $$
    select 'figcraft-connection:' || md5('notice-login')::uuid || ':' || md5(tab)::uuid;
$$;
select realtime.send('{"reason":"stopped"}','ended',pg_temp.topic('revoked'),true);
select realtime.send('{"reason":"removed"}','ended',pg_temp.topic('public'),false);
select realtime.send('{"reason":"removed"}','presence',pg_temp.topic('wrong-event'),true);
select realtime.send('{"reason":"removed"}','ended',pg_temp.topic('expired'),true);
update realtime.messages set inserted_at=statement_timestamp()-interval '46 seconds' where topic=pg_temp.topic('expired');
set local role authenticated;
select is(public.online_connection_ending(md5('revoked')::uuid),'stopped','the same login recovers its private terminal event');
select is(public.online_connection_ending(md5('public')::uuid),null::text,'public messages cannot impersonate termination');
select is(public.online_connection_ending(md5('wrong-event')::uuid),null::text,'presence cannot impersonate termination');
select is(public.online_connection_ending(md5('expired')::uuid),null::text,'the fallback respects the guest silence window');
select set_config('request.jwt.claims',jsonb_build_object('sub',md5('notice-guest')::uuid,
    'session_id',md5('another-login')::uuid)::text,true);
select is(public.online_connection_ending(md5('revoked')::uuid),null::text,'a different login of the same user cannot read it');
reset role;
select * from finish();
rollback;
