begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon','public.lookup_online_code(inet,text)','execute')
    and not has_function_privilege('authenticated','public.lookup_online_code(inet,text)','execute'),
    'browser clients cannot choose their own lookup address');
select ok(has_function_privilege('service_role','public.lookup_online_code(inet,text)','execute')
    and not has_function_privilege('service_role','figcraft_private.resolve_online_code(inet,text,timestamptz)','execute'),
    'the authenticated host can resolve codes only on the real clock');
select ok(not has_table_privilege('authenticated','figcraft_private.retired_online_codes','select')
    and not has_table_privilege('service_role','figcraft_private.online_code_global','update'),
    'retirement history and remaining budgets are private');

truncate figcraft_private.online_code_budgets, figcraft_private.online_code_global, figcraft_private.retired_online_codes;
create function pg_temp.attempt(ip inet, symbols text default null, seconds integer default 0) returns jsonb
language sql volatile as $$ select figcraft_private.resolve_online_code(ip, symbols, '2026-01-01Z'::timestamptz + seconds * interval '1 second'); $$;
create function pg_temp.try_many(ip inet, amount integer) returns void language plpgsql as $$
begin for i in 1..amount loop perform pg_temp.attempt(ip); end loop; end; $$;

insert into auth.users(id) values('10000000-0000-4000-8000-000000000001');
insert into storage.objects(id,bucket_id,name) values('10000000-0000-4000-8000-000000000002','figcraft-files','sql-code-fixture');
insert into public.online_files(id,owner_id,snapshot_id,name) values('10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','SQL fixture');
-- Unmodified record from native-sealed-join-codes.json, bits 0, ASCII token.
insert into public.online_file_links(id,file_id,access_level,label,token_hash,code_hash,wrapped_token)
values('aabbcc0011223344','10000000-0000-4000-8000-000000000003','view','Shared (view)',
    encode(sha256(convert_to('edit-test-token','UTF8')),'hex'),'2faf17961cd9e2fc8a9447717f70d3c7bbd853f7d166679407bcff2f6d4e9d0a','b642e3d84dcc4865024595744d79dc');

select is(pg_temp.attempt('192.0.2.1','000000000')->>'token','edit-test-token','the native sealed fixture opens');
select is(pg_temp.attempt('192.0.2.1','000000009')->>'status','unknown','a never-issued code stays unknown');
select pg_temp.try_many('192.0.2.2',9);
select is(pg_temp.attempt('192.0.2.2','000000000')->>'token','edit-test-token','a correct tenth guess fits the burst');
select is(pg_temp.attempt('192.0.2.2','000000000')->>'status','rate','correct codes consume the address budget');
select is(pg_temp.attempt('192.0.2.2',null,6)->>'status','unknown','one token refills in six seconds');
select is(pg_temp.attempt('::ffff:192.0.2.2','000000000',7)->>'status','locked','mapped addresses share lockout and success did not clear prior failures');
select is(pg_temp.attempt('192.0.2.2','000000000',906)->>'token','edit-test-token','the lock releases at the native time boundary');

select pg_temp.try_many('2001:db8:1:101::1',10);
select is(pg_temp.attempt('2001:db8:1:101::2')->>'status','locked','siblings in the same /64 share a lock');
select pg_temp.try_many('2001:db8:1:102::1',10);
select is(pg_temp.attempt('2001:db8:1:103::1')->>'status','locked','a /56 combines twenty wrong codes');
select pg_temp.try_many('2001:db8:1:201::1',10);
select pg_temp.try_many('2001:db8:1:202::1',10);
select is(pg_temp.attempt('2001:db8:1:301::1')->>'status','locked','a /48 combines forty wrong codes');
select is(pg_temp.attempt('2001:db8:2::1','000000000')->>'token','edit-test-token','another /48 remains independent');

update figcraft_private.online_code_global set tokens = 1, sampled_at = '2026-01-01Z';
select is(pg_temp.attempt('192.0.2.3','000000000')->>'token','edit-test-token','a valid code preserves the global wrong-code budget');
select is(pg_temp.attempt('192.0.2.4','malformed')->>'status','unknown','malformed requests count as wrong');
select is(pg_temp.attempt('192.0.2.5','000000000')->>'status','busy','the exhausted server refuses new codes even from a fresh address');
select is(pg_temp.attempt('192.0.2.5','000000000',4)->>'token','edit-test-token','the global bucket refills with time');
update figcraft_private.online_code_global set tokens = 1000, sampled_at = '2026-01-01Z';

update public.online_file_links set code_hash='740bc5f51c17f85da286c917b7a3ae255ecf9fe83b45e4022c1af04ce64f295f',
    wrapped_token='f8fc926f5faf770dbeeb6df314869c' where id='aabbcc0011223344';
select is(pg_temp.attempt('192.0.2.6','000000000')->>'status','gone','the replaced code reports retirement');
select is(pg_temp.attempt('192.0.2.6','000000001')->>'token','edit-test-token','the replacement opens');
savepoint remove_file;
delete from public.online_files where id='10000000-0000-4000-8000-000000000003';
select is(pg_temp.attempt('192.0.2.6','000000001')->>'status','gone','file removal retires its remaining code');
rollback to remove_file;
select is(pg_temp.attempt('192.0.2.6','000000001')->>'token','edit-test-token','rolling back file deletion restores the grant');
insert into figcraft_private.retired_online_codes(slot,serial_number,code_hash)
select i,i,repeat('a',64) from generate_series(1,9999) i;
delete from public.online_file_links where id='aabbcc0011223344';
select is((select count(*) from figcraft_private.retired_online_codes),10000::bigint,'only 10,000 retired digests are retained');
select is(pg_temp.attempt('192.0.2.6','000000000')->>'status','unknown','the oldest code falls outside history');
select is(pg_temp.attempt('192.0.2.6','000000001')->>'status','gone','the most recent revoke remains visible');
update figcraft_private.retired_online_codes set store_started = '2025-01-01Z' where slot = 0;
select is(pg_temp.attempt('192.0.2.6','000000001')->>'status','unknown','a new store ignores old retirement history and cannot grant access');
truncate figcraft_private.online_code_global, figcraft_private.online_code_budgets;
do $$ begin
    for i in 0..999 loop
        if pg_temp.attempt(inet '198.18.0.1' + i)->>'status' <> 'unknown' then raise exception 'unexpected early global limit'; end if;
    end loop;
end $$;
select is(pg_temp.attempt('198.19.0.1','000000001')->>'status','busy','exactly 1,000 malformed guesses exhaust the global burst');
select is(pg_temp.attempt('198.19.0.1','000000001',60)->>'status','unknown','a renewed budget permits lookup again');
select pg_temp.try_many('203.0.113.19',9);
select is(pg_temp.attempt('203.0.113.19',null,901)->>'status','unknown','wrong codes decay after a 15-minute gap');
select is(pg_temp.attempt('203.0.113.19',null,902)->>'status','unknown','the decayed count does not immediately relock the address');
truncate figcraft_private.online_code_budgets;
insert into figcraft_private.online_code_budgets(block, tokens, used_at)
select network(inet '198.18.0.0' + n), 10, '2025-12-31Z'::timestamptz + n * interval '1 second' from generate_series(0,9999) n;
select is(pg_temp.attempt('203.0.113.20',null,903)->>'status','unknown','a new address is admitted at capacity');
select is((select count(*) from figcraft_private.online_code_budgets),5000::bigint,'the oldest half is evicted at the native cutoff');
select ok(not exists(select from figcraft_private.online_code_budgets where block = '198.18.0.0'::cidr)
    and exists(select from figcraft_private.online_code_budgets where block = network(inet '198.18.0.0' + 9999)),
    'the most recently used address survives pruning');
select * from finish();
rollback;
