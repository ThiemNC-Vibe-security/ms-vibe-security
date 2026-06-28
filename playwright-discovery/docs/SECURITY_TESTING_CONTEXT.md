# Security Testing Context (STC)

Hướng dẫn này giải thích cách output của `playwright-discovery` được dùng làm **Security Testing Context (STC)** để sinh Playwright security tests.

---

## STC là gì

STC là tập hợp ngữ cảnh có cấu trúc được feed vào LLM (Gemini 2.5 Flash) để sinh test scripts. Bao gồm:

1. **Discovery Output** — kết quả của `playwright-discovery` (schema mô tả ở [`OUTPUT_SCHEMA.md`](./OUTPUT_SCHEMA.md))
2. **Security Knowledge** — knowledge base OWASP (từ `test-generator/knowledge/attacks/*.yml`)
3. **Tester Requirements** — scope, priority, target từ config của tester

---

## Pipeline tổng thể

```
playwright-discovery run --config discovery.yml
         ↓
discovery_{timestamp}.json
         ↓
test-generator plan --discovery discovery.json --requirements req.yml
         ↓
test_plan.json  (N test plans, mỗi plan = 1 attack surface × 1 attack type)
         ↓
test-generator generate --plan test_plan.json
         ↓
tests/generated/*.spec.ts  (Playwright test files)
```

---

## Cách đọc attack_surface_model

### auth_surfaces

Mỗi `auth_surface` là một form/input bảo mật cao. Ưu tiên test:

```json
{
  "type": "login_form",
  "page_url": "https://app.example.com/login",
  "selector": "form",
  "risk_level": "high",
  "recommended_tests": ["sql_injection", "broken_auth", "rate_limit", "default_credentials"]
}
```

Với login form → test: SQL Injection (`' OR '1'='1`), brute force, session fixation.

### data_input_surfaces

Form/input nhận user input, dễ bị XSS hoặc injection:

```json
{
  "type": "search_box",
  "selector": "input[name=\"q\"]",
  "semantic_types": ["search"],
  "risk_level": "medium",
  "recommended_tests": ["xss_reflected", "xss_dom", "sql_injection"]
}
```

### file_upload_surfaces

```json
{
  "page_url": "https://app.example.com/profile",
  "selector": "input[type=\"file\"]",
  "recommended_tests": ["xss_stored", "path_traversal", "command_injection"]
}
```

### api_surfaces

URL parameters có thể bị injection:

```json
{
  "page_url": "https://app.example.com/transactions?user_id=1",
  "parameters": [{ "name": "user_id", "in": "query", "applicable_attacks": ["idor", "sql_injection"] }]
}
```

---

## Cách dùng candidate_playwright_flows

`security_testing_context.candidate_playwright_flows` là template flows được sinh tự động từ evidence:

```json
{
  "flow_id":   "flow_login_sqli",
  "description": "Inject SQL payloads into login fields and verify no bypass or error leak",
  "start_url": "https://app.example.com/login",
  "steps": [
    "Navigate to https://app.example.com/login",
    "Fill username with SQL payload (e.g. `' OR '1'='1`)",
    "Fill password with any value",
    "Submit form",
    "Assert: login is rejected, no 500 error, no SQL error in response"
  ],
  "covers_attack_ids": ["sql_injection", "stack_trace_leak"]
}
```

LLM dùng flow này cùng với knowledge YAML (OWASP payloads, detection rules) để sinh Playwright test đầy đủ.

---

## Mapping attack_id → knowledge base

Tất cả `applicable_attacks` và `recommended_tests` trong output phải map về `id` trong `test-generator/knowledge/attacks/*.yml`. Ví dụ:

| attack_id | knowledge file |
|-----------|---------------|
| `sql_injection` | `attacks/sql-injection.yml` |
| `xss_reflected` | `attacks/xss.yml` |
| `csrf` | `attacks/csrf.yml` |
| `broken_auth` | `attacks/broken-auth.yml` |
| `idor` | `attacks/idor.yml` |
| `rate_limit` | `attacks/rate-limit.yml` |
| `path_traversal` | `attacks/path-traversal.yml` |

---

## Ví dụ thực tế — Finance App

Discovery output với VC-AWG-Demo (trang quản lý tài chính):

**Attack surfaces được phát hiện:**
- `login_form` tại `/login` → test SQL injection, rate limit, session fixation
- `form_without_csrf` tại `/transactions` → test CSRF
- `search_box` tại nhiều trang → test XSS reflected
- `file_upload` tại `/profile` → test unrestricted upload
- URL param `user_id` → test IDOR

**Endpoints captured (Phase 5):**
- `POST /api/auth/login` — auth_related: true
- `GET /api/transactions` — không auth-related
- `POST /api/transactions` — không auth-related

**Candidate flows được sinh:**
1. `flow_login_brute_force` — rate limit test
2. `flow_login_sqli` — SQL injection test
3. `flow_search_xss` — XSS test
4. `flow_csrf_state_change` — CSRF test

---

## Evaluation metrics cho báo cáo nghiên cứu

```json
{
  "pages_discovered":     12,
  "forms_discovered":     5,
  "inputs_discovered":    24,
  "endpoints_discovered": 8,
  "selector_success_rate": 0.912,
  "attack_surface_count": 9,
  "security_components_detected": 14
}
```

`selector_success_rate` phản ánh chất lượng của selector generation (Phase 2). Giá trị > 0.85 là tốt cho mục đích sinh test.

---

## Giới hạn của STC

- STC chỉ dựa trên **evidence từ discovery** — không hallucinate attack surface.
- **Không kiểm tra logic nghiệp vụ** — IDOR phụ thuộc vào dữ liệu test cụ thể.
- **Không thay thế manual pentest** — đặc biệt với business logic vulnerabilities.
- **API endpoint coverage phụ thuộc vào interaction** — chỉ capture được API khi page đã thực sự gọi chúng trong quá trình crawl.
