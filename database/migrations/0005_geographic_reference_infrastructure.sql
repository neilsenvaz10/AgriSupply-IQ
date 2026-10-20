CREATE TABLE "admin_unit_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference_set_id" uuid NOT NULL,
	"unit_type" text NOT NULL,
	"lgd_code" integer NOT NULL,
	"history_seq" integer DEFAULT 1 NOT NULL,
	"is_latest_version" boolean NOT NULL,
	"version" integer,
	"minor_version" integer,
	"name_en" text NOT NULL,
	"name_local" text,
	"parent_lgd_code" integer,
	"state_kind" text,
	"census_2001_code" text,
	"census_2011_code" text,
	"status" text NOT NULL,
	"lgd_effective_date" date,
	"lgd_effective_is_baseline" boolean DEFAULT false NOT NULL,
	"legal_effective_date" date,
	"legal_effective_evidence" text,
	"valid_from_known" boolean DEFAULT false NOT NULL,
	"order_no" text,
	"order_date" date,
	"gazette_date" date,
	"government_order_ref" text,
	"source_url" text,
	"source_sha256" char(64),
	"retrieved_at" timestamp with time zone,
	"content_sha256" char(64) NOT NULL,
	"raw_record" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state_id" uuid,
	"district_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aun_unit_seq_uq" UNIQUE("reference_set_id","unit_type","lgd_code","history_seq"),
	CONSTRAINT "aun_type_ck" CHECK ("admin_unit_version"."unit_type" IN ('state', 'district')),
	CONSTRAINT "aun_status_ck" CHECK ("admin_unit_version"."status" IN ('active', 'inactive')),
	CONSTRAINT "aun_code_ck" CHECK ("admin_unit_version"."lgd_code" > 0 AND "admin_unit_version"."history_seq" >= 1),
	CONSTRAINT "aun_version_ck" CHECK (("admin_unit_version"."version" IS NULL OR "admin_unit_version"."version" >= 1) AND ("admin_unit_version"."minor_version" IS NULL OR "admin_unit_version"."minor_version" >= 0)),
	CONSTRAINT "aun_name_ck" CHECK (btrim("admin_unit_version"."name_en") <> ''),
	CONSTRAINT "aun_parent_ck" CHECK (("admin_unit_version"."unit_type" = 'district' AND "admin_unit_version"."parent_lgd_code" IS NOT NULL AND "admin_unit_version"."state_kind" IS NULL AND "admin_unit_version"."state_id" IS NULL)
        OR ("admin_unit_version"."unit_type" = 'state' AND "admin_unit_version"."parent_lgd_code" IS NULL AND "admin_unit_version"."district_id" IS NULL)),
	CONSTRAINT "aun_state_kind_ck" CHECK ("admin_unit_version"."state_kind" IS NULL OR "admin_unit_version"."state_kind" IN ('state', 'union_territory')),
	CONSTRAINT "aun_hash_ck" CHECK ("admin_unit_version"."content_sha256" ~ '^[0-9a-f]{64}$' AND ("admin_unit_version"."source_sha256" IS NULL OR "admin_unit_version"."source_sha256" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "aun_baseline_ck" CHECK (NOT "admin_unit_version"."lgd_effective_is_baseline" OR "admin_unit_version"."lgd_effective_date" = DATE '2005-01-01'),
	CONSTRAINT "aun_legal_evidence_ck" CHECK ("admin_unit_version"."legal_effective_date" IS NULL OR ("admin_unit_version"."legal_effective_evidence" IS NOT NULL AND btrim("admin_unit_version"."legal_effective_evidence") <> '')),
	CONSTRAINT "aun_legal_not_baseline_ck" CHECK (NOT ("admin_unit_version"."lgd_effective_is_baseline" AND "admin_unit_version"."legal_effective_date" IS NOT NULL AND "admin_unit_version"."legal_effective_date" = "admin_unit_version"."lgd_effective_date")),
	CONSTRAINT "aun_valid_from_ck" CHECK (NOT "admin_unit_version"."valid_from_known" OR ("admin_unit_version"."lgd_effective_date" IS NOT NULL AND NOT "admin_unit_version"."lgd_effective_is_baseline")),
	CONSTRAINT "aun_order_ck" CHECK ("admin_unit_version"."order_no" IS NULL OR btrim("admin_unit_version"."order_no") <> '')
);
--> statement-breakpoint
CREATE TABLE "geo_reference_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"authority" text NOT NULL,
	"source_url" text NOT NULL,
	"access_method" text NOT NULL,
	"original_filename" text,
	"format" text,
	"file_sha256" char(64) NOT NULL,
	"fingerprint_kind" text DEFAULT 'file' NOT NULL,
	"size_bytes" bigint,
	"record_count" integer,
	"retrieved_at" timestamp with time zone NOT NULL,
	"as_of_date" date,
	"publication_date" date,
	"publication_note" text,
	"licence_note" text,
	"terms_note" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grs_code_uq" UNIQUE("code"),
	CONSTRAINT "grs_sha256_uq" UNIQUE("file_sha256"),
	CONSTRAINT "grs_code_ck" CHECK ("geo_reference_set"."code" ~ '^[a-z0-9][a-z0-9._-]*$'),
	CONSTRAINT "grs_sha256_ck" CHECK ("geo_reference_set"."file_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "grs_kind_ck" CHECK ("geo_reference_set"."kind" IN ('lgd_snapshot', 'lgd_modifications', 'gazette_extract', 'registry_listing', 'other')),
	CONSTRAINT "grs_access_ck" CHECK ("geo_reference_set"."access_method" IN ('public_page', 'manual_download', 'api', 'other')),
	CONSTRAINT "grs_fingerprint_ck" CHECK ("geo_reference_set"."fingerprint_kind" IN ('file', 'manifest')),
	CONSTRAINT "grs_text_ck" CHECK (btrim("geo_reference_set"."authority") <> '' AND btrim("geo_reference_set"."source_url") <> ''),
	CONSTRAINT "grs_size_ck" CHECK (("geo_reference_set"."size_bytes" IS NULL OR "geo_reference_set"."size_bytes" >= 0) AND ("geo_reference_set"."record_count" IS NULL OR "geo_reference_set"."record_count" >= 0))
);
--> statement-breakpoint
ALTER TABLE "admin_unit_version" ADD CONSTRAINT "aun_reference_set_fk" FOREIGN KEY ("reference_set_id") REFERENCES "public"."geo_reference_set"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_unit_version" ADD CONSTRAINT "aun_state_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_unit_version" ADD CONSTRAINT "aun_district_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aun_latest_uq" ON "admin_unit_version" USING btree ("reference_set_id","unit_type","lgd_code") WHERE "admin_unit_version"."is_latest_version";--> statement-breakpoint
CREATE INDEX "aun_code_idx" ON "admin_unit_version" USING btree ("unit_type","lgd_code");--> statement-breakpoint
CREATE INDEX "aun_parent_idx" ON "admin_unit_version" USING btree ("parent_lgd_code");--> statement-breakpoint
CREATE INDEX "aun_state_idx" ON "admin_unit_version" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "aun_district_idx" ON "admin_unit_version" USING btree ("district_id");--> statement-breakpoint
CREATE INDEX "grs_kind_retrieved_idx" ON "geo_reference_set" USING btree ("kind","retrieved_at");

--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- Milestone 2.4, Stage 3a, part 1: append-only history, a derived "current unit" view and least
-- privilege. Hand-written; the table DDL above is generated from src/schema/geography.js.
--
-- No data is inserted. No existing table, row, role or privilege of an existing table is changed.
-- No role is named: every non-owner grantee is found in the catalogue (the pattern of 0004).
-- ---------------------------------------------------------------------------------------------

-- Append-only guard shared by every history table of Milestone 2.4 (this migration and 0006).
-- It refuses UPDATE, DELETE and TRUNCATE for everybody, owner included, short of dropping the trigger
-- (which needs DDL rights that only the schema owner holds and which is itself auditable).
CREATE FUNCTION public.append_only_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
	RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = '55000';
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.append_only_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER grs_append_only BEFORE UPDATE OR DELETE ON public.geo_reference_set
	FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();
--> statement-breakpoint
CREATE TRIGGER grs_no_truncate BEFORE TRUNCATE ON public.geo_reference_set
	FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_guard();
--> statement-breakpoint
CREATE TRIGGER aun_append_only BEFORE UPDATE OR DELETE ON public.admin_unit_version
	FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();
--> statement-breakpoint
CREATE TRIGGER aun_no_truncate BEFORE TRUNCATE ON public.admin_unit_version
	FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_guard();
--> statement-breakpoint
-- The newest version of every official unit: for each (type, LGD code) the latest-version row of the most
-- recently retrieved reference set that lists it. A convenience for readers; it decides nothing.
CREATE VIEW public.admin_unit_current WITH (security_invoker = true) AS
	SELECT DISTINCT ON (v.unit_type, v.lgd_code) v.*
	FROM public.admin_unit_version v
	JOIN public.geo_reference_set s ON s.id = v.reference_set_id
	WHERE v.is_latest_version
	ORDER BY v.unit_type, v.lgd_code, s.retrieved_at DESC, s.id;
--> statement-breakpoint
COMMENT ON TABLE public.geo_reference_set IS 'Acquired official reference (file or manifest) with SHA-256 fingerprint, source URL and terms. Append-only.';
--> statement-breakpoint
COMMENT ON TABLE public.admin_unit_version IS 'Versions of official administrative units (LGD) as listed in one reference set. Append-only. lgd_effective_date is what LGD shows; the 2005 baseline is flagged and is never a legal date.';
--> statement-breakpoint
-- Least privilege. The Phase 1 default privileges give the application role full DML on every new
-- table, and a later grant for the ingestion role can add INSERT. Reference data is read by everyone and
-- written only by the loader: so every non-owner grantee loses write rights here, and the loader role's
-- INSERT is granted deliberately by its own grant script, never by this migration.
DO $$
DECLARE
	rel text;
	grantee_oid oid;
BEGIN
	FOREACH rel IN ARRAY ARRAY['geo_reference_set', 'admin_unit_version', 'admin_unit_current']
	LOOP
		FOR grantee_oid IN
			SELECT DISTINCT a.grantee
			FROM pg_class c, LATERAL aclexplode(c.relacl) a
			WHERE c.oid = to_regclass('public.' || rel)
				AND a.grantee <> c.relowner
				AND a.grantee <> 0
				AND a.privilege_type <> 'SELECT'
		LOOP
			EXECUTE format(
				CASE WHEN (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.' || rel)) = 'v'
					THEN 'REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM %I'
					ELSE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM %I' END,
				rel, pg_get_userbyid(grantee_oid));
		END LOOP;
	END LOOP;
END
$$;
