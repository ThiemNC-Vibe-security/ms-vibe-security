# Test Generator

Plan-then-Generate pipeline that turns a website discovery JSON + tester requirement + security knowledge into runnable Playwright security tests.

See [`overview.md`](./overview.md) for the architecture.

## Quick start

```bash
# Install
npm install
cp .env.example .env   # add GEMINI_API_KEY

# Full pipeline (one shot)
npm run dev -- run \
  --discovery ../playwright-discovery/output/discovery_*.json \
  --tester ./examples/tester-basic.yml \
  --out ./output

# Or step by step
npm run dev -- plan      --discovery ... --tester ... --out plan.json
npm run dev -- generate  --plan plan.json --discovery ... --out ./output
```

## Inputs

1. **Discovery JSON** — produced by [`../playwright-discovery`](../playwright-discovery)
2. **Tester Requirement** — see [`./examples/tester-basic.yml`](./examples/tester-basic.yml)
3. **Security Knowledge** — YAML files under [`./knowledge/attacks/`](./knowledge/attacks)

## Output

```
output/
├── plan.json          # what the planner decided to test
├── tests/             # generated .spec.ts files
│   ├── contact.spec.ts
│   └── login.spec.ts
└── report.md          # per-test coverage report
```
