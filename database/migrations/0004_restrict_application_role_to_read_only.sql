-- Phase 2, Milestone 2.2: least privilege for agricultural data.
--
-- The default privileges set up in Phase 1 give the application role SELECT/INSERT/UPDATE/DELETE
-- on every table the migrator creates. The API only READS agricultural data; ingestion is done by
-- a separate, narrower ingestion role (see database/docs/INGESTION.md). So the application role
-- loses INSERT, UPDATE and DELETE on every canonical table and view and keeps SELECT.
-- `system_metadata` (the Phase 1 key/value table) is left untouched.
--
-- The role is not named here: every non-owner role that holds DELETE on a relation (the pattern
-- the default privileges produce) loses its write privileges. The ingestion role never receives
-- DELETE, so it is unaffected even if it was created earlier.
DO $$
DECLARE
	rel record;
	grantee_oid oid;
BEGIN
	FOR rel IN
		SELECT c.oid, c.relname, c.relowner
		FROM pg_class c
		WHERE c.relnamespace = 'public'::regnamespace
			AND c.relkind IN ('r', 'v')
			AND c.relname <> 'system_metadata'
	LOOP
		FOR grantee_oid IN
			SELECT DISTINCT a.grantee
			FROM pg_class c, LATERAL aclexplode(c.relacl) a
			WHERE c.oid = rel.oid
				AND a.grantee <> rel.relowner
				AND a.grantee <> 0
				AND a.privilege_type = 'DELETE'
		LOOP
			EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM %I', rel.relname, pg_get_userbyid(grantee_oid));
		END LOOP;
	END LOOP;
END
$$;
