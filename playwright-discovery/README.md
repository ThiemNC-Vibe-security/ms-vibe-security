# playwright-discovery

**playwright-discovery** là Discovery Engine dùng Playwright để thu thập cấu trúc của web application và tạo ra Security Testing Context (STC) có cấu trúc.

> **Lưu ý:** Đây **không phải** là DAST scanner và không khai thác lỗ hổng bảo mật. Tool này là tầng Discovery Engine để tạo ngữ cảnh cho LLM hoặc DAST orchestrator sử dụng tiếp.

## Flow

```
Target Website
  → Playwright Discovery
  → Application Model (routes, forms, navigation graph)
  → Attack Surface Model (auth surfaces, data inputs, file uploads, API endpoints)
  → Security Testing Context (test categories, priority targets, candidate flows)
  → LLM-generated Playwright Security Tests
```

---

## Cài đặt

```bash
npm install
npx playwright install chromium
```

## Quick start

```bash
# Sinh config mẫu
npm run dev -- init

# Chạy discovery với URL trực tiếp
npm run dev -- run --url https://example.com --max-pages 10

# Dùng config file YAML
npm run dev -- run --config ./examples/basic.yml

# Verbose logging
npm run dev -- run --config ./examples/basic.yml -v
```

Sau khi build (`npm run build`):

```bash
node dist/cli.js run --config ./examples/basic.yml
```

---

## CLI Options

| Flag | Mô tả |
|------|-------|
| `-c, --config <path>` | Load YAML config file |
| `-u, --url <url>` | Target URL (override `config.target`) |
| `--max-pages <n>` | Số trang tối đa |
| `--max-depth <n>` | Độ sâu crawl tối đa |
| `--strategy <bfs\|dfs>` | Chiến lược crawl |
| `--output-dir <dir>` | Thư mục output JSON |
| `--save-screenshots` | Lưu screenshot mỗi trang |
| `--headless` / `--no-headless` | Bật/tắt headless mode |
| `--browser <type>` | `chromium` / `firefox` / `webkit` |
| `-v, --verbose` | Debug logging |

CLI flags luôn override config file.

---

## Config YAML

Xem schema đầy đủ tại [`docs/OUTPUT_SCHEMA.md`](./docs/OUTPUT_SCHEMA.md). Dưới đây là config tham khảo:

```yaml
target: https://your-app.example.com

scope:
  include: []        # glob patterns — rỗng = không lọc
  exclude:
    - /logout
    - /admin/**

crawl:
  max_pages: 20
  max_depth: 3
  strategy: bfs      # bfs | dfs
  same_domain_only: true
  follow_subdomains: false

auth:
  mode: none         # none | basic | bearer | form | storage_state

browser:
  type: chromium     # chromium | firefox | webkit
  headless: true
  viewport:
    width: 1280
    height: 800

timing:
  navigation_timeout: 30000
  wait_for_network_idle: true
  wait_after_navigation: 1000
  action_timeout: 10000

retry:
  max_attempts: 2
  backoff_ms: 2000

output:
  dir: ./output
  filename_pattern: discovery_{timestamp}.json
  save_screenshots: false

network:
  enabled: true                  # capture XHR/fetch endpoints
  capture_request_body: true
  capture_response_body: false   # tắt để tiết kiệm bộ nhớ
  redact_sensitive_values: true
  max_body_sample_size: 2048
  xhr_only: true

interact:
  enabled: false                 # DEFAULT OFF — bật để discover modal/tab/dropdown
  max_interactions_per_page: 10
  discover_modals: true
  discover_tabs: true
  discover_dropdowns: true
  interaction_settle_ms: 600
```

### Authentication

#### Form login

```yaml
auth:
  mode: form
  login_url: /login
  username_selector: 'input[name="email"]'
  password_selector: 'input[name="password"]'
  submit_selector: 'button[type="submit"]'
  username: ${TEST_USER}
  password: ${TEST_PASSWORD}
  success_indicator: url=/dashboard
  save_storage_state: ./auth-state.json  # lưu để tái sử dụng
```

Credentials được đọc từ `.env`. Chạy lần đầu để login, các lần sau dùng `auth-state.json` (nhanh hơn nhiều).

#### Storage state (reuse login)

```yaml
auth:
  mode: storage_state
  storage_state_path: ./auth-state.json
```

#### Bearer token

```yaml
auth:
  mode: bearer
  token: ${API_TOKEN}
```

---

## Output

Output được ghi vào file JSON với timestamp suffix:

```
output/
├── discovery_20260628_153000.json
└── screenshots/          # nếu save_screenshots: true
    ├── page_001.png
    └── page_002.png
```

Xem schema đầy đủ tại [`docs/OUTPUT_SCHEMA.md`](./docs/OUTPUT_SCHEMA.md).

Root-level shape:

```json
{
  "metadata":                 { "base_url": "...", "discovered_at": "...", "duration_seconds": 12.4 },
  "stats":                    { "pages_discovered": 8, "total_forms": 3, "security_components": 5 },
  "pages":                    [ ],
  "graph":                    { "edges": [ ] },
  "errors":                   [ ],
  "endpoints":                [ ],
  "network_summary":          { },
  "application_model":        { "routes": [], "forms": [], "navigation_graph": [] },
  "attack_surface_model":     { "auth_surfaces": [], "data_input_surfaces": [], ... },
  "security_testing_context": { "recommended_test_categories": [], "priority_targets": [], "candidate_playwright_flows": [] },
  "evaluation_metrics":       { "pages_discovered": 8, "selector_success_rate": 0.91, ... }
}
```

Xem chi tiết cách dùng output để sinh security tests tại [`docs/SECURITY_TESTING_CONTEXT.md`](./docs/SECURITY_TESTING_CONTEXT.md).

---

## Examples

| File | Mô tả |
|------|-------|
| [`examples/basic.yml`](./examples/basic.yml) | Public site, không auth |
| [`examples/with-auth.yml`](./examples/with-auth.yml) | Storage state login, crawl sau auth |
| [`examples/full-config.yml`](./examples/full-config.yml) | Full config với network + interact bật |

---

## Tests

```bash
npm test           # chạy một lần
npm run test:watch # watch mode
```

109 unit tests covering: `normalizeUrl`, `matchGlob`, `generateSelector`, `classifyConfidence`, `classifyPage`, `classifyInput`, `normalizePath`, `buildNetworkSummary`, `buildEvaluationMetrics`.

---

## Project layout

```
src/
├── cli.ts                    # CLI entry (Commander subcommands)
├── config/                   # Zod schema + YAML loader
├── crawler/                  # BFS/DFS orchestrator, URL queue, dynamic explorer
├── auth/                     # form / basic / bearer / storage_state handlers
├── extractors/               # DOM extraction (browser-side) + Node transformer
├── selectors/                # Playwright selector generation + verification
├── classifier/               # page type + security component + semantic input
├── probe/                    # network monitor (XHR/fetch capture)
├── output/                   # DiscoveryOutput schema, model builder, metrics
└── utils/                    # Pino logger, retry helper
tests/                        # Vitest unit tests (no Playwright, no internet)
docs/                         # OUTPUT_SCHEMA.md, SECURITY_TESTING_CONTEXT.md
examples/                     # YAML config examples
```

---

## Limitations

- **Không phải DAST scanner** — không tự động khai thác lỗ hổng, không thay thế OWASP ZAP / Wapiti / Nuclei.
- **Không tự submit form** — side-effect actions phải bật thủ công trong config.
- **Dynamic UI** — mặc định tắt (`interact.enabled: false`). Khi tắt, modal/tab/dropdown ẩn không được crawl.
- **Network capture** — chỉ capture request được trigger trong quá trình crawl. API endpoint không được call sẽ không xuất hiện trong output.
- **CAPTCHA / Cloudflare** — không bypass, page bị chặn sẽ bị ghi vào `errors[]`.
- **SPA hash routing** — `#/route1` và `#/route2` được coi là cùng một page.
- **Selector verification** — thêm N lần `locator.count()` call mỗi page (N = số element). Có thể làm chậm crawl trên trang lớn.

## Config fields — reserved for future use

| Field | Default | Ghi chú |
|-------|---------|---------|
| `crawl.parallel` | `1` | `reserved_for_future_use` — crawl tuần tự hiện tại |
| `crawl.respect_robots_txt` | `true` | `reserved_for_future_use` — chưa đọc robots.txt |
| `output.save_traces` | `false` | `reserved_for_future_use` — chưa lưu Playwright traces |

---

## License

Internal / academic project.
