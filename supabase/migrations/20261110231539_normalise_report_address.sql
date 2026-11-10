SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION figcraft_private.keep_participant_report (
  actor        uuid,
  auth_session uuid,
  tab          uuid,
  address      inet,
  reason       text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    connection public.online_file_connections;
    title text;
    cleaned text := figcraft_private.clean_report_reason(reason);
begin
    if coalesce(cleaned,'') = '' then return 'empty'; end if;
    select c.* into connection from public.online_file_connections c where c.id=tab
        and c.principal_id=actor and c.session_id=auth_session;
    if not found then return 'unavailable'; end if;
    -- Use the same file → link → connection order as join and owner revocation.
    select f.name into title from public.online_files f where f.id=connection.file_id for key share;
    if not found then return 'unavailable'; end if;
    perform 1 from public.online_file_links l where l.id=connection.link_id for key share;
    if not found then return 'unavailable'; end if;
    perform 1 from public.online_file_connections c where c.id=tab and c.link_id=connection.link_id
        and c.principal_id=actor and c.session_id=auth_session and c.heard_at>figcraft_private.connection_cutoff() for share;
    if not found then return 'unavailable'; end if;
    if not figcraft_private.take_report(address,null) then return 'rate'; end if;
    insert into figcraft_private.online_participant_reports(reported_at,file_id,file_name,link_id,address,reason)
        select floor(extract(epoch from clock_timestamp()))::bigint,connection.file_id,title,connection.link_id,host(block)::inet,cleaned
        from figcraft_private.publication_blocks(address) where multiplier=1;
    delete from figcraft_private.online_participant_reports where number <= (
        select number from figcraft_private.online_participant_reports order by number desc offset 1000 limit 1
    );
    return 'kept';
end;
$function$;
