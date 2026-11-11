begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.uid(value text) returns uuid language sql immutable as $$select md5('participant-report-'||value)::uuid;$$;
insert into auth.users(id) values(pg_temp.uid('owner')), (pg_temp.uid('viewer'));
insert into auth.sessions(id,user_id) values(pg_temp.uid('session'),pg_temp.uid('viewer'));
insert into storage.objects(id,bucket_id,name,owner_id) values(pg_temp.uid('bytes'),'figcraft-files',
    pg_temp.uid('owner')::text||'/'||pg_temp.uid('file')::text||'.figcraft',pg_temp.uid('owner')::text);
insert into public.online_files(id,owner_id,snapshot_id,name) values(pg_temp.uid('file'),pg_temp.uid('owner'),pg_temp.uid('bytes'),'Flyer');
insert into public.online_file_links(id,file_id,access_level,label,token_hash) values('0000000000000042',pg_temp.uid('file'),'view','View',repeat('a',64));
select access_level from public.join_online_file(pg_temp.uid('viewer'),pg_temp.uid('session'),pg_temp.uid('tab'),pg_temp.uid('file'),repeat('a',64));
create function pg_temp.send(reason text) returns text language sql volatile as $$
    select public.submit_participant_report(pg_temp.uid('viewer'),pg_temp.uid('session'),pg_temp.uid('tab'),'192.0.2.1',reason);
$$;
select ok(not has_table_privilege('authenticated','figcraft_private.online_participant_reports','select'),'reporters cannot read operator reports');
select ok(not has_function_privilege('anon','public.submit_participant_report(uuid,uuid,uuid,inet,text)','execute'),'anonymous clients cannot report');
select ok(not has_function_privilege('authenticated','public.submit_participant_report(uuid,uuid,uuid,inet,text)','execute'),'a client cannot spoof its address, identity or link');
select is(public.submit_participant_report(pg_temp.uid('owner'),pg_temp.uid('session'),pg_temp.uid('tab'),'192.0.2.1','wrong account'),'unavailable','the owner cannot impersonate the viewer');
select is(public.submit_participant_report(pg_temp.uid('viewer'),pg_temp.uid('other'),pg_temp.uid('tab'),'192.0.2.1','wrong session'),'unavailable','another login cannot reuse the tab');
select is((select operator_contact||terms_url from public.online_host_information(null)),'','optional host fields are empty by default');
insert into figcraft_private.online_host_contact(operator_contact,terms_url) values('Host desk','https://example.test/terms');
select is((select terms_url from public.online_host_information(null)),'https://example.test/terms','the configured web terms are published');
update figcraft_private.online_host_contact set operator_contact=U&'\3000Host desk\00a0', terms_url=U&'\0009https://example.test/terms\2029';
select is((select operator_contact||' '||terms_url from public.online_host_information(null)),'Host desk https://example.test/terms','Unicode padding is removed from both published settings');
update figcraft_private.online_host_contact set terms_url=repeat(' ',502)||'http://'||repeat('x',493);
select is((select octet_length(terms_url) from public.online_host_information(null)),500,'byte limit applies after trimming terms');
select throws_ok($$update figcraft_private.online_host_contact set terms_url='https://'||repeat('é',247)$$,'23514',null,'501-plus UTF-8 bytes rejected');
select throws_ok($$update figcraft_private.online_host_contact set terms_url=U&'https://example.test/a\202fb'$$,'23514',null,'internal narrow nonbreaking space rejected');
select throws_ok($$update figcraft_private.online_host_contact set operator_contact=U&'Host desk\0085'$$,'23514',null,'contact controls rejected even at the boundary');
select throws_ok($$update figcraft_private.online_host_contact set operator_contact=repeat(' ',120)||'x'$$,'23514',null,'contact length is measured before trim');
update figcraft_private.online_host_contact set terms_url=U&'\0009\2002\3000';
select is((select terms_url from public.online_host_information(null)),'','whitespace-only terms omit the link');
select ok(not has_table_privilege('authenticated','figcraft_private.online_host_contact','update'),'only the operator configures public contact details');
select throws_ok($$update figcraft_private.online_host_contact set terms_url='javascript:alert(1)'$$,'23514',null,'non-web terms rejected');
select throws_ok($$update figcraft_private.online_host_contact set operator_contact=repeat('x',121)$$,'23514',null,'overlong contact rejected');
select ok(not has_function_privilege('anon','public.online_host_information(uuid)','execute'),'unsigned clients cannot fetch hosting details directly');
select is(pg_temp.send(U&'\2066\2069 '),'empty','controls alone create no operator record');
select is(pg_temp.send(U&'  Spam\000aand\202eabuse  '),'kept','admitted view-only participant can report');
select is((select reason from figcraft_private.online_participant_reports),'Spam and abuse','C0 and bidi controls become spaces');
select is((select file_name||'/'||link_id||'/'||host(address) from figcraft_private.online_participant_reports),
    'Flyer/0000000000000042/192.0.2.1','file name, actual link and ingress address come from the host');
update public.online_files set name='Renamed' where id=pg_temp.uid('file');
select is(pg_temp.send(repeat('🙂',501)),'kept','overlong reason is bounded in Unicode scalars');
select is((select char_length(reason) from figcraft_private.online_participant_reports order by number desc limit 1),500,'500 Unicode scalar limit');
select is((select file_name from figcraft_private.online_participant_reports order by number limit 1),'Flyer','earlier reports keep the name at submission');
select is((select count(*) from generate_series(1,8) n where pg_temp.send('extra '||n)='kept'),8::bigint,'ten submissions fit the initial address budget');
select is(pg_temp.send('one more'),'rate','eleventh report refused');
select is((select count(*) from figcraft_private.online_participant_reports),10::bigint,'a refusal does not write a report');
update public.online_file_connections set heard_at=now()-interval '45 seconds' where id=pg_temp.uid('tab');
select is(pg_temp.send('timed out'),'unavailable','silent participant cannot report');
update public.online_file_connections set heard_at=clock_timestamp() where id=pg_temp.uid('tab');
truncate figcraft_private.online_code_budgets,figcraft_private.online_code_global;
insert into figcraft_private.online_participant_reports(reported_at,file_id,file_name,link_id,address,reason)
select 0,pg_temp.uid('file'),'Fixture','old','192.0.2.2','Filler '||i from generate_series(1,990) i;
select is(pg_temp.send('Last'),'kept','new report retained at full capacity');
select is((select count(*) from figcraft_private.online_participant_reports),1000::bigint,'operator retains the newest thousand');
select ok(not exists(select from figcraft_private.online_participant_reports where reason='Spam and abuse'),'the oldest report was dropped');
select is(public.submit_participant_report(pg_temp.uid('viewer'),pg_temp.uid('session'),pg_temp.uid('tab'),'2001:db8:1:2::7','IPv6'),'kept','IPv6 accepted');
select is((select host(address) from figcraft_private.online_participant_reports where reason='IPv6'),'2001:db8:1:2::','operator sees the same /64 host address as the native hub');
select is(public.submit_participant_report(pg_temp.uid('viewer'),pg_temp.uid('session'),pg_temp.uid('tab'),'::ffff:192.0.2.18','Mapped'),'kept','mapped client accepted');
select is((select host(address) from figcraft_private.online_participant_reports where reason='Mapped'),'192.0.2.18','mapped address retained as IPv4');
delete from public.online_files where id=pg_temp.uid('file');
select is(pg_temp.send('after removal'),'unavailable','removed participant cannot report');
select is((select count(*) from figcraft_private.online_participant_reports),1000::bigint,'file removal leaves operator history intact');

truncate figcraft_private.online_code_budgets,figcraft_private.online_code_global;
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
        bits := bits || case when figcraft_private.take_report(ip,'2026-01-01Z'::timestamptz + seconds * interval '1 second') then '1' else '0' end;
    end loop;
    return bits;
end;
$$;
select is(encode(sha256(convert_to(pg_temp.native_trace(),'UTF8')),'hex'),
    '04aff1ef60ce6a12d43549948f623326bc3d96a9bea22e25fe85a2efff0cdec6',
    'all 800 timed decisions match the pinned public and private Rust report admission');
truncate figcraft_private.online_code_budgets;
insert into figcraft_private.online_code_budgets(block,tokens,used_at)
    select network(inet '198.18.0.0'+n),10,'2025-12-31Z'::timestamptz+n*interval '1 second'
    from generate_series(0,9999) n;
select ok(figcraft_private.take_report('198.18.0.0','2026-01-01Z'),'report refreshes a code-only entry');
select ok(figcraft_private.take_report('203.0.113.19','2026-01-01Z'),'new report address triggers shared pruning');
select is((select count(*) from figcraft_private.online_code_budgets),5000::bigint,'report uses the bounded shared address table');
select ok(exists(select from figcraft_private.online_code_budgets where block='198.18.0.0/32')
    and not exists(select from figcraft_private.online_code_budgets where block='198.18.0.1/32'),
    'a recent report protects the formerly oldest code entry');
select * from finish();
rollback;
