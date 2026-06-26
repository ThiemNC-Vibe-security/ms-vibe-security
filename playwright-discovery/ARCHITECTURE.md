# Playwright Discovery — Kiến trúc chi tiết

## Tổng quan

Playwright Discovery là công cụ tự động khám phá cấu trúc website, trích xuất tất cả thành phần tương tác (forms, buttons, links, inputs, tables) cùng Playwright selectors ổn định, và xuất ra file JSON phục vụ cho việc sinh test cases bảo mật tự động.

**Không sử dụng AI/LLM** — toàn bộ logic là rule-based, heuristic, và deterministic.

---

## Tech Stack

| Thành phần | Công nghệ | Phiên bản |
|---|---|---|
| Runtime | Node.js | >= 20 |
| Language | TypeScript | 5.7.3 |
| Browser automation | Playwright | 1.61.1 |
| Config parsing | js-yaml + zod | 4.1.0 / 3.23.8 |
| CLI framework | Commander.js | 12.1.0 |
| Logging | Pino + pino-pretty | 9.5.0 / 11.3.0 |
| Env loading | dotenv | 16.4.5 |
| Dev runner | tsx | 4.19.2 |

---

## Cấu trúc thư mục

```
src/
├── cli.ts                          # Entry point — CLI commands (run, init, validate)
├── config/
│   ├── schema.ts                   # Zod schemas cho toàn bộ config (target, crawl, auth, browser, timing, output)
│   └── loader.ts                   # Load YAML → expand ${ENV} → merge CLI overrides → validate
├── auth/
│   └── index.ts                    # Auth handlers: none | basic | bearer | form | storage_state
├── crawler/
│   ├── crawler.ts                  # Orchestrator chính — quản lý browser lifecycle, BFS/DFS queue, per-page processing
│   ├── queue.ts                    # URL queue với dedup (Set), hỗ trợ BFS (shift) và DFS (pop)
│   └── url-utils.ts               # Normalize URL, strip tracking params, scope check, asset detection
├── extractors/
│   ├── browser-extract.ts          # Hàm chạy trong browser context (page.evaluate) — extract toàn bộ DOM
│   ├── page-extractor.ts           # Orchestrate extraction: gọi browser-extract → transform → classify
│   ├── transformer.ts              # Raw DOM data → typed models với Playwright selectors
│   └── types.ts                    # Type definitions cho Raw* và Extracted* shapes
├── selectors/
│   ├── generator.ts                # Sinh Playwright selector theo priority: testid > role > label > placeholder > text > id > name > css
│   └── types.ts                    # ElementInfo, SelectorResult interfaces
├── classifier/
│   ├── page-type.ts                # Classify trang: login, registration, dashboard, list, etc. (URL regex + content heuristics)
│   └── security-detector.ts        # Detect security components: login form, file upload, CSRF, admin, payment, etc.
├── output/
│   ├── schema.ts                   # TypeScript interfaces cho DiscoveryOutput, DiscoveredPage, SecurityComponent
│   └── writer.ts                   # Serialize → JSON file với timestamp trong tên
└── utils/
    ├── logger.ts                   # Pino logger instance (configurable via LOG_LEVEL env)
    └── retry.ts                    # Retry helper với linear backoff
```

---

## Luồng xử lý chính

```
┌─────────────────────────────────────────────────────────────────────┐
│ CLI (cli.ts)                                                         │
│   parse args → loadConfig() → buildAuth() → new Crawler() → run()  │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Crawler (crawler.ts)                                                 │
│                                                                      │
│  1. Launch browser (chromium/firefox/webkit)                         │
│  2. Create context (+ auth: cookies, localStorage, HTTP headers)    │
│  3. Auth post-setup nếu mode=form (login trên page riêng)           │
│  4. Seed URL queue với target                                        │
│  5. Loop: dequeue URL → processItem()                               │
│     ┌────────────────────────────────────────────────────────┐      │
│     │ processItem(url):                                       │      │
│     │   a. context.newPage()                                  │      │
│     │   b. page.goto(url) với retry                           │      │
│     │   c. extractPage(page) ← extraction pipeline            │      │
│     │   d. enqueueChildren() ← scope check, dedup            │      │
│     │   e. Record edges (parent → child)                      │      │
│     │   f. page.close()                                       │      │
│     └────────────────────────────────────────────────────────┘      │
│  6. Build DiscoveryOutput                                            │
│  7. Shutdown browser                                                 │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Output Writer (output/writer.ts)                                     │
│   → output/discovery_{timestamp}.json                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Extraction Pipeline (per page)

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│ Browser-side │     │   Node-side     │     │   Classifier     │
│  (evaluate)  │────▶│  Transformer    │────▶│                  │
│              │     │                 │     │                  │
│ extractRaw   │     │ buildForms()    │     │ classifyPage()   │
│ PageSnapshot │     │ buildButtons()  │     │ detectSecurity() │
│              │     │ buildLinks()    │     │                  │
│ Returns:     │     │ buildInputs()   │     │ Returns:         │
│ - forms      │     │ buildTables()   │     │ - page_type      │
│ - buttons    │     │ buildNavigation │     │ - security_comps │
│ - links      │     │                 │     │                  │
│ - inputs     │     │ + generateSelector│   │                  │
│ - tables     │     │   per element   │     │                  │
│ - navigation │     │                 │     │                  │
└──────────────┘     └─────────────────┘     └──────────────────┘
```

### Browser-side extraction (`browser-extract.ts`)

- Chạy **hoàn toàn trong browser** via `page.evaluate()`
- Self-contained: không import, không closure
- Extract: forms, buttons, links, standalone inputs, navigation regions, tables
- Mỗi element trả về `ElementInfo`: tag, id, name, type, role, ariaLabel, text, placeholder, testId, cssPath
- Filter: chỉ lấy visible elements (`display !== none`, `getBoundingClientRect > 0`)
- Detect: CSRF tokens (hidden inputs matching csrf/xsrf/_token patterns)

### Node-side transformer (`transformer.ts`)

- Nhận raw snapshots từ browser
- Gọi `generateSelector()` cho mỗi element → sinh selector ổn định
- Map raw data → typed interfaces (`ExtractedForm`, `ExtractedButton`, etc.)

### Selector generator (`selectors/generator.ts`)

Priority order:
1. `data-testid` → `page.getByTestId('...')`
2. ARIA role + name → `page.getByRole('button', { name: 'Submit' })`
3. Label text → `page.getByLabel('Email')`
4. Placeholder → `page.getByPlaceholder('Enter email')`
5. Text content → `page.getByText('Login')`
6. ID (chỉ stable IDs, skip auto-generated) → `page.locator('#myId')`
7. Name attribute → `page.locator('input[name="email"]')`
8. CSS path (fallback) → `page.locator('div > form > input:nth-of-type(2)')`

Mỗi element output: `selector` (primary) + `alternate_locators` (backup options).

---

## Authentication Module

| Mode | Cách hoạt động |
|---|---|
| `none` | Không auth, crawl public |
| `basic` | HTTP Basic auth via `httpCredentials` context option |
| `bearer` | `Authorization: Bearer <token>` header via `extraHTTPHeaders` |
| `form` | Mở page login → fill username/password → submit → verify redirect → save storage state |
| `storage_state` | Load file `auth-state.json` chứa cookies + localStorage (Playwright format) |

**Storage state format** (Playwright chuẩn):
```json
{
  "cookies": [...],
  "origins": [{
    "origin": "https://example.com",
    "localStorage": [
      { "name": "token", "value": "eyJ..." }
    ]
  }]
}
```

---

## Classifier Module

### Page Type (`classifier/page-type.ts`)

**Bước 1: URL pattern matching** (regex)
- `/login` → login
- `/register` → registration
- `/admin` → admin
- `/dashboard` → dashboard
- `/checkout` → payment
- etc.

**Bước 2: Content signals** (fallback khi URL không match)
- Có password field + ít inputs → login
- Có password field + nhiều inputs → registration
- Có search box + table → search
- Có table, không form → list
- Có form → generic_form
- Path `/` → landing
- Còn lại → content

### Security Detector (`classifier/security-detector.ts`)

Detect các components bảo mật kèm OWASP mapping:

| Component | Applicable Attacks | OWASP |
|---|---|---|
| login_form | sql_injection, brute_force, credential_stuffing, auth_bypass | A07, A03 |
| registration_form | sql_injection, xss_stored, weak_password, mass_assignment | A04, A03 |
| password_recovery | username_enumeration, no_rate_limit, predictable_token | A07, A01 |
| file_upload | malicious_file, path_traversal, oversized_file, svg_xss | A04, A05 |
| search_box | xss_reflected, sql_injection | A03 |
| payment_form | price_tampering, csrf, replay_attack | A04, A02 |
| form_without_csrf | csrf | A01 |
| admin_function | broken_access_control, privilege_escalation | A01 |

---

## Crawl Strategy

### URL Queue (`crawler/queue.ts`)
- **BFS** (default): `shift()` — breadth-first, ưu tiên coverage rộng
- **DFS**: `pop()` — depth-first, đi sâu trước
- **Dedup**: `Set<string>` — mỗi URL chỉ visit 1 lần
- Track: depth, parent URL, trigger text

### URL Normalization (`crawler/url-utils.ts`)
- Resolve relative → absolute
- Lowercase scheme + host
- Strip fragment (`#section`)
- Remove tracking params (utm_*, fbclid, gclid, etc.)
- Sort remaining query params
- Trim trailing slash
- Skip asset URLs (.png, .css, .js, .pdf, etc.)
- Skip non-HTTP protocols (mailto:, tel:, javascript:)

### Scope Rules
- `same_domain_only`: chỉ crawl cùng domain
- `follow_subdomains`: cho phép subdomain
- `include` / `exclude`: glob patterns cho paths

---

## Output Schema

```
DiscoveryOutput
├── metadata          # base_url, discovered_at, duration, playwright_version, config_hash
├── stats             # pages_discovered, pages_failed, total_forms, total_inputs, total_buttons, total_links, security_components
├── pages[]           # Array<DiscoveredPage>
│   ├── url, url_path, title, page_type, language
│   ├── authentication_required, http_status, load_time_ms
│   ├── navigation    # { navbar[], sidebar[], footer[], breadcrumb[] }
│   ├── forms[]       # form_id, action, method, inputs[], submit, csrf_token
│   ├── buttons[]     # text, type, selector, inside_form
│   ├── inputs[]      # standalone inputs (outside forms)
│   ├── tables[]      # columns, row_count, selector
│   ├── links[]       # text, href, is_external, selector
│   ├── security_components[]  # type, applicable_attacks, owasp, selector
│   ├── url_parameters[]       # name, value, applicable_attacks
│   └── next_candidate_pages[] # URLs discovered on this page
├── graph             # { edges: [{ from, to, trigger_text }] }
└── errors[]          # { url, error_type, message, timestamp }
```

---

## Configuration

Toàn bộ config validate bằng **Zod schemas** (`config/schema.ts`):

```yaml
target: https://example.com          # Required: URL bắt đầu crawl
scope:                                # Include/exclude paths
crawl:                                # max_pages, max_depth, strategy, parallel
auth:                                 # mode + credentials/selectors
browser:                              # type, headless, viewport, locale
timing:                               # navigation_timeout, wait_for_network_idle, action_timeout
retry:                                # max_attempts, backoff_ms
output:                               # dir, filename_pattern, save_screenshots
```

**Config merge order:** YAML defaults ← YAML file ← CLI flags (CLI wins)

**Env expansion:** `${VAR_NAME}` trong YAML values được replace bằng `process.env.VAR_NAME`

---

## Error Handling

- **Per-page retry**: mỗi page retry `max_attempts` lần với linear backoff
- **Non-fatal errors**: page fail không abort toàn bộ crawl, ghi vào `errors[]`
- **Error classification**: timeout, http_5xx, http_4xx, network_error, navigation_error, crash
- **Auth failure**: log warning, tiếp tục crawl anonymous

---

## Known Limitations (MVP)

1. Không detect dynamic content: modals, infinite scroll, tabs, accordions
2. CAPTCHA/Cloudflare sites bị skip
3. SPA hash-routes (#/page) treated as cùng page
4. Không probing forms (safe-by-default, chỉ observe)
5. Mỗi URL mở page mới → SPA lưu auth trong memory sẽ mất token (cần dùng storage_state)
6. Không parallel crawl (parallel config có nhưng chưa implement)
7. `robots.txt` respect config có nhưng chưa implement

---

## Downstream Usage

Output JSON là input cho **Test Generator** (chưa implement):

```
Discovery Output ──┐
                   ├──▶ Test Generator ──▶ Playwright test files (.spec.ts)
Security Rules ────┘    (OWASP payloads)
```

Mỗi `security_component` kèm `applicable_attacks` + Playwright `selector` → đủ thông tin để sinh test case nhắm vào element cụ thể với payload phù hợp.
