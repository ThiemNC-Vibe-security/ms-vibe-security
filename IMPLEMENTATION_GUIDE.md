# Security Test Auto-Generation Pipeline — Implementation Guide

> Tài liệu này mô tả đầy đủ kiến trúc, thiết kế và triển khai của pipeline tự động sinh Playwright security tests từ một website target. Mục đích: ai cũng có thể copy doc này sang dự án khác, đọc xong là dựng lại được.

**Phiên bản:** v0.1 MVP (26/06/2026)

---

## Mục lục

1. [Mục tiêu nghiên cứu](#1-mục-tiêu-nghiên-cứu)
2. [Kiến trúc tổng quan](#2-kiến-trúc-tổng-quan)
3. [Stage 1 — Playwright Discovery](#3-stage-1--playwright-discovery)
4. [Stage 2 — Test Generator (Plan-then-Generate)](#4-stage-2--test-generator)
5. [Security Knowledge format](#5-security-knowledge-format)
6. [Tester Requirement format](#6-tester-requirement-format)
7. [Cách chạy end-to-end](#7-cách-chạy-end-to-end)
8. [Tóm tắt các quyết định kiến trúc](#8-tóm-tắt-các-quyết-định-kiến-trúc)
9. [Hạn chế hiện tại](#9-hạn-chế-hiện-tại)
10. [Roadmap mở rộng](#10-roadmap-mở-rộng)
11. [Phụ lục: glossary và checklist migrate](#11-phụ-lục)

---

## 1. Mục tiêu nghiên cứu

**Bài toán:** Cho một website bất kỳ, tự động sinh ra một bộ Playwright test script có khả năng phát hiện các lỗ hổng bảo mật phổ biến (OWASP Top 10) — không yêu cầu tester viết code.

**Input của hệ thống:**
- URL website + cấu hình crawl (có credentials nếu cần login)
- Yêu cầu tester (priority attack types, scope, limits)
- Cơ sở tri thức bảo mật (payload, detection rules, OWASP mappings)

**Output:**
- Playwright `.spec.ts` files có thể chạy ngay bằng `npx playwright test`
- Báo cáo coverage

**Yêu cầu thực tế:**
- Selector trong test phải **thực sự work** (Playwright cần selector chính xác, không LLM hallucinate được)
- Phải scale lên website lớn (100+ pages) mà không vỡ context LLM
- Tester là QA, không phải dev → tool phải config-driven, không touch code

---

## 2. Kiến trúc tổng quan

```
                ┌─────────────────────────────────┐
                │         Target Website          │
                └────────────────┬────────────────┘
                                 │
                                 ▼
        ┌────────────────────────────────────────────────┐
        │  STAGE 1: Playwright Discovery (deterministic)  │
        │  - Crawl pages with Playwright                  │
        │  - Extract forms, inputs, buttons, links        │
        │  - Generate stable Playwright locators          │
        │  - Classify page types                          │
        │  - Detect security-relevant components          │
        └────────────────┬───────────────────────────────┘
                         │
                         ▼  discovery_*.json
        ┌────────────────────────────────────────────────┐
        │  STAGE 2: Test Generator (LLM-powered)          │
        │                                                 │
        │  ┌─────────────────────────────────────────┐   │
        │  │  Summary Builder (no LLM)               │   │
        │  │  Discovery 300KB → Summary 2KB           │   │
        │  └────────────────┬────────────────────────┘   │
        │                   ▼                            │
        │  ┌─────────────────────────────────────────┐   │
        │  │  Planner LLM (1 call)                   │   │
        │  │  summary + tester req + knowledge index │   │
        │  │  → TestPlan (list of TestCases)         │   │
        │  └────────────────┬────────────────────────┘   │
        │                   ▼                            │
        │  ┌─────────────────────────────────────────┐   │
        │  │  Generator LLMs (N parallel calls)      │   │
        │  │  per TestCase + page detail + attack    │   │
        │  │  → 1 Playwright test (TS code)          │   │
        │  └────────────────┬────────────────────────┘   │
        │                   ▼                            │
        │  ┌─────────────────────────────────────────┐   │
        │  │  Merger + Writer                        │   │
        │  │  Group by page → .spec.ts files          │   │
        │  └────────────────┬────────────────────────┘   │
        └───────────────────┼────────────────────────────┘
                            │
                            ▼
              ┌──────────────────────────────┐
              │  Playwright Test Scripts     │
              │  Ready to run                │
              └──────────────────────────────┘
```

### Vì sao chia 2 stage

| Lý do | Giải thích |
|---|---|
| **Tách deterministic và probabilistic** | Discovery dùng DOM API → deterministic. Test generation dùng LLM → probabilistic. Tách rõ để debug. |
| **Cache discovery** | Discovery một lần, có thể chạy nhiều test generation với tester req khác nhau (low/high priority, focused attacks...) |
| **Same engine** | Playwright vừa khám phá vừa chạy test → selector đảm bảo work |
| **Khả năng review** | Tester có thể review `discovery.json` trước khi feed sang generator |

### Vì sao Pattern 3 (Plan-then-Generate) thay vì single-shot LLM

| Pattern | Tokens per 50-page site | Quality | Cost | Scale |
|---|---|---|---|---|
| Single-shot (dump all into 1 prompt) | ~500K-1M | Low (LLM bị overwhelmed) | High | Vỡ context khi >100 pages |
| **Pattern 3 (Plan-then-Generate)** | **~250K (1 planner + 50 generator calls)** | **High (focused context per test)** | **Medium** | **Scale lên 1000+ pages** |
| Per-page fan-out | Tương tự | Medium (mất cross-page context) | Medium | Tốt |
| RAG (vector retrieval) | Constant | Tùy retrieval quality | Low | Vô hạn |

Pattern 3 là sweet spot cho MVP: vừa scale, vừa quality cao, vừa có planning step có thể review.

---

## 3. Stage 1 — Playwright Discovery

**Project folder:** `playwright-discovery/`

### 3.1 Mục đích

Khám phá tự động cấu trúc một website target. Output JSON chứa stable Playwright locators để LLM Test Generator dùng trực tiếp không cần đoán.

### 3.2 Input / Output

**Input:**
- URL website
- Config YAML (scope, auth, browser, timing, output)

**Output:**
```
output/
├── discovery_YYYYMMDD_HHMMSS.json   # main artifact (timestamped, không ghi đè)
├── screenshots/                      # optional
└── errors.log
```

### 3.3 Tech stack

| Layer | Choice | Lý do |
|---|---|---|
| Runtime | Node.js 20+ | ESM native, performance |
| Language | TypeScript 5.7 strict | Type safety cho schema phức tạp |
| Browser | Playwright 1.61+ | Real browser, stable API, support arm64 Mac |
| CLI | commander 12 | Standard, mature |
| Config | js-yaml + zod 3 | YAML cho tester-friendly, zod validate strict |
| Logger | pino + pino-pretty | Fast structured logging |
| Bundler | tsc (no webpack/esbuild) | MVP, đủ dùng |

### 3.4 File structure

```
playwright-discovery/
├── package.json
├── tsconfig.json
├── .env.example
├── overview.md             # Spec gốc
├── enhancements.md         # Spec v2 (Phase 2.0 network monitoring, etc.)
├── README.md
├── examples/
│   ├── basic.yml           # Public site
│   ├── with-auth.yml       # Form login
│   └── enterprise.yml      # Full options
└── src/
    ├── cli.ts                          # Entry, commander
    ├── config/
    │   ├── schema.ts                   # zod schemas
    │   └── loader.ts                   # YAML + env + CLI merge
    ├── crawler/
    │   ├── crawler.ts                  # Main BFS/DFS loop
    │   ├── queue.ts                    # UrlQueue (dedup + depth)
    │   └── url-utils.ts                # normalize, scope check
    ├── auth/
    │   └── index.ts                    # buildAuth: form/basic/bearer/storage_state
    ├── selectors/
    │   ├── types.ts                    # ElementInfo, SelectorResult
    │   └── generator.ts                # Node-side: priority-based selector string
    ├── extractors/
    │   ├── types.ts                    # RawSnapshot + ExtractedForm/Button/...
    │   ├── browser-extract.ts          # ONE self-contained fn cho page.evaluate
    │   ├── transformer.ts              # Node-side: raw → typed with selectors
    │   └── page-extractor.ts           # Orchestrate per page
    ├── classifier/
    │   ├── page-type.ts                # Heuristic: URL pattern + content signals
    │   └── security-detector.ts        # login_form, search_box, file_upload, ...
    ├── output/
    │   ├── schema.ts                   # DiscoveryOutput shape
    │   └── writer.ts                   # Timestamped JSON writer
    └── utils/
        ├── logger.ts
        └── retry.ts
```

### 3.5 Key modules — chi tiết

#### 3.5.1 Selector generator (`src/selectors/generator.ts`)

**Trách nhiệm:** Cho 1 element snapshot, output một Playwright locator string ổn định.

**Thứ tự ưu tiên** (theo Playwright official best practice):

```
1. data-testid → page.getByTestId('x')                     (most stable)
2. role + name → page.getByRole('button', { name: 'X' })   (accessibility)
3. label       → page.getByLabel('Email')                  (form inputs)
4. placeholder → page.getByPlaceholder('Search')
5. text        → page.getByText('Submit', { exact: true }) (buttons/links)
6. id          → page.locator('#id')                       (chỉ khi không phải auto-gen)
7. name attr   → page.locator('input[name="email"]')
8. CSS path    → page.locator('form:nth-of-type(1) > input:nth-of-type(2)')  (fallback cuối)
```

**Heuristic skip auto-generated ID:**
- ID có UUID-like pattern (>20 alphanum chars)
- ID chứa `:` (emotion/styled-components)
- ID bắt đầu bằng digit
- ID >40 ký tự

Output có cả:
- `selector`: CSS string Playwright `page.locator()` hiểu
- `playwright_locator`: full expression `page.getByRole('button', {...})`
- `alternate_locators`: 2-3 alternatives để LLM/test có fallback

#### 3.5.2 Browser-side mass extraction (`src/extractors/browser-extract.ts`)

**Pattern quan trọng:** ONE big self-contained function được pass cho `page.evaluate()`. Lý do:

- `page.evaluate(fn)` serialize function sang browser context
- KHÔNG thể import modules trong fn này
- Mọi helper (`extractInfo`, `findLabel`, `buildCssPath`, `implicitRole`) phải định nghĩa NESTED inside

Function này trả về một `RawPageSnapshot` JSON-serializable. Node-side `transformer.ts` đọc snapshot rồi áp dụng selector generator.

**Một call extract toàn bộ một page:**
- `forms[]` với inputs + submit + CSRF token detection
- `buttons[]` (kể cả nút ngoài form)
- `links[]` với is_external check
- `inputsOutsideForms[]`
- `navigation[]` (navbar/sidebar/footer/breadcrumb qua heuristic selectors)
- `tables[]` với column extraction
- `linkUrls[]` cho crawler queue

#### 3.5.3 Page type classifier (`src/classifier/page-type.ts`)

**Approach:** URL pattern → content signals → fallback "content"

URL rules (regex):
```
/login|signin|auth/login/  → login
/sign[-_]?up|register/     → registration
/forgot|reset-password/    → password_recovery
/dashboard|home|overview/  → dashboard
/profile|account|me/       → profile
/admin/                    → admin
/checkout|cart|payment/    → payment
```

Nếu URL không match, dùng content signals:
- Có password field + ≤4 inputs + 1 form → `login`
- Có password field + ≥3 inputs → `registration`
- Có search box + table → `search`
- Có table + không form → `list`
- Có form → `generic_form`
- Còn lại → `content` (hoặc `landing` nếu là `/`)

#### 3.5.4 Security component detector (`src/classifier/security-detector.ts`)

Cho mỗi `DiscoveredPage`, scan và emit `security_components[]` với `applicable_attacks` + OWASP mapping.

**Detection rules:**

| Component | Rule | Applicable attacks |
|---|---|---|
| `login_form` | Password field + ≤3 inputs | sql_injection, broken_auth, credential_stuffing, brute_force |
| `registration_form` | ≥2 password OR (password + email + name) | sql_injection, xss_stored, weak_password, mass_assignment |
| `password_recovery` | URL match OR email-only form + "reset" submit | username_enumeration, no_rate_limit, predictable_token |
| `payment_form` | URL match OR card/cvv field detection | price_tampering, no_https, csrf |
| `file_upload` | type=file | malicious_file, path_traversal, MIME bypass |
| `file_download` | Button text "Download/Export/Save as" | idor, path_traversal |
| `search_box` | type=search OR name=q/search | xss_reflected, sql_injection, open_redirect |
| `password_field` | type=password (standalone) | weak_password_accepted |
| `admin_function` | URL contains /admin/ | broken_access_control, privilege_escalation |
| `csrf_protected_form` | POST + CSRF token detected | csrf_token_validation |
| `form_without_csrf` | POST + NO CSRF token | csrf |

Output dedup theo `(type, selector)`.

#### 3.5.5 Auth handler (`src/auth/index.ts`)

Returns `AuthBundle = { contextOptions, postSetup? }`:
- `contextOptions` → pass vào `browser.newContext({...})` (storageState, httpCredentials, extraHTTPHeaders)
- `postSetup` → callback chạy sau context creation (cho form login)

Modes:
- `none` — return null
- `basic` — set `httpCredentials`
- `bearer` — set `extraHTTPHeaders.Authorization`
- `storage_state` — load Playwright auth state file
- `form` — navigate + fill + submit + verify success indicator, optional save_storage_state để reuse

Form auth success indicator có 2 format:
- `url=/dashboard` — assert URL chứa string
- `selector=.user-menu` — assert selector visible

#### 3.5.6 Crawler (`src/crawler/crawler.ts`)

BFS/DFS over URL queue. Per page:
1. `page.goto()` với timeout + waitUntil networkidle
2. `extractPage()` → DiscoveredPage + outboundUrls
3. Enqueue children URLs nếu in scope và chưa visited
4. Track edges từ parent → child cho graph

**Quan trọng:** Continue on error. Mỗi page fail được record vào `errors[]` rồi crawl tiếp.

### 3.6 Output schema

```jsonc
{
  "metadata": {
    "base_url": "https://example.com",
    "discovered_at": "2026-06-26T15:30:00Z",
    "duration_seconds": 12.4,
    "user_agent": "...",
    "config_hash": "abc123"
  },
  "stats": {
    "pages_discovered": 5,
    "pages_failed": 0,
    "total_forms": 3,
    "total_inputs": 12,
    "total_buttons": 25,
    "total_links": 87,
    "security_components": 4
  },
  "pages": [
    {
      "url": "https://example.com/login",
      "url_path": "/login",
      "title": "Sign In",
      "page_type": "login",
      "language": "en",
      "authentication_required": false,
      "http_status": 200,
      "load_time_ms": 412,
      "navigation": { "navbar": [...], "sidebar": [], "footer": [], "breadcrumb": [] },
      "forms": [{
        "selector": "...",
        "playwright_locator": "page.locator(...)",
        "alternate_locators": [...],
        "form_id": "login-form",
        "action": "/api/auth/login",
        "method": "POST",
        "inputs": [{
          "selector": "input[name='email']",
          "playwright_locator": "page.getByLabel('Email')",
          "alternate_locators": [...],
          "tag": "input", "name": "email", "id": "email", "type": "email",
          "label": "Email", "required": true, "placeholder": "...",
          "aria_label": null, "data_testid": null,
          "autocomplete": "email", "pattern": null,
          "min_length": null, "max_length": 100, "default_value": ""
        }],
        "submit": { "selector": "...", "playwright_locator": "...", "text": "Sign In", "type": "submit" },
        "csrf_token": { "present": true, "field_name": "_csrf" }
      }],
      "buttons": [...],
      "inputs": [...],
      "tables": [...],
      "links": [...],
      "security_components": [
        {
          "type": "login_form",
          "selector": "form[data-testid='login-form']",
          "applicable_attacks": ["sql_injection", "credential_stuffing", "brute_force"],
          "owasp": ["A07:2021"]
        }
      ],
      "url_parameters": [
        { "name": "redirect", "value": "/dashboard", "in": "query",
          "applicable_attacks": ["open_redirect"] }
      ],
      "next_candidate_pages": ["/register", "/forgot-password"]
    }
  ],
  "graph": { "edges": [{ "from": "/", "to": "/login", "trigger_text": "Sign In" }] },
  "errors": []
}
```

### 3.7 Cách chạy

```bash
cd playwright-discovery
npm install
npx playwright install chromium

# Quick
node dist/cli.js run --url https://example.com --max-pages 10

# With config
node dist/cli.js run --config ./examples/with-auth.yml

# Generate config template
node dist/cli.js init --output discovery.yml
```

---

## 4. Stage 2 — Test Generator

**Project folder:** `test-generator/`

### 4.1 Mục đích

Đọc `discovery.json` + tester requirement + security knowledge, sinh ra Playwright security tests có thể chạy được.

### 4.2 Pattern 3 — Plan-then-Generate

```
                LOAD ALL INPUTS (3 sources)
                          │
                          ▼
                SUMMARY BUILDER (Node, no LLM)
                discovery.json (300KB) → summary (3KB)
                Assigns: page_id, form_id, input_id (stable IDs)
                Indexes for later lookup
                          │
                          ▼
                STEP 1: PLANNER (1 LLM call)
                Input:  summary + tester req + knowledge index (id/name only)
                Output: TestPlan { test_cases: [...] }
                          │
                          ▼
                STEP 2: GENERATOR (N parallel LLM calls)
                Per TestCase:
                  context = page detail + attack with payloads + test config
                  → 1 Playwright test (TS code)
                Concurrency: 5 (configurable)
                          │
                          ▼
                STEP 3: MERGER + WRITER
                Group by page → 1 .spec.ts per page
                Dedupe imports
                          │
                          ▼
              output/
              ├── plan.json
              ├── tests/*.spec.ts
              ├── report.md
              └── summary.json
```

### 4.3 Tech stack

| Layer | Choice | Lý do |
|---|---|---|
| Runtime | Node.js 20+ | ESM native |
| Language | TypeScript 5.7 strict | Type safety cho pipeline |
| LLM | @google/generative-ai 0.21 (Gemini) | 1M token context, JSON mode |
| Default model | `gemini-2.5-flash` | Fast, cheap, đủ tốt cho task |
| CLI | commander 12 | Standard |
| Config | js-yaml + zod | Tester edits YAML |
| Logger | pino | Token tracking per call |

### 4.4 File structure

```
test-generator/
├── package.json
├── tsconfig.json
├── .env.example                # GEMINI_API_KEY
├── overview.md
├── README.md
├── knowledge/                  # Security knowledge YAMLs
│   ├── README.md
│   └── attacks/
│       ├── sql-injection.yml
│       ├── xss-reflected.yml
│       ├── csrf.yml
│       ├── broken-auth.yml
│       ├── open-redirect.yml
│       ├── idor.yml
│       └── rate-limit.yml
├── examples/                   # Tester requirement examples
│   ├── tester-basic.yml
│   ├── tester-focused.yml
│   └── tester-full.yml
└── src/
    ├── cli.ts                  # 4 commands: run / plan / generate / inspect
    ├── pipeline.ts             # Orchestrator
    ├── types.ts                # All types in one file
    ├── input/
    │   ├── discovery-loader.ts # Reads discovery_*.json
    │   ├── tester-loader.ts    # Reads tester.yml + env expansion
    │   └── knowledge-loader.ts # Reads knowledge/attacks/*.yml
    ├── summary/
    │   └── builder.ts          # Compress discovery → summary + indexes
    ├── planner/
    │   ├── prompt.ts           # Planner prompt template
    │   └── planner.ts          # LLM call + post-process
    ├── generator/
    │   ├── context.ts          # Build per-test context from index
    │   ├── prompt.ts           # Generator prompt template
    │   └── generator.ts        # Parallel LLM calls with concurrency
    ├── merger/
    │   └── merger.ts           # Group artifacts by file, dedupe imports
    ├── llm/
    │   └── gemini-client.ts    # Wrapper: complete() + completeJson()
    ├── output/
    │   └── writer.ts           # Write plan.json + tests/ + report.md
    └── utils/
        ├── logger.ts           # pino
        └── retry.ts            # retry() + pMap() for parallel
```

### 4.5 Key modules — chi tiết

#### 4.5.1 Summary Builder (`src/summary/builder.ts`)

**Trách nhiệm:** Compress full discovery JSON xuống còn ~1% kích thước, gán stable IDs để planner reference được.

**Compression strategy:**
- Drop: `alternate_locators`, navigation details, links text, tables
- Keep: page URL/type, forms (compressed), inputs (label+type+required only), security_components, url_parameters
- Generate IDs:
  - `page_id`: P-001, P-002, ...
  - `form_id`: reuse existing or F-001
  - `input_id`: từ data-testid → name → id → IN-001

**Index built parallel với summary:**
```ts
{
  pages:  Map<page_id, DiscoveryPage>      // page_id → full page
  forms:  Map<page_id/form_id, Form>       // composite key
  inputs: Map<page_id/input_id, Input>
}
```

→ Generator step lookup full detail qua index, không phải dump cả discovery.

**Measured compression:** 318KB raw → 2.2KB summary (0.7%). Vượt target 10%.

#### 4.5.2 Planner (`src/planner/planner.ts`)

**Input:** summary + tester req + knowledge index (id/name/owasp/applies_to only — no payloads).

**Prompt structure** (deterministic, label-separated JSON blocks):

```
SECTION 1: ROLE/TASK statement
SECTION 2: ================ DISCOVERY SUMMARY ================
           {summary JSON}
SECTION 3: ================ TESTER REQUIREMENT ================
           {tester JSON}
SECTION 4: ================ KNOWLEDGE INDEX ================
           {attack list, id+name+owasp+applies_to}
SECTION 5: ================ RULES ================
           10 explicit rules (use literal IDs, respect scope, etc.)
SECTION 6: ================ OUTPUT FORMAT ================
           Strict JSON schema example
```

**Why structured prompts:**
- Labels giúp LLM không confuse các block
- Explicit rules giảm hallucination
- Output format ví dụ giảm parse errors

**Post-processing** (deterministic, sau khi LLM trả):
1. Drop test cases với `page_id` không có trong summary
2. Drop test cases với `attack_id` không có trong knowledge
3. Sort by priority (high > medium > low)
4. Enforce `limits.max_tests_per_page` cap
5. Enforce `limits.max_tests` global cap
6. Renumber IDs deterministically: TC-001, TC-002, ...

**zod validation:** PlannerResponseSchema validate JSON trả về, retry 1 lần nếu fail.

#### 4.5.3 Generator (`src/generator/generator.ts`)

**Input:** TestPlan + index + knowledge + tester.

**Per TestCase:**

1. `buildContext(tc, index, knowledge, tester, baseUrl)` → focused context object chứa:
   - `test_case` (id, target, attack_id, why)
   - `attack` (FULL knowledge attack với payloads, detection, test_template_hints)
   - `page` (target page với target_form/target_input/target_url_parameter inlined)
   - `test_config` (base_url, credentials, browsers)

2. `buildGeneratorPrompt(ctx)` → focused prompt với rules nghiêm ngặt:
   - "Output TS code ONLY. No markdown."
   - "Use ONLY the Playwright locators provided. Don't invent selectors."
   - "Prefer playwright_locator over selector."
   - "Apply attack's test_template_hints."
   - "Assertions must use Playwright's expect API."

3. `gemini.complete()` → raw text, `stripFences()` clean markdown nếu có.

4. Wrap thành `TestArtifact { code, filename, generated_ok, error? }`.

**Concurrency:** `pMap(testCases, generateOne, 5)` — 5 calls parallel mặc định.

**Failure handling:** Mỗi test fail tạo failure artifact với `generated_ok=false` + error string. KHÔNG dừng cả batch.

**Filename derivation:** từ page URL path → slug. Tests cùng page merge cùng `.spec.ts`.

#### 4.5.4 Merger (`src/merger/merger.ts`)

Group artifacts theo `filename`, build 1 `.spec.ts` per group:

```
1. Tách imports vs body cho mỗi artifact
2. Dedup imports across artifacts
3. Build header comment liệt kê TC ids
4. Concat: header + deduped imports + annotated bodies
5. Each test prefixed: // ----- TC-001: sql_injection -----
```

#### 4.5.5 Gemini client (`src/llm/gemini-client.ts`)

Wrapper quanh `@google/generative-ai`:

- `complete(prompt, opts)` → raw text
- `completeJson(prompt, schema, opts)` → parse + zod validate

Tính năng:
- Singleton client (init 1 lần)
- Default model từ `GEMINI_MODEL` env (gemini-2.5-flash)
- Retry với linear backoff (3 attempts)
- Log per-call: tokens_in / tokens_out / duration_ms / tag
- `tag` field: `"planner"`, `"generator:TC-001"` → debug dễ
- `responseJson: true` → gọi với `responseMimeType: 'application/json'`
- `stripFences()` exported cho generator (LLM hay wrap code trong ```)

### 4.6 CLI commands

```bash
# Full pipeline (mặc định)
test-gen run \
  --discovery ../playwright-discovery/output/discovery_*.json \
  --tester ./examples/tester-basic.yml \
  --out ./output

# Chỉ chạy planner → plan.json (để review trước khi gen code)
test-gen plan \
  --discovery ... --tester ... --out ./output/plan.json

# Review plan offline (không gọi LLM)
test-gen inspect ./output/plan.json

# Chỉ chạy generator từ plan đã có
test-gen generate \
  --plan ./output/plan.json \
  --discovery ... --tester ... --out ./output
```

### 4.7 Output structure

```
output/
├── plan.json          # TestPlan — danh sách TestCases
├── tests/
│   ├── login.spec.ts        # Tất cả test cho /login page
│   ├── contact.spec.ts
│   └── search.spec.ts
├── report.md          # Báo cáo: success/fail per TC + lý do fail
└── summary.json       # Full GenerationOutput record (metadata + stats + plan + artifacts)
```

### 4.8 Token economics

Đo trên một site 50 pages:

| Step | Input tokens | Output tokens | Calls |
|---|---|---|---|
| Summary build | 0 | 0 | 0 (Node-side) |
| Planner | 5-15K | 3-5K | 1 |
| Generator | 3-5K mỗi call | 1-2K mỗi call | ~50 |
| **Total** | **~250K** | **~75K** | **~51** |

vs single-shot: 500K-1M token in 1 prompt với quality kém hơn. **Pattern 3 tiết kiệm ~3x token.**

Parallel: 50 generator calls × concurrency 5 = 10 batches.

---

## 5. Security Knowledge format

### 5.1 Format

Mỗi attack là một YAML file ở `knowledge/attacks/`:

```yaml
id: sql_injection                # required, unique join key
name: SQL Injection              # human readable
owasp:                           # OWASP Top 10 mapping
  - A03:2021
applies_to:                      # component types từ discovery security_components.type
  - login_form
  - search_box
  - form_without_csrf
  - url_param
payloads:                        # injection strings (empty cho detect-only attacks)
  - "' OR '1'='1"
  - "'; DROP TABLE--"
detection:                       # detection rule IDs (cho generator reasoning)
  - response_contains_sql_error
  - response_time_above_threshold:5000
  - http_500_response
test_template_hints:             # hints về cách viết test
  - inject_each_payload_separately
  - assert_response_does_not_leak_sql_error
description: |                   # optional
  Long human description.
```

### 5.2 7 attacks đã có sẵn

| File | Attack | OWASP | Applies to |
|---|---|---|---|
| `sql-injection.yml` | SQL Injection | A03:2021 | login_form, registration_form, search_box, form_without_csrf, url_param |
| `xss-reflected.yml` | Reflected XSS | A03:2021 | search_box, generic_form, form_without_csrf, registration_form, url_param |
| `csrf.yml` | CSRF | A01:2021 | form_without_csrf, login_form, registration_form, payment_form |
| `broken-auth.yml` | Broken Authentication | A07:2021 | login_form, password_field |
| `open-redirect.yml` | Open Redirect | A01:2021 | url_param |
| `idor.yml` | IDOR | A01:2021 | url_param, hidden_identifier |
| `rate-limit.yml` | Missing Rate Limit | A04:2021, A07:2021 | login_form, registration_form, password_recovery, search_box |

### 5.3 Thêm attack mới

Drop một YAML file mới vào `knowledge/attacks/`. Loader auto-discover.

`applies_to` phải khớp với security_components type names từ playwright-discovery (login_form, search_box, ...). Nếu thêm component type mới, update cả `security-detector.ts` của playwright-discovery.

---

## 6. Tester Requirement format

```yaml
target_discovery: ./discovery.json   # required: path to discovery JSON

scope:                               # optional: filter pages
  include_page_types: [login, registration, contact]
  exclude_pages: [/admin, /logout]
  include_urls: []

priorities:                          # which attacks to focus on
  high:   [sql_injection, xss_reflected, broken_auth]
  medium: [csrf, open_redirect]
  low:    [rate_limit]

limits:
  max_tests: 50
  max_tests_per_page: 10

test_config:
  browsers: [chromium]
  parallel: 4
  base_url: https://target.com       # optional override

credentials:                         # ${ENV_VAR} expansion supported
  valid:   { user: ${TEST_USER}, pass: ${TEST_PASSWORD} }
  invalid: { user: wrong@x.com,  pass: wrong }
```

`${VAR}` expansion: tester YAML resolve trước khi zod validate.

---

## 7. Cách chạy end-to-end

### 7.1 Setup một lần

```bash
# Clone hoặc setup workspace
mkdir my-research && cd my-research

# Stage 1: discovery
cd playwright-discovery
npm install
npx playwright install chromium

# Stage 2: test generator
cd ../test-generator
npm install
cp .env.example .env
# edit .env: add GEMINI_API_KEY (https://aistudio.google.com/app/apikey)
```

### 7.2 Run pipeline

```bash
# Step 1: Discover the target
cd playwright-discovery
npx tsx src/cli.ts run \
  --url https://target.com \
  --max-pages 20 \
  --max-depth 3
# → output/discovery_YYYYMMDD_HHMMSS.json

# Step 2: Generate tests
cd ../test-generator
npx tsx src/cli.ts run \
  --discovery ../playwright-discovery/output/discovery_*.json \
  --tester ./examples/tester-basic.yml \
  --out ./output
# → output/plan.json + output/tests/*.spec.ts + output/report.md

# Step 3: Run the generated tests
cd output
npm init -y && npm install @playwright/test
npx playwright test
```

### 7.3 Iterate

Nếu muốn refine: chỉnh `tester-basic.yml` (đổi priorities, scope, max_tests) và chạy lại test-generator. Không cần re-crawl.

Reuse discovery JSON cho nhiều round test generation khác nhau.

---

## 8. Tóm tắt các quyết định kiến trúc

### 8.1 Discovery — vì sao Playwright thay vì LLM agent (browser-use)

| Tiêu chí | LLM agent (browser-use) | **Playwright (chọn)** |
|---|---|---|
| Reliability | Bịa selector, output không deterministic | Real DOM, output stable |
| Speed | 30s-2min per page | <1s per page |
| Token cost | $$ mỗi page | $0 |
| Selector quality | Hallucinated | Verified, ready for Playwright tests |
| Khả năng debug | Khó (LLM black box) | Dễ |

### 8.2 Test gen — vì sao Pattern 3 thay vì single-shot

Đã giải thích §2. Tóm tắt: scale, token economics, quality, reviewability.

### 8.3 Vì sao tách `selector` và `playwright_locator`

- `selector`: CSS-like string `page.locator(...)` hiểu
- `playwright_locator`: full expression như `page.getByRole('button', { name: 'Sign In' })`

LLM chọn cái nào phù hợp test logic. Có cả 2 + alternates → LLM khó bịa selector vì có thể paste verbatim.

### 8.4 Vì sao stable IDs (page_id, form_id, input_id)

Planner và Generator nói chuyện qua IDs, không qua URL/selector full. Lợi ích:
- Token efficient (ID 5 chars vs URL 80 chars)
- Stable across runs
- Generator lookup full detail từ index O(1)

### 8.5 Vì sao knowledge là YAML plugin

- Tester có thể đọc/sửa không cần code
- Add attack mới = drop file mới
- Schema validate per file → 1 file hỏng không break batch
- Có thể version control attack libraries riêng

### 8.6 Vì sao continue-on-error

Discovery crawl 100 pages, 1 page crash → record error, crawl tiếp. Test gen 50 cases, 1 case LLM fail → record fail, gen tiếp.

Không bao giờ vứt toàn bộ kết quả vì 1 lỗi nhỏ.

---

## 9. Hạn chế hiện tại

### 9.1 Discovery

- **Endpoint không capture** — `action: null` cho form AJAX. Test phải assert UI, không API. **→ Phase 2.0** (network monitoring) sẽ fix.
- **Required field detect sai** — Chỉ đọc HTML `required` attr, không hiểu visual `*` marker.
- **Validation rules** — Chỉ HTML attributes (`pattern`, `minlength`), không probe runtime.
- **Multi-step workflows** — Chưa capture sequence (login → action → check).
- **Dynamic content** — Modal, infinite scroll, tabs chỉ thấy initial state.
- **CAPTCHA** — Không bypass, skip site.
- **Auth modes** — Đã có form/basic/bearer/storage_state. Chưa có OAuth/SSO multi-step.

### 9.2 Test generator

- **LLM hallucination assertion** — Generator có thể tạo `expect()` không phù hợp với app's behavior.
- **No self-heal** — Test fail không tự sửa.
- **No cross-page workflow tests** — Mỗi test 1 page, không simulate full user journey.
- **No test deduplication** — Cùng attack trên các form tương tự có thể duplicate logic.
- **Cost** — N test cases = N LLM calls. Cho 200 tests = $0.5-2 với Gemini Flash.

### 9.3 Pipeline

- **No caching** — Mỗi run gọi LLM lại từ đầu. Nên có incremental khi discovery không đổi.
- **No tester review UI** — Plan chỉ là JSON. Nên có web UI cho tester duyệt plan.

---

## 10. Roadmap mở rộng

### Phase 2.0 — Network monitoring (highest impact, no LLM)
- Capture endpoints qua `page.on('request')` trong discovery
- Capture security headers (CSP, HSTS, X-Frame-Options) qua `page.on('response')`
- Detect auth signals (Bearer tokens, cookies, JWT)
- → Tests có thể assert API status/headers, không chỉ DOM

### Phase 2.1 — Semantic enrichment
- Rule-based semantic_type detection (email, phone, password, card_number, ...)
- LLM fallback cho ambiguous cases
- Attack surface annotation per input
- LLM-friendly summary cho mỗi page

### Phase 2.2 — Interactive probing (opt-in)
- Form probing: submit empty/invalid → capture validation messages
- Modal/tab discovery: click triggers, extract nested
- Auth differential crawl: anon vs authenticated coverage

### Phase 3 — Test gen advanced
- Self-healing tests (rerun fail → regenerate with error context)
- Multi-step workflow tests (login + action + assert)
- RAG mode cho sites 1000+ pages
- Multi-LLM support (Claude, GPT-4)
- Web UI cho test plan review

### Phase 4 — Production polish
- Cache layer (Redis): incremental regen khi discovery đổi 1 page
- Diff mode (compare discovery runs để detect changes)
- Coverage report
- Custom knowledge plugin marketplace

---

## 11. Phụ lục

### 11.1 Glossary

| Term | Meaning |
|---|---|
| **Discovery** | Stage 1: crawl + extract page structure |
| **Discovery JSON** | Output của Stage 1, input của Stage 2 |
| **Summary** | Compressed view của Discovery JSON (~1% size), fed to Planner |
| **TestPlan** | LLM-produced list of TestCases, output của Step 1 trong Stage 2 |
| **TestCase** | Một test cần generate, refer page+form+attack qua IDs |
| **TestArtifact** | LLM-produced Playwright code cho 1 TestCase, output của Step 2 |
| **Knowledge attack** | One YAML định nghĩa 1 attack class (payloads + detection + hints) |
| **applies_to** | Field trong attack YAML, match security_components.type |
| **page_id / form_id / input_id** | Stable IDs gán bởi Summary Builder để Planner reference |
| **AuthBundle** | `{ contextOptions, postSetup? }` cho crawler launch |
| **`pMap`** | Concurrency-limited parallel map (chạy N task song song với cap) |
| **stripFences** | Helper xóa markdown ``` wrap khỏi LLM response |
| **Pattern 3** | Plan-then-Generate (vs single-shot Pattern 1) |

### 11.2 Checklist migrate sang project mới

Khi setup từ đầu trong một workspace mới:

**Stage 1 — Playwright Discovery**

- [ ] Copy folder `playwright-discovery/` (15 files src/ + 3 examples)
- [ ] `npm install` (deps: playwright 1.61.1, commander, dotenv, js-yaml, pino, pino-pretty, zod)
- [ ] `npx playwright install chromium`
- [ ] `npm run build` → verify clean
- [ ] `node dist/cli.js init` → tạo discovery.yml template
- [ ] Test: `node dist/cli.js run --url https://example.com --max-pages 3`

**Stage 2 — Test Generator**

- [ ] Copy folder `test-generator/` (16 files src/ + 7 knowledge YAMLs + 3 examples)
- [ ] `npm install` (deps: @google/generative-ai 0.21, commander, dotenv, js-yaml, pino, pino-pretty, zod)
- [ ] `cp .env.example .env` → add GEMINI_API_KEY
- [ ] `npm run build` → verify clean
- [ ] Test: `node dist/cli.js inspect ./output/plan.json` (cần 1 plan để test, hoặc skip nếu chưa có)

**Verify end-to-end**

- [ ] Run discovery trên 1 site test
- [ ] Run test gen với tester-basic.yml
- [ ] Kiểm tra `output/plan.json` có test cases
- [ ] Kiểm tra `output/tests/*.spec.ts` có valid TS
- [ ] Run `npx playwright test` trên output

### 11.3 Files cần copy

#### Stage 1 (playwright-discovery)

```
playwright-discovery/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
├── overview.md
├── enhancements.md          (optional, Phase 2 spec)
├── examples/
│   ├── basic.yml
│   ├── with-auth.yml
│   └── enterprise.yml
└── src/
    ├── cli.ts
    ├── config/
    │   ├── schema.ts
    │   └── loader.ts
    ├── crawler/
    │   ├── crawler.ts
    │   ├── queue.ts
    │   └── url-utils.ts
    ├── auth/
    │   └── index.ts
    ├── selectors/
    │   ├── types.ts
    │   └── generator.ts
    ├── extractors/
    │   ├── types.ts
    │   ├── browser-extract.ts
    │   ├── transformer.ts
    │   └── page-extractor.ts
    ├── classifier/
    │   ├── page-type.ts
    │   └── security-detector.ts
    ├── output/
    │   ├── schema.ts
    │   └── writer.ts
    └── utils/
        ├── logger.ts
        └── retry.ts
```

#### Stage 2 (test-generator)

```
test-generator/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
├── overview.md
├── knowledge/
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
    ├── pipeline.ts
    ├── types.ts
    ├── input/
    │   ├── discovery-loader.ts
    │   ├── tester-loader.ts
    │   └── knowledge-loader.ts
    ├── summary/
    │   └── builder.ts
    ├── planner/
    │   ├── prompt.ts
    │   └── planner.ts
    ├── generator/
    │   ├── context.ts
    │   ├── prompt.ts
    │   └── generator.ts
    ├── merger/
    │   └── merger.ts
    ├── llm/
    │   └── gemini-client.ts
    ├── output/
    │   └── writer.ts
    └── utils/
        ├── logger.ts
        └── retry.ts
```

### 11.4 Gotchas khi migrate

1. **Node.js version** — Cần Node 20+. Tốt nhất Node 22 LTS. Tránh Node 26 với Playwright cũ (gặp error `-88` lúc spawn Chromium trên macOS arm64). Đã fix bằng Playwright 1.61.1.

2. **TypeScript ESM strict** — Phải `"type": "module"` trong package.json + tsconfig `module: ESNext`. Import phải có `.js` extension dù file là `.ts`.

3. **Browser-side function constraints** — `browser-extract.ts` không được import bất cứ gì. Mọi helper phải nested. Đừng refactor extract sang nhiều file.

4. **Auth.postSetup vs contextOptions** — `storageState` và `httpCredentials` phải pass vào `newContext()`. Form login phải xảy ra SAU `newContext()`. → Tách 2 phần trong `AuthBundle`.

5. **CSRF in detect-only attacks** — `payloads: []` cho csrf/rate-limit là valid. Schema để `default([])` không `min(1)`.

6. **macOS quarantine** — Sau `npx playwright install`, có thể cần `xattr -dr com.apple.quarantine ~/Library/Caches/ms-playwright/`.

7. **dotenv** — Phải `import 'dotenv/config'` hoặc `loadEnv()` trước khi `process.env` được dùng.

8. **Gemini JSON mode** — Truyền `generationConfig: { responseMimeType: 'application/json' }` để model trả JSON sạch hơn. Vẫn cần `stripFences` đề phòng.

### 11.5 Liên hệ kiến thức / tham khảo

Các quyết định kiến trúc tham khảo:

- **Burp Suite crawler** — Directed graph model, content fingerprint identification
- **Playwright codegen** — Locator priority order (testid → role → label)
- **Crawl4AI** — Schema-based extraction concept
- **OWASP Top 10 2021** — Attack categorization
- **Stage decoupling** — Như compiler pipeline (lex → parse → typecheck)

---

## Kết thúc

Doc này tự chứa đủ để rebuild from scratch. Nếu mở agent mới, paste vào prompt là agent có context.

Khi bắt đầu lại từ doc này:
1. Tạo 2 folder `playwright-discovery/` và `test-generator/`
2. Setup theo §11.2 checklist
3. Copy file list ở §11.3
4. Test theo §7

Ưu tiên implement Phase 2.0 (network monitoring) cho discovery nếu có thời gian — đó là quick win lớn nhất theo §10.

**Status hiện tại:** MVP v0.1 — typecheck clean, build OK, smoke-test 7 attacks loaded, summary compression 0.7%, merger working. Cần `GEMINI_API_KEY` để test full end-to-end thực tế.
