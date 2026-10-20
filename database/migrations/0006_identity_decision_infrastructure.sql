CREATE TABLE "identity_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mapping_set_id" uuid,
	"decision_kind" text NOT NULL,
	"entity_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"source_label" text NOT NULL,
	"source_context" text,
	"subject_market_id" uuid,
	"target_state_id" uuid,
	"target_district_id" uuid,
	"target_market_id" uuid,
	"target_admin_unit_version_id" uuid,
	"decision_class" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"requires_two_reviewers" boolean GENERATED ALWAYS AS ((decision_kind IN ('correct_state', 'merge_markets') OR decision_class = 'A' OR entity_kind = 'state')) STORED,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence_refs" text[] DEFAULT '{}'::text[] NOT NULL,
	"rationale" text NOT NULL,
	"ruleset_version" text NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"supersedes_id" uuid,
	"proposed_by" text NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_by" text,
	"accepted_at" timestamp with time zone,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	CONSTRAINT "idec_kind_ck" CHECK ("identity_decision"."decision_kind" IN ('map_label', 'correct_state', 'merge_markets', 'mark_ambiguous', 'mark_unresolved')),
	CONSTRAINT "idec_entity_ck" CHECK ("identity_decision"."entity_kind" IN ('state', 'district', 'market')),
	CONSTRAINT "idec_class_ck" CHECK ("identity_decision"."decision_class" IN ('V', 'S', 'A', 'U', 'H')),
	CONSTRAINT "idec_status_ck" CHECK ("identity_decision"."status" IN ('proposed', 'accepted', 'rejected', 'superseded', 'withdrawn')),
	CONSTRAINT "idec_text_ck" CHECK (btrim("identity_decision"."source_key") <> '' AND btrim("identity_decision"."source_label") <> '' AND btrim("identity_decision"."rationale") <> '' AND btrim("identity_decision"."ruleset_version") <> ''),
	CONSTRAINT "idec_evidence_ck" CHECK (jsonb_typeof("identity_decision"."evidence") = 'object'),
	CONSTRAINT "idec_valid_ck" CHECK ("identity_decision"."valid_to" IS NULL OR "identity_decision"."valid_from" IS NULL OR "identity_decision"."valid_to" >= "identity_decision"."valid_from"),
	CONSTRAINT "idec_supersedes_ck" CHECK ("identity_decision"."supersedes_id" IS NULL OR "identity_decision"."supersedes_id" <> "identity_decision"."id"),
	CONSTRAINT "idec_one_target_ck" CHECK (num_nonnulls("identity_decision"."target_state_id", "identity_decision"."target_district_id", "identity_decision"."target_market_id") <= 1),
	CONSTRAINT "idec_target_ck" CHECK (CASE "identity_decision"."decision_kind"
        WHEN 'map_label' THEN
          ("identity_decision"."entity_kind" = 'state' AND "identity_decision"."subject_market_id" IS NULL AND num_nonnulls("identity_decision"."target_state_id", "identity_decision"."target_admin_unit_version_id") >= 1 AND "identity_decision"."target_district_id" IS NULL AND "identity_decision"."target_market_id" IS NULL)
          OR ("identity_decision"."entity_kind" = 'district' AND "identity_decision"."subject_market_id" IS NULL AND num_nonnulls("identity_decision"."target_district_id", "identity_decision"."target_admin_unit_version_id") >= 1 AND "identity_decision"."target_state_id" IS NULL AND "identity_decision"."target_market_id" IS NULL)
          OR ("identity_decision"."entity_kind" = 'market' AND "identity_decision"."subject_market_id" IS NULL AND "identity_decision"."target_market_id" IS NOT NULL AND "identity_decision"."target_state_id" IS NULL AND "identity_decision"."target_district_id" IS NULL AND "identity_decision"."target_admin_unit_version_id" IS NULL)
        WHEN 'correct_state' THEN
          "identity_decision"."entity_kind" = 'market' AND "identity_decision"."subject_market_id" IS NOT NULL AND num_nonnulls("identity_decision"."target_state_id", "identity_decision"."target_admin_unit_version_id") >= 1 AND "identity_decision"."target_district_id" IS NULL AND "identity_decision"."target_market_id" IS NULL
        WHEN 'merge_markets' THEN
          "identity_decision"."entity_kind" = 'market' AND "identity_decision"."subject_market_id" IS NOT NULL AND "identity_decision"."target_market_id" IS NOT NULL AND "identity_decision"."subject_market_id" <> "identity_decision"."target_market_id" AND "identity_decision"."target_state_id" IS NULL AND "identity_decision"."target_district_id" IS NULL AND "identity_decision"."target_admin_unit_version_id" IS NULL
        ELSE num_nonnulls("identity_decision"."target_state_id", "identity_decision"."target_district_id", "identity_decision"."target_market_id", "identity_decision"."target_admin_unit_version_id") = 0
      END),
	CONSTRAINT "idec_lifecycle_ck" CHECK (CASE "identity_decision"."status"
        WHEN 'proposed' THEN "identity_decision"."mapping_set_id" IS NULL AND "identity_decision"."accepted_by" IS NULL AND "identity_decision"."accepted_at" IS NULL AND "identity_decision"."closed_by" IS NULL AND "identity_decision"."closed_at" IS NULL
        WHEN 'accepted' THEN "identity_decision"."mapping_set_id" IS NOT NULL AND "identity_decision"."accepted_by" IS NOT NULL AND "identity_decision"."accepted_at" IS NOT NULL AND "identity_decision"."closed_by" IS NULL AND "identity_decision"."closed_at" IS NULL
        WHEN 'superseded' THEN "identity_decision"."mapping_set_id" IS NOT NULL AND "identity_decision"."accepted_by" IS NOT NULL AND "identity_decision"."accepted_at" IS NOT NULL AND "identity_decision"."closed_by" IS NOT NULL AND "identity_decision"."closed_at" IS NOT NULL
        ELSE "identity_decision"."accepted_by" IS NULL AND "identity_decision"."accepted_at" IS NULL AND "identity_decision"."closed_by" IS NOT NULL AND "identity_decision"."closed_at" IS NOT NULL
      END),
	CONSTRAINT "idec_separation_ck" CHECK ("identity_decision"."accepted_by" IS NULL OR "identity_decision"."accepted_by" <> "identity_decision"."proposed_by")
);
--> statement-breakpoint
CREATE TABLE "identity_review_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "identity_review_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_type" text NOT NULL,
	"decision_id" uuid,
	"mapping_set_id" uuid,
	"actor" text NOT NULL,
	"actor_role" text NOT NULL,
	"verdict" text,
	"from_status" text,
	"to_status" text,
	"note" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "irev_type_ck" CHECK ("identity_review_event"."event_type" IN ('proposed', 'reviewed', 'accepted', 'rejected', 'withdrawn', 'superseded', 'mapping_set_created', 'mapping_set_activated', 'mapping_set_deactivated')),
	CONSTRAINT "irev_role_ck" CHECK ("identity_review_event"."actor_role" IN ('reviewer', 'approver')),
	CONSTRAINT "irev_verdict_ck" CHECK (("identity_review_event"."event_type" = 'reviewed') = ("identity_review_event"."verdict" IS NOT NULL) AND ("identity_review_event"."verdict" IS NULL OR "identity_review_event"."verdict" IN ('recommend', 'reject', 'needs_evidence'))),
	CONSTRAINT "irev_subject_ck" CHECK (num_nonnulls("identity_review_event"."decision_id", "identity_review_event"."mapping_set_id") >= 1),
	CONSTRAINT "irev_actor_ck" CHECK (btrim("identity_review_event"."actor") <> ''),
	CONSTRAINT "irev_evidence_ck" CHECK (jsonb_typeof("identity_review_event"."evidence") = 'object')
);
--> statement-breakpoint
CREATE TABLE "mapping_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_by" text,
	"activated_at" timestamp with time zone,
	"deactivated_by" text,
	"deactivated_at" timestamp with time zone,
	"activation_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mset_code_ck" CHECK ("mapping_set"."code" ~ '^[a-z0-9][a-z0-9._-]*$'),
	CONSTRAINT "mset_status_ck" CHECK ("mapping_set"."status" IN ('draft', 'active', 'inactive')),
	CONSTRAINT "mset_count_ck" CHECK ("mapping_set"."activation_count" >= 0 AND ("mapping_set"."status" <> 'active' OR "mapping_set"."activation_count" >= 1)),
	CONSTRAINT "mset_active_by_ck" CHECK ("mapping_set"."status" <> 'active' OR ("mapping_set"."activated_by" IS NOT NULL AND "mapping_set"."activated_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "identity_decision" ADD CONSTRAINT "idec_mapping_set_fk" FOREIGN KEY ("mapping_set_id") REFERENCES "public"."mapping_set"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_decision" ADD CONSTRAINT "idec_source_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_decision" ADD CONSTRAINT "idec_subject_market_fk" FOREIGN KEY ("subject_market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_decision" ADD CONSTRAINT "idec_target_state_fk" FOREIGN KEY ("target_state_id") REFERENCES "public"."states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_decision" ADD CONSTRAINT "idec_target_district_fk" FOREIGN KEY ("target_district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_decision" ADD CONSTRAINT "idec_target_market_fk" FOREIGN KEY ("target_market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_decision" ADD CONSTRAINT "idec_target_unit_fk" FOREIGN KEY ("target_admin_unit_version_id") REFERENCES "public"."admin_unit_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_decision" ADD CONSTRAINT "idec_supersedes_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."identity_decision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_review_event" ADD CONSTRAINT "irev_decision_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."identity_decision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_review_event" ADD CONSTRAINT "irev_mapping_set_fk" FOREIGN KEY ("mapping_set_id") REFERENCES "public"."mapping_set"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idec_one_accepted_label_uq" ON "identity_decision" USING btree ("mapping_set_id","source_id","entity_kind","source_key") WHERE "identity_decision"."status" = 'accepted';--> statement-breakpoint
CREATE UNIQUE INDEX "idec_one_accepted_subject_uq" ON "identity_decision" USING btree ("mapping_set_id","subject_market_id","decision_kind") WHERE "identity_decision"."status" = 'accepted' AND "identity_decision"."subject_market_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idec_supersedes_uq" ON "identity_decision" USING btree ("supersedes_id") WHERE "identity_decision"."supersedes_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idec_status_idx" ON "identity_decision" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idec_set_idx" ON "identity_decision" USING btree ("mapping_set_id");--> statement-breakpoint
CREATE INDEX "idec_label_idx" ON "identity_decision" USING btree ("source_id","entity_kind","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "irev_one_review_uq" ON "identity_review_event" USING btree ("decision_id","actor") WHERE "identity_review_event"."event_type" = 'reviewed';--> statement-breakpoint
CREATE INDEX "irev_decision_idx" ON "identity_review_event" USING btree ("decision_id","id");--> statement-breakpoint
CREATE INDEX "irev_set_idx" ON "identity_review_event" USING btree ("mapping_set_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mset_code_uq" ON "mapping_set" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "mset_one_active_uq" ON "mapping_set" USING btree ((true)) WHERE "mapping_set"."status" = 'active';

--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- Milestone 2.4, Stage 3a, part 2: the identity decision state machine, its guards and its
-- privileges. Hand-written; the tables above are generated from src/schema/identity.js.
--
-- Nothing is inserted and no existing table, row or privilege of an existing table is changed.
-- Nothing here applies a decision to a mandi, alias or observation.
--
-- Roles. Two group roles are expected to exist (created by the cluster administrator, never by a
-- migration, see database/init and docs/geography/GEOGRAPHIC_ARCHITECTURE.md):
--     fasalytics_reviewer   proposes and reviews
--     fasalytics_approver   accepts, rejects and manages mapping sets
-- Individual reviewers and approvers are login roles that are MEMBERS of one group; no login may be a
-- member of both. Nobody is created here.
--
-- Access control, in three layers:
--   1. Table privileges: every non-owner grantee loses all write privileges (below). Nobody writes
--      these tables directly except the schema owner.
--   2. SECURITY DEFINER functions are the ONLY write path. EXECUTE is withdrawn from everyone and
--      granted to the two group roles by scripts/grant-identity-privileges.js.
--   3. Inside every function the caller is identified with session_user (never with a parameter) and
--      must be a member of exactly the required group.
-- A trigger additionally refuses any write to these tables made by a role other than the table owner
-- (that is: not through a function), whatever privileges that role was granted.
-- ---------------------------------------------------------------------------------------------

-- Which group is the caller in? Raises when the login is in neither or in both groups.
CREATE FUNCTION public.identity_caller_role() RETURNS text
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
	is_reviewer boolean := false;
	is_approver boolean := false;
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fasalytics_reviewer') THEN
		is_reviewer := pg_has_role(session_user, 'fasalytics_reviewer', 'member');
	END IF;
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fasalytics_approver') THEN
		is_approver := pg_has_role(session_user, 'fasalytics_approver', 'member');
	END IF;
	IF is_reviewer AND is_approver THEN
		RAISE EXCEPTION 'login % holds both the reviewer and the approver role: separation of duties refuses it', session_user USING ERRCODE = 'FI010';
	END IF;
	IF is_approver THEN RETURN 'approver'; END IF;
	IF is_reviewer THEN RETURN 'reviewer'; END IF;
	RAISE EXCEPTION 'login % holds neither the reviewer nor the approver role', session_user USING ERRCODE = 'FI011';
END
$$;
--> statement-breakpoint
CREATE FUNCTION public.identity_require_role(p_need text) RETURNS text
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
	have text := public.identity_caller_role();
BEGIN
	IF have <> p_need THEN
		RAISE EXCEPTION 'this action needs the % role; login % acts as %', p_need, session_user, have USING ERRCODE = 'FI012';
	END IF;
	RETURN have;
END
$$;
--> statement-breakpoint
-- Writes one audit event. Internal: only the functions below call it.
CREATE FUNCTION public.identity_log_event(
	p_event_type text, p_decision_id uuid, p_mapping_set_id uuid, p_actor_role text,
	p_verdict text, p_from_status text, p_to_status text, p_note text, p_evidence jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
	new_id bigint;
BEGIN
	INSERT INTO public.identity_review_event
		(event_type, decision_id, mapping_set_id, actor, actor_role, verdict, from_status, to_status, note, evidence)
	VALUES
		(p_event_type, p_decision_id, p_mapping_set_id, session_user, p_actor_role, p_verdict, p_from_status, p_to_status, p_note, coalesce(p_evidence, '{}'::jsonb))
	RETURNING id INTO new_id;
	RETURN new_id;
END
$$;
--> statement-breakpoint
-- ---- guards (triggers) ------------------------------------------------------------------------
-- BEFORE triggers fire in alphabetical order of their names: the owner-only guard is named so that it runs first.

-- Writes are only possible from inside the SECURITY DEFINER functions: the statement then runs as the
-- table owner. Any other role is refused whatever it was granted.
CREATE FUNCTION public.identity_owner_only_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
	IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = TG_RELID)) THEN
		RAISE EXCEPTION 'direct writes to % are not allowed: use the identity functions', TG_TABLE_NAME USING ERRCODE = 'FI020';
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION public.identity_decision_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
	moved text;
	-- requires_two_reviewers is GENERATED from decision_kind, decision_class and entity_kind (all compared): PostgreSQL
	-- computes it after BEFORE triggers run, so NEW does not carry it yet and it is left out of the comparison.
	movable text[] := ARRAY['status', 'mapping_set_id', 'accepted_by', 'accepted_at', 'closed_by', 'closed_at', 'closed_reason', 'requires_two_reviewers'];
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.status <> 'proposed' THEN
			RAISE EXCEPTION 'a decision is created as proposed, not as %', NEW.status USING ERRCODE = 'FI021';
		END IF;
		IF NEW.proposed_by <> session_user THEN
			RAISE EXCEPTION 'proposed_by must be the session login' USING ERRCODE = 'FI022';
		END IF;
		RETURN NEW;
	END IF;
	-- UPDATE: only the status machine may move, and only along the allowed edges.
	IF NEW.status = OLD.status THEN
		RAISE EXCEPTION 'the content of an identity decision is immutable' USING ERRCODE = 'FI024';
	END IF;
	moved := OLD.status || '>' || NEW.status;
	IF moved NOT IN ('proposed>accepted', 'proposed>rejected', 'proposed>withdrawn', 'accepted>superseded') THEN
		RAISE EXCEPTION 'a decision cannot move from % to %', OLD.status, NEW.status USING ERRCODE = 'FI023';
	END IF;
	IF (to_jsonb(NEW) - movable) <> (to_jsonb(OLD) - movable) THEN
		RAISE EXCEPTION 'the content of an identity decision is immutable' USING ERRCODE = 'FI024';
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION public.mapping_set_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
	moved text;
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.status <> 'draft' OR NEW.activation_count <> 0 THEN
			RAISE EXCEPTION 'a mapping set is created as a draft' USING ERRCODE = 'FI025';
		END IF;
		IF NEW.created_by <> session_user THEN
			RAISE EXCEPTION 'created_by must be the session login' USING ERRCODE = 'FI022';
		END IF;
		RETURN NEW;
	END IF;
	IF NEW.status = OLD.status THEN
		RAISE EXCEPTION 'a mapping set is immutable: it changes only by being activated or deactivated' USING ERRCODE = 'FI027';
	END IF;
	moved := OLD.status || '>' || NEW.status;
	IF moved NOT IN ('draft>active', 'draft>inactive', 'active>inactive', 'inactive>active') THEN
		RAISE EXCEPTION 'a mapping set cannot move from % to %', OLD.status, NEW.status USING ERRCODE = 'FI026';
	END IF;
	IF (to_jsonb(NEW) - ARRAY['status', 'activated_by', 'activated_at', 'deactivated_by', 'deactivated_at', 'activation_count'])
		<> (to_jsonb(OLD) - ARRAY['status', 'activated_by', 'activated_at', 'deactivated_by', 'deactivated_at', 'activation_count']) THEN
		RAISE EXCEPTION 'the identity of a mapping set (code, description, creator) is immutable' USING ERRCODE = 'FI027';
	END IF;
	IF NEW.activation_count <> OLD.activation_count + (CASE WHEN NEW.status = 'active' THEN 1 ELSE 0 END) THEN
		RAISE EXCEPTION 'activation_count changes only when a set is activated' USING ERRCODE = 'FI028';
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.identity_owner_only_guard() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.identity_decision_guard() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mapping_set_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER idec_a_owner_only BEFORE INSERT OR UPDATE ON public.identity_decision
	FOR EACH ROW EXECUTE FUNCTION public.identity_owner_only_guard();
--> statement-breakpoint
CREATE TRIGGER idec_guard BEFORE INSERT OR UPDATE ON public.identity_decision
	FOR EACH ROW EXECUTE FUNCTION public.identity_decision_guard();
--> statement-breakpoint
CREATE TRIGGER idec_append_only BEFORE DELETE ON public.identity_decision
	FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();
--> statement-breakpoint
CREATE TRIGGER idec_no_truncate BEFORE TRUNCATE ON public.identity_decision
	FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_guard();
--> statement-breakpoint
CREATE TRIGGER mset_a_owner_only BEFORE INSERT OR UPDATE ON public.mapping_set
	FOR EACH ROW EXECUTE FUNCTION public.identity_owner_only_guard();
--> statement-breakpoint
CREATE TRIGGER mset_guard BEFORE INSERT OR UPDATE ON public.mapping_set
	FOR EACH ROW EXECUTE FUNCTION public.mapping_set_guard();
--> statement-breakpoint
CREATE TRIGGER mset_append_only BEFORE DELETE ON public.mapping_set
	FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();
--> statement-breakpoint
CREATE TRIGGER mset_no_truncate BEFORE TRUNCATE ON public.mapping_set
	FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_guard();
--> statement-breakpoint
CREATE TRIGGER irev_owner_only BEFORE INSERT ON public.identity_review_event
	FOR EACH ROW EXECUTE FUNCTION public.identity_owner_only_guard();
--> statement-breakpoint
CREATE TRIGGER irev_append_only BEFORE UPDATE OR DELETE ON public.identity_review_event
	FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();
--> statement-breakpoint
CREATE TRIGGER irev_no_truncate BEFORE TRUNCATE ON public.identity_review_event
	FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_guard();
--> statement-breakpoint
-- ---- the write path: SECURITY DEFINER functions ------------------------------------------------

-- Reviewer: propose a decision. Everything the decision claims is stored; nothing is applied.
CREATE FUNCTION public.identity_propose(
	p_decision_kind text, p_entity_kind text, p_source_id uuid, p_source_key text, p_source_label text,
	p_decision_class text, p_rationale text, p_ruleset_version text,
	p_source_context text DEFAULT NULL, p_subject_market_id uuid DEFAULT NULL,
	p_target_state_id uuid DEFAULT NULL, p_target_district_id uuid DEFAULT NULL, p_target_market_id uuid DEFAULT NULL,
	p_target_admin_unit_version_id uuid DEFAULT NULL, p_evidence jsonb DEFAULT '{}'::jsonb,
	p_evidence_refs text[] DEFAULT '{}'::text[], p_valid_from date DEFAULT NULL, p_valid_to date DEFAULT NULL,
	p_supersedes_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
	role_name text := public.identity_require_role('reviewer');
	unit_kind text;
	old_row public.identity_decision%ROWTYPE;
	new_id uuid;
BEGIN
	IF p_target_admin_unit_version_id IS NOT NULL THEN
		SELECT unit_type INTO unit_kind FROM public.admin_unit_version WHERE id = p_target_admin_unit_version_id;
		IF unit_kind IS NULL THEN
			RAISE EXCEPTION 'the official unit version does not exist' USING ERRCODE = 'FI030';
		END IF;
		IF (p_decision_kind = 'correct_state' OR p_entity_kind = 'state') AND unit_kind <> 'state' THEN
			RAISE EXCEPTION 'a state decision needs an official STATE version, got %', unit_kind USING ERRCODE = 'FI030';
		END IF;
		IF p_entity_kind = 'district' AND p_decision_kind = 'map_label' AND unit_kind <> 'district' THEN
			RAISE EXCEPTION 'a district decision needs an official DISTRICT version, got %', unit_kind USING ERRCODE = 'FI030';
		END IF;
	END IF;
	IF p_supersedes_id IS NOT NULL THEN
		SELECT * INTO old_row FROM public.identity_decision WHERE id = p_supersedes_id;
		IF NOT FOUND OR old_row.status <> 'accepted' THEN
			RAISE EXCEPTION 'only an accepted decision can be superseded' USING ERRCODE = 'FI031';
		END IF;
		IF old_row.source_id <> p_source_id OR old_row.entity_kind <> p_entity_kind OR old_row.source_key <> p_source_key THEN
			RAISE EXCEPTION 'a decision can only supersede a decision about the same label' USING ERRCODE = 'FI031';
		END IF;
	END IF;
	INSERT INTO public.identity_decision (
		decision_kind, entity_kind, source_id, source_key, source_label, source_context, subject_market_id,
		target_state_id, target_district_id, target_market_id, target_admin_unit_version_id,
		decision_class, evidence, evidence_refs, rationale, ruleset_version, valid_from, valid_to,
		supersedes_id, proposed_by)
	VALUES (
		p_decision_kind, p_entity_kind, p_source_id, p_source_key, p_source_label, p_source_context, p_subject_market_id,
		p_target_state_id, p_target_district_id, p_target_market_id, p_target_admin_unit_version_id,
		p_decision_class, coalesce(p_evidence, '{}'::jsonb), coalesce(p_evidence_refs, '{}'::text[]), p_rationale,
		p_ruleset_version, p_valid_from, p_valid_to, p_supersedes_id, session_user)
	RETURNING id INTO new_id;
	PERFORM public.identity_log_event('proposed', new_id, NULL, role_name, NULL, NULL, 'proposed', p_rationale, p_evidence);
	RETURN new_id;
END
$$;
--> statement-breakpoint
-- Reviewer: record an independent verdict. The proposer cannot review; each reviewer counts once.
CREATE FUNCTION public.identity_review(p_decision_id uuid, p_verdict text, p_note text DEFAULT NULL, p_evidence jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
	role_name text := public.identity_require_role('reviewer');
	d public.identity_decision%ROWTYPE;
BEGIN
	IF p_verdict NOT IN ('recommend', 'reject', 'needs_evidence') THEN
		RAISE EXCEPTION 'unknown verdict %', p_verdict USING ERRCODE = 'FI040';
	END IF;
	SELECT * INTO d FROM public.identity_decision WHERE id = p_decision_id FOR SHARE;
	IF NOT FOUND THEN RAISE EXCEPTION 'decision not found' USING ERRCODE = 'FI050'; END IF;
	IF d.status <> 'proposed' THEN
		RAISE EXCEPTION 'only a proposed decision can be reviewed (it is %)', d.status USING ERRCODE = 'FI051';
	END IF;
	IF d.proposed_by = session_user THEN
		RAISE EXCEPTION 'the proposer cannot review their own proposal' USING ERRCODE = 'FI041';
	END IF;
	BEGIN
		RETURN public.identity_log_event('reviewed', p_decision_id, NULL, role_name, p_verdict, d.status, d.status, p_note, p_evidence);
	EXCEPTION WHEN unique_violation THEN
		RAISE EXCEPTION 'login % has already reviewed this decision', session_user USING ERRCODE = 'FI042';
	END;
END
$$;
--> statement-breakpoint
-- Approver: accept a proposed decision into a DRAFT mapping set. The row lock, the label lock and the
-- partial unique indexes together make concurrent approvals safe: the second approval sees the first.
CREATE FUNCTION public.identity_accept(p_decision_id uuid, p_mapping_set_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
	role_name text := public.identity_require_role('approver');
	d public.identity_decision%ROWTYPE;
	s public.mapping_set%ROWTYPE;
	old_row public.identity_decision%ROWTYPE;
	needed int;
	recommends int;
	blockers int;
BEGIN
	SELECT * INTO d FROM public.identity_decision WHERE id = p_decision_id FOR UPDATE;
	IF NOT FOUND THEN RAISE EXCEPTION 'decision not found' USING ERRCODE = 'FI050'; END IF;
	IF d.status <> 'proposed' THEN
		RAISE EXCEPTION 'only a proposed decision can be accepted (it is %)', d.status USING ERRCODE = 'FI051';
	END IF;
	SELECT * INTO s FROM public.mapping_set WHERE id = p_mapping_set_id FOR UPDATE;
	IF NOT FOUND OR s.status <> 'draft' THEN
		RAISE EXCEPTION 'decisions are accepted only into an existing DRAFT mapping set' USING ERRCODE = 'FI052';
	END IF;
	IF d.proposed_by = session_user THEN
		RAISE EXCEPTION 'the approver cannot be the proposer' USING ERRCODE = 'FI053';
	END IF;
	IF EXISTS (SELECT 1 FROM public.identity_review_event e WHERE e.decision_id = d.id AND e.event_type = 'reviewed' AND e.actor = session_user) THEN
		RAISE EXCEPTION 'the approver cannot be a reviewer of the same decision' USING ERRCODE = 'FI054';
	END IF;
	-- serialise everything that concerns the same label (and the same mandi) inside this set
	PERFORM pg_advisory_xact_lock(hashtextextended('idec|' || p_mapping_set_id::text || '|' || d.source_id::text || '|' || d.entity_kind || '|' || d.source_key, 0));
	IF d.subject_market_id IS NOT NULL THEN
		PERFORM pg_advisory_xact_lock(hashtextextended('idecm|' || p_mapping_set_id::text || '|' || d.subject_market_id::text || '|' || d.decision_kind, 0));
	END IF;
	SELECT count(DISTINCT e.actor) FILTER (WHERE e.verdict = 'recommend'),
		count(*) FILTER (WHERE e.verdict IN ('reject', 'needs_evidence'))
	INTO recommends, blockers
	FROM public.identity_review_event e
	WHERE e.decision_id = d.id AND e.event_type = 'reviewed' AND e.actor <> d.proposed_by;
	needed := CASE WHEN d.requires_two_reviewers THEN 2 ELSE 1 END;
	IF blockers > 0 THEN
		RAISE EXCEPTION 'a reviewer rejected or asked for more evidence: propose a new decision' USING ERRCODE = 'FI055';
	END IF;
	IF recommends < needed THEN
		RAISE EXCEPTION 'this decision needs % distinct recommending reviewers, it has %', needed, recommends USING ERRCODE = 'FI056';
	END IF;
	-- conflicting accepted mapping inside the same set (the unique indexes enforce it again at commit)
	IF EXISTS (
		SELECT 1 FROM public.identity_decision o
		WHERE o.id <> d.id AND o.status = 'accepted' AND o.mapping_set_id = p_mapping_set_id
			AND ((o.source_id = d.source_id AND o.entity_kind = d.entity_kind AND o.source_key = d.source_key AND o.id IS DISTINCT FROM d.supersedes_id)
				OR (d.subject_market_id IS NOT NULL AND o.subject_market_id = d.subject_market_id AND o.decision_kind = d.decision_kind AND o.id IS DISTINCT FROM d.supersedes_id))
	) THEN
		RAISE EXCEPTION 'a conflicting accepted decision already exists in this mapping set' USING ERRCODE = 'FI058';
	END IF;
	-- Replacing a decision of the SAME draft set closes the old one; replacing a decision of another set is lineage only,
	-- so that older sets stay intact and reactivating them is a true rollback.
	IF d.supersedes_id IS NOT NULL THEN
		SELECT * INTO old_row FROM public.identity_decision WHERE id = d.supersedes_id FOR UPDATE;
		IF FOUND AND old_row.status = 'accepted' AND old_row.mapping_set_id = p_mapping_set_id THEN
			UPDATE public.identity_decision
				SET status = 'superseded', closed_by = session_user, closed_at = clock_timestamp(), closed_reason = 'superseded by ' || d.id
				WHERE id = old_row.id;
			PERFORM public.identity_log_event('superseded', old_row.id, p_mapping_set_id, role_name, NULL, 'accepted', 'superseded', 'superseded by ' || d.id, '{}'::jsonb);
		END IF;
	END IF;
	UPDATE public.identity_decision
		SET status = 'accepted', mapping_set_id = p_mapping_set_id, accepted_by = session_user, accepted_at = clock_timestamp()
		WHERE id = d.id;
	PERFORM public.identity_log_event('accepted', d.id, p_mapping_set_id, role_name, NULL, 'proposed', 'accepted', NULL,
		jsonb_build_object('recommending_reviewers', recommends, 'required', needed));
END
$$;
--> statement-breakpoint
CREATE FUNCTION public.identity_reject(p_decision_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
	role_name text := public.identity_require_role('approver');
	d public.identity_decision%ROWTYPE;
BEGIN
	IF p_reason IS NULL OR btrim(p_reason) = '' THEN
		RAISE EXCEPTION 'a reason is required' USING ERRCODE = 'FI043';
	END IF;
	SELECT * INTO d FROM public.identity_decision WHERE id = p_decision_id FOR UPDATE;
	IF NOT FOUND THEN RAISE EXCEPTION 'decision not found' USING ERRCODE = 'FI050'; END IF;
	IF d.status <> 'proposed' THEN
		RAISE EXCEPTION 'only a proposed decision can be rejected (it is %)', d.status USING ERRCODE = 'FI051';
	END IF;
	UPDATE public.identity_decision
		SET status = 'rejected', closed_by = session_user, closed_at = clock_timestamp(), closed_reason = p_reason
		WHERE id = d.id;
	PERFORM public.identity_log_event('rejected', d.id, NULL, role_name, NULL, 'proposed', 'rejected', p_reason, '{}'::jsonb);
END
$$;
--> statement-breakpoint
CREATE FUNCTION public.identity_withdraw(p_decision_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
	role_name text := public.identity_require_role('reviewer');
	d public.identity_decision%ROWTYPE;
BEGIN
	IF p_reason IS NULL OR btrim(p_reason) = '' THEN
		RAISE EXCEPTION 'a reason is required' USING ERRCODE = 'FI043';
	END IF;
	SELECT * INTO d FROM public.identity_decision WHERE id = p_decision_id FOR UPDATE;
	IF NOT FOUND THEN RAISE EXCEPTION 'decision not found' USING ERRCODE = 'FI050'; END IF;
	IF d.proposed_by <> session_user THEN
		RAISE EXCEPTION 'only the proposer can withdraw a proposal' USING ERRCODE = 'FI044';
	END IF;
	IF d.status <> 'proposed' THEN
		RAISE EXCEPTION 'only a proposed decision can be withdrawn (it is %)', d.status USING ERRCODE = 'FI051';
	END IF;
	UPDATE public.identity_decision
		SET status = 'withdrawn', closed_by = session_user, closed_at = clock_timestamp(), closed_reason = p_reason
		WHERE id = d.id;
	PERFORM public.identity_log_event('withdrawn', d.id, NULL, role_name, NULL, 'proposed', 'withdrawn', p_reason, '{}'::jsonb);
END
$$;
--> statement-breakpoint
CREATE FUNCTION public.mapping_set_create(p_code text, p_description text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
	role_name text := public.identity_require_role('approver');
	new_id uuid;
BEGIN
	INSERT INTO public.mapping_set (code, description, created_by) VALUES (p_code, p_description, session_user) RETURNING id INTO new_id;
	PERFORM public.identity_log_event('mapping_set_created', NULL, new_id, role_name, NULL, NULL, 'draft', p_description, '{}'::jsonb);
	RETURN new_id;
END
$$;
--> statement-breakpoint
-- Activation is reversible: it replaces the active set (which becomes inactive) and any inactive set can be
-- activated again. Nothing about the decisions themselves changes, and nothing is applied to any mandi.
CREATE FUNCTION public.mapping_set_activate(p_mapping_set_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
	role_name text := public.identity_require_role('approver');
	s public.mapping_set%ROWTYPE;
	previous record;
BEGIN
	PERFORM pg_advisory_xact_lock(hashtextextended('fasalytics.mapping_set.activation', 0));
	SELECT * INTO s FROM public.mapping_set WHERE id = p_mapping_set_id FOR UPDATE;
	IF NOT FOUND THEN RAISE EXCEPTION 'mapping set not found' USING ERRCODE = 'FI050'; END IF;
	IF s.status = 'active' THEN
		RAISE EXCEPTION 'the mapping set is already active' USING ERRCODE = 'FI061';
	END IF;
	FOR previous IN SELECT id FROM public.mapping_set WHERE status = 'active' AND id <> s.id FOR UPDATE
	LOOP
		UPDATE public.mapping_set SET status = 'inactive', deactivated_by = session_user, deactivated_at = clock_timestamp() WHERE id = previous.id;
		PERFORM public.identity_log_event('mapping_set_deactivated', NULL, previous.id, role_name, NULL, 'active', 'inactive', 'replaced by ' || s.id, '{}'::jsonb);
	END LOOP;
	UPDATE public.mapping_set
		SET status = 'active', activated_by = session_user, activated_at = clock_timestamp(), activation_count = activation_count + 1
		WHERE id = s.id;
	PERFORM public.identity_log_event('mapping_set_activated', NULL, s.id, role_name, NULL, s.status, 'active', NULL, '{}'::jsonb);
END
$$;
--> statement-breakpoint
CREATE FUNCTION public.mapping_set_deactivate(p_mapping_set_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
	role_name text := public.identity_require_role('approver');
	s public.mapping_set%ROWTYPE;
BEGIN
	PERFORM pg_advisory_xact_lock(hashtextextended('fasalytics.mapping_set.activation', 0));
	SELECT * INTO s FROM public.mapping_set WHERE id = p_mapping_set_id FOR UPDATE;
	IF NOT FOUND THEN RAISE EXCEPTION 'mapping set not found' USING ERRCODE = 'FI050'; END IF;
	IF s.status <> 'active' THEN
		RAISE EXCEPTION 'only an active mapping set can be deactivated (it is %)', s.status USING ERRCODE = 'FI062';
	END IF;
	UPDATE public.mapping_set SET status = 'inactive', deactivated_by = session_user, deactivated_at = clock_timestamp() WHERE id = s.id;
	PERFORM public.identity_log_event('mapping_set_deactivated', NULL, s.id, role_name, NULL, 'active', 'inactive', NULL, '{}'::jsonb);
END
$$;
--> statement-breakpoint
-- The accepted decisions of the ACTIVE mapping set: what is "in effect" for readers. Nothing is applied by it.
CREATE VIEW public.identity_decision_in_effect WITH (security_invoker = true) AS
	SELECT d.*, m.code AS mapping_set_code
	FROM public.identity_decision d
	JOIN public.mapping_set m ON m.id = d.mapping_set_id
	WHERE d.status = 'accepted' AND m.status = 'active';
--> statement-breakpoint
COMMENT ON TABLE public.mapping_set IS 'Versioned group of accepted identity decisions. One active set at most; draft sets accept decisions; activation is reversible.';
--> statement-breakpoint
COMMENT ON TABLE public.identity_decision IS 'Evidence-backed identity decisions. Content immutable; only the status machine moves, through the identity_* functions. Nothing here is applied to the registry.';
--> statement-breakpoint
COMMENT ON TABLE public.identity_review_event IS 'Append-only audit log of identity proposals, reviews, decisions and mapping-set changes.';
--> statement-breakpoint
-- Least privilege. The functions are the only write path: EXECUTE is withdrawn from everyone here and granted
-- to the reviewer and approver group roles by scripts/grant-identity-privileges.js. Every non-owner grantee
-- (the application role through default privileges, the ingestion role through its blanket grant) loses all
-- write privileges on the identity tables and on their view.
DO $$
DECLARE
	fn record;
	rel text;
	grantee_oid oid;
BEGIN
	FOR fn IN
		SELECT p.oid::regprocedure AS sig
		FROM pg_proc p
		WHERE p.pronamespace = 'public'::regnamespace
			AND p.proname IN ('identity_caller_role', 'identity_require_role', 'identity_log_event', 'identity_propose', 'identity_review',
				'identity_accept', 'identity_reject', 'identity_withdraw', 'mapping_set_create', 'mapping_set_activate', 'mapping_set_deactivate')
	LOOP
		EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
	END LOOP;
	FOREACH rel IN ARRAY ARRAY['mapping_set', 'identity_decision', 'identity_review_event', 'identity_decision_in_effect']
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
