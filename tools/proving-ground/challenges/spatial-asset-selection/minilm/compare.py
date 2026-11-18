"""Independent, post-seal accounting; cross-checks the canonical Node receipts."""

import argparse
from collections import Counter
import hashlib
import json
from math import comb
from pathlib import Path

def load(path):
    return json.loads(path.read_text())

def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def calculate(labels, submission, receipt):
    pairs = load(submission)
    predictions = dict(pairs)
    if len(pairs) != len(predictions) or predictions.keys() != labels.keys():
        raise ValueError("Submission and expected IDs disagree")
    counted = dict.fromkeys(["correct_selection", "wrong_selection", "missed_selection",
                             "correct_abstention", "false_selection_on_abstain"], 0)
    correct = {}
    for identifier, expected in labels.items():
        pick = predictions[identifier]
        correct[identifier] = pick == expected
        if expected is None:
            outcome = "correct_abstention" if correct[identifier] else "false_selection_on_abstain"
        elif pick is None:
            outcome = "missed_selection"
        else:
            outcome = "correct_selection" if correct[identifier] else "wrong_selection"
        counted[outcome] += 1
    if receipt["metrics"] != counted or receipt["submission_file_sha256"] != sha256(submission):
        raise ValueError("Canonical scorer or submission mismatch")
    return counted, correct

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", type=Path, required=True)
    parser.add_argument("--run", type=Path, required=True)
    args = parser.parse_args()
    folder = args.run
    suite = load(args.suite / "cases.json")
    labels = {item["id"]: item["expected"] for item in suite["cases"]}
    candidate_receipt = load(folder / "canonical-receipt.json")
    baseline_receipt = load(folder / "canonical-baseline.json")
    pinned = load(args.suite / "suite.lock.json")["suite_sha256"]
    for receipt in (candidate_receipt, baseline_receipt):
        if (receipt["suite_sha256"] != pinned or
                receipt["verifier_sha256"] != sha256(args.suite / "verify.mjs")):
            raise ValueError("Receipt suite or verifier fingerprint mismatch")
    c, c_ok = calculate(labels, folder / "predictions.json", candidate_receipt)
    b, b_ok = calculate(labels, folder / "baseline.json", baseline_receipt)
    for metrics, receipt in ((c, candidate_receipt), (b, baseline_receipt)):
        passed = (metrics["correct_selection"] >= suite["minimum_correct_selections"] and
                  metrics["false_selection_on_abstain"] <= suite["maximum_false_selections_on_abstain"])
        if passed != (receipt["verdict"] == "qualified_on_public_cases"):
            raise ValueError("Disagreement on public qualification")
    paired = Counter((c_ok[k], b_ok[k]) for k in labels)
    wins, losses = paired[(True, False)], paired[(False, True)]
    discordant = wins + losses
    exact = min(1.0, 2*sum(comb(discordant, i) for i in range(min(wins, losses)+1))/2**discordant)
    diagnostics = {r["id"]: r for r in load(folder / "diagnostics.json")["cases"]}
    errors = []
    for i in labels:
        if c_ok[i]:
            continue
        d = diagnostics[i]
        errors.append({"id": i, "expected": labels[i], "ranked_first": d["first"],
                       "best_cosine": d["first_score"], "margin": d["margin"],
                       "failed_thresholds": [key for key, accepted in (("similarity", d["above_min"]),
                           ("margin", d["above_gap"])) if not accepted]})
    data = {"public_cases": len(labels), "candidate": c, "baseline": b,
            "candidate_correct": sum(c_ok.values()), "baseline_correct": sum(b_ok.values()),
            "paired": {"both_correct": paired[(True,True)], "both_wrong": paired[(False,False)],
                       "challenger_only": wins, "baseline_only": losses,
                       "exact_two_sided_mcnemar_p_descriptive": exact},
            "candidate_errors": errors, "verdict": candidate_receipt["verdict"]}
    print(json.dumps(data, indent=2))

if __name__ == "__main__":
    main()
