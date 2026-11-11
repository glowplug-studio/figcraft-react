SET local check_function_bodies = off;

CREATE TABLE "figcraft_private"."live_batches" (
  "file_id"      uuid          NOT NULL,
  "seq"          numeric(20,0) NOT NULL,
  "author"       bigint        NOT NULL,
  "batch_id"     numeric(20,0) NOT NULL,
  "changes"      jsonb         NOT NULL,
  "change_count" integer       NOT NULL,
  "byte_count"   bigint        NOT NULL,
  CONSTRAINT "live_batches_pkey" PRIMARY KEY (file_id, seq)
);

ALTER TABLE "figcraft_private"."live_batches"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "figcraft_private"."live_clients"
  ADD COLUMN "last_batch" numeric(20,0) NOT NULL DEFAULT 0;

ALTER TABLE "figcraft_private"."live_clients"
  ADD COLUMN "refused" text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE "figcraft_private"."live_rooms"
  ADD COLUMN "seq" numeric(20,0) NOT NULL DEFAULT 0;

ALTER TABLE "figcraft_private"."live_rooms"
  ADD COLUMN "checkpoint_seq" numeric(20,0) NOT NULL DEFAULT 0;

ALTER TABLE "figcraft_private"."live_rooms"
  ADD COLUMN "checkpoint" jsonb;

ALTER TABLE "figcraft_private"."live_rooms"
  ADD COLUMN "removed" jsonb NOT NULL DEFAULT '{"nodes": [], "entries": []}'::jsonb;

ALTER TABLE "figcraft_private"."live_rooms"
  ADD COLUMN "log_changes" bigint NOT NULL DEFAULT 0;

ALTER TABLE "figcraft_private"."live_rooms"
  ADD COLUMN "log_bytes" bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION figcraft_private.commit_live_batch (
  actor             uuid,
  login             uuid,
  tab               uuid,
  target            uuid,
  expected          numeric,
  issued_floor      bigint,
  batch             numeric,
  accepted          boolean,
  ops               jsonb,
  removed_ids       jsonb,
  stored_checkpoint jsonb,
  weight_bytes      bigint
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    g record;
    room figcraft_private.live_rooms;
    peer figcraft_private.live_clients;
    oldest figcraft_private.live_batches;
    first_seq numeric;
    n integer;
begin
    perform from public.online_files f where f.id=target for key share;
    select * into room from figcraft_private.live_rooms r where r.file_id=target for update;
    if not found then raise exception 'file unavailable' using errcode='42501'; end if;
    select * into strict g from figcraft_private.live_grant(actor,login,tab,target);
    select * into strict peer from figcraft_private.live_clients c where c.file_id=target and c.client_id=g.client and c.connection_id=tab for update;
    if batch is null or batch<>trunc(batch) or batch not between 1 and 18446744073709551615 then
        raise exception 'invalid batch ID' using errcode='22023';
    end if;
    if batch<=peer.last_batch then return 'processed'; end if;
    if room.seq is distinct from expected or room.highest_client is distinct from issued_floor then return 'retry'; end if;
    if accepted is null then raise exception 'missing decision' using errcode='22023'; end if;
    if accepted then
        if jsonb_typeof(ops) is distinct from 'array' or weight_bytes is null or weight_bytes<0
            or jsonb_typeof(removed_ids->'nodes') is distinct from 'array' or jsonb_typeof(removed_ids->'entries') is distinct from 'array' then
            raise exception 'invalid journal payload' using errcode='22023';
        end if;
        n := jsonb_array_length(ops);
        if n>500000 then raise exception 'too many changes' using errcode='22023'; end if;
        if g.access='view' or (g.access='comment' and exists(select from jsonb_array_elements(ops) op where
               (op->>'type' in ('put','remove') and op->>'entry'='comment' or
                op->>'type'='setDoc' and op->>'prop' in ('comments','commentOrder')) is not true)) then
            raise exception 'access denied' using errcode='42501';
        end if;
        room.seq := room.seq+1;
        insert into figcraft_private.live_batches values(target,room.seq,g.client,batch,ops,n,weight_bytes);
        room.log_changes := room.log_changes+n;
        room.log_bytes := room.log_bytes+weight_bytes;
        if stored_checkpoint is not null then
            room.checkpoint := stored_checkpoint;
            room.checkpoint_seq := room.seq;
        end if;
        select min(b.seq) into first_seq from figcraft_private.live_batches b where b.file_id=target;
        while first_seq is not null and (room.seq-first_seq+1>10000 or room.log_changes>1000000 or room.log_bytes>67108864) loop
            if first_seq>room.checkpoint_seq then raise exception 'snapshot required before journal pruning' using errcode='22023'; end if;
            delete from figcraft_private.live_batches b where b.file_id=target and b.seq=first_seq returning * into strict oldest;
            room.log_changes := room.log_changes-oldest.change_count;
            room.log_bytes := room.log_bytes-oldest.byte_count;
            first_seq := case when first_seq<room.seq then first_seq+1 end;
        end loop;
        update figcraft_private.live_rooms set seq=room.seq, removed=removed_ids, checkpoint=room.checkpoint,
            checkpoint_seq=room.checkpoint_seq,log_changes=room.log_changes,log_bytes=room.log_bytes where file_id=target;
    else
        peer.refused := array_append(peer.refused,batch::text);
        if cardinality(peer.refused)>1024 then peer.refused := peer.refused[2:1025]; end if;
    end if;
    update figcraft_private.live_clients set last_batch=batch, refused=peer.refused where file_id=target and client_id=g.client;
    return case when accepted then 'accepted' else 'refused' end;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.live_grant (
  actor  uuid,
  login  uuid,
  tab    uuid,
  target uuid
)
  RETURNS TABLE (
    client bigint,
    access text,
    path   text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
    return query select lc.client_id,l.access_level,o.name from public.online_file_connections c
        join public.online_file_links l on l.id=c.link_id and l.file_id=c.file_id
        join public.online_files f on f.id=c.file_id
        join storage.objects o on o.id=f.snapshot_id
        join figcraft_private.live_clients lc on lc.file_id=c.file_id and lc.connection_id=c.id
        where c.file_id=target and c.id=tab and c.principal_id=actor and c.session_id=login
            and lc.session_id=login and c.heard_at>figcraft_private.connection_cutoff()
        for key share of l,c;
    if not found then raise exception 'live connection unavailable' using errcode='42501'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.read_live_journal (
  actor      uuid,
  login      uuid,
  tab        uuid,
  target     uuid,
  after_seq  numeric,
  validation boolean
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    g record;
    room figcraft_private.live_rooms;
    peer figcraft_private.live_clients;
    first_seq numeric;
    since_seq numeric;
    reset boolean;
    result jsonb;
begin
    perform from public.online_files f where f.id=target for key share;
    select * into room from figcraft_private.live_rooms r where r.file_id=target for share;
    if not found then raise exception 'file unavailable' using errcode='42501'; end if;
    select * into strict g from figcraft_private.live_grant(actor,login,tab,target);
    select * into strict peer from figcraft_private.live_clients c where c.file_id=target and c.client_id=g.client and c.connection_id=tab;
    select min(b.seq) into first_seq from figcraft_private.live_batches b where b.file_id=target;
    reset := after_seq is null or after_seq>room.seq or after_seq<coalesce(first_seq,room.seq+1)-1;
    since_seq := case when reset then room.checkpoint_seq else after_seq end;
    select jsonb_build_object('client',g.client,'access',g.access,'sequence',room.seq::text,'lastBatch',peer.last_batch::text,
        'refused',peer.refused,'reset',reset,'batches',coalesce(jsonb_agg(jsonb_build_object('sequence',b.seq::text,
            'client',b.author,'batch',b.batch_id::text,'changes',b.changes) order by b.seq),'[]'::jsonb))
        into result from figcraft_private.live_batches b where b.file_id=target and b.seq>since_seq;
    if reset then result := result || jsonb_build_object('path',g.path,'checkpoint',room.checkpoint,'checkpointSeq',room.checkpoint_seq::text); end if;
    if validation then result := result || jsonb_build_object('removed',room.removed,'highest',room.highest_client,
        'issued',(select jsonb_agg(c.client_id) from figcraft_private.live_clients c where c.file_id=target),
        'checkpointSeq',room.checkpoint_seq::text,'logChanges',room.log_changes,'logBytes',room.log_bytes); end if;
    return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.commit_live_batch (
  actor             uuid,
  login             uuid,
  tab               uuid,
  target            uuid,
  expected          numeric,
  issued_floor      bigint,
  batch             numeric,
  accepted          boolean,
  ops               jsonb,
  removed_ids       jsonb,
  stored_checkpoint jsonb,
  weight_bytes      bigint
)
  RETURNS text
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    select figcraft_private.commit_live_batch(actor,login,tab,target,expected,issued_floor,batch,accepted,ops,removed_ids,stored_checkpoint,weight_bytes);
$function$;

CREATE OR REPLACE FUNCTION public.read_live_journal (
  actor      uuid,
  login      uuid,
  tab        uuid,
  target     uuid,
  after_seq  numeric,
  validation boolean
)
  RETURNS jsonb
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    select figcraft_private.read_live_journal(actor,login,tab,target,after_seq,validation);
$function$;

ALTER TABLE "figcraft_private"."live_batches"
  ADD CONSTRAINT "live_batches_file_id_fkey" FOREIGN KEY (file_id) REFERENCES figcraft_private.live_rooms(file_id) ON DELETE CASCADE;

ALTER TABLE "figcraft_private"."live_rooms"
  ADD CONSTRAINT "live_rooms_seq_check" CHECK (((seq >= (0)::numeric) AND (seq <= '18446744073709551615'::numeric)));

REVOKE ALL ON FUNCTION "figcraft_private"."commit_live_batch"(uuid, uuid, uuid, uuid, numeric, bigint, numeric, boolean, jsonb, jsonb, jsonb, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
  ON FUNCTION "figcraft_private"."commit_live_batch"(uuid, uuid, uuid, uuid, numeric, bigint, numeric, boolean, jsonb, jsonb, jsonb, bigint)
  TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."live_grant"(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."live_grant"(uuid, uuid, uuid, uuid) TO "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."read_live_journal"(uuid, uuid, uuid, uuid, numeric, boolean) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."read_live_journal"(uuid, uuid, uuid, uuid, numeric, boolean) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."commit_live_batch"(uuid, uuid, uuid, uuid, numeric, bigint, numeric, boolean, jsonb, jsonb, jsonb, bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."commit_live_batch"(uuid, uuid, uuid, uuid, numeric, bigint, numeric, boolean, jsonb, jsonb, jsonb, bigint) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."read_live_journal"(uuid, uuid, uuid, uuid, numeric, boolean) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "public"."read_live_journal"(uuid, uuid, uuid, uuid, numeric, boolean) TO "postgres", "service_role";

REVOKE ALL ON TABLE "figcraft_private"."live_batches" FROM PUBLIC, anon, authenticated, service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."live_batches" TO "postgres";
