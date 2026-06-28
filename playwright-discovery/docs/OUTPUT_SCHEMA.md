# Output Schema

Mỗi lần chạy discovery sinh ra một file JSON có tên theo pattern `discovery_{timestamp}.json`.

---

## Root object

```json
{
  "metadata":                 DiscoveryMetadata,
  "stats":                    DiscoveryStats,
  "pages":                    DiscoveredPage[],
  "graph":                    CrawlGraph,
  "errors":                   DiscoveryError[],
  "endpoints":                CapturedEndpoint[],
  "network_summary":          NetworkSummary,
  "application_model":        ApplicationModel,
  "attack_surface_model":     AttackSurfaceModel,
  "security_testing_context": SecurityTestingContext,
  "evaluation_metrics":       EvaluationMetrics
}
```

---

## metadata

```json
{
  "base_url":          "https://example.com",
  "discovered_at":     "2026-06-28T15:30:00.000Z",
  "duration_seconds":  12.4,
  "playwright_version":"unknown",
  "user_agent":        "playwright-default",
  "config_hash":       "a1b2c3d4e5f6"
}
```

---

## stats

Tổng hợp nhanh để đọc lướt:

```json
{
  "pages_discovered":  8,
  "pages_failed":      1,
  "total_forms":       5,
  "total_inputs":      18,
  "total_buttons":     24,
  "total_links":       97,
  "security_components": 11
}
```

---

## pages[]  — DiscoveredPage

Mỗi phần tử đại diện cho một URL đã được crawl:

```json
{
  "url":                   "https://example.com/login",
  "url_path":              "/login",
  "title":                 "Login – MyApp",
  "page_type":             "login",
  "language":              "en",
  "authentication_required": false,
  "http_status":           200,
  "load_time_ms":          843,

  "forms":    [ ExtractedForm ],
  "inputs":   [ ExtractedInput ],
  "buttons":  [ ExtractedButton ],
  "links":    [ ExtractedLink ],
  "tables":   [ ExtractedTable ],
  "navigation": {
    "navbar": [], "sidebar": [], "footer": [], "breadcrumb": []
  },

  "security_components":   [ SecurityComponent ],
  "url_parameters":        [ UrlParameter ],
  "dynamic_components":    [ DynamicComponent ],
  "interactions_performed": [ InteractionRecord ],

  "next_candidate_pages":  [ "https://example.com/dashboard" ],
  "screenshot_path":       null
}
```

### page_type values

`login` | `registration` | `password_recovery` | `dashboard` | `profile` | `settings` | `admin` | `payment` | `checkout` | `cart` | `search` | `list` | `detail` | `generic_form` | `error` | `landing` | `content` | `unknown`

---

## ExtractedInput

Mỗi input (trong form hoặc standalone) có đầy đủ metadata:

```json
{
  "selector":           "input[name=\"email\"]",
  "playwright_locator": "page.getByLabel('Email')",
  "alternate_locators": [ "page.locator('input[name=\"email\"]')" ],

  "selector_verified":     true,
  "selector_unique":       true,
  "selector_match_count":  1,
  "selector_confidence":   "high",

  "tag":          "input",
  "name":         "email",
  "id":           "email-field",
  "type":         "email",
  "label":        "Email",
  "placeholder":  "Enter your email",
  "required":     true,
  "autocomplete": "email",
  "pattern":      null,
  "min_length":   null,
  "max_length":   255,
  "default_value": "",
  "aria_label":   null,
  "data_testid":  null,

  "semantic_type":       "email",
  "data_category":       "pii",
  "security_relevance":  "high"
}
```

#### selector_confidence

| Giá trị | Nghĩa |
|---------|-------|
| `high`  | Đã verify, chính xác 1 element |
| `medium`| Đã verify, >1 element khớp |
| `low`   | Chưa verify (fallback css-path) |

#### semantic_type

`email` | `password` | `username` | `search` | `amount` | `date` | `file` | `phone` | `id` | `comment` | `hidden_token` | `url` | `otp` | `unknown`

#### data_category

`credential` | `pii` | `financial` | `user_input` | `identifier` | `security_token` | `unknown`

---

## ExtractedForm

```json
{
  "selector":   "form",
  "playwright_locator": "page.locator('form')",
  "alternate_locators": [],
  "selector_verified":  true,
  "selector_unique":    true,
  "selector_match_count": 1,
  "selector_confidence": "high",

  "form_id":  "login-form",
  "action":   "/api/auth/login",
  "method":   "POST",
  "enctype":  "application/x-www-form-urlencoded",
  "inputs":   [ ExtractedInput ],
  "submit":   ExtractedButton,
  "csrf_token": { "present": false, "field_name": null }
}
```

---

## SecurityComponent

Mỗi component bảo mật được phát hiện trên page:

```json
{
  "type":               "login_form",
  "selector":           "form",
  "applicable_attacks": ["sql_injection", "broken_auth", "rate_limit"],
  "owasp":              ["A07:2025", "A05:2025"],
  "description":        "Auto-detected login_form (2 inputs)"
}
```

#### type values

`login_form` | `admin_login_form` | `registration_form` | `password_recovery` | `password_change_form` | `password_field` | `search_box` | `comment_form` | `profile_form` | `generic_form` | `file_upload` | `file_download` | `payment_form` | `admin_function` | `csrf_protected_form` | `form_without_csrf`

---

## endpoints[]  — CapturedEndpoint (Phase 5)

XHR/fetch endpoint được capture trong quá trình crawl:

```json
{
  "method":            "POST",
  "url":               "https://example.com/api/auth/login",
  "path":              "/api/auth/login",
  "normalized_path":   "/api/auth/login",
  "resource_type":     "fetch",
  "initiator_page_url": "https://example.com/login",
  "request_headers":   { "content-type": "application/json", "authorization": "REDACTED" },
  "request_body_sample": { "email": "test@test.com", "password": "REDACTED" },
  "response_status":   200,
  "response_content_type": "application/json",
  "response_body_sample": null,
  "query_parameters":  [],
  "auth_related":      true,
  "sensitive_data_detected": ["password", "authorization", "auth_endpoint"],
  "discovered_at":     "2026-06-28T15:30:05.000Z"
}
```

Path normalization: `/api/users/123` → `/api/users/:id`

---

## application_model (Phase 4)

```json
{
  "routes": [
    { "path": "/login", "url": "https://example.com/login", "page_type": "login", "authentication_required": false }
  ],
  "forms": [
    { "form_id": "login-form", "page_url": "https://example.com/login", "action": "/api/auth/login", "method": "POST", "input_count": 2, "has_csrf_token": false, "high_relevance_inputs": ["input[name=\"email\"]", "input[name=\"password\"]"] }
  ],
  "navigation_graph": [
    { "from": "https://example.com/login", "to": "https://example.com/dashboard", "trigger_text": "Login" }
  ]
}
```

---

## attack_surface_model (Phase 4)

```json
{
  "entry_points": [
    { "url": "https://example.com/login", "page_type": "login", "component_types": ["login_form", "form_without_csrf"] }
  ],
  "auth_surfaces": [
    { "type": "login_form", "page_url": "https://example.com/login", "selector": "form", "risk_level": "high", "recommended_tests": ["sql_injection", "broken_auth", "rate_limit"], "owasp": ["A07:2025"] }
  ],
  "data_input_surfaces": [ ... ],
  "file_upload_surfaces": [ ... ],
  "admin_surfaces": [ ... ],
  "api_surfaces": [
    { "page_url": "https://example.com/dashboard?user_id=1", "parameters": [{ "name": "user_id", "in": "query", "applicable_attacks": ["idor", "sql_injection"] }] }
  ]
}
```

#### risk_level values

`critical` | `high` | `medium` | `low`

---

## security_testing_context (Phase 4)

```json
{
  "recommended_test_categories": [
    { "id": "sql_injection", "label": "SQL Injection", "attack_ids": ["sql_injection"], "evidence_count": 3, "source_pages": ["/login", "/search"] }
  ],
  "priority_targets": [
    { "page_url": "https://example.com/login", "component_type": "login_form", "selector": "form", "risk_level": "high", "attack_ids": [...], "reason": "Auth surface — primary target for broken authentication and injection" }
  ],
  "candidate_playwright_flows": [
    {
      "flow_id":             "flow_login_brute_force",
      "description":         "Attempt login with invalid credentials and verify rate limiting",
      "start_url":           "https://example.com/login",
      "steps":               [ "Navigate to ...", "Fill username ...", "..." ],
      "covers_attack_ids":   ["broken_auth", "rate_limit", "default_credentials"]
    }
  ]
}
```

---

## evaluation_metrics (Phase 7)

Phục vụ báo cáo nghiên cứu và so sánh giữa các lần chạy:

```json
{
  "pages_discovered":          8,
  "crawl_errors":              1,
  "forms_discovered":          5,
  "inputs_discovered":         18,
  "buttons_discovered":        24,
  "links_discovered":          97,
  "endpoints_discovered":      12,
  "selectors_total":           250,
  "selectors_verified":        228,
  "selector_success_rate":     0.912,
  "security_components_detected": 11,
  "attack_surface_count":      9,
  "dynamic_components_discovered": 3
}
```

`selector_success_rate` = `selectors_verified / selectors_total`. Null nếu không có selector nào.

---

## dynamic_components[]  — DynamicComponent (Phase 6)

Chỉ có dữ liệu khi `interact.enabled: true`:

```json
{
  "type":             "modal",
  "trigger_selector": "button:has-text(\"Filter\")",
  "trigger_text":     "Filter",
  "title":            "Filter Transactions",
  "forms":            [ ExtractedForm ],
  "buttons":          [ ExtractedButton ],
  "inputs":           [ ExtractedInput ]
}
```

#### type values

`modal` | `tab_panel` | `dropdown` | `accordion` | `unknown`

---

## errors[]  — DiscoveryError

```json
{
  "url":        "https://example.com/broken",
  "error_type": "timeout",
  "message":    "Timeout 30000ms exceeded",
  "timestamp":  "2026-06-28T15:30:10.000Z"
}
```

Lỗi không làm dừng crawl — trang lỗi được bỏ qua và ghi vào mảng này.
