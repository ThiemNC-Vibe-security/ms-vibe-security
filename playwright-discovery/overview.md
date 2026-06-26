# Playwright Discovery — Overview

## Mục đích

Khám phá tự động cấu trúc một website target để sinh ra **structured JSON** mô tả mọi page, form, input, button, navigation, và security-relevant component. Output này được dùng làm input cho LLM Test Generator để sinh Playwright security test scripts có thể chạy được ngay.

Tool này được thiết kế cho **tester**, không yêu cầu code per-website. Chỉ cần config URL và scope.

---

## Vị trí trong pipeline tổng

```
┌─────────────────────┐
│  Target Website     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Playwright         │ ◄── (project này)
│  Discovery          │
└──────────┬──────────┘
           │ discovery.json
           ▼
┌─────────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  LLM Test Generator │ ◄──│  Security        │ ◄──│  Tester          │
│  (Gemini)           │    │  Knowledge       │    │  Requirement     │
└──────────┬──────────┘    │  (OWASP, payloads)│   │  (scope, config) │
           │               └──────────────────┘    └──────────────────┘
           ▼
   Playwright Test Scripts
        (runnable)
```

---

## Nguyên tắc thiết kế

1. **Generic, không hardcode per-website** — DOM APIs là chuẩn, mọi website đều có `<form>`, `<input>`, `<button>`.
2. **Selector real, không infer** — Mọi selector trong output đều được Playwright verify trước khi ghi.
3. **Stable selectors first** — Ưu tiên `data-testid` → `role+name` → `label` → `name` attribute → `id` → CSS path.
4. **Resilient** — Site lỗi, page crash, network timeout không làm dừng discovery.
5. **Config-driven cho tester** — Tester chỉ chạm YAML/JSON, không touch code.
6. **Deterministic** — Cùng URL + config → cùng output.

---

## Input

### 1. CLI args (đơn giản nhất)
```bash
playwright-discovery --url https://target.com --max-pages 20
```

### 2. Config file (đầy đủ)
```yaml
target: https://my-app.com
output: ./output/discovery.json

scope:
  include:
    - /login
    - /dashboard
    - /transactions/*
  exclude:
    - /admin
    - /api/internal/*
    - "*.pdf"

crawl:
  max_pages: 30
  max_depth: 3
  strategy: bfs   # bfs | dfs
  same_domain_only: true
  follow_subdomains: false
  parallel: 1     # concurrent pages (browser contexts)

auth:
  mode: none      # none | basic | form | bearer | oauth | storage_state
  # if mode: form
  login_url: /login
  username_selector: 'input[name="email"]'
  password_selector: 'input[name="password"]'
  submit_selector: 'button[type="submit"]'
  username: ${TEST_USER}        # from .env
  password: ${TEST_PASSWORD}
  success_indicator: 'url=/dashboard'   # or 'selector=.user-menu'
  # if mode: storage_state (reuse Playwright auth state file)
  storage_state_path: ./auth.json

browser:
  type: chromium     # chromium | firefox | webkit
  headless: true
  user_agent: null   # null = Playwright default
  viewport: { width: 1280, height: 800 }
  locale: en-US
  timezone: Asia/Ho_Chi_Minh

timing:
  navigation_timeout: 30000
  wait_for_network_idle: true
  wait_after_navigation: 1000   # ms, for animations
  action_timeout: 10000

stealth:
  enable: false
  proxy: null

retry:
  max_attempts: 2
  backoff_ms: 2000
```

### 3. Environment variables
```bash
TEST_USER=test@example.com
TEST_PASSWORD=Test123!
GEMINI_API_KEY=...   # only if using LLM enrichment
```

---

## Output

### File structure
```
output/
├── discovery_YYYYMMDD_HHMMSS.json   # main output
├── screenshots/                      # optional, per page
│   ├── page_001.png
│   └── ...
├── errors.log                        # errors during crawl
└── traces/                           # optional Playwright traces for debug
```

### JSON schema

```json
{
  "metadata": {
    "base_url": "https://target.com",
    "discovered_at": "2026-06-26T15:30:00Z",
    "duration_seconds": 45.2,
    "playwright_version": "1.48.0",
    "user_agent": "Mozilla/5.0 ...",
    "config_hash": "abc123"
  },
  "stats": {
    "pages_discovered": 12,
    "pages_failed": 1,
    "total_forms": 5,
    "total_inputs": 23,
    "total_buttons": 47,
    "total_links": 89,
    "security_components": 4
  },
  "pages": [
    {
      "url": "https://target.com/login",
      "url_path": "/login",
      "title": "Sign In",
      "page_type": "login",
      "language": "en",
      "authentication_required": false,
      "http_status": 200,
      "load_time_ms": 412,

      "navigation": {
        "navbar": [
          {
            "text": "Home",
            "href": "/",
            "selector": "nav >> a:has-text('Home')",
            "playwright_locator": "page.getByRole('link', { name: 'Home' })"
          }
        ],
        "sidebar": [],
        "footer": [],
        "breadcrumb": []
      },

      "forms": [
        {
          "form_id": "login-form-0",
          "selector": "form[data-testid='login-form']",
          "playwright_locator": "page.locator('form[data-testid=\"login-form\"]')",
          "action": "/api/auth/login",
          "method": "POST",
          "enctype": "application/x-www-form-urlencoded",
          "purpose": "login",
          "inputs": [
            {
              "selector": "input[name='email']",
              "playwright_locator": "page.getByLabel('Email')",
              "alternate_locators": [
                "page.getByPlaceholder('you@example.com')",
                "page.locator('#email')"
              ],
              "tag": "input",
              "name": "email",
              "id": "email",
              "type": "email",
              "label": "Email",
              "placeholder": "you@example.com",
              "required": true,
              "autocomplete": "email",
              "pattern": null,
              "min_length": null,
              "max_length": 100,
              "default_value": "",
              "aria_label": null,
              "data_testid": null,
              "validation_rules": ["required", "email_format"]
            }
          ],
          "submit": {
            "selector": "button[type='submit']",
            "playwright_locator": "page.getByRole('button', { name: 'Sign In' })",
            "text": "Sign In",
            "type": "submit"
          },
          "csrf_token": {
            "present": true,
            "field_name": "_csrf",
            "selector": "input[name='_csrf']"
          },
          "expected_outcome": {
            "success_redirect": "/dashboard",
            "error_indicator_selector": "[role='alert']",
            "error_message_pattern": "Invalid credentials"
          }
        }
      ],

      "buttons": [
        {
          "selector": "button.btn-primary",
          "playwright_locator": "page.getByRole('button', { name: 'Sign In' })",
          "text": "Sign In",
          "type": "submit",
          "aria_label": null,
          "data_testid": null,
          "inside_form_id": "login-form-0",
          "business_meaning": null
        }
      ],

      "links": [
        {
          "text": "Forgot password?",
          "href": "/forgot-password",
          "selector": "a[href='/forgot-password']",
          "playwright_locator": "page.getByRole('link', { name: 'Forgot password?' })",
          "is_external": false,
          "rel": null
        }
      ],

      "tables": [],
      "dialogs": [],

      "security_components": [
        {
          "type": "login_form",
          "selector": "form[data-testid='login-form']",
          "applicable_attacks": [
            "sql_injection",
            "credential_stuffing",
            "brute_force",
            "no_rate_limit",
            "broken_auth"
          ],
          "owasp": ["A07:2021"]
        },
        {
          "type": "password_field",
          "selector": "input[name='password']",
          "applicable_attacks": ["weak_password_accepted"]
        }
      ],

      "url_parameters": [
        {
          "name": "redirect",
          "value": "/dashboard",
          "in": "query",
          "applicable_attacks": ["open_redirect"]
        }
      ],

      "javascript_errors": [],
      "console_warnings": [],
      "outbound_requests_sample": [
        { "url": "/api/auth/csrf", "method": "GET" }
      ],

      "next_candidate_pages": [
        "/register",
        "/forgot-password",
        "/help"
      ],

      "screenshot_path": "screenshots/page_001.png"
    }
  ],

  "graph": {
    "edges": [
      {
        "from": "/",
        "to": "/login",
        "trigger_text": "Sign In",
        "trigger_selector": "nav a:has-text('Sign In')"
      }
    ]
  },

  "errors": [
    {
      "url": "/admin",
      "error_type": "http_403",
      "message": "Forbidden",
      "timestamp": "2026-06-26T15:30:15Z"
    }
  ]
}
```

---

## Cases cần xử lý

### A. Phát hiện UI components

| Case | Cách xử lý |
|---|---|
| Standard `<form>` | `page.locator('form').all()` |
| Form không có `<form>` tag (div/section gom inputs) | Heuristic: group inputs theo container có submit button |
| Input có `<label for="...">` | Match `for` → `id`, lấy label text |
| Input có `<label>` wrap | Tìm label cha gần nhất |
| Input không có label | Dùng `aria-label`, `placeholder`, `name` |
| Custom dropdown (không phải `<select>`) | Detect bằng `role="combobox"` hoặc class pattern |
| Toggle/switch (không phải checkbox) | Detect bằng `role="switch"` |
| Rich text editor (CKEditor, TinyMCE) | Detect bằng iframe hoặc `contenteditable` |
| File upload | `input[type="file"]` + nearby drop zones |
| Hidden CSRF token | Detect `input[type="hidden"]` với name match pattern (`_csrf`, `_token`, `authenticity_token`) |
| Submit button ngoài form (`form="x"`) | Resolve qua `form` attribute |

### B. Generate stable Playwright selector

Order of preference:
1. `data-testid` / `data-test` / `data-cy`
2. `getByRole('role', { name: 'text' })` — accessibility-first
3. `getByLabel('label text')` — for inputs with labels
4. `getByPlaceholder('placeholder')` — for inputs
5. `getByText('exact text')` — for buttons/links
6. `id` attribute (nếu không phải auto-generated)
7. `name` attribute
8. CSS unique path (last resort, fragile)

Output cả selector chính và 2-3 alternates để LLM có lựa chọn.

### C. Page type classification

Heuristic rules (không cần LLM):

| Pattern | Page type |
|---|---|
| URL contains `/login`, `/signin`, `/auth` | `login` |
| URL contains `/register`, `/signup` | `registration` |
| URL contains `/forgot`, `/reset-password` | `password_recovery` |
| URL contains `/dashboard`, `/home` (after auth) | `dashboard` |
| URL contains `/profile`, `/account`, `/settings` | `profile` |
| URL contains `/admin` | `admin` |
| URL contains `/checkout`, `/cart`, `/payment` | `payment` |
| Has `<input type="search">` only | `search` |
| Has `<table>` with many rows | `list` / `report` |
| Path matches `/items/:id` pattern | `detail` |
| Has form with no inputs from above patterns | `generic_form` |
| No forms, only content | `content` / `landing` |

Optional LLM enrichment để xử lý case ambiguous.

### D. Crawl strategy

- **BFS** (default) — explore broad first, ưu tiên top-level pages
- **DFS** — đào sâu một flow (ví dụ checkout)
- **Priority queue** — cho page có security-relevant components score cao hơn
- **Dedup** — bằng URL normalized (lowercase, no trailing slash, no fragment)
- **Cycle prevention** — visited set
- **Same-domain only** (configurable) — không crawl external sites
- **Robots.txt** — respect by default, override với `--ignore-robots`

### E. URL normalization

- Remove fragment (`#section`)
- Sort query params alphabetically
- Remove tracking params (`utm_*`, `fbclid`, `gclid`)
- Lowercase scheme + host
- Trim trailing slash (except root)
- Resolve relative URLs against base

### F. Authentication

| Mode | Mô tả | Implementation |
|---|---|---|
| `none` | Public site | No auth |
| `basic` | HTTP Basic Auth | Set `Authorization` header |
| `form` | Login form | Fill + submit, save storage state, reuse |
| `bearer` | API token | Set `Authorization: Bearer ...` |
| `oauth` | OAuth flow (Google, GitHub, etc.) | Manual record once → reuse storage state |
| `storage_state` | Reuse existing Playwright auth file | Load `storageState` directly |

**Storage state reuse:** Login một lần, save `auth.json`, dùng cho mọi run sau (skip login, tiết kiệm thời gian). Refresh khi expired.

### G. Dynamic content

| Case | Cách xử lý |
|---|---|
| SPA (React/Vue/Angular) | `waitUntil: 'networkidle'` |
| Infinite scroll | Scroll to bottom, đợi mới, lặp đến không thêm content |
| Lazy load images | Trigger scroll, đợi `IntersectionObserver` fire |
| Modal mở khi click | Track modal triggers, optionally open + extract |
| Hover-only menus | Hover trigger element, đợi visible |
| Tabs hidden | Click each tab, extract content |
| Accordion | Expand all sections |

### H. Anti-bot / Protected sites

| Case | Cách xử lý |
|---|---|
| Cloudflare basic | Stealth plugin, real browser fingerprint |
| reCAPTCHA v2/v3 | **Skip** (can't bypass legally), document trong errors |
| hCaptcha | Skip |
| Rate limiting | Respect retry-after, exponential backoff |
| User-Agent check | Custom UA from config |
| Cookie consent banner | Auto-click "Accept all" (heuristic by text) |

### I. Edge cases trong DOM

| Case | Cách xử lý |
|---|---|
| Shadow DOM | Use `>>>` Playwright selector, or skip with flag |
| iFrame content | Recurse into iframes, prefix selector with frame ID |
| Cross-origin iframe | Skip, log warning |
| `contenteditable` div | Treat as text input |
| Web Components | Detect custom elements, try to extract inner DOM |
| Disabled elements | Include but mark `disabled: true` |
| Hidden elements (`display:none`) | Skip unless explicitly required |
| Off-screen elements | Include |

### J. Form interactions

- **Don't submit forms by default** — only discover structure
- **Optional dry-run submit** — fill dummy data, submit, observe outcome (success URL, error message) → enrich `expected_outcome`
- **Tester opt-in** via `--probe-forms` flag (vì có thể side-effect)

### K. Error handling

| Error | Action |
|---|---|
| HTTP 4xx/5xx | Log, continue. Mark page as `failed` |
| Timeout | Retry once with longer timeout, then skip |
| Page crash | Restart browser context, retry |
| JS error on page | Log to `javascript_errors`, continue extract what's possible |
| Network error | Retry with backoff |
| Selector not found | Skip element, log to errors |
| OOM (too many elements) | Throttle, batch extraction |

**Quan trọng:** Một page fail không làm dừng cả discovery.

### L. Performance

- Reuse browser instance across pages (chỉ tạo context mới)
- Block unnecessary resources: images, fonts, analytics (configurable)
- Parallel contexts (default 1, can tune)
- Resource limit: max DOM size (skip if page > 5MB HTML)
- Timeout per page (default 60s total)

### M. Privacy / Safety

- **Không submit forms với data thật** (chỉ probe nếu user opt-in)
- **Không exfiltrate data** — chỉ structure, không lưu content sensitive
- **Mask credentials trong output** — Replace với placeholder
- **Respect robots.txt** by default
- **Rate limit** — không spam target server

---

## CLI Design

### Quick start
```bash
# Minimal
discovery --url https://example.com

# With output path
discovery --url https://example.com --output ./out/site.json

# Limit
discovery --url https://example.com --max-pages 10 --max-depth 2

# With config
discovery --config ./discovery.yml

# With auth
discovery --url https://app.com --auth-mode form \
  --login-url /login --username u --password p

# Verbose / debug
discovery --url https://example.com --verbose --save-screenshots --save-traces
```

### Commands
```bash
discovery init                    # Generate discovery.yml template
discovery run [--config FILE]     # Run discovery
discovery validate FILE.json      # Validate output JSON schema
discovery diff OLD.json NEW.json  # Compare two runs (regression detection)
```

---

## Tech stack đề xuất

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript | Same ecosystem as Playwright + gemini-api |
| Runtime | Node.js 20+ | Native ESM, performance |
| Crawler | Playwright | Real browser, stable API |
| CLI | `commander` or `yargs` | Standard |
| Config | YAML (`js-yaml`) | Tester-friendly |
| Validation | `zod` | Type-safe schema |
| Logging | `pino` | Structured, fast |
| Tests | `vitest` | Fast |

---

## File structure dự kiến

```
playwright-discovery/
├── package.json
├── tsconfig.json
├── README.md
├── discovery.yml              # default config template
├── .env.example
├── src/
│   ├── index.ts              # entry
│   ├── cli.ts                # CLI handling
│   ├── config/
│   │   ├── schema.ts         # zod schema for config
│   │   └── loader.ts         # load yaml + env
│   ├── crawler/
│   │   ├── crawler.ts        # main BFS/DFS logic
│   │   ├── queue.ts          # URL queue with dedup
│   │   ├── url-utils.ts      # normalize, validate
│   │   └── robots.ts         # robots.txt parser
│   ├── extractors/
│   │   ├── page-extractor.ts # main per-page extraction
│   │   ├── form-extractor.ts
│   │   ├── input-extractor.ts
│   │   ├── button-extractor.ts
│   │   ├── link-extractor.ts
│   │   ├── nav-extractor.ts
│   │   └── security-detector.ts
│   ├── selectors/
│   │   ├── generator.ts      # stable selector generation
│   │   └── playwright-locator.ts
│   ├── auth/
│   │   ├── form-auth.ts
│   │   ├── basic-auth.ts
│   │   └── storage-state.ts
│   ├── classifier/
│   │   └── page-type.ts      # URL/content based classification
│   ├── output/
│   │   ├── writer.ts         # JSON output
│   │   └── schema.ts         # output schema
│   └── utils/
│       ├── logger.ts
│       └── retry.ts
├── examples/
│   ├── basic.yml
│   ├── with-auth.yml
│   └── enterprise.yml
└── tests/
    └── ...
```

---

## Output sẵn sàng cho LLM Test Generator

Output JSON này có thể đưa thẳng vào prompt như:

> "Đây là cấu trúc website. Dùng các selectors này (đã verify chạy được trên Playwright). Sinh test theo Security Knowledge + Tester Requirement."

LLM **không phải bịa** selector. Chỉ map:
- `security_components.type = "login_form"` → trigger SQL injection / brute force tests
- `inputs[].selector` → dùng làm `page.locator()` trong test
- `expected_outcome.success_redirect` → dùng làm assertion `expect(page).toHaveURL()`

---

## Roadmap

### MVP (v0.1)
- Crawl + extract forms/inputs/buttons/links
- Generate stable Playwright selectors
- URL normalization, BFS, max pages, max depth
- JSON output schema
- CLI cơ bản

### v0.2
- Auth: form login + storage state
- Page type classification (URL heuristic)
- Security component detection
- Error handling + retry

### v0.3
- Dynamic content (modal, tabs, infinite scroll)
- Graph edges (navigation flow)
- CSRF detection
- URL params extraction

### v0.4
- LLM enrichment (business meaning, advanced page type)
- Multi-context parallelism
- Stealth mode
- Robots.txt respect

### v0.5
- Diff mode (compare 2 runs)
- Form probing (opt-in)
- iframe support
- Shadow DOM support

### Future
- Recording mode (manual click → record session)
- Plugin system (custom extractors)
- Cloud mode (run on remote)
