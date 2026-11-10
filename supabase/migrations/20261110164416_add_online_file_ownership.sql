SET local check_function_bodies = off;

CREATE TABLE "public"."online_files" (
  "id"          uuid                     NOT NULL,
  "owner_id"    uuid                     NOT NULL,
  "snapshot_id" uuid                     NOT NULL,
  "name"        text                     NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "online_files_name_check" CHECK ((char_length(name) <= 256)),
  CONSTRAINT "online_files_pkey" PRIMARY KEY (id),
  CONSTRAINT "online_files_snapshot_id_key" UNIQUE (snapshot_id)
);

ALTER TABLE "public"."online_files"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.clean_online_file_rename()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
    new.name := left(regexp_replace(
        btrim(new.name, U&'\0009\000a\000b\000c\000d\0020\0085\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000'),
        U&'[[:cntrl:]\061c\200e\200f\202a-\202e\2066-\2069]', '', 'g'
    ), 256);
    if new.name = '' then
        raise exception 'give the file a name' using errcode = '22023';
    end if;
    return new;
end;
$function$;

ALTER TABLE "public"."online_files"
  ADD CONSTRAINT "online_files_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."online_files"
  ADD CONSTRAINT "online_files_snapshot_id_fkey" FOREIGN KEY (snapshot_id) REFERENCES storage.objects(id) ON DELETE CASCADE;

CREATE INDEX online_files_owner_id_idx ON public.online_files USING btree (owner_id);

CREATE TRIGGER clean_online_file_rename
  BEFORE UPDATE OF name ON public.online_files
  FOR EACH ROW
  EXECUTE FUNCTION public.clean_online_file_rename();

CREATE POLICY "Owners rename their online files" ON "public"."online_files"
  FOR UPDATE
  TO "authenticated"
  USING ((owner_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "Owners see their online files" ON "public"."online_files"
  FOR SELECT
  TO "authenticated"
  USING ((owner_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "Owners read private Figcraft snapshots" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'figcraft-files'::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text)));

CREATE POLICY "Owners remove private Figcraft snapshots" ON "storage"."objects"
  FOR DELETE
  TO "authenticated"
  USING (((bucket_id = 'figcraft-files'::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text)));

CREATE POLICY "Owners upload private Figcraft snapshots" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    (((bucket_id = 'figcraft-files'::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND (name ~ (('^'::text || (( SELECT auth.uid() AS uid))::text) ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]figcraft$'::text))));

REVOKE ALL ON FUNCTION "public"."clean_online_file_rename"() FROM PUBLIC, "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."clean_online_file_rename"() TO "postgres", "service_role";

-- Local and hosted projects may predate the restricted Data API defaults.
-- A table-level REVOKE also removes existing column privileges.
REVOKE ALL ON TABLE "public"."online_files" FROM PUBLIC, "anon", "authenticated";

GRANT SELECT, UPDATE ("name") ON TABLE "public"."online_files" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."online_files" TO "postgres", "service_role";
