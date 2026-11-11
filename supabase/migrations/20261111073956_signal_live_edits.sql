SET local check_function_bodies = off;

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
    recipient record;
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
        for recipient in select c.session_id,c.id from public.online_file_connections c
            where c.file_id=target and c.id<>tab and c.heard_at>figcraft_private.connection_cutoff()
        loop
            perform realtime.send(jsonb_build_object('sequence',room.seq::text),'edits',
                'figcraft-connection:'||recipient.session_id::text||':'||recipient.id::text,true);
        end loop;
    else
        peer.refused := array_append(peer.refused,batch::text);
        if cardinality(peer.refused)>1024 then peer.refused := peer.refused[2:1025]; end if;
    end if;
    update figcraft_private.live_clients set last_batch=batch, refused=peer.refused where file_id=target and client_id=g.client;
    return case when accepted then 'accepted' else 'refused' end;
end;
$function$;
