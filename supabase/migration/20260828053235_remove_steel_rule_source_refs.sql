DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'steel'
      AND table_name = 'rules'
      AND column_name = 'source_refs'
  ) THEN
    EXECUTE $migration$
      UPDATE steel.rules
      SET created_by = 'sync-steel-rules'
      WHERE created_by IS NULL
        AND jsonb_typeof(source_refs) = 'array'
        AND jsonb_array_length(source_refs) = 1
        AND source_refs->0->>'channel' = 'repo_docs'
        AND source_refs->0->>'sourceFile' LIKE 'docs/rules/%.txt'
        AND NULLIF(BTRIM(source_refs->0->>'canonicalKey'), '') IS NOT NULL
        AND source_refs->0->>'sha256' ~ '^[0-9a-f]{64}$'
    $migration$;
    ALTER TABLE steel.rules DROP CONSTRAINT IF EXISTS rules_source_refs_check;
    ALTER TABLE steel.rules DROP COLUMN IF EXISTS source_refs;
  END IF;
END
$$;
