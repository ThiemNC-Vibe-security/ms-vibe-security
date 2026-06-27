# Project Structure

```
ms-vibe-testing/
├── playwright-discovery/          # Stage 1: Deterministic website crawler
│   └── src/
│       ├── cli.ts                 # Entry point (Commander subcommands)
│       ├── config/                # Zod schemas + YAML loader
│       ├── auth/                  # Auth handlers (none, basic, bearer, form, storage_state)
│       ├── crawler/               # BFS/DFS orchestrator, URL queue, URL utils
│       ├── extractors/            # DOM extraction (browser-evaluate), transformation, typing
│       ├── selectors/             # Playwright selector generation (priority-based)
│       ├── classifier/            # Page-type classification + security component detection
│       ├── output/                # JSON serialization + file writer
│       └── utils/                 # Logger (Pino), retry helper
│
├── test-generator/                # Stage 2: LLM-powered test generation
│   ├── src/                       # CLI, planner, generator, merger
│   ├── knowledge/                 # Security knowledge base (OWASP payloads, detection rules)
│   └── examples/                  # Example configs and tester requirements
│
├── VC-AWG-Demo_FinalCode/         # Target app used for testing the pipeline
│   ├── be/                        # NestJS backend
│   │   └── src/
│   │       ├── config/            # Database config
│   │       ├── database/          # Database module
│   │       ├── filters/           # Global exception filter
│   │       ├── modules/           # Feature modules (one per domain entity)
│   │       │   ├── auth/          # JWT authentication
│   │       │   ├── account/
│   │       │   ├── transaction/
│   │       │   ├── category/
│   │       │   ├── bill/
│   │       │   ├── expenses/
│   │       │   ├── goal/
│   │       │   └── savings/
│   │       └── main.ts            # Bootstrap (CORS, validation pipe, Swagger, /api prefix)
│   └── fe/                        # React + Vite frontend
│       └── src/
│           ├── api/               # Axios API clients
│           ├── components/        # Shared UI components
│           ├── context/           # React context (Auth)
│           ├── hooks/             # Custom React hooks
│           ├── pages/             # Page components
│           ├── router/            # Route definitions
│           └── utils/             # Helper utilities
│
├── vbsec/                         # Academic documentation & research notes
├── IMPLEMENTATION_GUIDE.md        # Full pipeline architecture doc
├── TESTING_GUIDE.md               # End-to-end usage instructions
└── NOTES_20260626.md              # Working notes
```

## Architecture Patterns

### Pipeline Projects (playwright-discovery, test-generator)

- **CLI entry point**: `src/cli.ts` using Commander subcommands
- **Config-driven**: YAML files validated by Zod schemas, env variable expansion with `${VAR}` syntax
- **Layered extraction**: browser-context code (page.evaluate) is self-contained — no external imports allowed inside evaluate functions
- **Selector priority**: `data-testid > role > label > placeholder > text > id > name > CSS`
- **Error handling**: Per-page retry with backoff; failures are non-fatal and recorded in output
- **Knowledge base**: test-generator/knowledge/attacks/*.yml is the security ground truth, aligned with OWASP Top 10:2025, ASVS v5.0, and CWE. Component types emitted by discovery's security-detector must match knowledge `applies_to` values.

### NestJS Backend (VC-AWG-Demo_FinalCode/be)

- **Module-per-entity**: Each domain concept gets its own module folder with:
  - `*.module.ts` — NestJS module
  - `*.controller.ts` — REST endpoints
  - `*.service.ts` — Business logic
  - `*.entity.ts` — TypeORM entity
  - `dto/` — Request/response DTOs with class-validator decorators
- **Global prefix**: All routes under `/api`
- **Global pipes**: ValidationPipe with whitelist + transform
- **Auth**: JWT via Passport, guard-based protection

### React Frontend (VC-AWG-Demo_FinalCode/fe)

- **Feature-by-type**: `pages/`, `components/`, `hooks/`, `context/`, `api/`
- **State management**: Zustand stores (not Redux)
- **Routing**: React Router v6 with a centralized `router/` directory
- **Styling**: TailwindCSS utility classes
