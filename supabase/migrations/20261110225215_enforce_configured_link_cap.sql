SET local check_function_bodies = off;

CREATE TABLE "figcraft_private"."online_link_settings" (
  "singleton" boolean NOT NULL DEFAULT true,
  "max_links" numeric NOT NULL,
  CONSTRAINT "online_link_settings_max_links_check" CHECK (((max_links = trunc(max_links)) AND ((max_links >= (1)::numeric) AND (max_links <= '18446744073709551615'::numeric)))),
  CONSTRAINT "online_link_settings_pkey" PRIMARY KEY (singleton),
  CONSTRAINT "online_link_settings_singleton_check" CHECK (singleton)
);

ALTER TABLE "figcraft_private"."online_link_settings"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION figcraft_private.change_online_file_links (
  actor      uuid,
  target     uuid,
  revoke_ids text[],
  new_links  jsonb,
  link_limit numeric
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
    retained bigint;
begin
    perform 1 from public.online_files where id = target and owner_id = actor for no key update;
    if not found then
        raise exception 'this file is unavailable' using errcode = '42501';
    end if;
    if revoke_ids is null or new_links is null or jsonb_typeof(new_links) <> 'array'
            or link_limit is null or link_limit < 0 then
        raise exception 'invalid link change' using errcode = '22023';
    end if;

    if exists (
        select 1 from unnest(revoke_ids) as requested(id)
        where not exists (
            select 1 from public.online_file_links as link where link.file_id = target and link.id = requested.id
        )
    ) then
        raise exception 'that file has no such link' using errcode = '22023';
    end if;
    delete from public.online_file_links where file_id = target and id = any(revoke_ids);
    select count(*) into retained from public.online_file_links where file_id = target;
    if jsonb_array_length(new_links) > greatest(0, link_limit - retained) then
        raise exception 'a file has at most % links: revoke one first', link_limit using errcode = '22023';
    end if;

    insert into public.online_file_links (id, file_id, access_level, label, token_hash, code_hash, wrapped_token)
    select item.id, target, item.access_level, item.label, item.token_hash, item.code_hash, item.wrapped_token
    from jsonb_to_recordset(new_links) as item(
        id text, access_level text, label text, token_hash text, code_hash text, wrapped_token text
    );
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.host_link_limit()
  RETURNS numeric
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$select coalesce((select max_links from figcraft_private.online_link_settings where singleton),100);$function$;

CREATE OR REPLACE FUNCTION figcraft_private.resolve_team_file (
  target uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    team_access text;
    issued_token text;
    issued_id text;
    max_links numeric;
begin
    if (select auth.uid()) is null then
        raise exception 'sign in to join a team file' using errcode = '42501';
    end if;
    select s.access_level into team_access from figcraft_private.team_directory_settings s for share;
    if not found then return jsonb_build_object('status','disabled'); end if;
    perform 1 from public.online_files f where f.id=target for no key update;
    if not found or not exists (select from public.online_file_links l
        where l.file_id=target and l.code_hash is not null) then
        return jsonb_build_object('status','unshared');
    end if;
    select t.token into issued_token from figcraft_private.team_file_links t where t.file_id=target;
    if not found then
        -- Same host cap and file lock as owner-issued links.
        max_links := figcraft_private.host_link_limit();
        if (select count(*) from public.online_file_links l where l.file_id=target) >= max_links then
            return jsonb_build_object('status','full','limit',trunc(max_links)::text);
        end if;
        issued_id := encode(extensions.gen_random_bytes(8),'hex');
        issued_token := translate(rtrim(encode(extensions.gen_random_bytes(16),'base64'),'='),'+/','-_');
        insert into public.online_file_links(id,file_id,access_level,label,token_hash)
            values(issued_id,target,team_access,'Team (' || team_access || ')',
                encode(sha256(convert_to(issued_token,'UTF8')),'hex'));
        insert into figcraft_private.team_file_links(file_id,link_id,token) values(target,issued_id,issued_token);
    end if;
    return jsonb_build_object('file',target,'token',issued_token);
end;
$function$;

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
    perform 1 from public.online_files f where f.id = target and f.owner_id = actor for no key update;
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
    perform figcraft_private.change_online_file_links(actor, target, revoke_ids, new_links, figcraft_private.host_link_limit());
    insert into public.online_file_share_changes as c (file_id, revision, proof)
        values (target, revision, fingerprint) on conflict (file_id)
        do update set revision = excluded.revision, proof = excluded.proof;
end;
$function$;

CREATE OR REPLACE FUNCTION public.change_online_file_links (
  actor      uuid,
  target     uuid,
  revoke_ids text[],
  new_links  jsonb,
  link_limit integer
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
    perform figcraft_private.change_online_file_links(actor,target,revoke_ids,new_links,link_limit::numeric);
end;
$function$;

CREATE TRIGGER drop_truncated_team_access
  AFTER TRUNCATE ON figcraft_private.team_directory_settings
  FOR EACH STATEMENT
  EXECUTE FUNCTION figcraft_private.drop_previous_team_access();

REVOKE ALL ON FUNCTION "figcraft_private"."change_online_file_links"(uuid, uuid, text[], jsonb, numeric) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "figcraft_private"."change_online_file_links"(uuid, uuid, text[], jsonb, numeric) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "figcraft_private"."host_link_limit"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "figcraft_private"."host_link_limit"() TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."online_link_settings" TO "postgres";
