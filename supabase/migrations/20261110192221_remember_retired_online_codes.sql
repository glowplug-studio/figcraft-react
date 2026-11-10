SET local check_function_bodies = off;

CREATE TABLE "figcraft_private"."retired_online_codes" (
  "slot"          integer                  NOT NULL,
  "serial_number" bigint                   NOT NULL,
  "code_hash"     text                     NOT NULL,
  "store_started" timestamp with time zone NOT NULL DEFAULT pg_postmaster_start_time(),
  CONSTRAINT "retired_online_codes_code_hash_check" CHECK ((code_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "retired_online_codes_pkey" PRIMARY KEY (slot),
  CONSTRAINT "retired_online_codes_serial_number_key" UNIQUE (serial_number),
  CONSTRAINT "retired_online_codes_slot_check" CHECK (((slot >= 0) AND (slot <= 9999)))
);

ALTER TABLE "figcraft_private"."retired_online_codes"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION figcraft_private.retire_online_code()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
    next_serial bigint;
begin
    -- Serialise the append across files. Rolled-back grant changes consume no slots.
    perform pg_advisory_xact_lock(650130, 1);
    select coalesce(max(serial_number) + 1, 0) into next_serial from figcraft_private.retired_online_codes;
    insert into figcraft_private.retired_online_codes as ring(slot, serial_number, code_hash)
        values (next_serial % 10000, next_serial, old.code_hash)
        on conflict (slot) do update set serial_number = excluded.serial_number,
            code_hash = excluded.code_hash, store_started = excluded.store_started;
    return null;
end;
$function$;

CREATE INDEX retired_online_codes_lookup ON figcraft_private.retired_online_codes USING btree (code_hash, store_started);

CREATE TRIGGER retire_deleted_online_code
  AFTER DELETE ON public.online_file_links
  FOR EACH ROW
  WHEN ((old.code_hash IS NOT NULL))
  EXECUTE FUNCTION figcraft_private.retire_online_code();

CREATE TRIGGER retire_replaced_online_code
  AFTER UPDATE OF code_hash ON public.online_file_links
  FOR EACH ROW
  WHEN (((old.code_hash IS NOT NULL) AND (old.code_hash IS DISTINCT FROM new.code_hash)))
  EXECUTE FUNCTION figcraft_private.retire_online_code();

REVOKE ALL ON FUNCTION "figcraft_private"."retire_online_code"() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION "figcraft_private"."retire_online_code"() TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "figcraft_private"."retired_online_codes" TO "postgres";

REVOKE ALL ON figcraft_private.retired_online_codes FROM PUBLIC, anon, authenticated, service_role;
