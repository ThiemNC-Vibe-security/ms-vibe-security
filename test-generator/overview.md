# Test Generator — Overview

**Goal:** Convert a website's discovery model + tester requirement + security knowledge into runnable Playwright security test scripts, at scale.

**Approach:** Plan-then-Generate pipeline (Pattern 3). Avoids dumping the whole discovery into a single LLM prompt; instead plans tests from a compressed summary, then generates each test in parallel with only the relevant context.

---

## Position in the larger system

```
playwright-discovery   →   discovery_*.json
gemini-api (legacy)    →   (old single-shot generator, will be deprecated)

THIS PROJECT (test-generator):
  discovery_*.json
        +
  tester-requirement.yml
        +
  knowledge/*.yml            →   Playwright .spec.ts files
```

---

## Three inputs

### 1. Discovery JSON (from playwright-discovery)
Structured page model with real Playwright locators, forms, inputs, security components. Already produced by the discovery engine.

### 2. Tester Requirement (YAML)
The tester decides scope and priorities. Examples:

```yaml
target_discovery: ./discovery_20260626.json
scope:
  include_page_types: [login, registration, contact, search, payment]
  exclude_pages: [/admin, /logout]
priorities:
  high:   [sql_injection, xss_reflected, broken_auth]
  medium: [csrf, open_redirect]
  low:    [rate_limit, password_complexity]
limits:
  max_tests: 50
  max_tests_per_page: 10
test_config:
  browsers: [chromium]
  parallel: 4
credentials:
  valid:   { user: ${VALID_USER},   pass: ${VALID_PASS} }
  invalid: { user: wrong@x.com,     pass: wrong }
```

### 3. Security Knowledge (YAML)
Reusable per-attack definitions. Plugged in like a library.

```yaml
# knowledge/attacks/sql-injection.yml
id: sql_injection
owasp: A03:2021
applies_to:
  - login_form
  - search_box
  - generic_form
  - url_param
payloads:
  - "' OR '1'='1"
  - "'; DROP TABLE--"
  - "1' AND SLEEP(5)--"
detection:
  - text_response_contains_sql_error
  - response_time_above_threshold
  - http_500_response
test_template_hints:
  - inject_payload_into_each_input
  - assert_no_sql_error_leaked
  - assert_response_time_normal
```

---

## Pipeline

```
                  ┌──────────────────────────────────────────────┐
                  │  Input loaders                                │
                  │  ─────────────                                │
                  │  • discovery.json                             │
                  │  • tester-requirement.yml                     │
                  │  • knowledge/*.yml                            │
                  └────────────────────┬─────────────────────────┘
                                       │
                  ┌────────────────────▼─────────────────────────┐
                  │  Summary Builder (Node, no LLM)               │
                  │  Compress discovery → ~10% size               │
                  │  Keep: page IDs, types, form IDs, primary     │
                  │        selectors, security components         │
                  │  Drop: alternates, empty arrays, navigation   │
                  │        details, nav items                     │
                  └────────────────────┬─────────────────────────┘
                                       │ DiscoverySummary
                                       │
                  ┌────────────────────▼─────────────────────────┐
                  │  STEP 1: Planner LLM                          │
                  │  Input:  summary + tester req + knowledge     │
                  │          (categories only, no payloads)       │
                  │  Output: TestPlan {                           │
                  │    test_cases: [                              │
                  │      { id, target: {page_id, form_id?},       │
                  │        attack_id, priority, why }             │
                  │    ]                                          │
                  │  }                                            │
                  │  One call. Budget: ~5-15K tokens.             │
                  └────────────────────┬─────────────────────────┘
                                       │
                       (optional: tester review / filter)
                                       │
                  ┌────────────────────▼─────────────────────────┐
                  │  STEP 2: Generator (parallel, N LLM calls)    │
                  │  For each TestCase:                           │
                  │     context = page detail (full from discovery)│
                  │             + matching attack definition       │
                  │             + payloads                         │
                  │             + test config (creds, base_url)    │
                  │     output  = 1 Playwright test (TS code)      │
                  │  Run with concurrency limit (default 5).      │
                  │  Budget per call: ~2-5K tokens.               │
                  └────────────────────┬─────────────────────────┘
                                       │ TestArtifact[]
                                       │
                  ┌────────────────────▼─────────────────────────┐
                  │  STEP 3: Merger + Writer                      │
                  │  Group by page → write to .spec.ts file       │
                  │  Insert common setup (base URL, fixtures)     │
                  │  Optional: prettier format + tsc check        │
                  └────────────────────┬─────────────────────────┘
                                       │
                                       ▼
                  output/
                  ├── plan.json
                  ├── tests/
                  │   ├── login.spec.ts
                  │   ├── contact.spec.ts
                  │   └── ...
                  └── report.md          (summary of what was generated)
```

---

## Data types

### TestPlan
```ts
interface TestPlan {
  metadata: {
    discovery_source: string;
    generated_at: string;
    planner_model: string;
  };
  test_cases: TestCase[];
}

interface TestCase {
  id: string;                   // e.g. "TC-001"
  target: {
    page_url: string;
    page_id: string;
    form_id?: string;
    input_selector?: string;
  };
  attack_id: string;            // matches knowledge/attacks/<id>.yml
  attack_class: string;         // e.g. "sql_injection"
  priority: 'high' | 'medium' | 'low';
  why: string;                  // 1-line rationale (from planner LLM)
  hints?: string[];             // optional planner notes for generator
}
```

### KnowledgeAttack
```ts
interface KnowledgeAttack {
  id: string;
  owasp: string[];
  applies_to: string[];          // component types it targets
  payloads: string[];
  detection: string[];           // detection rule IDs
  test_template_hints: string[];
  description?: string;
}
```

### TestArtifact
```ts
interface TestArtifact {
  test_case_id: string;
  page_id: string;
  filename: string;
  code: string;                  // raw TS source
  imports?: string[];
  fixtures?: string[];
}
```

---

## Prompting strategy

### Planner prompt (system + user)
- System: "You are a security test planner. Given an application summary, tester priorities, and a catalogue of attack types, produce a focused test plan. Return JSON only."
- User: `{summary} + {tester_req} + {knowledge_categories}`
- Response: JSON `TestPlan`
- Validation: zod parse + retry once on malformed JSON

### Generator prompt (one per TestCase)
- System: "You are a senior QA engineer. Generate ONE Playwright test in TypeScript for this test case. Use the EXACT selectors provided. Output ONLY TypeScript code, no markdown."
- User: structured block of `test_case + page_detail + attack_definition + test_config`
- Response: raw TS code
- Validation: parse with TypeScript compiler API; if syntactically invalid, ask LLM to fix once

---

## Token economics

For a 50-page site:

| Step | Tokens (approx) | Calls |
|---|---|---|
| Summary build | 0 (Node-side) | 0 |
| Planner | 5-15K input, 3-5K output | 1 |
| Generator (per test) | 3-5K input, 1-2K output | N (=50) |
| **Total** | **~250K** | **51** |

vs single-shot pattern: ~500K-1M tokens in one prompt, lower quality.

Parallelism cuts wall-clock time: 50 generator calls at concurrency 5 ≈ 10 batches.

---

## Cases handled / not handled

### Handled (MVP)
- One test per form per attack class
- Built-in attack library: XSS, SQLi, CSRF, no rate limit, broken auth, open redirect, IDOR
- Multi-page sites
- Form-based + URL-param targets
- Headed/headless config passthrough to Playwright

### Not handled (yet)
- Multi-step workflows (e.g. login → action → assert)
- Authentication setup in generated tests (assumes stored state)
- Custom assertions beyond patterns in knowledge
- Tests that require seeded backend data
- Self-healing of failing generated tests
- Test deduplication across pages

---

## Failure modes & mitigations

| Failure | Mitigation |
|---|---|
| Planner returns invalid JSON | zod retry once with strict instruction |
| Generator returns non-TS or markdown | strip fences, try tsc, ask LLM to fix once |
| LLM hallucinates a selector | All selectors come from discovery JSON, planner refers by id only; generator pastes verbatim |
| LLM hallucinates an endpoint | Future: when Phase 2.0 of discovery adds endpoints, generator uses them; for now generator asserts on UI only |
| LLM exceeds token budget | Concurrency limit + retry; summary view is < 10% of raw discovery |
| Generated test fails to run | Linter step catches obvious issues; runtime errors surfaced in report.md |

---

## CLI surface

```bash
# Full pipeline
generator run \
  --discovery ./playwright-discovery/output/discovery_*.json \
  --tester ./examples/tester-basic.yml \
  --knowledge ./knowledge \
  --out ./output

# Step-by-step (useful during dev)
generator plan      --discovery ... --tester ... --knowledge ...  → plan.json
generator generate  --plan plan.json --discovery ... --knowledge ... → tests/
generator merge     --tests tests/  → final .spec.ts files

# Inspect/validate
generator inspect  --plan plan.json                # show summary
generator validate --tests-dir tests/              # tsc + playwright lint
```

---

## File layout

```
test-generator/
├── overview.md
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── knowledge/                  # built-in security knowledge
│   ├── README.md
│   └── attacks/
│       ├── sql-injection.yml
│       ├── xss-reflected.yml
│       ├── csrf.yml
│       ├── broken-auth.yml
│       ├── open-redirect.yml
│       ├── idor.yml
│       └── rate-limit.yml
├── examples/
│   ├── tester-basic.yml
│   ├── tester-focused.yml
│   └── tester-full.yml
└── src/
    ├── cli.ts
    ├── pipeline.ts                # orchestrates plan→generate→merge
    ├── config/
    │   └── schema.ts              # zod for tester requirement
    ├── input/
    │   ├── discovery-loader.ts
    │   ├── tester-loader.ts
    │   └── knowledge-loader.ts
    ├── summary/
    │   └── builder.ts             # compress discovery JSON
    ├── planner/
    │   ├── planner.ts
    │   └── prompt.ts
    ├── generator/
    │   ├── generator.ts
    │   ├── prompt.ts
    │   └── context.ts             # builds the per-test context
    ├── merger/
    │   └── merger.ts              # group by page → spec files
    ├── llm/
    │   └── gemini-client.ts
    ├── output/
    │   ├── writer.ts
    │   └── report.ts              # report.md
    ├── types.ts                   # TestPlan, TestCase, etc.
    └── utils/
        ├── logger.ts
        └── retry.ts
```

---

## Roadmap

### v0.1 (MVP, this iteration)
- All three pipeline steps working end-to-end
- 5-7 built-in attacks
- Per-form, per-attack test generation
- Output: working Playwright spec files

### v0.2
- Authentication-aware tests (use storage state)
- Multi-step workflow tests
- Test deduplication
- Linter / formatter pass on output

### v0.3
- Self-heal: rerun failing generated tests, regenerate with error context
- Caching: incremental regeneration when discovery changes
- Report.md with coverage analysis

### v0.4
- RAG mode for very large sites (1000+ pages)
- Multi-LLM support (Claude, GPT-4)
- Custom knowledge plugins
