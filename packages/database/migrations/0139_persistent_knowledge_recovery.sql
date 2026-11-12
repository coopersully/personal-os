-- Reapply the published guarded recovery after the current main migration watermark.
-- Forward recovery for the published Knowledge migration skipped by a later cursor.
-- Never rewrite either published 0130, lower receipts, or existing personal data.
-- Drizzle runs this single guarded statement and its new receipt in one transaction.
DO $knowledge_recovery$
DECLARE
  previous_search_path text := pg_catalog.current_setting('search_path');
  expected jsonb := $catalog${"knowledge_records":{"columns":[{"name":"id","type":"uuid","notNull":true,"default":"gen_random_uuid()"},{"name":"user_id","type":"uuid","notNull":true,"default":null},{"name":"revision","type":"integer","notNull":true,"default":"1"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"default":"now()"}],"constraints":[{"kind":"p","columns":["id"]},{"kind":"u","columns":["user_id","id"]},{"kind":"f","columns":["user_id"],"target":"public.users","targetColumns":["id"],"onDelete":"c","onUpdate":"a","match":"s"}]},"knowledge_revisions":{"columns":[{"name":"id","type":"uuid","notNull":true,"default":"gen_random_uuid()"},{"name":"user_id","type":"uuid","notNull":true,"default":null},{"name":"record_id","type":"uuid","notNull":true,"default":null},{"name":"revision","type":"integer","notNull":true,"default":null},{"name":"snapshot","type":"jsonb","notNull":true,"default":null}],"constraints":[{"kind":"p","columns":["id"]},{"kind":"u","columns":["user_id","record_id","revision"]},{"kind":"f","columns":["user_id","record_id"],"target":"public.knowledge_records","targetColumns":["user_id","id"],"onDelete":"c","onUpdate":"a","match":"s"}]},"knowledge_sources":{"columns":[{"name":"id","type":"uuid","notNull":true,"default":null},{"name":"user_id","type":"uuid","notNull":true,"default":null},{"name":"record_id","type":"uuid","notNull":true,"default":null},{"name":"source","type":"jsonb","notNull":true,"default":null}],"constraints":[{"kind":"p","columns":["id"]},{"kind":"f","columns":["user_id","record_id"],"target":"public.knowledge_records","targetColumns":["user_id","id"],"onDelete":"c","onUpdate":"a","match":"s"}]},"knowledge_relationships":{"columns":[{"name":"user_id","type":"uuid","notNull":true,"default":null},{"name":"record_id","type":"uuid","notNull":true,"default":null},{"name":"related_record_id","type":"uuid","notNull":true,"default":null}],"constraints":[{"kind":"u","columns":["user_id","record_id","related_record_id"]},{"kind":"f","columns":["user_id","record_id"],"target":"public.knowledge_records","targetColumns":["user_id","id"],"onDelete":"c","onUpdate":"a","match":"s"},{"kind":"f","columns":["user_id","related_record_id"],"target":"public.knowledge_records","targetColumns":["user_id","id"],"onDelete":"c","onUpdate":"a","match":"s"}]},"knowledge_receipts":{"columns":[{"name":"id","type":"uuid","notNull":true,"default":"gen_random_uuid()"},{"name":"user_id","type":"uuid","notNull":true,"default":null},{"name":"record_id","type":"uuid","notNull":true,"default":null},{"name":"mutation_key","type":"uuid","notNull":true,"default":null},{"name":"request_hash","type":"text","notNull":true,"default":null}],"constraints":[{"kind":"p","columns":["id"]},{"kind":"u","columns":["user_id","mutation_key"]},{"kind":"f","columns":["user_id","record_id"],"target":"public.knowledge_records","targetColumns":["user_id","id"],"onDelete":"c","onUpdate":"a","match":"s"}]}}$catalog$::jsonb;
  relation_name text;
  relation_oid oid;
  present_count integer;
  actual_columns jsonb;
  actual_constraints jsonb;
  expected_constraints jsonb;
BEGIN
  PERFORM pg_catalog.set_config('search_path', 'pg_catalog', true);
  -- A higher timestamp alone is not evidence of the required lower transition.
  IF (SELECT count(*) FROM drizzle.__drizzle_migrations
      WHERE created_at = 1793289422144 AND hash = '1ab5ba167cd90f122a2ee84fe661e2e8f43b00f9cc7fe8eaaf8de0b0680618f4') <> 1
     OR (SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793289422144) <> 1
     OR (SELECT count(*) FROM drizzle.__drizzle_migrations
      WHERE created_at = 1793300055681 AND hash = '75a95d9e842bf745aed2f757aeaeb63d18945ba7e80d66f4bc647fdd11ffb505') <> 1
     OR (SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793300055681) <> 1 THEN
    RAISE EXCEPTION 'Knowledge recovery requires exact published Finance and Accounts receipts';
  END IF;
  IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = 1792812516993
      AND hash <> '96670a55cb61549da09cd95900abd25a7b47b79e41e1f5514292bff81ecba94f')
     OR (SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1792812516993) > 1 THEN
    RAISE EXCEPTION 'Knowledge recovery found conflicting original history';
  END IF;
  SELECT count(*) INTO present_count FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND expected ? c.relname;
  IF present_count <> 0 AND present_count <> 5 THEN
    RAISE EXCEPTION 'Knowledge recovery refuses partial catalog';
  END IF;
  IF present_count = 0 THEN
    CREATE TABLE public.knowledge_records (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
     revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT knowledge_records_owner_id_idx UNIQUE(user_id,id)
    );
    CREATE TABLE public.knowledge_revisions (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, record_id uuid NOT NULL, revision integer NOT NULL,
     snapshot jsonb NOT NULL,
     CONSTRAINT knowledge_revisions_owner_record_revision_idx UNIQUE(user_id,record_id,revision),
     FOREIGN KEY(user_id,record_id) REFERENCES public.knowledge_records(user_id,id) ON DELETE CASCADE
    );
    CREATE TABLE public.knowledge_sources (
     id uuid PRIMARY KEY, user_id uuid NOT NULL, record_id uuid NOT NULL, source jsonb NOT NULL,
     FOREIGN KEY(user_id,record_id) REFERENCES public.knowledge_records(user_id,id) ON DELETE CASCADE
    );
    CREATE TABLE public.knowledge_relationships (
     user_id uuid NOT NULL, record_id uuid NOT NULL, related_record_id uuid NOT NULL,
     CONSTRAINT knowledge_relationships_pair_idx UNIQUE(user_id,record_id,related_record_id),
     FOREIGN KEY(user_id,record_id) REFERENCES public.knowledge_records(user_id,id) ON DELETE CASCADE,
     FOREIGN KEY(user_id,related_record_id) REFERENCES public.knowledge_records(user_id,id) ON DELETE CASCADE
    );
    CREATE TABLE public.knowledge_receipts (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, record_id uuid NOT NULL,
     mutation_key uuid NOT NULL, request_hash text NOT NULL,
     CONSTRAINT knowledge_receipts_owner_key_idx UNIQUE(user_id,mutation_key),
     FOREIGN KEY(user_id,record_id) REFERENCES public.knowledge_records(user_id,id) ON DELETE CASCADE
    );
  END IF;

  -- Validate the same bounded catalog after creation and on compatible existing installs.
  FOR relation_name IN SELECT jsonb_object_keys(expected) LOOP
    SELECT c.oid INTO relation_oid FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = relation_name
        AND c.relkind = 'r' AND c.relpersistence = 'p' AND NOT c.relispartition
        AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relhasrules;
    IF relation_oid IS NULL
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=relation_oid OR inhparent=relation_oid)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid=relation_oid AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'Knowledge recovery refuses incompatible relation: %', relation_name;
    END IF;
    SELECT jsonb_agg(jsonb_build_object(
        'name', a.attname, 'type', pg_catalog.format_type(a.atttypid,a.atttypmod),
        'notNull', a.attnotnull,
        -- With search_path fixed to pg_catalog, builtins deparse unqualified;
        -- public.now()/public.gen_random_uuid() retain their distinct identities.
        'default', pg_catalog.pg_get_expr(d.adbin,d.adrelid))
        ORDER BY a.attnum)
      INTO actual_columns FROM pg_catalog.pg_attribute a
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=relation_oid AND a.attnum>0 AND NOT a.attisdropped
        AND a.attidentity='' AND a.attgenerated='';
    IF actual_columns IS DISTINCT FROM expected->relation_name->'columns'
       OR (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid=relation_oid AND attnum>0 AND NOT attisdropped)
          <> jsonb_array_length(expected->relation_name->'columns') THEN
      RAISE EXCEPTION 'Knowledge recovery refuses incompatible columns: %', relation_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=relation_oid
        AND (contype NOT IN ('p','u','f') OR NOT convalidated OR condeferrable OR condeferred))
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_constraint fk
         WHERE fk.conrelid=relation_oid AND fk.contype='f' AND (
           (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgconstraint=fk.oid) <> 4
           OR EXISTS (
             -- Verify both referencing checks and referenced actions, including users.
             SELECT 1 FROM (VALUES
               (fk.conrelid, 5, 'pg_catalog."RI_FKey_check_ins"()'::regprocedure::oid),
               (fk.conrelid, 17, 'pg_catalog."RI_FKey_check_upd"()'::regprocedure::oid),
               (fk.confrelid, 9, 'pg_catalog."RI_FKey_cascade_del"()'::regprocedure::oid),
               (fk.confrelid, 17, 'pg_catalog."RI_FKey_noaction_upd"()'::regprocedure::oid)
             ) required_trigger(target_relation, trigger_type, function_oid)
             LEFT JOIN pg_catalog.pg_trigger t ON t.tgconstraint=fk.oid
               AND t.tgrelid=required_trigger.target_relation
               AND t.tgtype=required_trigger.trigger_type AND t.tgfoid=required_trigger.function_oid
             WHERE t.oid IS NULL OR NOT t.tgisinternal OR t.tgenabled <> 'O'
               OR t.tgdeferrable OR t.tginitdeferred
           )
         )
       )
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indrelid=relation_oid
        AND (NOT i.indisvalid OR NOT i.indisready OR i.indexprs IS NOT NULL OR i.indpred IS NOT NULL
          OR (i.indisunique AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
              WHERE c.conindid=i.indexrelid AND c.conrelid=relation_oid)))) THEN
      RAISE EXCEPTION 'Knowledge recovery refuses incompatible constraints: %', relation_name;
    END IF;
    SELECT jsonb_agg(signature ORDER BY signature::text) INTO actual_constraints FROM (
      SELECT jsonb_build_object('kind',c.contype::text,'columns',
          (SELECT jsonb_agg(a.attname ORDER BY k.ordinality)
           FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
           JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum))
        || CASE WHEN c.contype='f' THEN jsonb_build_object(
          'target',(SELECT n.nspname||'.'||r.relname FROM pg_catalog.pg_class r
            JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace WHERE r.oid=c.confrelid),
          'targetColumns',(SELECT jsonb_agg(a.attname ORDER BY k.ordinality)
            FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ordinality)
            JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum),
          'onDelete',c.confdeltype::text,'onUpdate',c.confupdtype::text,'match',c.confmatchtype::text)
          ELSE '{}'::jsonb END AS signature
      FROM pg_catalog.pg_constraint c WHERE c.conrelid=relation_oid
    ) signatures;
    SELECT jsonb_agg(value ORDER BY value::text) INTO expected_constraints
      FROM jsonb_array_elements(expected->relation_name->'constraints');
    IF actual_constraints IS DISTINCT FROM expected_constraints THEN
      RAISE EXCEPTION 'Knowledge recovery refuses incompatible keys: %', relation_name;
    END IF;
  END LOOP;
  -- Later append migrations in this same Drizzle transaction retain their normal namespace.
  PERFORM pg_catalog.set_config('search_path', previous_search_path, true);
END;
$knowledge_recovery$;
