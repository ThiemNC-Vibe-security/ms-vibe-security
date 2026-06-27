# Sample Runs

Curated snapshots of test-generator pipeline runs, kept here as **evidence for the thesis** and regression reference.

Each subfolder is one snapshot:

```
sample-runs/
├── 2026-06-27-vc-awg-baseline/
│   ├── plan.json
│   ├── report.json
│   ├── summary.md
│   ├── failures.json          (only if any test failed generation)
│   ├── tests/                 (the generated Playwright spec files)
│   │   └── *.spec.ts
│   └── README.md              (context, observations, command used)
└── ...
```

## Why this folder exists

The pipeline's `output/` folder is git-ignored for `*.json` files because runs are non-deterministic and noisy. This folder is the **explicit, manually curated** subset of runs worth keeping.

Use it for:
- **Thesis demo** — point reviewers at a known-good run
- **Regression** — compare a new run against a baseline (did refactoring break planning?)
- **Failure case studies** — preserve interesting LLM mistakes for analysis

## How to add a new snapshot

After a pipeline run produces an `output/` you want to keep:

```bash
cd test-generator

# Option A: auto-name from the discovery source
npm run snapshot

# Option B: custom slug
npm run snapshot -- vc-awg-baseline
```

This creates `sample-runs/YYYY-MM-DD-<slug>/` with:
- All JSON + markdown artefacts from `output/`
- The full `tests/` folder
- A starter `README.md` pre-filled with run metadata

Then:

1. Edit `README.md` — fill in the **Observations** section (what was interesting, what to look at).
2. Commit it.

```bash
git add examples/sample-runs/<folder>
git commit -m "snapshot: 2026-06-27 vc-awg-baseline"
```

## Conventions

- Folder name: `YYYY-MM-DD-<short-slug>` (sortable, descriptive).
- One subject per snapshot — don't bundle multiple unrelated runs.
- Keep observations factual; speculation in a separate section if needed.
- Don't manually edit the JSON files (they're audit artefacts). Edit only the `README.md`.

## When NOT to snapshot

- Failing runs that are just due to missing API key / bad config → debug locally, don't commit.
- Quick smoke tests during development.
- Runs against private staging environments without scrubbing PII.
