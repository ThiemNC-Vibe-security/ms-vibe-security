# Tech Stack & Build Commands

## Runtime Requirements

- Node.js >= 20
- All TypeScript projects use ESM (`"type": "module"`)

---

## playwright-discovery (Stage 1 — Deterministic Crawler)

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.7 (strict) |
| Browser automation | Playwright 1.61 |
| CLI | Commander 12 |
| Config | js-yaml + Zod 3 |
| Logging | Pino + pino-pretty |
| Env | dotenv |

### Commands

```bash
cd playwright-discovery
npm run build        # tsc → dist/
npm run dev          # tsx src/cli.ts (dev mode)
npm run typecheck    # tsc --noEmit
npm run clean        # rm -rf dist
npm start            # node dist/cli.js
```

---

## test-generator (Stage 2 — LLM-Powered Generation)

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.7 (strict) |
| LLM SDK | @google/generative-ai 0.21 (Gemini 2.5 Flash) |
| CLI | Commander 12 |
| Config | js-yaml + Zod 3 |
| Logging | Pino + pino-pretty |
| Env | dotenv |

### Commands

```bash
cd test-generator
npm run build        # tsc → dist/
npm run dev          # tsx src/cli.ts (dev mode)
npm run typecheck    # tsc --noEmit
npm run clean        # rm -rf dist
npm start            # node dist/cli.js
```

---

## VC-AWG-Demo_FinalCode — Target App (Finance Management)

### Backend (NestJS)

| Layer | Technology |
|-------|-----------|
| Framework | NestJS 11 |
| Language | TypeScript 5.7 |
| ORM | TypeORM + MySQL2 |
| Auth | Passport + JWT |
| Validation | class-validator + class-transformer |
| API docs | Swagger (@nestjs/swagger) |
| Testing | Jest + supertest |
| Linting | ESLint + Prettier |

#### Commands

```bash
cd VC-AWG-Demo_FinalCode/be
npm run build          # nest build
npm run start:dev      # nest start --watch
npm run lint           # eslint --fix
npm run format         # prettier --write
npm run test           # jest
npm run test:cov       # jest --coverage
npm run test:e2e       # jest (e2e config)
```

### Frontend (React + Vite)

| Layer | Technology |
|-------|-----------|
| Framework | React 18 |
| Build tool | Vite 5 |
| Language | TypeScript 5.5 |
| Styling | TailwindCSS 3 |
| State | Zustand 4 |
| HTTP | Axios |
| Routing | React Router 6 |
| Charts | Recharts 3 |
| Linting | ESLint |

#### Commands

```bash
cd VC-AWG-Demo_FinalCode/fe
npm run dev            # vite dev server
npm run build          # tsc && vite build
npm run preview        # vite preview
npm run lint           # eslint
```

---

## Shared Conventions

- **Pinned dependencies**: All pipeline projects (discovery, test-generator) use exact versions, not ranges.
- **Zod for config validation**: YAML configs are parsed then validated with Zod schemas.
- **Pino for structured logging**: Configurable via `LOG_LEVEL` env variable.
- **dotenv for env loading**: `.env` files for secrets (API keys, DB credentials).
- **Commander for CLI**: Subcommands pattern (run, init, validate, plan, generate).
