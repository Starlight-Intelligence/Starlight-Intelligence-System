# Can a scene builder pick the right asset and know when to ask?

A community retrieval challenge for a simulated checkout and office. Match each English request to one of **10 real NVIDIA USDCraft-10K object IDs**, or choose `null` when the evidence cannot justify a unique match. Anyone can submit predictions from a local model, a search index, a rule set or their own judgment. The verifier reads JSON data. Participants run their own candidate on their own infrastructure.

Try it as the second builder. Start with [the catalog](catalog.json) and [the prompts](prompts.json). Write down the candidate version and abstention rule before reading [the public answer key](cases.json). Save your predictions before scoring. Share disagreements with a case ID and a source that supports a different label.

## Run and contribute

Use Node 22 or newer. The challenge runs offline from a checkout with no package installation or model download. Run these commands from this directory.

```sh
node --test verify.test.mjs
node verify.mjs baseline > baseline-predictions.json
node verify.mjs score baseline-predictions.json
node verify.mjs always-select > adverse-predictions.json
node verify.mjs score adverse-predictions.json
node verify.mjs score my-predictions.json > my-receipt.json
```

A submission is a JSON array with one two-element pair per prompt. A pair looks like `["c01","ds_R302_01"]` or `["c11",null]`. Supply exactly 14 unique case IDs from the public prompts. A selection must be a catalog ID or JSON null. Row order is immaterial. The CLI rejects duplicate, missing or unknown case IDs, extra fields, unknown asset IDs and malformed input. Valid submissions receive a receipt even when they score below threshold. Malformed submissions exit nonzero.

Use the **Community reproduction** issue form in this repository's new-issue chooser. Include the exact repository commit, challenge ID, candidate identity and settings, prediction file, suite and prediction hashes, command, Node version, and observed differences. Include the receipt or a link to its public copy. Another builder can reproduce scoring directly from the submitted JSON. Only a separate rerun of the candidate establishes that the predictions themselves reproduce. The same person running the same command twice supplies one contributor's evidence.

## Frozen cases and scoring

The suite pairs ten positive requests with four cases requiring abstention. Each catalog object has a positive example. Requests include choosing the receipt printer over the inkjet, the long-arm booklet stapler over the compact stapler, and the board eraser over its writing surface.

For c04, the participant catalog identifies a unique classic black desktop stapler. The answer-key explanation also mentions the long-arm model’s blue finish. NVIDIA describes it as blue powder-coated steel in its original design prompt. [Pinned long-arm stapler metadata](https://huggingface.co/datasets/nvidia/USDCraft-10K/blob/6fbffb56c443237ddae9f6c7a05b72263fd1469e/rigid/office_commercial_hospitality/R307_stapler/02_long_arm_stapler/meta.json)

| Negative case | Why a single selection would be false |
| --- | --- |
| Unspecified printer | The inkjet and the thermal receipt printer both fit. |
| Exact replacement for an unidentified broken stapler | Two models fit the product class. The order omits which model broke. |
| Ceiling-mounted projector | The subset contains no projector. |
| Certified waterproof print | The metadata supplies no such certification for either printer. |

**Public qualification requires at least 8 of 10 correct positive selections and zero false selections on the 4 abstention cases.** The cutoff is a declared fixture policy. The receipt names misses, wrong selections and false selections separately and lists every expected and predicted ID.

| Observed method | Correct / 10 positive | Wrong / missed positive | Correct / 4 abstentions | Public verdict |
| --- | ---: | ---: | ---: | --- |
| Word overlap weighted by inverse document frequency | 7 | 0 / 3 | 0 | Below threshold |
| Same ranker forced to select, including ties and zero overlap | 7 | 3 / 0 | 0 | Below threshold |

The baseline missed “turned into ribbons,” the arithmetic request and the package-code request. Both methods selected an object in all four abstention cases. This is a failure worth reproducing. A missing capability can still produce strong keyword overlap. [Baseline source](baseline.mjs) · [Recorded measurements and failure IDs](reference-results.json)

### What the local model changed

We froze a quantized MiniLM retriever and two abstention thresholds before the
challenger operator saw the cases. On the corrected public suite it selected
**5/10** answerable assets and correctly declined **3/4** insufficient requests.
The lexical baseline scored **7/10** and **0/4**. The embedding model selected a
classic stapler when the user required an exact replacement and the identity of
the original was missing. Neither route clears the public bar. Preserve the
candidate as a suggestion for a builder to inspect. A grounded clarification
is useful here before committing anything to the scene.

[Candidate, counterexamples and CPU reproduction instructions](minilm/README.md) ·
[Machine-readable comparison](minilm/run/comparison.json)

## Case correction before publication

An earlier c12 prompt explicitly allowed either stapler while its label demanded abstention. The maintainer invalidated that suite, including its receipts (SHA-256 `ddd2ddc09c3e1d98b1bee719ccf41f635743077dfa8095292e4a4a1ed3fba6d1`). The revised c12 requires the exact replacement for an unidentified broken unit. The other thirteen prompts and all thresholds remain as originally frozen. The current suite digest is `a3b24f9fc702b0f7555150bf57ef12ffbb4cb06d6389e47c50df3bc500defa43`. Compare candidates only on this revision.

## Evidence and scope

The receipt hashes the original prediction file, predictions sorted by case ID, verifier bytes and the frozen catalog, prompts, scoring policy and answer key. The suite hash covers canonical JSON with recursively sorted object keys and preserved array order. `suite.lock.json` pins that hash. The file hash distinguishes byte-for-byte submissions. The canonical prediction hash permits whitespace or row-order differences. Hashes support a rerun against a trusted checkout. They do not authenticate authorship.

One author curated these English prompts and labels. The public development set is small, intentionally contains near-neighbors, and is open to memorization. It measures selection from text metadata. It records no evidence of asset loading, joint correctness, rendering, simulation performance, throughput or production generalization. Generic equipment requests in this suite require clarification when the choice depends on a missing job detail or a specific unrecorded identity. A real order that explicitly permits interchangeable items calls for a different scoring rule.

This is a public **retrieval/datasets qualification** exercise. A production routing decision requires an independently held-out case set, independently authored labels and a separate review of integration, rights and operating cost. Keep holdout prompts and answers out of this directory. The pass verdict has no authority to promote a route or trigger a paid job.

NVIDIA's upstream selection and the original Starlight descriptions have separate provenance. The pinned manifest, license text, changes and attribution are documented in [NOTICE.md](NOTICE.md). To inspect a specific object, combine the pinned dataset tree URL with its `upstream_path`; the publisher's PhysX file digest is supplied for later binary validation.
