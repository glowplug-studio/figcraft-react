SET local check_function_bodies = off;

CREATE UNLOGGED TABLE "figcraft_private"."live_peer_names" (
  "connection_id" uuid NOT NULL,
  "display_name"  text NOT NULL,
  CONSTRAINT "live_peer_names_display_name_check" CHECK (((char_length(display_name) >= 1) AND (char_length(display_name) <= 64))),
  CONSTRAINT "live_peer_names_pkey" PRIMARY KEY (connection_id)
);

ALTER TABLE "figcraft_private"."live_peer_names"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION figcraft_private.live_participants (
  actor   uuid,
  login   uuid,
  tab     uuid,
  target  uuid,
  display text,
  welcome boolean
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    receipt jsonb;
    peers jsonb;
    actual text;
begin
    if display is null or char_length(display)>64 or display ~ '[[:cntrl:]]' then
        raise exception 'invalid display name' using errcode='22023';
    end if;
    receipt:=figcraft_private.live_presence_targets(actor,login,tab,target,display='');
    actual:=coalesce(nullif(display,''),'Guest '||coalesce(receipt->>'guest',receipt->>'client'));
    if not exists(select 1 from figcraft_private.live_peer_names n where n.connection_id=tab and n.display_name=actual) then
        insert into figcraft_private.live_peer_names as n(connection_id,display_name) values(tab,actual)
            on conflict(connection_id) do update set display_name=excluded.display_name where n.display_name<>excluded.display_name;
    end if;
    if welcome then
        select coalesce(jsonb_agg(jsonb_build_object('client',lc.client_id,'colour',pc.colour,'name',n.display_name,
            'generation',(extract(epoch from pc.generation)*1000000)::bigint::text) order by lc.client_id),'[]'::jsonb)
        into peers from figcraft_private.live_clients lc
        join public.online_file_connections c on c.id=lc.connection_id and c.file_id=lc.file_id
        join figcraft_private.live_presence_connections pc on pc.connection_id=c.id
        join figcraft_private.live_peer_names n on n.connection_id=c.id
        where c.file_id=target and c.id<>tab and c.heard_at>figcraft_private.connection_cutoff();
    end if;
    return receipt||jsonb_build_object('name',actual,'peers',peers);
end;
$function$;

CREATE OR REPLACE FUNCTION public.live_participants (
  actor   uuid,
  login   uuid,
  tab     uuid,
  target  uuid,
  display text,
  welcome boolean
)
  RETURNS jsonb
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    select figcraft_private.live_participants(actor,login,tab,target,display,welcome);
$function$;

ALTER TABLE "figcraft_private"."live_peer_names"
  ADD CONSTRAINT "live_peer_names_connection_id_fkey" FOREIGN KEY (connection_id) REFERENCES figcraft_private.live_presence_connections(connection_id) ON DELETE CASCADE;

REVOKE ALL ON FUNCTION "figcraft_private"."live_participants"(uuid, uuid, uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."live_participants"(uuid, uuid, uuid, uuid, text, boolean) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."live_participants"(uuid, uuid, uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."live_participants"(uuid, uuid, uuid, uuid, text, boolean) TO "postgres", "service_role";

REVOKE ALL ON TABLE "figcraft_private"."live_peer_names" FROM PUBLIC, anon, authenticated, service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."live_peer_names" TO "postgres";
