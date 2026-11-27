# Frozen MiniLM spatial selection challenger

**Decision. Keep this candidate in shadow evaluation.** It selected five of ten answerable assets and rejected three of four requests that required abstention. It confidently substituted a classic stapler for an unidentified exact replacement. The public gate requires at least eight correct selections and zero false selections on abstention cases.

| Outcome | Frozen MiniLM | Lexical baseline |
|---|---:|---:|
| Correct asset / answerable | 5 / 10 | 7 / 10 |
| Wrong asset / answerable | 0 / 10 | 0 / 10 |
| Missed asset / answerable | 5 / 10 | 3 / 10 |
| Correct abstentions / required | 3 / 4 | 0 / 4 |
| False selections on required abstentions | 1 | 4 |
| All correct decisions | 8 / 14 | 7 / 14 |

Both methods were correct on five cases and wrong on four. The challenger alone was correct on three, the baseline alone on two. The exact two-sided McNemar diagnostic is 1.0. Four synthetic abstention cases cannot establish a production false-selection rate. These are publicly inspectable, team-authored qualification prompts, without an independent human or customer holdout.

## Candidate and execution

Before receiving the new catalog, queries or labels, the challenger operator fixed the model, text fields and two abstention thresholds in `preregistration.json` and recorded its SHA-256 in the working session. Asset title and description are concatenated and embedded. A selection requires cosine similarity ≥ 0.42 and a runner-up margin ≥ 0.055. The comparator uses the public query-only projection. It performs ten asset encodes and fourteen query encodes, all on CPU with pinned ONNX weights and networking disabled. It uses the same Encoder implementation as the earlier retrieval experiment. The category, file path and asset ID are excluded from embedding input. Asset ID provides a stable sort for ties.

| Fingerprint | SHA-256 |
|---|---|
| Preregistered method bytes | `ace0c66d4a03a4d8b8959a541a9943cb501ab0b20531849e30153d7a52be3bcb` |
| Sealed prediction file bytes | `883b18058276fbbda6f29b70263ad2f6b086460889fefa80d3c8ba9c5c954dc3` |
| Query-only projection bytes | `a5c60bc2cb87dd984b13b6d0b1c19086908edf0d3bfb589f1f92f9c55ec79c41` |
| Catalog bytes | `66381f7e48784a6c8e63c0e6dd67173c70a52e2f5b30746bdd0d3db8b39d3f67` |
| Public suite, canonical | `a3b24f9fc702b0f7555150bf57ef12ffbb4cb06d6389e47c50df3bc500defa43` |
| Scorer bytes | `9eb7a152c8bbe41e81341acaa61f7c39da82bc52533cf0c4f6401f3fb5388427` |

The first suite was evaluated with an author/challenger split: predictions were sealed before the challenger operator saw its labels. A reviewer found that the first wording for c12 allowed either stapler while the key demanded abstention. The author amended c12 to require an exact replacement with missing identity. The same operator reran the unchanged frozen method after viewing the original labels. The reported results are therefore a corrected public assay, not a fresh blinded holdout. The first suite digest was `ddd2ddc09c3e1d98b1bee719ccf41f635743077dfa8095292e4a4a1ed3fba6d1` and the first prediction file hash was `5419e60cd826324af893a1f2f93caa04ef32cfdd04661d0095788b8e1e7424e0`. First-run counts (superseded) were 5/10 and 4/4. Both runs sealed submissions before canonical scoring. These timestamps and workflow claims are operator records, not a third-party attestation. A separate Python implementation recomputed both methods’ confusion counts and the qualification decision and checked the canonical Node receipts.

## Every failed case

| Case | Expected asset | First-ranked asset | Cosine / margin | Failure |
|---|---|---|---:|---|
| c03 | Strip-cut shredder | Magnetic board eraser | .243 / .003 | Both thresholds failed |
| c05 | Long-arm stapler | Long-arm stapler | .378 / .012 | Both thresholds failed |
| c06 | Two-hole desk punch | Long-arm stapler | .425 / .048 | Margin failed |
| c07 | Desktop calculator | Desktop calculator | .375 / .069 | Similarity failed |
| c08 | Handheld barcode scanner | Handheld barcode scanner | .251 / .056 | Similarity failed |
| c12 | Abstain, exact model unknown | Classic desktop stapler | .511 / .070 | Both thresholds passed with no evidence of exact identity |

Keep these thresholds fixed in this comparison. An explicit evidence check for exact-identity requirements and a capability-aware retriever developed on separate cases are defensible next candidates. Judge any promotion on fresh prompts, including unseen assets and ambiguity.

## Reproduce

Requires Python 3.12 with the versions in `requirements.txt`, Node, and the two model files named in `encoder.py`. The pinned model revision is `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`. Download `onnx/model_quint8_avx2.onnx` and `tokenizer.json` into the same local directory from the [Apache-2.0 upstream repository](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/tree/1110a243fdf4706b3f48f1d95db1a4f5529b4d41). The predictor verifies both SHA-256 hashes before loading either file.

Run these commands from the directory containing this README. Supply absolute paths to the public challenge, local model directory, and a fresh output directory. The predictor creates the output directory and refuses to overwrite predictions.

```shell
sha256sum -c preregistration.sha256
python predict.py --catalog "$SUITE/catalog.json" --prompts "$SUITE/prompts.json" \
  --model-dir "$MODEL_DIR" --output-dir "$OUT"
sha256sum "$OUT/predictions.json"
node "$SUITE/verify.mjs" score "$OUT/predictions.json" > "$OUT/canonical-receipt.json"
node "$SUITE/verify.mjs" baseline > "$OUT/baseline.json"
node "$SUITE/verify.mjs" score "$OUT/baseline.json" > "$OUT/canonical-baseline.json"
python compare.py --suite "$SUITE" --run "$OUT" > "$OUT/comparison.json"
```

`run/predictions.json` is the data-only submission. Diagnostics retain the first and second asset, scores and threshold decisions. Canonical receipts and the Python comparison are included in `run/`.
