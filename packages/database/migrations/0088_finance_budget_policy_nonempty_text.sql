-- Correct empty-string admission without rewriting published migration 0087.
CREATE OR REPLACE FUNCTION public.finance_budget_policy_text(value jsonb, maximum integer, canonical boolean DEFAULT true) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE s text; units integer;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  s := value #>> '{}';
  IF s = '' THEN RETURN false; END IF;
  SELECT coalesce(sum(CASE WHEN ascii(c) > 65535 THEN 2 ELSE 1 END),0) INTO units FROM regexp_split_to_table(s,'') c;
  RETURN units BETWEEN 1 AND maximum AND (NOT canonical OR s = btrim(s,E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)));
END;
$$;
