SET local check_function_bodies = off;

ALTER TABLE "figcraft_private"."online_host_contact"
  DROP CONSTRAINT "online_host_contact_operator_contact_check";

ALTER TABLE "figcraft_private"."online_host_contact"
  DROP CONSTRAINT "online_host_contact_terms_url_check";

CREATE OR REPLACE FUNCTION figcraft_private.host_contact()
  RETURNS TABLE (
    operator_contact text,
    terms_url        text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    select btrim(coalesce(c.operator_contact,''),figcraft_private.host_whitespace()),
        btrim(coalesce(c.terms_url,''),figcraft_private.host_whitespace())
    from (values(true)) as defaults(singleton)
    left join figcraft_private.online_host_contact c using(singleton);
$function$;

CREATE OR REPLACE FUNCTION figcraft_private.host_whitespace()
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path TO ''
  AS $function$ select U&'\0009\000a\000b\000c\000d\0020\0085\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000'; $function$;

ALTER TABLE "figcraft_private"."online_host_contact"
  ADD CONSTRAINT "online_host_contact_operator_contact_check" CHECK (((char_length(operator_contact) <= 120) AND (operator_contact !~ U&'[\0001-\001f\007f-\009f]'::text)));

REVOKE ALL ON FUNCTION "figcraft_private"."host_whitespace"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "figcraft_private"."host_whitespace"() TO "postgres";

ALTER TABLE "figcraft_private"."online_host_contact"
  ADD CONSTRAINT "online_host_contact_terms_url_check"
    CHECK
    (((btrim(terms_url, figcraft_private.host_whitespace()) ~ '^(https?://|$)'::text) AND (octet_length(btrim(terms_url, figcraft_private.host_whitespace())) <= 500) AND
    (btrim(terms_url, figcraft_private.host_whitespace()) !~ (('['::text || figcraft_private.host_whitespace()) || ']'::text))));
