begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- This transaction uses an empty test host even when other local fixtures
-- already published files. The rollback restores all existing listings.
delete from public.online_files;
select ok(not has_table_privilege('authenticated','figcraft_private.online_file_usage','select')
    and not has_table_privilege('service_role','figcraft_private.online_file_usage','update'), 'usage and ingress are private');
select ok(not has_function_privilege('service_role','public.finalise_online_publication(uuid,uuid,uuid,text,jsonb,boolean)','execute'),
    'the host cannot bypass retained accounting through the old installation RPC');
select ok(not has_function_privilege('authenticated','public.keep_online_publication(uuid,uuid,uuid,text,jsonb,boolean,inet,bigint,integer,integer,bigint,bigint)','execute')
    and not has_function_privilege('anon','public.unmeasured_online_files()','execute')
    and not has_function_privilege('authenticated','public.record_prior_online_usage(uuid,uuid,bigint)','execute'),
    'clients cannot choose trusted limits, read prior owners or write a measured size');
select is((select array_agg(block::text order by multiplier) from figcraft_private.publication_blocks('::ffff:192.0.2.1')),
    array['192.0.2.1/32'], 'mapped IPv4 shares the ordinary IPv4 budget');
select is((select array_agg(block::text order by multiplier) from figcraft_private.publication_blocks('2001:db8:42:1234::8')),
    array['2001:db8:42:1234::/64','2001:db8:42:1200::/56','2001:db8:42::/48'], 'IPv6 admission checks three native blocks');

insert into auth.users(id) values(md5('capacity-user')::uuid);
insert into storage.objects(id,bucket_id,name)
    select md5('object'||i)::uuid,'figcraft-files', md5('capacity-user')::uuid::text||'/'||md5('file'||i)::uuid::text||'.figcraft'
    from generate_series(1,18) i;
create function pg_temp.keep(i integer, ip inet, n bigint default 100, per_ip integer default 20,
    block_bytes bigint default 10000, total bigint default 100000, files integer default 1000)
returns integer language sql as $$
    select count(*)::integer from public.keep_online_publication(md5('capacity-user')::uuid, md5('file'||i)::uuid,
        md5('object'||i)::uuid, 'Test', jsonb_build_object(
            'edit',jsonb_build_object('id',left(md5('edit'||i),16),'hash',repeat('a',64)),
            'view',jsonb_build_object('id',left(md5('view'||i),16),'hash',repeat('b',64))
        ),true,ip,n,files,per_ip,block_bytes,total);
$$;
select is(pg_temp.keep(1,'::ffff:192.0.2.1',100,1,100,100),1,'accepts first snapshot at the exact cap');
select is((select snapshot_bytes+log_bytes from figcraft_private.online_file_usage),113::bigint,'kept bytes include the 13-byte journal header');
select is(pg_temp.keep(1,'192.0.2.9',null,1,1,1),1,'an existing receipt survives a tighter quota and a changed address');
select throws_ok($$select pg_temp.keep(2,'192.0.2.1',100,1)$$,'FC002','Your address has reached its retained file limit','a mapped and ordinary address share a file cap');
select throws_ok($$select pg_temp.keep(2,'192.0.2.1',100,20,212)$$,'FC002','Your address has reached its retained byte limit','one byte over retained plus proposed fails');
select throws_ok($$select pg_temp.keep(2,'192.0.2.2',100,20,10000,212)$$,'FC002','This server has reached its retained byte limit','another address shares the host byte cap');
select throws_ok($$select pg_temp.keep(2,'192.0.2.2',100,20,10000,10000,1)$$,'FC002','This server has reached its retained file limit','the server file cap covers independent addresses');
select is((select count(*) from public.online_files),1::bigint,'refusal creates no listing');
select is((select count(*) from public.online_file_links),2::bigint,'refusal creates no grants');
select is(pg_temp.keep(2,'192.0.2.1',100,20,213,213),1,'exact remaining retained capacity is accepted');
delete from public.online_files where id in (md5('file1')::uuid,md5('file2')::uuid);
select is((select count(*) from figcraft_private.online_file_usage),0::bigint,'removal releases both reservations');
select is(pg_temp.keep(3,'2001:db8:42:101::2',100,1),1,'one IPv6 /64 admitted');
select throws_ok($$select pg_temp.keep(4,'2001:db8:42:101::ffe',100,1)$$,'FC002','Your address has reached its retained file limit','another host in the /64 shares the cap');
select is(pg_temp.keep(4,'2001:db8:42:102::1',100,1),1,'second /64 fits wider /56');
select throws_ok($$select pg_temp.keep(5,'2001:db8:42:103::1',100,1)$$,'FC002','Your address has reached its retained file limit','third /64 exceeds twice the limit');
select is(pg_temp.keep(5,'2001:db8:42:201::1',100,1),1,'another /56 counts towards /48');
select is(pg_temp.keep(6,'2001:db8:42:202::1',100,1),1,'fourth /64 fits the /48');
select throws_ok($$select pg_temp.keep(7,'2001:db8:42:302::1',100,1)$$,'FC002','Your address has reached its retained file limit','fifth /64 exceeds four times the cap');
select is(pg_temp.keep(7,'2001:db8:43:302::1',100,1),1,'unrelated /48 retains its own allowance');

-- A pre-accounting row has neither a usable ingress address nor a measured size.
delete from public.online_files;
insert into public.online_files(id, owner_id, snapshot_id, name) values
    (md5('file8')::uuid,md5('capacity-user')::uuid,md5('object8')::uuid,'Previous version');
select throws_ok($$select pg_temp.keep(9,'192.0.2.8')$$,'FC001','retained sizes require measurement','legacy bytes must be accounted before another reservation');
select is((select snapshot_id from public.unmeasured_online_files()),md5('object8')::uuid,'only unmeasured immutable objects are returned');
select public.record_prior_online_usage(md5('file8')::uuid,md5('other')::uuid,100);
select is((select count(*) from public.unmeasured_online_files()),1::bigint,'a replaced snapshot cannot adopt an obsolete measurement');
select public.record_prior_online_usage(md5('file8')::uuid,md5('object8')::uuid,100);
select public.record_prior_online_usage(md5('file8')::uuid,md5('object8')::uuid,999);
select throws_ok($$select pg_temp.keep(9,'192.0.2.8',100,1,100,212)$$,'FC002','This server has reached its retained byte limit','unknown historic addresses still consume global bytes');
select is(pg_temp.keep(9,'192.0.2.8',100,1,100,213),1,'a legacy charge is immutable and has no invented address');
select * from finish();
rollback;
