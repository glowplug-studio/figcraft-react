begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('authenticated','public.admit_online_publication(inet,bigint)','execute')
    and not has_function_privilege('anon','public.admit_online_publication(inet,bigint)','execute'),
    'the trusted host owns the source address and rate');
select ok(has_function_privilege('service_role','public.admit_online_publication(inet,bigint)','execute')
    and not has_function_privilege('service_role','figcraft_private.take_online_publication(inet,bigint,timestamptz)','execute')
    and not has_function_privilege('service_role','figcraft_private.admission_clock(timestamptz)','execute'),
    'the host cannot choose the admission clock or reset buckets');
truncate figcraft_private.online_code_budgets, figcraft_private.online_code_global;
create function pg_temp.take(ip inet, seconds numeric default 0, rate bigint default 10) returns boolean
language sql volatile as $$ select figcraft_private.take_online_publication(ip,rate,'2026-01-01Z'::timestamptz + seconds * interval '1 second'); $$;
create function pg_temp.count_allowed(ip inet, attempts integer, seconds numeric default 0) returns integer
language plpgsql as $$
declare accepted integer := 0;
begin
    for i in 1..attempts loop if pg_temp.take(ip,seconds) then accepted := accepted+1; end if; end loop;
    return accepted;
end;
$$;
select is(pg_temp.count_allowed('::ffff:192.0.2.9',11),10,'ten of eleven simultaneous publications fit');
select ok(not pg_temp.take('192.0.2.9',359),'ordinary and mapped IPv4 share one clock');
select ok(pg_temp.take('192.0.2.9',361),'one token refills in six minutes');
select ok(not pg_temp.take('192.0.2.9',361),'one newly available token is spent once');
select is(pg_temp.count_allowed('192.0.2.9',20,9000),10,'long idle time only restores the ten-token burst');
truncate figcraft_private.online_code_budgets, figcraft_private.online_code_global;

-- hardening_tests::no_block_can_use_up_a_shared_budget. Vary /56 within one
-- /48, then use independent IPv4 addresses at the same instant.
select is((select count(*) from generate_series(0,199) n
    where pg_temp.take(('2001:db8:5:'||to_hex(n*256)||'::1')::inet)),40::bigint,'one IPv6 /48 can use forty');
select is((select count(*) from generate_series(0,399) n where pg_temp.take(inet '198.51.100.0'+n)),280::bigint,
    'the remaining 280 belong to other addresses');
select ok(not pg_temp.take('203.0.113.7',11),'the global bucket has not yet refilled');
select ok(pg_temp.take('203.0.113.7',12),'the global rate is 320 per hour');
select is((select publish_tokens from figcraft_private.online_code_budgets where block='203.0.113.7/32'),9::double precision,
    'a global refusal spends no address token');

truncate figcraft_private.online_code_budgets, figcraft_private.online_code_global;
select is(pg_temp.count_allowed('2001:db8::1',10),10,'IPv6 /64 gets one allowance');
select ok(not pg_temp.take('2001:db8::2'),'another address in that /64 shares its exhaustion');
select is(pg_temp.count_allowed('2001:db8:0:1::1',11),10,'a sibling /64 gets the rest of its /56');
select ok(not pg_temp.take('2001:db8:0:2::1'),'a third /64 cannot exceed the wider block');
select is((select publish_tokens from figcraft_private.online_code_budgets where block='2001:db8:0:2::/64'),10::double precision,
    'wider-block rejection preserves narrower credit');

truncate figcraft_private.online_code_budgets, figcraft_private.online_code_global;
select ok(pg_temp.take('192.0.2.1',0,1),'operator can reduce burst to one');
select is(figcraft_private.resolve_online_code('192.0.2.1',null,'2026-01-01 00:30Z')->>'status','unknown',
    'the same address still has independent code credits');
select ok(not pg_temp.take('192.0.2.1',3599,1),'code lookup cannot advance the publication refill');
select ok(pg_temp.take('192.0.2.1',3601,1),'code lookup does not delay publication refill');
select is((select tokens from figcraft_private.online_code_budgets where block='192.0.2.1/32'),9::double precision,
    'publishing never spends code lookup credits');
select throws_ok($$select pg_temp.take('192.0.2.1',0,0)$$,'22023','invalid publication admission','invalid zero capacity is refused');
truncate figcraft_private.online_code_budgets;
insert into figcraft_private.online_code_budgets(block,tokens,used_at)
    select network(inet '198.18.0.0'+n),10,'2025-12-31Z'::timestamptz+n*interval '1 second'
    from generate_series(0,9999) n;
select ok(pg_temp.take('198.18.0.0',4000),'a publish touches the oldest code-only entry');
select ok(pg_temp.take('203.0.113.19',4001),'a new publishing address triggers shared pruning');
select is((select count(*) from figcraft_private.online_code_budgets),5000::bigint,'both actions share the bounded inventory');
select ok(exists(select from figcraft_private.online_code_budgets where block='198.18.0.0/32')
    and not exists(select from figcraft_private.online_code_budgets where block='198.18.0.1/32'),
    'pruning accounts for the most recent use of either action');
update figcraft_private.online_code_global set store_started='2000-01-01Z';
select ok(pg_temp.take('203.0.113.20',4002,1),'a new database lifetime starts with fresh publication credit');
select is((select count(*) from figcraft_private.online_code_budgets),1::bigint,'the previous process address table is discarded');
truncate figcraft_private.online_code_budgets, figcraft_private.online_code_global;
-- Golden trace from hub/conn.rs ingress ip_key followed by Abuse::allow, ip_blocks and Bucket.
create function pg_temp.native_trace() returns text language plpgsql as $$
declare
    bits text := '';
    ip inet;
    k integer;
    seconds numeric;
begin
    for i in 0..799 loop
        k := (i*37+i/11)%23;
        ip := case i%5 when 0 then ('192.0.2.'||(k%7+1))::inet
            when 1 then ('::ffff:192.0.2.'||(k%7+1))::inet
            else ('2001:db8:32:'||to_hex((k%3)*256+k%9)||'::'||(i%99+1))::inet end;
        seconds := ((i/70)*510000+(i%70)*521)/1000.0;
        bits := bits || case when pg_temp.take(ip,seconds,5) then '1' else '0' end;
    end loop;
    return bits;
end;
$$;
select is(encode(sha256(convert_to(pg_temp.native_trace(),'UTF8')),'hex'),
    'abd35595962fd0204be43cb584730bfc171e7bdb5d5f0fb015307315d276cc4e',
    'all 800 timed decisions match the pinned Rust store');
select * from finish();
rollback;
