-- Custom SQL migration file, put your code below! --
INSERT INTO "plan_limit" ("plan", "key", "value") VALUES
  ('free', 'discovery_initial_cents', 50),
  ('free', 'discovery_daily_review_cents', 5),
  ('pro', 'discovery_initial_cents', 50),
  ('pro', 'discovery_daily_review_cents', 5)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION reserve_discovery_spend(p_id uuid, p_workspace uuid, p_scope text, p_request text, p_estimate numeric, p_token uuid)
RETURNS TABLE (reservation_id uuid, created boolean) LANGUAGE plpgsql AS $$
DECLARE
  v_period date;
  v_plan text;
  v_key text;
  v_cap numeric;
  v_feature integer;
  v_existing discovery_reservation%ROWTYPE;
  v_saved uuid;
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN ('initial', 'daily_review') OR p_estimate IS NULL OR p_estimate <= 0 OR p_estimate::text = 'NaN'
     OR length(p_request) < 1 OR length(p_request) > 200 OR p_token IS NULL THEN
    RAISE EXCEPTION 'Invalid discovery reservation';
  END IF;
  v_period := CASE WHEN p_scope = 'initial' THEN '0001-01-01'::date ELSE (now() AT TIME ZONE 'UTC')::date END;
  -- One transaction lock covers request identity and all providers for this workspace.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace::text, 0));
  SELECT * INTO v_existing FROM discovery_reservation WHERE workspace_id = p_workspace AND request_id = p_request;
  IF FOUND THEN
    IF v_existing.scope <> p_scope OR v_existing.estimate_usd <> p_estimate THEN
      RAISE EXCEPTION 'Conflicting discovery request ID';
    END IF;
    RETURN QUERY SELECT v_existing.id, false;
    RETURN;
  END IF;
  -- A prior run with an unsettled receipt may owe more than its estimate. Only
  -- nested model/tools from its server-owned context token may proceed.
  IF EXISTS (SELECT 1 FROM discovery_reservation r WHERE r.workspace_id = p_workspace
      AND r.settled_at IS NULL AND r.run_token <> p_token) THEN
    RAISE EXCEPTION 'Discovery spend needs reconciliation';
  END IF;
  SELECT CASE WHEN w.plan = 'pro' OR EXISTS (
      SELECT 1 FROM billing_subscription b WHERE b.user_id = w.owner_user_id AND b.plan = 'pro'
        AND b.status IN ('active', 'trialing', 'past_due') AND (b.ended_at IS NULL OR b.ended_at > now())
    ) THEN 'pro' ELSE 'free' END INTO v_plan FROM workspace w WHERE w.id = p_workspace;
  IF v_plan IS NULL THEN RETURN; END IF;
  SELECT COALESCE((SELECT value FROM plan_limit WHERE plan = v_plan AND key = 'discovery_reports'),
                  (SELECT value FROM plan_limit WHERE plan = 'free' AND key = 'discovery_reports'), 1)
    INTO v_feature;
  IF v_feature <= 0 THEN RETURN; END IF;
  v_key := CASE WHEN p_scope = 'initial' THEN 'discovery_initial_cents' ELSE 'discovery_daily_review_cents' END;
  SELECT greatest(0, least(CASE WHEN p_scope = 'initial' THEN 50 ELSE 5 END,
    COALESCE((SELECT value FROM plan_limit WHERE plan = v_plan AND key = v_key),
             (SELECT value FROM plan_limit WHERE plan = 'free' AND key = v_key),
             CASE WHEN p_scope = 'initial' THEN 50 ELSE 5 END)))::numeric / 100 INTO v_cap;
  INSERT INTO discovery_budget (workspace_id, scope, period, spent_usd)
    SELECT p_workspace, p_scope, v_period, p_estimate WHERE p_estimate <= v_cap
    ON CONFLICT (workspace_id, scope, period) DO UPDATE
      SET spent_usd = discovery_budget.spent_usd + EXCLUDED.spent_usd
      WHERE discovery_budget.spent_usd + EXCLUDED.spent_usd <= v_cap
    RETURNING p_workspace INTO v_saved;
  IF v_saved IS NULL THEN RETURN; END IF;
  INSERT INTO discovery_reservation (id, workspace_id, scope, period, request_id, run_token, estimate_usd, retained_usd)
    VALUES (p_id, p_workspace, p_scope, v_period, p_request, p_token, p_estimate, p_estimate);
  RETURN QUERY SELECT p_id, true;
  RETURN;
END $$;
--> statement-breakpoint
CREATE FUNCTION settle_discovery_spend(p_workspace uuid, p_id uuid, p_actual numeric, p_outcome text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_row discovery_reservation%ROWTYPE;
  v_retained numeric;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('success', 'failed', 'ambiguous') OR p_actual < 0 OR p_actual::text = 'NaN' THEN
    RAISE EXCEPTION 'Invalid discovery settlement';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace::text, 0));
  SELECT * INTO v_row FROM discovery_reservation WHERE workspace_id = p_workspace AND id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Discovery reservation not found'; END IF;
  v_retained := CASE WHEN p_outcome = 'success' AND p_actual IS NOT NULL THEN p_actual
                     WHEN p_actual IS NOT NULL THEN greatest(v_row.estimate_usd, p_actual)
                     ELSE v_row.estimate_usd END;
  IF v_row.settled_at IS NOT NULL THEN
    IF v_row.outcome <> p_outcome OR v_row.retained_usd <> v_retained THEN
      RAISE EXCEPTION 'Conflicting discovery settlement';
    END IF;
    RETURN;
  END IF;
  UPDATE discovery_budget SET spent_usd = greatest(0, spent_usd + v_retained - v_row.estimate_usd)
    WHERE workspace_id = p_workspace AND scope = v_row.scope AND period = v_row.period;
  UPDATE discovery_reservation SET retained_usd = v_retained, outcome = p_outcome, settled_at = now()
    WHERE id = p_id;
END $$;
