CREATE TABLE "commodities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text GENERATED ALWAYS AS (lower(btrim(regexp_replace("name", '\s+', ' ', 'g')))) STORED NOT NULL,
	"commodity_group" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commodities_normalized_name_uq" UNIQUE("normalized_name"),
	CONSTRAINT "commodities_name_ck" CHECK (btrim("commodities"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "commodity_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"source_label" text NOT NULL,
	"source_context" text,
	"source_code" text,
	"normalized_label" text GENERATED ALWAYS AS (lower(btrim(regexp_replace("source_label", '\s+', ' ', 'g')))) STORED NOT NULL,
	"commodity_id" uuid,
	"resolution_status" text DEFAULT 'unresolved' NOT NULL,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commodity_alias_source_key_uq" UNIQUE("source_id","source_key"),
	CONSTRAINT "commodity_alias_source_code_uq" UNIQUE("source_id","source_code"),
	CONSTRAINT "commodity_alias_key_ck" CHECK (btrim("commodity_aliases"."source_key") <> '' AND btrim("commodity_aliases"."source_label") <> ''),
	CONSTRAINT "commodity_alias_status_ck" CHECK ("commodity_aliases"."resolution_status" IN ('resolved', 'ambiguous', 'unresolved', 'rejected')),
	CONSTRAINT "commodity_alias_resolved_ck" CHECK (("commodity_aliases"."resolution_status" = 'resolved') = ("commodity_aliases"."commodity_id" IS NOT NULL AND "commodity_aliases"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"source_type" text NOT NULL,
	"publisher" text,
	"description" text,
	"endpoint_reference" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_sources_code_uq" UNIQUE("code"),
	CONSTRAINT "data_sources_code_ck" CHECK ("data_sources"."code" ~ '^[a-z0-9][a-z0-9_.-]*$'),
	CONSTRAINT "data_sources_name_ck" CHECK (btrim("data_sources"."name") <> ''),
	CONSTRAINT "data_sources_type_ck" CHECK ("data_sources"."source_type" IN ('historical_file', 'government_api', 'commercial_api', 'manual_entry', 'other')),
	CONSTRAINT "data_sources_no_credentials_ck" CHECK ("data_sources"."endpoint_reference" IS NULL OR (
        "data_sources"."endpoint_reference" !~* '(api[_-]?key|apikey|token|secret|password|passwd|auth)=' AND
        "data_sources"."endpoint_reference" !~ '://[^/@]*:[^/@]*@'
      ))
);
--> statement-breakpoint
CREATE TABLE "district_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"source_label" text NOT NULL,
	"source_context" text,
	"source_code" text,
	"normalized_label" text GENERATED ALWAYS AS (lower(btrim(regexp_replace("source_label", '\s+', ' ', 'g')))) STORED NOT NULL,
	"district_id" uuid,
	"resolution_status" text DEFAULT 'unresolved' NOT NULL,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "district_alias_source_key_uq" UNIQUE("source_id","source_key"),
	CONSTRAINT "district_alias_source_code_uq" UNIQUE("source_id","source_code"),
	CONSTRAINT "district_alias_key_ck" CHECK (btrim("district_aliases"."source_key") <> '' AND btrim("district_aliases"."source_label") <> ''),
	CONSTRAINT "district_alias_status_ck" CHECK ("district_aliases"."resolution_status" IN ('resolved', 'ambiguous', 'unresolved', 'rejected')),
	CONSTRAINT "district_alias_resolved_ck" CHECK (("district_aliases"."resolution_status" = 'resolved') = ("district_aliases"."district_id" IS NOT NULL AND "district_aliases"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text GENERATED ALWAYS AS (lower(btrim(regexp_replace("name", '\s+', ' ', 'g')))) STORED NOT NULL,
	"lgd_code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "districts_state_name_uq" UNIQUE("state_id","normalized_name"),
	CONSTRAINT "districts_id_state_uq" UNIQUE("id","state_id"),
	CONSTRAINT "districts_lgd_code_uq" UNIQUE("lgd_code"),
	CONSTRAINT "districts_name_ck" CHECK (btrim("districts"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "ingestion_rejections" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingestion_rejections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ingestion_run_id" uuid NOT NULL,
	"source_row_number" bigint,
	"reason_code" text NOT NULL,
	"reason_detail" text,
	"raw_record" jsonb NOT NULL,
	"raw_record_sha256" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_rejections_run_row_uq" UNIQUE("ingestion_run_id","source_row_number"),
	CONSTRAINT "ingestion_rejections_reason_ck" CHECK ("ingestion_rejections"."reason_code" IN ('structural_error', 'missing_required_value', 'invalid_value', 'invalid_date', 'negative_value', 'price_ordering_violation', 'unmapped_entity', 'ambiguous_entity', 'unsupported_unit', 'other')),
	CONSTRAINT "ingestion_rejections_sha_ck" CHECK ("ingestion_rejections"."raw_record_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ingestion_rejections_raw_ck" CHECK (jsonb_typeof("ingestion_rejections"."raw_record") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"source_file_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"importer_name" text NOT NULL,
	"importer_version" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"rows_read" bigint DEFAULT 0 NOT NULL,
	"rows_loaded" bigint DEFAULT 0 NOT NULL,
	"rows_exact_duplicate" bigint DEFAULT 0 NOT NULL,
	"rows_conflicting" bigint DEFAULT 0 NOT NULL,
	"rows_rejected" bigint DEFAULT 0 NOT NULL,
	"error_summary" text,
	CONSTRAINT "ingestion_runs_id_source_uq" UNIQUE("id","source_id"),
	CONSTRAINT "ingestion_runs_status_ck" CHECK ("ingestion_runs"."status" IN ('running', 'succeeded', 'succeeded_with_rejections', 'failed', 'cancelled')),
	CONSTRAINT "ingestion_runs_finished_ck" CHECK (("ingestion_runs"."status" = 'running') = ("ingestion_runs"."finished_at" IS NULL)),
	CONSTRAINT "ingestion_runs_time_ck" CHECK ("ingestion_runs"."finished_at" IS NULL OR "ingestion_runs"."finished_at" >= "ingestion_runs"."started_at"),
	CONSTRAINT "ingestion_runs_counts_ck" CHECK ("ingestion_runs"."rows_read" >= 0 AND "ingestion_runs"."rows_loaded" >= 0 AND "ingestion_runs"."rows_exact_duplicate" >= 0
        AND "ingestion_runs"."rows_conflicting" >= 0 AND "ingestion_runs"."rows_rejected" >= 0
        AND "ingestion_runs"."rows_loaded" + "ingestion_runs"."rows_exact_duplicate" + "ingestion_runs"."rows_conflicting" + "ingestion_runs"."rows_rejected" <= "ingestion_runs"."rows_read"),
	CONSTRAINT "ingestion_runs_error_ck" CHECK ("ingestion_runs"."error_summary" IS NULL OR (length("ingestion_runs"."error_summary") <= 2000 AND "ingestion_runs"."error_summary" !~ '://[^/@\s]*:[^/@\s]*@'))
);
--> statement-breakpoint
CREATE TABLE "mandi_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"commodity_id" uuid NOT NULL,
	"variety_id" uuid,
	"variety_label" text,
	"grade" text,
	"observed_date" date NOT NULL,
	"min_price" numeric(16, 4),
	"max_price" numeric(16, 4),
	"modal_price" numeric(16, 4),
	"price_currency" char(3),
	"price_unit" text,
	"source_price_unit_label" text,
	"arrival_quantity" numeric(18, 3),
	"arrival_unit" text,
	"source_arrival_unit_label" text,
	"source_state_label" text,
	"source_district_label" text,
	"source_market_label" text,
	"source_commodity_label" text,
	"source_id" uuid NOT NULL,
	"source_file_id" uuid,
	"ingestion_run_id" uuid NOT NULL,
	"source_record_key" text NOT NULL,
	"source_row_number" bigint,
	"record_fingerprint" char(64) NOT NULL,
	"source_published_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_historical_snapshot" boolean DEFAULT false NOT NULL,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"quality_status" text DEFAULT 'accepted' NOT NULL,
	"quality_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "mandi_obs_record_key_uq" UNIQUE("source_id","source_record_key"),
	CONSTRAINT "mandi_obs_natural_uq" UNIQUE NULLS NOT DISTINCT("source_id","market_id","commodity_id","variety_id","grade","observed_date"),
	CONSTRAINT "mandi_obs_quality_status_ck" CHECK ("mandi_observations"."quality_status" IN ('accepted', 'flagged')),
	CONSTRAINT "mandi_obs_quality_flags_ck" CHECK (("mandi_observations"."quality_status" = 'flagged') = (cardinality("mandi_observations"."quality_flags") > 0)),
	CONSTRAINT "mandi_obs_fingerprint_ck" CHECK ("mandi_observations"."record_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mandi_obs_record_key_ck" CHECK (btrim("mandi_observations"."source_record_key") <> ''),
	CONSTRAINT "mandi_obs_nonneg_ck" CHECK (("mandi_observations"."min_price" IS NULL OR "mandi_observations"."min_price" >= 0) AND ("mandi_observations"."max_price" IS NULL OR "mandi_observations"."max_price" >= 0) AND ("mandi_observations"."modal_price" IS NULL OR "mandi_observations"."modal_price" >= 0)),
	CONSTRAINT "mandi_obs_order_ck" CHECK (("mandi_observations"."min_price" IS NULL OR "mandi_observations"."modal_price" IS NULL OR "mandi_observations"."min_price" <= "mandi_observations"."modal_price")
      AND ("mandi_observations"."modal_price" IS NULL OR "mandi_observations"."max_price" IS NULL OR "mandi_observations"."modal_price" <= "mandi_observations"."max_price")
      AND ("mandi_observations"."min_price" IS NULL OR "mandi_observations"."max_price" IS NULL OR "mandi_observations"."min_price" <= "mandi_observations"."max_price")),
	CONSTRAINT "mandi_obs_zero_flag_ck" CHECK ((coalesce("mandi_observations"."min_price", 1) > 0 AND coalesce("mandi_observations"."max_price", 1) > 0 AND coalesce("mandi_observations"."modal_price", 1) > 0) OR "mandi_observations"."quality_status" = 'flagged'),
	CONSTRAINT "mandi_obs_price_unit_ck" CHECK (num_nonnulls("mandi_observations"."min_price", "mandi_observations"."max_price", "mandi_observations"."modal_price") = 0
      OR ("mandi_observations"."price_currency" IS NOT NULL AND "mandi_observations"."price_unit" IS NOT NULL)),
	CONSTRAINT "mandi_obs_currency_ck" CHECK ("mandi_observations"."price_currency" IS NULL OR "mandi_observations"."price_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "mandi_obs_arrival_ck" CHECK (("mandi_observations"."arrival_quantity" IS NULL) = ("mandi_observations"."arrival_unit" IS NULL) AND ("mandi_observations"."arrival_quantity" IS NULL OR "mandi_observations"."arrival_quantity" >= 0)),
	CONSTRAINT "mandi_obs_measure_ck" CHECK (num_nonnulls("mandi_observations"."min_price", "mandi_observations"."max_price", "mandi_observations"."modal_price", "mandi_observations"."arrival_quantity") >= 1),
	CONSTRAINT "mandi_obs_date_ck" CHECK ("mandi_observations"."observed_date" BETWEEN DATE '1990-01-01' AND DATE '2100-12-31')
);
--> statement-breakpoint
CREATE TABLE "market_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"source_label" text NOT NULL,
	"source_context" text,
	"source_code" text,
	"normalized_label" text GENERATED ALWAYS AS (lower(btrim(regexp_replace("source_label", '\s+', ' ', 'g')))) STORED NOT NULL,
	"market_id" uuid,
	"resolution_status" text DEFAULT 'unresolved' NOT NULL,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_alias_source_key_uq" UNIQUE("source_id","source_key"),
	CONSTRAINT "market_alias_source_code_uq" UNIQUE("source_id","source_code"),
	CONSTRAINT "market_alias_key_ck" CHECK (btrim("market_aliases"."source_key") <> '' AND btrim("market_aliases"."source_label") <> ''),
	CONSTRAINT "market_alias_status_ck" CHECK ("market_aliases"."resolution_status" IN ('resolved', 'ambiguous', 'unresolved', 'rejected')),
	CONSTRAINT "market_alias_resolved_ck" CHECK (("market_aliases"."resolution_status" = 'resolved') = ("market_aliases"."market_id" IS NOT NULL AND "market_aliases"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" uuid NOT NULL,
	"district_id" uuid,
	"name" text NOT NULL,
	"normalized_name" text GENERATED ALWAYS AS (lower(btrim(regexp_replace("name", '\s+', ' ', 'g')))) STORED NOT NULL,
	"disambiguator" text DEFAULT '' NOT NULL,
	"government_market_code" text,
	"classification" text,
	"status" text DEFAULT 'active' NOT NULL,
	"merged_into_market_id" uuid,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_identity_uq" UNIQUE NULLS NOT DISTINCT("state_id","district_id","normalized_name","disambiguator"),
	CONSTRAINT "markets_government_code_uq" UNIQUE("government_market_code"),
	CONSTRAINT "markets_name_ck" CHECK (btrim("markets"."name") <> ''),
	CONSTRAINT "markets_status_ck" CHECK ("markets"."status" IN ('active', 'inactive', 'unverified', 'merged')),
	CONSTRAINT "markets_merge_ck" CHECK (("markets"."status" = 'merged') = ("markets"."merged_into_market_id" IS NOT NULL) AND "markets"."merged_into_market_id" IS DISTINCT FROM "markets"."id"),
	CONSTRAINT "markets_coordinates_ck" CHECK (("markets"."latitude" IS NULL) = ("markets"."longitude" IS NULL)
        AND ("markets"."latitude" IS NULL OR ("markets"."latitude" BETWEEN -90 AND 90 AND "markets"."longitude" BETWEEN -180 AND 180)))
);
--> statement-breakpoint
CREATE TABLE "measurement_units" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"dimension" text NOT NULL,
	"kg_per_unit" numeric(14, 6),
	CONSTRAINT "measurement_units_code_ck" CHECK ("measurement_units"."code" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "measurement_units_dimension_ck" CHECK ("measurement_units"."dimension" IN ('mass', 'count')),
	CONSTRAINT "measurement_units_conversion_ck" CHECK (("measurement_units"."dimension" = 'mass' AND "measurement_units"."kg_per_unit" > 0) OR ("measurement_units"."dimension" = 'count' AND "measurement_units"."kg_per_unit" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "national_monthly_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" char(2) DEFAULT 'IN' NOT NULL,
	"commodity_id" uuid NOT NULL,
	"period_month" date NOT NULL,
	"avg_min_price" numeric(16, 4),
	"avg_max_price" numeric(16, 4),
	"avg_modal_price" numeric(16, 4),
	"price_currency" char(3),
	"price_unit" text,
	"source_price_unit_label" text,
	"source_reported_change" numeric(16, 4),
	"source_calculation_type" text,
	"source_commodity_label" text,
	"source_id" uuid NOT NULL,
	"source_file_id" uuid,
	"ingestion_run_id" uuid NOT NULL,
	"source_record_key" text NOT NULL,
	"source_row_number" bigint,
	"record_fingerprint" char(64) NOT NULL,
	"source_published_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_historical_snapshot" boolean DEFAULT false NOT NULL,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"quality_status" text DEFAULT 'accepted' NOT NULL,
	"quality_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "national_price_record_key_uq" UNIQUE("source_id","source_record_key"),
	CONSTRAINT "national_price_natural_uq" UNIQUE("source_id","commodity_id","period_month"),
	CONSTRAINT "national_price_quality_status_ck" CHECK ("national_monthly_prices"."quality_status" IN ('accepted', 'flagged')),
	CONSTRAINT "national_price_quality_flags_ck" CHECK (("national_monthly_prices"."quality_status" = 'flagged') = (cardinality("national_monthly_prices"."quality_flags") > 0)),
	CONSTRAINT "national_price_fingerprint_ck" CHECK ("national_monthly_prices"."record_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "national_price_record_key_ck" CHECK (btrim("national_monthly_prices"."source_record_key") <> ''),
	CONSTRAINT "national_price_nonneg_ck" CHECK (("national_monthly_prices"."avg_min_price" IS NULL OR "national_monthly_prices"."avg_min_price" >= 0) AND ("national_monthly_prices"."avg_max_price" IS NULL OR "national_monthly_prices"."avg_max_price" >= 0) AND ("national_monthly_prices"."avg_modal_price" IS NULL OR "national_monthly_prices"."avg_modal_price" >= 0)),
	CONSTRAINT "national_price_order_ck" CHECK (("national_monthly_prices"."avg_min_price" IS NULL OR "national_monthly_prices"."avg_modal_price" IS NULL OR "national_monthly_prices"."avg_min_price" <= "national_monthly_prices"."avg_modal_price")
      AND ("national_monthly_prices"."avg_modal_price" IS NULL OR "national_monthly_prices"."avg_max_price" IS NULL OR "national_monthly_prices"."avg_modal_price" <= "national_monthly_prices"."avg_max_price")
      AND ("national_monthly_prices"."avg_min_price" IS NULL OR "national_monthly_prices"."avg_max_price" IS NULL OR "national_monthly_prices"."avg_min_price" <= "national_monthly_prices"."avg_max_price")),
	CONSTRAINT "national_price_zero_flag_ck" CHECK ((coalesce("national_monthly_prices"."avg_min_price", 1) > 0 AND coalesce("national_monthly_prices"."avg_max_price", 1) > 0 AND coalesce("national_monthly_prices"."avg_modal_price", 1) > 0) OR "national_monthly_prices"."quality_status" = 'flagged'),
	CONSTRAINT "national_price_price_unit_ck" CHECK (num_nonnulls("national_monthly_prices"."avg_min_price", "national_monthly_prices"."avg_max_price", "national_monthly_prices"."avg_modal_price") = 0
      OR ("national_monthly_prices"."price_currency" IS NOT NULL AND "national_monthly_prices"."price_unit" IS NOT NULL)),
	CONSTRAINT "national_price_currency_ck" CHECK ("national_monthly_prices"."price_currency" IS NULL OR "national_monthly_prices"."price_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "national_price_country_ck" CHECK ("national_monthly_prices"."country_code" = 'IN'),
	CONSTRAINT "national_price_measure_ck" CHECK (num_nonnulls("national_monthly_prices"."avg_min_price", "national_monthly_prices"."avg_max_price", "national_monthly_prices"."avg_modal_price") >= 1),
	CONSTRAINT "national_price_month_ck" CHECK ("national_monthly_prices"."period_month" BETWEEN DATE '1990-01-01' AND DATE '2100-12-31' AND extract(day FROM "national_monthly_prices"."period_month") = 1)
);
--> statement-breakpoint
CREATE TABLE "observation_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingestion_run_id" uuid NOT NULL,
	"fact_type" text NOT NULL,
	"mandi_observation_id" uuid,
	"state_observation_id" uuid,
	"national_price_observation_id" uuid,
	"wpi_observation_id" uuid,
	"incoming_record" jsonb NOT NULL,
	"incoming_fingerprint" char(64) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "obs_conflicts_candidate_uq" UNIQUE NULLS NOT DISTINCT("fact_type","mandi_observation_id","state_observation_id","national_price_observation_id","wpi_observation_id","incoming_fingerprint"),
	CONSTRAINT "obs_conflicts_type_ck" CHECK ("observation_conflicts"."fact_type" IN ('mandi_price', 'state_observation', 'national_commodity_price', 'wpi_index')),
	CONSTRAINT "obs_conflicts_ref_ck" CHECK (num_nonnulls("observation_conflicts"."mandi_observation_id", "observation_conflicts"."state_observation_id", "observation_conflicts"."national_price_observation_id", "observation_conflicts"."wpi_observation_id") = 1
        AND (CASE "observation_conflicts"."fact_type"
          WHEN 'mandi_price' THEN "observation_conflicts"."mandi_observation_id" IS NOT NULL
          WHEN 'state_observation' THEN "observation_conflicts"."state_observation_id" IS NOT NULL
          WHEN 'national_commodity_price' THEN "observation_conflicts"."national_price_observation_id" IS NOT NULL
          WHEN 'wpi_index' THEN "observation_conflicts"."wpi_observation_id" IS NOT NULL
          ELSE false END)),
	CONSTRAINT "obs_conflicts_fingerprint_ck" CHECK ("observation_conflicts"."incoming_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "obs_conflicts_status_ck" CHECK ("observation_conflicts"."status" IN ('open', 'kept_existing', 'replaced_existing', 'dismissed')),
	CONSTRAINT "obs_conflicts_resolved_ck" CHECK (("observation_conflicts"."status" = 'open') = ("observation_conflicts"."resolved_at" IS NULL)),
	CONSTRAINT "obs_conflicts_record_ck" CHECK (jsonb_typeof("observation_conflicts"."incoming_record") = 'object')
);
--> statement-breakpoint
CREATE TABLE "source_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" char(64) NOT NULL,
	"size_bytes" bigint,
	"dataset_version" text,
	"reported_period_start" date,
	"reported_period_end" date,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_files_source_sha_uq" UNIQUE("source_id","file_sha256"),
	CONSTRAINT "source_files_id_source_uq" UNIQUE("id","source_id"),
	CONSTRAINT "source_files_sha_ck" CHECK ("source_files"."file_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "source_files_name_ck" CHECK (btrim("source_files"."file_name") <> '' AND "source_files"."file_name" !~ '[\\/]'),
	CONSTRAINT "source_files_size_ck" CHECK ("source_files"."size_bytes" IS NULL OR "source_files"."size_bytes" >= 0),
	CONSTRAINT "source_files_period_ck" CHECK ("source_files"."reported_period_start" IS NULL OR "source_files"."reported_period_end" IS NULL OR "source_files"."reported_period_end" >= "source_files"."reported_period_start")
);
--> statement-breakpoint
CREATE TABLE "state_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"source_label" text NOT NULL,
	"source_context" text,
	"source_code" text,
	"normalized_label" text GENERATED ALWAYS AS (lower(btrim(regexp_replace("source_label", '\s+', ' ', 'g')))) STORED NOT NULL,
	"state_id" uuid,
	"resolution_status" text DEFAULT 'unresolved' NOT NULL,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "state_alias_source_key_uq" UNIQUE("source_id","source_key"),
	CONSTRAINT "state_alias_source_code_uq" UNIQUE("source_id","source_code"),
	CONSTRAINT "state_alias_key_ck" CHECK (btrim("state_aliases"."source_key") <> '' AND btrim("state_aliases"."source_label") <> ''),
	CONSTRAINT "state_alias_status_ck" CHECK ("state_aliases"."resolution_status" IN ('resolved', 'ambiguous', 'unresolved', 'rejected')),
	CONSTRAINT "state_alias_resolved_ck" CHECK (("state_aliases"."resolution_status" = 'resolved') = ("state_aliases"."state_id" IS NOT NULL AND "state_aliases"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "state_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" uuid NOT NULL,
	"commodity_id" uuid NOT NULL,
	"observed_date" date NOT NULL,
	"min_price" numeric(16, 4),
	"max_price" numeric(16, 4),
	"modal_price" numeric(16, 4),
	"price_currency" char(3),
	"price_unit" text,
	"source_price_unit_label" text,
	"arrival_quantity" numeric(18, 3),
	"arrival_unit" text,
	"source_arrival_unit_label" text,
	"source_state_label" text,
	"source_commodity_label" text,
	"source_commodity_group_label" text,
	"source_report_label" text,
	"source_id" uuid NOT NULL,
	"source_file_id" uuid,
	"ingestion_run_id" uuid NOT NULL,
	"source_record_key" text NOT NULL,
	"source_row_number" bigint,
	"record_fingerprint" char(64) NOT NULL,
	"source_published_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_historical_snapshot" boolean DEFAULT false NOT NULL,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"quality_status" text DEFAULT 'accepted' NOT NULL,
	"quality_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "state_obs_record_key_uq" UNIQUE("source_id","source_record_key"),
	CONSTRAINT "state_obs_natural_uq" UNIQUE("source_id","state_id","commodity_id","observed_date"),
	CONSTRAINT "state_obs_quality_status_ck" CHECK ("state_observations"."quality_status" IN ('accepted', 'flagged')),
	CONSTRAINT "state_obs_quality_flags_ck" CHECK (("state_observations"."quality_status" = 'flagged') = (cardinality("state_observations"."quality_flags") > 0)),
	CONSTRAINT "state_obs_fingerprint_ck" CHECK ("state_observations"."record_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "state_obs_record_key_ck" CHECK (btrim("state_observations"."source_record_key") <> ''),
	CONSTRAINT "state_obs_nonneg_ck" CHECK (("state_observations"."min_price" IS NULL OR "state_observations"."min_price" >= 0) AND ("state_observations"."max_price" IS NULL OR "state_observations"."max_price" >= 0) AND ("state_observations"."modal_price" IS NULL OR "state_observations"."modal_price" >= 0)),
	CONSTRAINT "state_obs_order_ck" CHECK (("state_observations"."min_price" IS NULL OR "state_observations"."modal_price" IS NULL OR "state_observations"."min_price" <= "state_observations"."modal_price")
      AND ("state_observations"."modal_price" IS NULL OR "state_observations"."max_price" IS NULL OR "state_observations"."modal_price" <= "state_observations"."max_price")
      AND ("state_observations"."min_price" IS NULL OR "state_observations"."max_price" IS NULL OR "state_observations"."min_price" <= "state_observations"."max_price")),
	CONSTRAINT "state_obs_zero_flag_ck" CHECK ((coalesce("state_observations"."min_price", 1) > 0 AND coalesce("state_observations"."max_price", 1) > 0 AND coalesce("state_observations"."modal_price", 1) > 0) OR "state_observations"."quality_status" = 'flagged'),
	CONSTRAINT "state_obs_price_unit_ck" CHECK (num_nonnulls("state_observations"."min_price", "state_observations"."max_price", "state_observations"."modal_price") = 0
      OR ("state_observations"."price_currency" IS NOT NULL AND "state_observations"."price_unit" IS NOT NULL)),
	CONSTRAINT "state_obs_currency_ck" CHECK ("state_observations"."price_currency" IS NULL OR "state_observations"."price_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "state_obs_arrival_ck" CHECK (("state_observations"."arrival_quantity" IS NULL) = ("state_observations"."arrival_unit" IS NULL) AND ("state_observations"."arrival_quantity" IS NULL OR "state_observations"."arrival_quantity" >= 0)),
	CONSTRAINT "state_obs_measure_ck" CHECK (num_nonnulls("state_observations"."min_price", "state_observations"."max_price", "state_observations"."modal_price", "state_observations"."arrival_quantity") >= 1),
	CONSTRAINT "state_obs_date_ck" CHECK ("state_observations"."observed_date" BETWEEN DATE '1990-01-01' AND DATE '2100-12-31')
);
--> statement-breakpoint
CREATE TABLE "states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text GENERATED ALWAYS AS (lower(btrim(regexp_replace("name", '\s+', ' ', 'g')))) STORED NOT NULL,
	"kind" text NOT NULL,
	"lgd_code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "states_normalized_name_uq" UNIQUE("normalized_name"),
	CONSTRAINT "states_lgd_code_uq" UNIQUE("lgd_code"),
	CONSTRAINT "states_name_ck" CHECK (btrim("states"."name") <> ''),
	CONSTRAINT "states_kind_ck" CHECK ("states"."kind" IN ('state', 'union_territory'))
);
--> statement-breakpoint
CREATE TABLE "varieties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commodity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text GENERATED ALWAYS AS (lower(btrim(regexp_replace("name", '\s+', ' ', 'g')))) STORED NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "varieties_commodity_name_uq" UNIQUE("commodity_id","normalized_name"),
	CONSTRAINT "varieties_id_commodity_uq" UNIQUE("id","commodity_id"),
	CONSTRAINT "varieties_name_ck" CHECK (btrim("varieties"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "variety_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"source_label" text NOT NULL,
	"source_context" text,
	"source_code" text,
	"normalized_label" text GENERATED ALWAYS AS (lower(btrim(regexp_replace("source_label", '\s+', ' ', 'g')))) STORED NOT NULL,
	"variety_id" uuid,
	"resolution_status" text DEFAULT 'unresolved' NOT NULL,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variety_alias_source_key_uq" UNIQUE("source_id","source_key"),
	CONSTRAINT "variety_alias_source_code_uq" UNIQUE("source_id","source_code"),
	CONSTRAINT "variety_alias_key_ck" CHECK (btrim("variety_aliases"."source_key") <> '' AND btrim("variety_aliases"."source_label") <> ''),
	CONSTRAINT "variety_alias_status_ck" CHECK ("variety_aliases"."resolution_status" IN ('resolved', 'ambiguous', 'unresolved', 'rejected')),
	CONSTRAINT "variety_alias_resolved_ck" CHECK (("variety_aliases"."resolution_status" = 'resolved') = ("variety_aliases"."variety_id" IS NOT NULL AND "variety_aliases"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "wpi_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"period_month" date NOT NULL,
	"index_value" numeric(12, 4) NOT NULL,
	"source_id" uuid NOT NULL,
	"source_file_id" uuid,
	"ingestion_run_id" uuid NOT NULL,
	"source_record_key" text NOT NULL,
	"source_row_number" bigint,
	"record_fingerprint" char(64) NOT NULL,
	"source_published_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_historical_snapshot" boolean DEFAULT false NOT NULL,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"quality_status" text DEFAULT 'accepted' NOT NULL,
	"quality_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "wpi_obs_record_key_uq" UNIQUE("source_id","source_record_key"),
	CONSTRAINT "wpi_obs_natural_uq" UNIQUE("series_id","period_month"),
	CONSTRAINT "wpi_obs_quality_status_ck" CHECK ("wpi_observations"."quality_status" IN ('accepted', 'flagged')),
	CONSTRAINT "wpi_obs_quality_flags_ck" CHECK (("wpi_observations"."quality_status" = 'flagged') = (cardinality("wpi_observations"."quality_flags") > 0)),
	CONSTRAINT "wpi_obs_fingerprint_ck" CHECK ("wpi_observations"."record_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "wpi_obs_record_key_ck" CHECK (btrim("wpi_observations"."source_record_key") <> ''),
	CONSTRAINT "wpi_obs_value_ck" CHECK ("wpi_observations"."index_value" > 0),
	CONSTRAINT "wpi_obs_month_ck" CHECK ("wpi_observations"."period_month" BETWEEN DATE '1990-01-01' AND DATE '2100-12-31' AND extract(day FROM "wpi_observations"."period_month") = 1)
);
--> statement-breakpoint
CREATE TABLE "wpi_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"item_label" text NOT NULL,
	"normalized_label" text GENERATED ALWAYS AS (lower(btrim(regexp_replace("item_label", '\s+', ' ', 'g')))) STORED NOT NULL,
	"commodity_id" uuid,
	"base_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wpi_series_source_label_uq" UNIQUE("source_id","normalized_label"),
	CONSTRAINT "wpi_series_id_source_uq" UNIQUE("id","source_id"),
	CONSTRAINT "wpi_series_label_ck" CHECK (btrim("wpi_series"."item_label") <> '')
);
--> statement-breakpoint
ALTER TABLE "commodity_aliases" ADD CONSTRAINT "commodity_aliases_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commodity_aliases" ADD CONSTRAINT "commodity_aliases_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "district_aliases" ADD CONSTRAINT "district_aliases_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "district_aliases" ADD CONSTRAINT "district_aliases_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_rejections" ADD CONSTRAINT "ingestion_rejections_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_file_source_fk" FOREIGN KEY ("source_file_id","source_id") REFERENCES "public"."source_files"("id","source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandi_observations" ADD CONSTRAINT "mandi_observations_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandi_observations" ADD CONSTRAINT "mandi_observations_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandi_observations" ADD CONSTRAINT "mandi_observations_price_unit_measurement_units_code_fk" FOREIGN KEY ("price_unit") REFERENCES "public"."measurement_units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandi_observations" ADD CONSTRAINT "mandi_observations_arrival_unit_measurement_units_code_fk" FOREIGN KEY ("arrival_unit") REFERENCES "public"."measurement_units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandi_observations" ADD CONSTRAINT "mandi_observations_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandi_observations" ADD CONSTRAINT "mandi_obs_run_fk" FOREIGN KEY ("ingestion_run_id","source_id") REFERENCES "public"."ingestion_runs"("id","source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandi_observations" ADD CONSTRAINT "mandi_obs_file_fk" FOREIGN KEY ("source_file_id","source_id") REFERENCES "public"."source_files"("id","source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandi_observations" ADD CONSTRAINT "mandi_obs_variety_fk" FOREIGN KEY ("variety_id","commodity_id") REFERENCES "public"."varieties"("id","commodity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_aliases" ADD CONSTRAINT "market_aliases_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_aliases" ADD CONSTRAINT "market_aliases_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_district_state_fk" FOREIGN KEY ("district_id","state_id") REFERENCES "public"."districts"("id","state_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_merged_into_fk" FOREIGN KEY ("merged_into_market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "national_monthly_prices" ADD CONSTRAINT "national_monthly_prices_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "national_monthly_prices" ADD CONSTRAINT "national_monthly_prices_price_unit_measurement_units_code_fk" FOREIGN KEY ("price_unit") REFERENCES "public"."measurement_units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "national_monthly_prices" ADD CONSTRAINT "national_monthly_prices_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "national_monthly_prices" ADD CONSTRAINT "national_price_run_fk" FOREIGN KEY ("ingestion_run_id","source_id") REFERENCES "public"."ingestion_runs"("id","source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "national_monthly_prices" ADD CONSTRAINT "national_price_file_fk" FOREIGN KEY ("source_file_id","source_id") REFERENCES "public"."source_files"("id","source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_conflicts" ADD CONSTRAINT "observation_conflicts_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_conflicts" ADD CONSTRAINT "obs_conflicts_mandi_fk" FOREIGN KEY ("mandi_observation_id") REFERENCES "public"."mandi_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_conflicts" ADD CONSTRAINT "obs_conflicts_state_fk" FOREIGN KEY ("state_observation_id") REFERENCES "public"."state_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_conflicts" ADD CONSTRAINT "obs_conflicts_national_fk" FOREIGN KEY ("national_price_observation_id") REFERENCES "public"."national_monthly_prices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_conflicts" ADD CONSTRAINT "obs_conflicts_wpi_fk" FOREIGN KEY ("wpi_observation_id") REFERENCES "public"."wpi_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_aliases" ADD CONSTRAINT "state_aliases_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_aliases" ADD CONSTRAINT "state_aliases_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_observations" ADD CONSTRAINT "state_observations_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_observations" ADD CONSTRAINT "state_observations_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_observations" ADD CONSTRAINT "state_observations_price_unit_measurement_units_code_fk" FOREIGN KEY ("price_unit") REFERENCES "public"."measurement_units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_observations" ADD CONSTRAINT "state_observations_arrival_unit_measurement_units_code_fk" FOREIGN KEY ("arrival_unit") REFERENCES "public"."measurement_units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_observations" ADD CONSTRAINT "state_observations_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_observations" ADD CONSTRAINT "state_obs_run_fk" FOREIGN KEY ("ingestion_run_id","source_id") REFERENCES "public"."ingestion_runs"("id","source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_observations" ADD CONSTRAINT "state_obs_file_fk" FOREIGN KEY ("source_file_id","source_id") REFERENCES "public"."source_files"("id","source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "varieties" ADD CONSTRAINT "varieties_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variety_aliases" ADD CONSTRAINT "variety_aliases_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variety_aliases" ADD CONSTRAINT "variety_aliases_variety_id_varieties_id_fk" FOREIGN KEY ("variety_id") REFERENCES "public"."varieties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wpi_observations" ADD CONSTRAINT "wpi_observations_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wpi_observations" ADD CONSTRAINT "wpi_obs_run_fk" FOREIGN KEY ("ingestion_run_id","source_id") REFERENCES "public"."ingestion_runs"("id","source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wpi_observations" ADD CONSTRAINT "wpi_obs_file_fk" FOREIGN KEY ("source_file_id","source_id") REFERENCES "public"."source_files"("id","source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wpi_observations" ADD CONSTRAINT "wpi_obs_series_fk" FOREIGN KEY ("series_id","source_id") REFERENCES "public"."wpi_series"("id","source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wpi_series" ADD CONSTRAINT "wpi_series_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wpi_series" ADD CONSTRAINT "wpi_series_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commodity_alias_entity_idx" ON "commodity_aliases" USING btree ("commodity_id");--> statement-breakpoint
CREATE INDEX "commodity_alias_label_idx" ON "commodity_aliases" USING btree ("normalized_label");--> statement-breakpoint
CREATE INDEX "district_alias_entity_idx" ON "district_aliases" USING btree ("district_id");--> statement-breakpoint
CREATE INDEX "district_alias_label_idx" ON "district_aliases" USING btree ("normalized_label");--> statement-breakpoint
CREATE INDEX "ingestion_rejections_run_reason_idx" ON "ingestion_rejections" USING btree ("ingestion_run_id","reason_code");--> statement-breakpoint
CREATE INDEX "ingestion_runs_source_started_idx" ON "ingestion_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX "ingestion_runs_file_idx" ON "ingestion_runs" USING btree ("source_file_id");--> statement-breakpoint
CREATE INDEX "mandi_obs_run_idx" ON "mandi_observations" USING btree ("ingestion_run_id");--> statement-breakpoint
CREATE INDEX "mandi_obs_file_idx" ON "mandi_observations" USING btree ("source_file_id");--> statement-breakpoint
CREATE INDEX "mandi_obs_history_idx" ON "mandi_observations" USING btree ("market_id","commodity_id","observed_date");--> statement-breakpoint
CREATE INDEX "mandi_obs_commodity_day_idx" ON "mandi_observations" USING btree ("commodity_id","observed_date","market_id");--> statement-breakpoint
CREATE INDEX "market_alias_entity_idx" ON "market_aliases" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "market_alias_label_idx" ON "market_aliases" USING btree ("normalized_label");--> statement-breakpoint
CREATE INDEX "markets_state_district_idx" ON "markets" USING btree ("state_id","district_id");--> statement-breakpoint
CREATE INDEX "markets_normalized_name_idx" ON "markets" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "national_price_run_idx" ON "national_monthly_prices" USING btree ("ingestion_run_id");--> statement-breakpoint
CREATE INDEX "national_price_file_idx" ON "national_monthly_prices" USING btree ("source_file_id");--> statement-breakpoint
CREATE INDEX "national_price_series_idx" ON "national_monthly_prices" USING btree ("commodity_id","period_month");--> statement-breakpoint
CREATE INDEX "obs_conflicts_run_idx" ON "observation_conflicts" USING btree ("ingestion_run_id");--> statement-breakpoint
CREATE INDEX "obs_conflicts_open_idx" ON "observation_conflicts" USING btree ("status") WHERE "observation_conflicts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "state_alias_entity_idx" ON "state_aliases" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "state_alias_label_idx" ON "state_aliases" USING btree ("normalized_label");--> statement-breakpoint
CREATE INDEX "state_obs_run_idx" ON "state_observations" USING btree ("ingestion_run_id");--> statement-breakpoint
CREATE INDEX "state_obs_file_idx" ON "state_observations" USING btree ("source_file_id");--> statement-breakpoint
CREATE INDEX "state_obs_history_idx" ON "state_observations" USING btree ("state_id","commodity_id","observed_date");--> statement-breakpoint
CREATE INDEX "state_obs_commodity_day_idx" ON "state_observations" USING btree ("commodity_id","observed_date");--> statement-breakpoint
CREATE INDEX "variety_alias_entity_idx" ON "variety_aliases" USING btree ("variety_id");--> statement-breakpoint
CREATE INDEX "variety_alias_label_idx" ON "variety_aliases" USING btree ("normalized_label");--> statement-breakpoint
CREATE INDEX "wpi_obs_run_idx" ON "wpi_observations" USING btree ("ingestion_run_id");--> statement-breakpoint
CREATE INDEX "wpi_obs_file_idx" ON "wpi_observations" USING btree ("source_file_id");--> statement-breakpoint
CREATE INDEX "wpi_obs_month_idx" ON "wpi_observations" USING btree ("period_month");--> statement-breakpoint
CREATE INDEX "wpi_series_commodity_idx" ON "wpi_series" USING btree ("commodity_id");