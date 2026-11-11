begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('authenticated','public.apply_addressed_share_change(uuid,uuid,uuid,uuid,text[],jsonb,inet)','execute'),'a browser cannot spend another address allowance');
select ok(not has_function_privilege('service_role','figcraft_private.take_admin_request(inet,timestamptz)','execute'),'server callers cannot choose their own clock');
select ok(has_function_privilege('service_role','public.apply_addressed_share_change(uuid,uuid,uuid,uuid,text[],jsonb,inet)','execute'),'the trusted application can charge an admin request');
truncate figcraft_private.online_code_budgets,figcraft_private.online_code_global;
select is((select count(*) from generate_series(1,61) n where figcraft_private.take_admin_request('192.0.2.4','2026-01-01Z'::timestamptz+n*interval '0 sec')),60::bigint,'sixty requests per initial IPv4 burst');
select ok(not figcraft_private.take_admin_request('192.0.2.4','2026-01-01 00:00:00.999Z'),'a full token is needed');
select ok(figcraft_private.take_admin_request('192.0.2.4','2026-01-01 00:00:01Z'),'one second replenishes a token');
select ok(figcraft_private.take_report('192.0.2.4','2026-01-01 00:00:01Z'),'file reports retain independent credit');
truncate figcraft_private.online_code_budgets,figcraft_private.online_code_global;
create function pg_temp.native_trace() returns text language plpgsql as $$
declare
    bits text := '';
    ip inet;
    k integer;
    seconds numeric;
begin
    for i in 0..2399 loop
        k := (i*37+i/11)%23;
        ip := case i%5 when 0 then ('192.0.2.'||(k%7+1))::inet
            when 1 then ('::ffff:192.0.2.'||(k%7+1))::inet
            else ('2001:db8:32:'||to_hex((k%3)*256+k%9)||'::'||(i%99+1))::inet end;
        seconds := ((i/800)*45000+(i%800)*3)/1000.0;
        bits := bits || case when figcraft_private.take_admin_request(ip,'2026-01-01Z'::timestamptz + seconds * interval '1 second') then '1' else '0' end;
    end loop;
    return bits;
end;
$$;
select is(encode(sha256(convert_to(pg_temp.native_trace(),'UTF8')),'hex'),
    '515681c9dca5c497e14eaa77ecdeb2ed79bfe0ebbfcea1407bedd0ebea11500f',
    'all 2400 timed decisions match both native host modes (1540 admitted, 860 refused)');
truncate figcraft_private.online_code_budgets;
insert into figcraft_private.online_code_budgets(block,tokens,used_at)
    select network(inet '198.18.0.0'+n),10,'2025-12-31Z'::timestamptz+n*interval '1 second'
    from generate_series(0,9999) n;
select ok(figcraft_private.take_admin_request('198.18.0.0','2026-01-01Z'),'file management refreshes a code-only entry');
select ok(figcraft_private.take_admin_request('203.0.113.19','2026-01-01Z'),'new admin address triggers shared pruning');
select is((select count(*) from figcraft_private.online_code_budgets),5000::bigint,'all actions share the bounded inventory');
select ok(exists(select from figcraft_private.online_code_budgets where block='198.18.0.0/32')
    and not exists(select from figcraft_private.online_code_budgets where block='198.18.0.1/32'),'the recent admin request protects its entry');
select * from finish();
rollback;
