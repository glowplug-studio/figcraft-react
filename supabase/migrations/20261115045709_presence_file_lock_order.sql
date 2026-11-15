SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION figcraft_private.live_presence_targets (
  actor          uuid,
  login          uuid,
  tab            uuid,
  target         uuid,
  anonymous_name boolean
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    sender bigint;
    registration figcraft_private.live_presence_connections;
    used smallint[];
begin
    -- Every grant must lock the file before its links and connection. Removal
    -- locks the file/connections before cascading to links, including when a
    -- subsequent sample reuses an existing presence allocation.
    perform 1 from public.online_files where id=target for key share;
    if not exists(select 1 from figcraft_private.live_presence_connections where connection_id=tab) then
        perform 1 from figcraft_private.live_rooms where file_id=target for update;
    end if;
    select g.client into strict sender from figcraft_private.live_grant(actor,login,tab,target) g;
    select * into registration from figcraft_private.live_presence_connections where connection_id=tab;
    if not found then
        select coalesce(array_agg(pc.colour),'{}') into used
        from public.online_file_connections c
        join figcraft_private.live_presence_connections pc on pc.connection_id=c.id
        where c.file_id=target and c.heard_at>figcraft_private.connection_cutoff();
        select n into registration.colour from generate_series(0,7) n where not n=any(used) order by n limit 1;
        if registration.colour is null then registration.colour:=cardinality(used)%8; end if;
        if anonymous_name then
            update figcraft_private.live_rooms set guest_names_issued=guest_names_issued+1
                where file_id=target returning guest_names_issued into registration.guest_number;
        end if;
        insert into figcraft_private.live_presence_connections(connection_id,colour,guest_number)
            values(tab,registration.colour,registration.guest_number) returning * into registration;
    end if;
    return jsonb_build_object('client',sender,'colour',registration.colour,'guest',registration.guest_number,
        'generation',(extract(epoch from registration.generation)*1000000)::bigint::text,'targets',figcraft_private.live_recipient_topics(target,tab));
end;
$function$;
