# ms-vibe-security

Automated security test generation and execution framework for web applications, powered by Playwright (deterministic discovery) + LLM (Gemini, test generation).

This is the implementation supporting the thesis project at `vbsec/PROJECT_OVERVIEW.md`. The system takes any target web app, discovers its structure, generates Playwright security tests aligned with OWASP Top 10:2025, and produces an evidence report.

## Architecture

```
Target Web App
      │
      ▼
┌──────────────────────────┐    ┌──────────────────────────┐
│  Stage 1: Discovery       │ → │  Stage 2: Test Generator  │
│  playwright-discovery/    │    │  test-generator/          │
│  - Crawl & extract DOM    │    │  - Summarise discovery    │
│  - Stable locators        │    │  - Planner LLM (1 call)   │
│  - Security components    │    │  - Generator LLMs (N)     │
│  - Deterministic          │    │  - Merge + write specs    │
└──────────────────────────┘    └──────────────────────────┘
                                              │
                                              ▼
                                      Playwright .spec.ts
                                      (ready to run)
```

Full architecture: [`IMPLEMENTATION_GUIDE.md`](./IMPLEMENTATION_GUIDE.md)
Knowledge base: [`test-generator/knowledge/README.md`](./test-generator/knowledge/README.md)

## Repository layout

```
ms-vibe-testing/
├── playwright-discovery/      # Stage 1 — deterministic crawler
├── test-generator/            # Stage 2 — LLM-powered test generation
│   ├── knowledge/attacks/     # OWASP Top 10:2025 attack catalogue (25 attacks)
│   └── examples/              # Tester requirement configs + sample-runs/
├── VC-AWG-Demo_FinalCode/     # Sample target app (NestJS + React finance manager)
├── vbsec/                     # Academic documentation
├── IMPLEMENTATION_GUIDE.md    # Full pipeline design (Vietnamese)
└── TESTING_GUIDE.md           # End-to-end usage instructions
```

## Prerequisites

- **Node.js >= 20** (ESM, native fetch)
- **npm** (or pnpm, but examples use npm)
- **Gemini API key** — get one at https://aistudio.google.com/app/apikey
- ~500 MB free disk for Playwright browsers

## Quick start

### 1. Clone and install

```bash
git clone <repo-url>
cd ms-vibe-testing

# Install dependencies for each sub-project
(cd playwright-discovery && npm install && npx playwright install chromium)
(cd test-generator && npm install)
```

### 2. Configure secrets

```bash
cp playwright-discovery/.env.example playwright-discovery/.env
cp test-generator/.env.example test-generator/.env

# Edit test-generator/.env and set:
#   GEMINI_API_KEY=your-key-here
```

### 3. Run the pipeline

**Stage 1 — Discovery:**

```bash
cd playwright-discovery
npm run dev -- run --config examples/basic.yml
# → output/discovery_YYYYMMDD_HHMMSS.json
```

**Stage 2 — Test generation:**

```bash
cd ../test-generator
npm run dev -- run \
  --discovery ../playwright-discovery/output/discovery_*.json \
  --tester examples/tester-basic.yml
# → output/plan.json, report.json, summary.md, tests/*.spec.ts
```

**Run the generated tests:**

```bash
cd output
npx playwright test tests/
```

## Optional: run the sample target app

The repo ships with a finance management app you can use as a target.

```bash
# Backend (NestJS + MySQL)
cd VC-AWG-Demo_FinalCode/be
cp .env.example .env   # set DB_* and JWT_SECRET
npm install
npm run start:dev      # → http://localhost:8000

# Frontend (React + Vite)
cd ../fe
npm install
npm run dev            # → http://localhost:5173
```

Then point Stage 1 at `http://localhost:5173`.

## Authenticated crawling

For pages behind login, choose one auth strategy in your discovery YAML:

- `mode: form` — let Playwright log in with credentials from `.env`, then save session.
- `mode: storage_state` — point at a pre-built `auth-state.json` (created elsewhere).
- `mode: bearer` — send an Authorization header on every request.

Details in [`playwright-discovery/README.md`](./playwright-discovery/README.md). Note: `auth-state.json` is gitignored because it contains real tokens.

## Common commands

### playwright-discovery

```bash
npm run build         # tsc → dist/
npm run dev -- run    # run from source (tsx)
npm run typecheck
```

### test-generator

```bash
npm run dev -- run       # full pipeline (plan + generate + write)
npm run dev -- plan      # planner only → plan.json
npm run dev -- generate  # generator only (consumes existing plan.json)
npm run dev -- inspect   # show a plan summary, no LLM calls
npm run snapshot         # save current output/ into examples/sample-runs/
npm run typecheck
```

## Security note

This repo had two leaked secrets in earlier history (a Gemini API key and a personal JWT). Both have been **rotated** and **un-tracked**. The `.gitignore` at every level now covers:

- `.env`, `.env.local`, `auth-state.json`, `storage-state.json`
- All JSON / PNG / HAR runtime artefacts in `output/`

If you fork this project, double-check `.gitignore` before any commit that touches credentials.

## Standards alignment

The security knowledge base maps each attack to:

- **OWASP Top 10:2025** (primary) + 2021 (backward trace)
- **OWASP ASVS v5.0.0** (verification requirements)
- **MITRE CWE** (root weakness types)

Currently covers 25 attacks across 6 OWASP 2025 categories. See [`test-generator/knowledge/README.md`](./test-generator/knowledge/README.md) for the full catalogue and intentional gaps.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module './output/writer.js'` | Source files masked by old `output/` gitignore pattern | Already fixed; if reappears, check leading `/` in pattern |
| `Gemini returned empty response` | Rate limit, API key invalid, or empty prompt | Check `.env`, lower `GENERATOR_CONCURRENCY` |
| Discovery returns 1 page only | Login flow not working — discovery hits paywall | Verify `auth.mode` in discovery YAML, regenerate `auth-state.json` |
| `__name is not defined` in browser context | esbuild helper escaping `page.evaluate` | Already shimmed in `browser-extract.ts`; rebuild |
| Tests fail at runtime | Selectors changed on target site | Re-run discovery to refresh locators, then regenerate |

## Further reading

- [`IMPLEMENTATION_GUIDE.md`](./IMPLEMENTATION_GUIDE.md) — Full pipeline design and rationale (Vietnamese)
- [`TESTING_GUIDE.md`](./TESTING_GUIDE.md) — End-to-end usage walkthrough
- [`playwright-discovery/ARCHITECTURE.md`](./playwright-discovery/ARCHITECTURE.md) — Stage 1 internals
- [`test-generator/knowledge/README.md`](./test-generator/knowledge/README.md) — Attack catalogue + schema
- [`.kiro/steering/`](./.kiro/steering/) — Project conventions for AI assistants

## Licence

Academic research project. See [`vbsec/PROJECT_OVERVIEW.md`](./vbsec/PROJECT_OVERVIEW.md) for context.
