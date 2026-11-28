"""Run with python3 and PostgreSQL initdb/postgres on PATH, as a non-root user."""
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
MIGRATION = HERE.parents[1] / "supabase/migrations/20261127043000_credits_ledger.sql"
REPORT = (HERE / "reconcile.sql").read_text()
BUYER = "00000000-0000-4000-8000-000000000001"


class ReconciliationTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.data = Path(tmp.name) / "data"
        subprocess.run(["initdb", "-D", self.data, "-U", "credit_test", "-A", "trust",
                        "--no-locale"], check=True, stdout=subprocess.DEVNULL)
        self.sql("""
            CREATE ROLE anon;
            CREATE ROLE authenticated;
            CREATE ROLE service_role BYPASSRLS;
            CREATE SCHEMA auth;
            CREATE TABLE auth.users(id uuid PRIMARY KEY);
            CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
        """)
        self.sql(MIGRATION.read_text())

    def sql(self, script, expected_error=None):
        # Standalone mode accepts one multiline command group and opens no socket.
        command = "\n".join(line for line in script.splitlines() if line.strip()) + "\n\n"
        result = subprocess.run(["postgres", "--single", "-j", "-D", self.data, "postgres"],
                                input=command, capture_output=True, text=True, check=True)
        if expected_error:
            self.assertRegex(result.stderr, expected_error)
        else:
            self.assertNotRegex(result.stderr, r"(ERROR|FATAL|PANIC):")
        return result.stdout

    def report(self, **expected):
        observed = dict(re.findall(r'\d+: (\w+) = "(\d+)"', self.sql(REPORT)))
        baseline = dict(accounts=0, postings=0, open_holds=0, posting_mismatches=0,
                        account_mismatches=0, hold_mismatches=0, grant_mismatches=0)
        self.assertEqual({k: int(v) for k, v in observed.items()}, baseline | expected)

    def test_lifecycle_and_source_discrepancies(self):
        self.report()
        grant = f"""SELECT public.grant_from_stripe_event('evt_example001',
                    'checkout.session.completed','{BUYER}',100,'fixture',false);"""
        reserve = f"SELECT public.reserve_credits('{BUYER}',60,'fixture-hold');"
        self.sql(f"INSERT INTO auth.users VALUES ('{BUYER}');")
        self.sql(grant, "credits are switched off")
        self.sql("UPDATE public.credit_controls SET enabled=true;")
        self.sql(grant + grant + reserve + reserve)
        self.report(accounts=1, postings=2, open_holds=1)
        settle = """SELECT public.commit_reservation(id,40) FROM public.credit_reservations
                    WHERE idempotency_key='fixture-hold';"""
        release = """SELECT public.release_reservation(id) FROM public.credit_reservations
                     WHERE idempotency_key='fixture-release';"""
        self.sql(settle + settle + f"SELECT public.reserve_credits('{BUYER}',15,'fixture-release');"
                 + release + release)
        self.report(accounts=1, postings=5)
        self.assertIn('balance = "60"', self.sql("SELECT balance FROM public.credit_accounts;"))
        # Alter only disposable source records to verify independent discrepancy counters.
        self.sql("""UPDATE public.credit_accounts SET balance=61;
                    UPDATE public.credit_reservations SET charged=39 WHERE status='committed';
                    UPDATE public.stripe_events SET credits=101;""")
        self.report(accounts=1, postings=5, account_mismatches=1, hold_mismatches=1,
                    grant_mismatches=1)

    def test_posting_balance_and_missing_grant(self):
        self.sql(f"""INSERT INTO auth.users VALUES ('{BUYER}');
                     INSERT INTO public.credit_accounts(user_id,balance) VALUES ('{BUYER}',10);
                     INSERT INTO public.stripe_events(event_id,event_type,user_id,pack_id,credits,livemode)
                     VALUES ('evt_fixture01','checkout.session.completed','{BUYER}','fixture',10,false),
                            ('evt_fixture02','checkout.session.completed','{BUYER}','fixture',5,false);
                     INSERT INTO public.credit_ledger(user_id,kind,amount,balance_after,stripe_event_id)
                     VALUES ('{BUYER}','grant',10,11,'evt_fixture01');""")
        self.report(accounts=1, postings=1, posting_mismatches=1, grant_mismatches=1)

    def test_partial_visibility_fails_closed(self):
        self.sql("SET ROLE authenticated;\n" + REPORT, r"ERROR:.*(permission denied|row.level security)")


if __name__ == "__main__":
    unittest.main()
