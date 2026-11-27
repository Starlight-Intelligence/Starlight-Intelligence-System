"""Generate sealed predictions using preregistered MiniLM. No scorer or labels are loaded."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def disallow_network(event, args):
    if event in {"socket.connect", "socket.getaddrinfo", "socket.sendto"}:
        raise RuntimeError("Prediction requires only local files.")


sys.addaudithook(disallow_network)
from encoder import Encoder, FILES, MODEL_ID, REVISION
import numpy as np

METHOD_SHA256 = "ace0c66d4a03a4d8b8959a541a9943cb501ab0b20531849e30153d7a52be3bcb"
HERE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    with path.open("x", encoding="utf-8") as target:
        json.dump(value, target, ensure_ascii=False, indent=2, allow_nan=False)
        target.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("catalog", "prompts", "model-dir", "output-dir"):
        parser.add_argument("--" + arg, type=Path, required=True)
    args = parser.parse_args()

    method_path = HERE / "preregistration.json"
    if digest(method_path) != METHOD_SHA256:
        raise ValueError("Method hash mismatch")
    method = json.loads(method_path.read_text())
    limits = method["abstention"]
    for remote, sha in FILES.items():
        if digest(args.model_dir / Path(remote).name) != sha:
            raise ValueError(f"Model hash mismatch: {remote}")

    assets = sorted(json.loads(args.catalog.read_text())["assets"], key=lambda a: a["id"])
    prompts = json.loads(args.prompts.read_text())
    if any(set(row) != {"id", "intent"} for row in prompts):
        raise ValueError("Expected query-only projection with ID and intent")
    if len({row["id"] for row in assets}) != len(assets) or not assets:
        raise ValueError("Expected at least one asset with unique ID")
    if len({p["id"] for p in prompts}) != len(prompts) or not prompts:
        raise ValueError("Expected at least one prompt with unique ID")
    encoder = Encoder(args.model_dir)
    texts = [f'{a["title"]}. {a["description"]}' for a in assets]
    corpus = np.array([encoder.encode(text) for text in texts])
    predictions, details = [], []
    for p in prompts:
        scores = corpus @ encoder.encode(p["intent"])
        ranking = sorted(range(len(assets)), key=lambda i: (-scores[i], assets[i]["id"]))
        best = ranking[0]
        second = ranking[1] if len(ranking) > 1 else None
        margin = float(scores[best]) - float(scores[second]) if second is not None else None
        above_min = float(scores[best]) >= limits["min_top_cosine_inclusive"]
        above_gap = margin is None or margin >= limits["min_top_minus_second_inclusive"]
        prediction = assets[best]["id"] if above_min and above_gap else None
        predictions.append([p["id"], prediction])
        details.append({"id": p["id"], "first": assets[best]["id"], "first_score": float(scores[best]),
                        "second": assets[second]["id"] if second is not None else None,
                        "second_score": float(scores[second]) if second is not None else None,
                        "margin": margin, "above_min": above_min, "above_gap": above_gap})
    args.output_dir.mkdir(parents=True, exist_ok=True)
    prediction_file = args.output_dir / "predictions.json"
    write(prediction_file, predictions)
    report = {"method_sha256": METHOD_SHA256, "catalog_sha256": digest(args.catalog),
              "prompts_sha256": digest(args.prompts), "prediction_sha256": digest(prediction_file),
              "model": MODEL_ID, "revision": REVISION, "files_sha256": FILES,
              "encoder_sha256": digest(HERE / "encoder.py"), "predictor_sha256": digest(Path(__file__)),
              "local_forward_passes": encoder.calls, "cases": details}
    write(args.output_dir / "diagnostics.json", report)
    print(f"sealed {len(predictions)} predictions  {report['prediction_sha256']}")


if __name__ == "__main__":
    main()
