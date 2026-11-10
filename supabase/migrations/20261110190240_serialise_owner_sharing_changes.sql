SET local check_function_bodies = off;

CREATE TABLE "public"."online_file_share_changes" (
  "file_id"  uuid NOT NULL,
  "revision" uuid NOT NULL,
  "proof"    text NOT NULL,
  CONSTRAINT "online_file_share_changes_pkey" PRIMARY KEY (file_id)
);

ALTER TABLE "public"."online_file_share_changes"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.apply_online_share_change (
  actor      uuid,
  target     uuid,
  expected   uuid,
  revision   uuid,
  revoke_ids text[],
  new_links  jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
    prior public.online_file_share_changes;
    fingerprint text;
begin
    perform 1 from public.online_files f where f.id = target and f.owner_id = actor for update;
    if not found then raise exception 'this file is unavailable' using errcode = '42501'; end if;
    if revision is null or revision = expected or new_links is null or jsonb_typeof(new_links) <> 'array'
        or revoke_ids is null then raise exception 'invalid sharing change' using errcode = '22023'; end if;

    select * into prior from public.online_file_share_changes c where c.file_id = target;
    fingerprint := encode(sha256(convert_to(jsonb_build_array(expected, revoke_ids, new_links)::text, 'UTF8')), 'hex');
    if prior.revision = revision then
        if prior.proof <> fingerprint then raise exception 'different sharing change' using errcode = '22023'; end if;
        return;
    end if;
    if prior.revision is distinct from expected then raise exception 'sharing changed elsewhere' using errcode = '40001'; end if;

    if jsonb_array_length(new_links) <> 0 and (jsonb_array_length(new_links) <> 3 or
        (select array_agg(v->>'access_level' order by v->>'access_level') from jsonb_array_elements(new_links) v)
        is distinct from array['comment','edit','view']::text[] or
        exists (select 1 from jsonb_array_elements(new_links) v where v->>'code_hash' is null or v->>'wrapped_token' is null
            or v->>'label' is distinct from ('Shared (' || (v->>'access_level') || ')'))) then
        raise exception 'invalid shared links' using errcode = '22023';
    end if;
    if exists (select 1 from public.online_file_links l where l.file_id = target and l.id = any(revoke_ids)
        and l.label is distinct from ('Shared (' || l.access_level || ')')) then
        raise exception 'only shared links may be stopped' using errcode = '22023';
    end if;
    perform public.change_online_file_links(actor, target, revoke_ids, new_links, 100);
    insert into public.online_file_share_changes as c (file_id, revision, proof)
        values (target, revision, fingerprint) on conflict (file_id)
        do update set revision = excluded.revision, proof = excluded.proof;
end;
$function$;

ALTER TABLE "public"."online_file_share_changes"
  ADD CONSTRAINT "online_file_share_changes_file_id_fkey" FOREIGN KEY (file_id) REFERENCES public.online_files(id) ON DELETE CASCADE;

REVOKE ALL ON FUNCTION "public"."apply_online_share_change"(uuid, uuid, uuid, uuid, text[], jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION "public"."apply_online_share_change"(uuid, uuid, uuid, uuid, text[], jsonb) TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."online_file_share_changes" FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."online_file_share_changes" TO service_role;
