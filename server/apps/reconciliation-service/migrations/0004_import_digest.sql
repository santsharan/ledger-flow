-- Re-importing the same statement must not open a second set of cases.

ALTER TABLE statement_imports ADD COLUMN file_digest text;

UPDATE statement_imports SET file_digest = id::text WHERE file_digest IS NULL;

ALTER TABLE statement_imports ALTER COLUMN file_digest SET NOT NULL;

CREATE UNIQUE INDEX statement_imports_provider_digest_unique
  ON statement_imports (provider, file_digest);
