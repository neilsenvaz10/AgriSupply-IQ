CREATE TABLE "source_assumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"assumption_code" text NOT NULL,
	"statement" text NOT NULL,
	"evidence_reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_assumptions_code_uq" UNIQUE("source_id","assumption_code"),
	CONSTRAINT "source_assumptions_code_ck" CHECK ("source_assumptions"."assumption_code" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "source_assumptions_text_ck" CHECK (btrim("source_assumptions"."statement") <> '' AND btrim("source_assumptions"."evidence_reference") <> '')
);
--> statement-breakpoint
ALTER TABLE "commodities" ADD COLUMN "provenance_run_id" uuid;--> statement-breakpoint
ALTER TABLE "districts" ADD COLUMN "provenance_run_id" uuid;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "resumed_from_run_id" uuid;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "last_committed_row" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mandi_observations" ADD COLUMN "unit_basis" text DEFAULT 'source_stated' NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "provenance_run_id" uuid;--> statement-breakpoint
ALTER TABLE "national_monthly_prices" ADD COLUMN "unit_basis" text DEFAULT 'source_stated' NOT NULL;--> statement-breakpoint
ALTER TABLE "state_observations" ADD COLUMN "unit_basis" text DEFAULT 'source_stated' NOT NULL;--> statement-breakpoint
ALTER TABLE "states" ADD COLUMN "provenance_run_id" uuid;--> statement-breakpoint
ALTER TABLE "varieties" ADD COLUMN "provenance_run_id" uuid;--> statement-breakpoint
ALTER TABLE "source_assumptions" ADD CONSTRAINT "source_assumptions_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commodities" ADD CONSTRAINT "commodities_provenance_run_id_ingestion_runs_id_fk" FOREIGN KEY ("provenance_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_provenance_run_id_ingestion_runs_id_fk" FOREIGN KEY ("provenance_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_resumed_fk" FOREIGN KEY ("resumed_from_run_id","source_id") REFERENCES "public"."ingestion_runs"("id","source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_provenance_run_id_ingestion_runs_id_fk" FOREIGN KEY ("provenance_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "states" ADD CONSTRAINT "states_provenance_run_id_ingestion_runs_id_fk" FOREIGN KEY ("provenance_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "varieties" ADD CONSTRAINT "varieties_provenance_run_id_ingestion_runs_id_fk" FOREIGN KEY ("provenance_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_checkpoint_ck" CHECK ("ingestion_runs"."last_committed_row" >= 0);--> statement-breakpoint
ALTER TABLE "mandi_observations" ADD CONSTRAINT "mandi_obs_unit_basis_ck" CHECK ("mandi_observations"."unit_basis" IN ('source_stated', 'assumed_from_documentation'));--> statement-breakpoint
ALTER TABLE "mandi_observations" ADD CONSTRAINT "mandi_obs_unit_label_ck" CHECK (num_nonnulls("mandi_observations"."min_price", "mandi_observations"."max_price", "mandi_observations"."modal_price") = 0
      OR ("mandi_observations"."unit_basis" = 'source_stated' AND "mandi_observations"."source_price_unit_label" IS NOT NULL)
      OR ("mandi_observations"."unit_basis" = 'assumed_from_documentation' AND "mandi_observations"."source_price_unit_label" IS NULL));--> statement-breakpoint
ALTER TABLE "national_monthly_prices" ADD CONSTRAINT "national_price_unit_basis_ck" CHECK ("national_monthly_prices"."unit_basis" IN ('source_stated', 'assumed_from_documentation'));--> statement-breakpoint
ALTER TABLE "national_monthly_prices" ADD CONSTRAINT "national_price_unit_label_ck" CHECK (num_nonnulls("national_monthly_prices"."avg_min_price", "national_monthly_prices"."avg_max_price", "national_monthly_prices"."avg_modal_price") = 0
      OR ("national_monthly_prices"."unit_basis" = 'source_stated' AND "national_monthly_prices"."source_price_unit_label" IS NOT NULL)
      OR ("national_monthly_prices"."unit_basis" = 'assumed_from_documentation' AND "national_monthly_prices"."source_price_unit_label" IS NULL));--> statement-breakpoint
ALTER TABLE "state_observations" ADD CONSTRAINT "state_obs_unit_basis_ck" CHECK ("state_observations"."unit_basis" IN ('source_stated', 'assumed_from_documentation'));--> statement-breakpoint
ALTER TABLE "state_observations" ADD CONSTRAINT "state_obs_unit_label_ck" CHECK (num_nonnulls("state_observations"."min_price", "state_observations"."max_price", "state_observations"."modal_price") = 0
      OR ("state_observations"."unit_basis" = 'source_stated' AND "state_observations"."source_price_unit_label" IS NOT NULL)
      OR ("state_observations"."unit_basis" = 'assumed_from_documentation' AND "state_observations"."source_price_unit_label" IS NULL));