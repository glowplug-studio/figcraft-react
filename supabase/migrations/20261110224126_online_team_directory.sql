SET local check_function_bodies = off;

CREATE TABLE "figcraft_private"."team_directory_settings" (
  "singleton"    boolean NOT NULL DEFAULT true,
  "access_level" text    NOT NULL,
  "web_url"      text    NOT NULL DEFAULT ''::text,
  CONSTRAINT "team_directory_settings_access_level_check" CHECK ((access_level = ANY (ARRAY['edit'::text, 'view'::text, 'comment'::text]))),
  CONSTRAINT "team_directory_settings_pkey" PRIMARY KEY (singleton),
  CONSTRAINT "team_directory_settings_singleton_check" CHECK (singleton),
  CONSTRAINT "team_directory_settings_web_url_check"
    CHECK (((web_url = ''::text) OR ((web_url ~ '^https?://'::text) AND (octet_length(web_url) <= 500) AND (web_url !~ '[?#[:space:][:cntrl:]]'::text))))
);

ALTER TABLE "figcraft_private"."team_directory_settings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "figcraft_private"."team_file_links" (
  "file_id" uuid NOT NULL,
  "link_id" text NOT NULL,
  "token"   text NOT NULL,
  CONSTRAINT "team_file_links_link_id_key" UNIQUE (link_id),
  CONSTRAINT "team_file_links_pkey" PRIMARY KEY (file_id)
);

ALTER TABLE "figcraft_private"."team_file_links"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION figcraft_private.drop_previous_team_access()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
    delete from public.online_file_links l using figcraft_private.team_file_links t where l.id=t.link_id;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.online_team_directory()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    select coalesce((
        select jsonb_build_object('state','listed','web',s.web_url,'files',(
            select coalesce(jsonb_agg(jsonb_build_object(
                'file',f.id,'name',f.name,'updated',f.updated::text,'access',s.access_level,
                'people',(select count(*) from public.online_file_connections c where c.file_id=f.id
                    and c.heard_at > figcraft_private.connection_cutoff())
            ) order by f.updated desc, f.name collate "C", f.id),'[]'::jsonb)
            from (
                select f.id, f.name, floor(extract(epoch from coalesce(f.document_updated_at,f.created_at))) as updated
                from public.online_files f where exists (
                    select from public.online_file_links l where l.file_id=f.id and l.code_hash is not null
                ) order by updated desc, f.name collate "C", f.id limit 500
            ) f
        )) from figcraft_private.team_directory_settings s where (select auth.uid()) is not null
    ),jsonb_build_object('state','none'));
$function$;

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
        if (select count(*) from public.online_file_links l where l.file_id=target) >= 100 then
            return jsonb_build_object('status','full');
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

CREATE OR REPLACE FUNCTION figcraft_private.revoke_unshared_team_link()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
    if not exists (select from public.online_file_links l where l.file_id=old.file_id and l.code_hash is not null) then
        delete from public.online_file_links l using figcraft_private.team_file_links t
            where t.file_id=old.file_id and l.id=t.link_id;
    end if;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.online_team_directory()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$select figcraft_private.online_team_directory();$function$;

CREATE OR REPLACE FUNCTION public.resolve_team_file (
  target uuid
)
  RETURNS jsonb
  LANGUAGE sql
  SET search_path TO ''
  AS $function$select figcraft_private.resolve_team_file(target);$function$;

ALTER TABLE "figcraft_private"."team_file_links"
  ADD CONSTRAINT "team_file_links_link_id_file_id_fkey" FOREIGN KEY (link_id, file_id) REFERENCES public.online_file_links(id, file_id) ON DELETE CASCADE;

CREATE TRIGGER drop_changed_team_access
  AFTER UPDATE OF access_level ON figcraft_private.team_directory_settings
  FOR EACH ROW
  WHEN ((old.access_level IS DISTINCT FROM new.access_level))
  EXECUTE FUNCTION figcraft_private.drop_previous_team_access();

CREATE TRIGGER drop_disabled_team_access
  AFTER DELETE ON figcraft_private.team_directory_settings
  FOR EACH ROW
  EXECUTE FUNCTION figcraft_private.drop_previous_team_access();

CREATE TRIGGER revoke_uncoded_team_link
  AFTER UPDATE OF code_hash ON public.online_file_links
  FOR EACH ROW
  WHEN (((old.code_hash IS NOT NULL) AND (new.code_hash IS NULL)))
  EXECUTE FUNCTION figcraft_private.revoke_unshared_team_link();

CREATE TRIGGER revoke_unshared_team_link
  AFTER DELETE ON public.online_file_links
  FOR EACH ROW
  WHEN ((old.code_hash IS NOT NULL))
  EXECUTE FUNCTION figcraft_private.revoke_unshared_team_link();

REVOKE ALL ON FUNCTION "figcraft_private"."drop_previous_team_access"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "figcraft_private"."drop_previous_team_access"() TO "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."online_team_directory"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "figcraft_private"."online_team_directory"() TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."resolve_team_file"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "figcraft_private"."resolve_team_file"(uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "figcraft_private"."revoke_unshared_team_link"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "figcraft_private"."revoke_unshared_team_link"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."online_team_directory"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."online_team_directory"() TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."resolve_team_file"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."resolve_team_file"(uuid) TO "authenticated", "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."team_directory_settings" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."team_file_links" TO "postgres";

-- Supabase's local public-schema defaults also grant EXECUTE to API roles directly.
revoke all on function public.online_team_directory(), public.resolve_team_file(uuid) from anon, service_role;
