-- Run as an operator with full SELECT visibility. Return counts only.
-- A missing migration or partial RLS visibility must fail the read.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL row_security = off;
WITH entries AS (
  SELECT l.*, sum(amount) OVER (
    PARTITION BY user_id ORDER BY id ROWS UNBOUNDED PRECEDING
  ) AS running_balance
  FROM public.credit_ledger l
), balances AS (
  SELECT user_id, sum(amount) AS available
  FROM entries GROUP BY user_id
), holds AS (
  SELECT r.id, r.amount, r.status, r.charged,
    count(e.id) FILTER (WHERE e.kind = 'reserve') AS debit_count,
    coalesce(sum(-e.amount) FILTER (WHERE e.kind = 'reserve'), 0) AS debited,
    count(e.id) FILTER (WHERE e.kind = 'reservation_refund') AS return_count,
    coalesce(sum(e.amount) FILTER (WHERE e.kind = 'reservation_refund'), 0) AS returned,
    bool_or(e.user_id <> r.user_id) AS wrong_owner,
    CASE r.status WHEN 'released' THEN r.amount
                  WHEN 'committed' THEN r.amount - r.charged ELSE 0 END AS expected_return
  FROM public.credit_reservations r LEFT JOIN entries e ON e.reservation_id = r.id
  GROUP BY r.id
), grants AS (
  SELECT s.event_id
  FROM public.stripe_events s LEFT JOIN entries e ON e.stripe_event_id = s.event_id
  GROUP BY s.event_id
  HAVING count(e.id) <> 1 OR bool_or(e.amount <> s.credits OR e.user_id <> s.user_id)
)
SELECT
  (SELECT count(*) FROM public.credit_accounts) AS accounts,
  (SELECT count(*) FROM entries) AS postings,
  (SELECT count(*) FROM holds WHERE status = 'open') AS open_holds,
  (SELECT count(*) FROM entries WHERE running_balance <> balance_after) AS posting_mismatches,
  (SELECT count(*) FROM public.credit_accounts a LEFT JOIN balances b USING (user_id)
    WHERE a.balance <> coalesce(b.available, 0)) AS account_mismatches,
  (SELECT count(*) FROM holds WHERE wrong_owner OR debit_count <> 1 OR debited <> amount
    OR returned <> expected_return OR return_count <> (expected_return > 0)::int) AS hold_mismatches,
  (SELECT count(*) FROM grants) AS grant_mismatches;
COMMIT;
