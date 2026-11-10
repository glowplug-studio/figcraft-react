SET local check_function_bodies = off;

CREATE TABLE "public"."online_file_links" (
  "id"            text                     NOT NULL,
  "file_id"       uuid                     NOT NULL,
  "access_level"  text                     NOT NULL,
  "label"         text                     NOT NULL,
  "token_hash"    text                     NOT NULL,
  "code_hash"     text,
  "wrapped_token" text,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "online_file_links_access_level_check" CHECK ((access_level = ANY (ARRAY['view'::text, 'comment'::text, 'edit'::text]))),
  CONSTRAINT "online_file_links_check" CHECK (((code_hash IS NULL) = (wrapped_token IS NULL))),
  CONSTRAINT "online_file_links_code_hash_check" CHECK ((code_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "online_file_links_file_id_token_hash_key" UNIQUE (file_id, token_hash),
  CONSTRAINT "online_file_links_id_check" CHECK ((id ~ '^[0-9a-f]{16}$'::text)),
  CONSTRAINT "online_file_links_label_check" CHECK ((char_length(label) <= 256)),
  CONSTRAINT "online_file_links_pkey" PRIMARY KEY (id),
  CONSTRAINT "online_file_links_token_hash_check" CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "online_file_links_wrapped_token_check" CHECK ((wrapped_token ~ '^([0-9a-f]{2}){1,32}$'::text))
);

ALTER TABLE "public"."online_file_links"
  ENABLE ROW LEVEL SECURITY;

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
declare
    retained integer;
begin
    perform 1 from public.online_files where id = target and owner_id = actor for update;
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

ALTER TABLE "public"."online_file_links"
  ADD CONSTRAINT "online_file_links_file_id_fkey" FOREIGN KEY (file_id) REFERENCES public.online_files(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX online_file_links_code_idx ON public.online_file_links USING btree (code_hash)
  WHERE (code_hash IS NOT NULL);

REVOKE ALL ON FUNCTION "public"."change_online_file_links"(uuid, uuid, text[], jsonb, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION "public"."change_online_file_links"(uuid, uuid, text[], jsonb, integer) TO "postgres", "service_role";

-- The local Data API roles inherit table and function grants at creation.
REVOKE ALL ON TABLE "public"."online_file_links" FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."online_file_links" TO service_role;
