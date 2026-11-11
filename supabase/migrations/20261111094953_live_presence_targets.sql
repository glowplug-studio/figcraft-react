SET local check_function_bodies = off;

CREATE TABLE "figcraft_private"."live_presence_connections" (
  "connection_id" uuid                     NOT NULL,
  "colour"        smallint                 NOT NULL,
  "guest_number"  bigint,
  "generation"    timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "live_presence_connections_colour_check" CHECK (((colour >= 0) AND (colour <= 7))),
  CONSTRAINT "live_presence_connections_pkey" PRIMARY KEY (connection_id)
);

ALTER TABLE "figcraft_private"."live_presence_connections"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "figcraft_private"."live_rooms"
  ADD COLUMN "guest_names_issued" bigint NOT NULL DEFAULT 0;

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
    targets jsonb;
begin
    -- Match admission lock order. Subsequent samples only read their existing allocation.
    if not exists(select 1 from figcraft_private.live_presence_connections where connection_id=tab) then
        perform 1 from public.online_files where id=target for key share;
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
    select coalesce(jsonb_agg('figcraft-connection:'||c.session_id::text||':'||c.id::text),'[]'::jsonb)
        into targets from public.online_file_connections c
        join figcraft_private.live_clients lc on lc.connection_id=c.id and lc.file_id=c.file_id
        where c.file_id=target and c.id<>tab and c.heard_at>figcraft_private.connection_cutoff();
    return jsonb_build_object('client',sender,'colour',registration.colour,'guest',registration.guest_number,
        'generation',(extract(epoch from registration.generation)*1000000)::bigint::text,'targets',targets);
end;
$function$;

CREATE OR REPLACE FUNCTION public.live_presence_targets (
  actor          uuid,
  login          uuid,
  tab            uuid,
  target         uuid,
  anonymous_name boolean
)
  RETURNS jsonb
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    select figcraft_private.live_presence_targets(actor,login,tab,target,anonymous_name);
$function$;

ALTER TABLE "figcraft_private"."live_presence_connections"
  ADD CONSTRAINT "live_presence_connections_connection_id_fkey" FOREIGN KEY (connection_id) REFERENCES public.online_file_connections(id) ON DELETE CASCADE;

REVOKE ALL ON FUNCTION "figcraft_private"."live_presence_targets"(uuid, uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."live_presence_targets"(uuid, uuid, uuid, uuid, boolean) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."live_presence_targets"(uuid, uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."live_presence_targets"(uuid, uuid, uuid, uuid, boolean) TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."live_presence_connections" TO "postgres";
