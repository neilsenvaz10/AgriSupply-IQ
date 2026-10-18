-- Phase 2, Milestone 2.1 (part 2): physical-unit reference rows, derived unit-normalised views
-- and in-database documentation. Hand-written (drizzle-kit "custom" migration).
-- This migration inserts NO agricultural data: the only rows are physical constants.

-- Units and their documented conversions. Mass units convert through kg; count units never do.
INSERT INTO "measurement_units" ("code", "label", "dimension", "kg_per_unit") VALUES
	('kg', 'Kilogram', 'mass', 1),
	('quintal', 'Quintal (100 kg)', 'mass', 100),
	('tonne', 'Metric tonne (1000 kg)', 'mass', 1000),
	('bundle', 'Bundle (count, no mass conversion)', 'count', NULL),
	('nos', 'Pieces (count, no mass conversion)', 'count', NULL),
	('unit', 'Source-defined count unit (no mass conversion)', 'count', NULL);
--> statement-breakpoint

-- Conversion factors are reference data: the application role may read them but must never
-- change them (a changed kg_per_unit would silently rescale every derived price). The role name
-- is not hardcoded: every non-owner role that was granted write access by the default
-- privileges loses INSERT, UPDATE and DELETE on this one table.
DO $$
DECLARE
	grantee_oid oid;
BEGIN
	FOR grantee_oid IN
		SELECT DISTINCT a.grantee
		FROM pg_class c, LATERAL aclexplode(c.relacl) a
		WHERE c.oid = 'public.measurement_units'::regclass
			AND a.grantee <> c.relowner
			AND a.grantee <> 0
			AND a.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
	LOOP
		EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.measurement_units FROM %I', pg_get_userbyid(grantee_oid));
	END LOOP;
END
$$;
--> statement-breakpoint

-- Derived, never stored: prices per quintal and arrivals in tonnes, computed ONLY from mass
-- units via measurement_units.kg_per_unit. Count units yield NULL (no fabricated conversion).
-- Currency is passed through unchanged: nothing is converted between currencies.
-- security_invoker: the caller's own privileges apply to the underlying tables.
CREATE VIEW "mandi_observations_normalized" WITH (security_invoker = true) AS
SELECT
	o."id",
	o."market_id",
	o."commodity_id",
	o."variety_id",
	o."grade",
	o."observed_date",
	o."price_currency",
	CASE WHEN pu."dimension" = 'mass' THEN o."min_price" * 100 / pu."kg_per_unit" END AS "min_price_per_quintal",
	CASE WHEN pu."dimension" = 'mass' THEN o."max_price" * 100 / pu."kg_per_unit" END AS "max_price_per_quintal",
	CASE WHEN pu."dimension" = 'mass' THEN o."modal_price" * 100 / pu."kg_per_unit" END AS "modal_price_per_quintal",
	CASE WHEN au."dimension" = 'mass' THEN o."arrival_quantity" * au."kg_per_unit" / 1000 END AS "arrival_tonnes",
	o."quality_status"
FROM "mandi_observations" o
LEFT JOIN "measurement_units" pu ON pu."code" = o."price_unit"
LEFT JOIN "measurement_units" au ON au."code" = o."arrival_unit";
--> statement-breakpoint

CREATE VIEW "state_observations_normalized" WITH (security_invoker = true) AS
SELECT
	o."id",
	o."state_id",
	o."commodity_id",
	o."observed_date",
	o."price_currency",
	CASE WHEN pu."dimension" = 'mass' THEN o."min_price" * 100 / pu."kg_per_unit" END AS "min_price_per_quintal",
	CASE WHEN pu."dimension" = 'mass' THEN o."max_price" * 100 / pu."kg_per_unit" END AS "max_price_per_quintal",
	CASE WHEN pu."dimension" = 'mass' THEN o."modal_price" * 100 / pu."kg_per_unit" END AS "modal_price_per_quintal",
	CASE WHEN au."dimension" = 'mass' THEN o."arrival_quantity" * au."kg_per_unit" / 1000 END AS "arrival_tonnes",
	o."quality_status"
FROM "state_observations" o
LEFT JOIN "measurement_units" pu ON pu."code" = o."price_unit"
LEFT JOIN "measurement_units" au ON au."code" = o."arrival_unit";
--> statement-breakpoint

COMMENT ON TABLE "states" IS 'States and union territories. Empty after migration; populated from authoritative references.';
--> statement-breakpoint
COMMENT ON TABLE "districts" IS 'Districts; each belongs to exactly one state or union territory.';
--> statement-breakpoint
COMMENT ON TABLE "markets" IS 'Agricultural markets (mandis). District and coordinates optional. Identity = state + district + normalised name + disambiguator.';
--> statement-breakpoint
COMMENT ON TABLE "commodities" IS 'Commodities. No crop list is built in; rows come from reviewed alias resolution.';
--> statement-breakpoint
COMMENT ON TABLE "varieties" IS 'Varieties of one commodity. An unknown variety is NULL on the observation, never a row here.';
--> statement-breakpoint
COMMENT ON TABLE "mandi_observations" IS 'GRANULARITY: market x commodity x variety x grade x DAY. Prices and optional arrivals in source units.';
--> statement-breakpoint
COMMENT ON TABLE "state_observations" IS 'GRANULARITY: state x commodity x DAY. Has no market column: a state figure is never a mandi figure.';
--> statement-breakpoint
COMMENT ON TABLE "national_monthly_prices" IS 'GRANULARITY: India x commodity x MONTH. Monthly averages, not daily or mandi prices.';
--> statement-breakpoint
COMMENT ON TABLE "wpi_series" IS 'Wholesale Price Index series. An index is dimensionless: no currency or unit exists in the WPI tables.';
--> statement-breakpoint
COMMENT ON TABLE "wpi_observations" IS 'WPI index value for one series and one month. NOT a price.';
--> statement-breakpoint
COMMENT ON TABLE "observation_conflicts" IS 'Source records with the same natural key as an existing observation but different values. Never overwrites.';
--> statement-breakpoint
COMMENT ON TABLE "ingestion_rejections" IS 'Quarantine: records that could not be loaded, with original values preserved.';
--> statement-breakpoint
COMMENT ON TABLE "data_sources" IS 'Registry of observation providers. Stores no credentials.';
--> statement-breakpoint
COMMENT ON VIEW "mandi_observations_normalized" IS 'Derived prices per quintal and arrivals in tonnes (mass units only; count units give NULL). Not stored.';
--> statement-breakpoint
COMMENT ON VIEW "state_observations_normalized" IS 'Derived prices per quintal and arrivals in tonnes (mass units only; count units give NULL). Not stored.';
