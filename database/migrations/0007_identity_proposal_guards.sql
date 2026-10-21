CREATE UNIQUE INDEX "idec_open_proposal_key_uq" ON "identity_decision" USING btree (("evidence"->>'proposalKey')) WHERE "identity_decision"."status" = 'proposed' AND "identity_decision"."evidence" ? 'proposalKey';--> statement-breakpoint
CREATE UNIQUE INDEX "idec_proposal_evidence_uq" ON "identity_decision" USING btree (("evidence"->>'proposalKey'),("evidence"->>'evidenceDigest')) WHERE "identity_decision"."evidence" ? 'proposalKey' AND "identity_decision"."evidence" ? 'evidenceDigest';
--> statement-breakpoint
-- A change of a mandi's state is accepted only with MARKET-SPECIFIC evidence. A state-level reorganisation (a
-- district now belongs to another state) says nothing about one individual mandi, so a `correct_state` decision
-- needs at least one entry in evidence.marketSpecificEvidence (an official listing of that mandi, a government
-- market code record, a gazette notification). The proposer supplies the entries and the reviewers check them; the
-- database only refuses to accept a correction that has none. It does not judge the entries.
CREATE FUNCTION public.identity_state_evidence_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
	has_evidence boolean;
BEGIN
	IF NEW.decision_kind = 'correct_state' AND NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
		-- a missing key, a non-array and an empty array all count as "no evidence" (never NULL)
		has_evidence := COALESCE(
			CASE WHEN jsonb_typeof(NEW.evidence->'marketSpecificEvidence') = 'array'
				THEN jsonb_array_length(NEW.evidence->'marketSpecificEvidence') > 0
				ELSE false END,
			false);
		IF NOT has_evidence THEN
			RAISE EXCEPTION 'a state correction needs market-specific evidence (evidence.marketSpecificEvidence); a state-level change is not evidence about one mandi'
				USING ERRCODE = 'FI057';
		END IF;
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.identity_state_evidence_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER idec_state_evidence BEFORE UPDATE ON public.identity_decision
	FOR EACH ROW EXECUTE FUNCTION public.identity_state_evidence_guard();
--> statement-breakpoint
COMMENT ON INDEX public.idec_open_proposal_key_uq IS 'Stage 3b: at most one open proposal per generated claim (evidence.proposalKey).';
--> statement-breakpoint
COMMENT ON INDEX public.idec_proposal_evidence_uq IS 'Stage 3b: the same claim with the same evidence is recorded once, whatever its status; new evidence means a new digest.';
