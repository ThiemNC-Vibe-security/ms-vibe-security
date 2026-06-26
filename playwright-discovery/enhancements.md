# Discovery Engine v2 — Enhancement Plan

**Goal:** Evolve from a *DOM Model* to an *Application Security Model* — enough semantic, behavioral, and security information that an LLM can generate comprehensive security test cases with minimal extra reasoning.

```
v1 (now):
  Target → DOM Model

v2 (target):
  Target → DOM Model → Semantic Enrichment → Application Model
                                            → Security Enrichment → Application Security Model
```

---

## Implementation strategy by data source

Each enhancement falls into one of four buckets. The bucket dictates how it's implemented.

| Bucket | How it's collected | Cost | Reliability |
|---|---|---|---|
| **A. DOM-only** | One-shot from rendered DOM | Free, fast | Deterministic |
| **B. Runtime monitoring** | Playwright `page.on('request'/'response')` | Cheap, in-flight | Deterministic |
| **C. Interactive probing** | Synthetic form submissions, hover/click | Slower, side-effects | Deterministic but invasive |
| **D. LLM enrichment** | Post-process JSON via Gemini | Token cost, latency | Probabilistic |

The order to build matters: lower buckets feed higher ones.

---

## Requirement matrix

| # | Requirement | Bucket | Depends on | Priority |
|---|---|---|---|---|
| 1 | Semantic input type | A + D | DOM hints; LLM polish | High |
| 2 | Business function / page goal | A + D | Page type (already have) | High |
| 3 | Workflow discovery | B + C | Network monitor | Med |
| 4 | Endpoint discovery | **B** | Network monitor | **High** |
| 5 | Validation rules | A + C | Form probing | Med |
| 6 | Authentication context | A + B | Cookie / header inspection | High |
| 7 | Authorization context | A + B | Auth context | Med |
| 8 | Attack surface annotation | D (rule-based + LLM) | Inputs + endpoints | High |
| 9 | Security headers / cookies | B | Response inspection | High |
| 10 | Application graph | A (already partial) | Crawler edges | Low (mostly done) |
| 11 | State transition | C | Auth flow | Low |
| 12 | API response observation | B | Endpoint discovery | Med |
| 13 | Dynamic UI detection | C | Interactive probing | Low |
| 14 | Security test hints | Rule + D | All of above | High |
| 15 | LLM-friendly summary | D | All of above | Med |

---

## Detailed designs

### 1. Semantic input type — Bucket A + D

Run a **rule-based heuristic first**, fall back to LLM for ambiguous cases.

Rules (DOM-only, fast, free):

```ts
type: 'email'           → semantic: 'email',         data: 'PII'
type: 'tel'             → semantic: 'phone',         data: 'PII'
type: 'password'        → semantic: 'password',      data: 'CREDENTIAL'
type: 'file'            → semantic: 'file_upload',   data: 'BINARY'
type: 'hidden' + name=~/csrf|token/ → semantic: 'csrf', data: 'TOKEN'
type: 'hidden' + name=~/id|uid/     → semantic: 'hidden_identifier', data: 'REFERENCE'
name=~/otp|code/        → semantic: 'otp',           data: 'CREDENTIAL'
name=~/search|^q$/      → semantic: 'search_keyword',data: 'USER_INPUT'
name=~/comment|message/ → semantic: 'comment',       data: 'USER_INPUT'
autocomplete='cc-number' → semantic: 'card_number',  data: 'PAN'
... etc
```

LLM fallback: for inputs where rules can't decide (generic `type=text` with no hint).
Batch all unknowns per page into one Gemini call.

**Implementation:** new module `src/semantic/input-classifier.ts`. Adds `semantic_type` + `data_category` fields to `ExtractedInput`.

---

### 2. Business function / page goal — Bucket A + D

We already have `page_type` (login, registration, etc.). Add:
- `business_goal` — free-text "what is the user trying to accomplish here"
- `workflow_name` — canonical workflow ID

DOM-only rules from URL + page_type cover the common cases. Send rest to Gemini in one batched call across all pages.

**Implementation:** new module `src/semantic/page-enricher.ts`. Adds fields to `DiscoveredPage`.

---

### 3. Workflow discovery — Bucket B + C

For each form, capture the **end-to-end workflow** when it submits.

Steps:
1. Before clicking submit, install `page.on('request')` listener.
2. Fill with safe dummy data (configurable per semantic type).
3. Click submit, wait for navigation OR response.
4. Capture:
   - Endpoint called (URL, method)
   - Response status
   - URL after submission
   - Visible elements that appeared (success/error message)
5. Restore page state (back-navigate).

**Risks:** real side-effects (sends emails, creates records). Must be **opt-in** via `crawl.probe_forms: true`. Off by default.

**Implementation:** `src/probe/form-probe.ts`. Adds `workflow` array + `expected_outcome.actual` to ExtractedForm.

---

### 4. Endpoint discovery — Bucket B ⭐ **highest impact**

Playwright exposes every network request:

```ts
page.on('request', req => {
  if (req.resourceType() === 'fetch' || req.resourceType() === 'xhr' || req.method() !== 'GET') {
    record({ url: req.url(), method: req.method(), postData: req.postData() });
  }
});
```

Collect during page load **and** during any form probing.

What we get for free:
- AJAX/fetch endpoints
- GraphQL endpoints (POST to `/graphql`)
- WebSocket connections (`page.on('websocket')`)
- The actual `form action=` for non-AJAX forms

**Implementation:** `src/probe/network-monitor.ts`. Per-page `endpoints[]` array on `DiscoveredPage`.

---

### 5. Validation rule extraction — Bucket A + C

**Bucket A (free, in DOM):**
- `required`, `minlength`, `maxlength`, `pattern`, `min`, `max`, `step` (we already extract these but don't surface them well)
- `type` itself implies validation (`email`, `url`, `number`, ...)
- Surface as a normalized rule list

**Bucket C (opt-in form probing):**
- Submit empty form → record validation messages shown
- Submit invalid format → record messages
- Read `validationMessage` property from inputs

Output:

```json
"validation": {
  "rules": [
    { "kind": "required", "source": "html_attribute" },
    { "kind": "email_format", "source": "input_type" },
    { "kind": "max_length", "value": 100, "source": "html_attribute" },
    { "kind": "custom", "message": "Phone must be 10 digits", "source": "probed" }
  ]
}
```

**Implementation:** enrich `ExtractedInput` with normalized `validation.rules[]`.

---

### 6. Authentication context — Bucket A + B

Detect from multiple signals:
- **Cookies** after page load — names like `session`, `JSESSIONID`, `connect.sid`, `__Secure-*`
- **Storage** — JWT in localStorage / sessionStorage
- **Request headers** — `Authorization: Bearer ...`, `X-API-Key`
- **Response headers** — `Set-Cookie` flags, `WWW-Authenticate`

Inference:

```
Cookie session    → type: "cookie_session"
Authorization: Bearer eyJ... → type: "JWT"
X-API-Key header  → type: "api_key"
WWW-Authenticate: Basic     → type: "basic"
WWW-Authenticate: Bearer    → type: "oauth_bearer"
```

**Implementation:** `src/probe/auth-detector.ts`. Adds `authentication` object to `DiscoveryMetadata` (global) and `authentication_required` already on page.

---

### 7. Authorization context — Bucket B (best-effort)

This is hard to detect generically. Best signals:
- HTTP 401 / 403 responses → page requires auth
- Redirects to login URL when not authenticated
- Compare anonymous vs authenticated crawl coverage (advanced)

For MVP v2: just record observed responses per page. Tag pages with `auth_observed` (anonymous 200 / auth 401 / auth 403).

**Implementation:** extend network-monitor to record status codes per requested URL.

---

### 8. Attack surface annotation — Rule + D

We already have `security_components[]`. Now extend per-input:

```json
{
  "input": "comment",
  "semantic_type": "comment",
  "attack_surface": ["XSS_stored", "HTML_injection", "Unicode_injection", "Length_overflow"]
}
```

Mapping table (semantic_type → attack list) lives in `src/security/attack-surface.ts`. No LLM needed for this step.

For URL params we already do `open_redirect`, `idor`, etc. — extend the table.

**Implementation:** lookup table + apply during page-extractor or post-processing.

---

### 9. Security headers + cookies — Bucket B

For every navigation response, record:
- HTTPS / HTTP
- `Content-Security-Policy` present + key directives
- `Strict-Transport-Security` (HSTS)
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- Cookie flags per cookie: `Secure`, `HttpOnly`, `SameSite`
- CORS headers
- Mixed-content warnings

Each page gets:

```json
{
  "security_metadata": {
    "https": true,
    "headers": {
      "csp": { "present": true, "directives": {...} },
      "hsts": { "present": true, "max_age": 31536000 },
      ...
    },
    "cookies": [
      { "name": "session", "secure": true, "http_only": true, "same_site": "Strict" }
    ]
  }
}
```

**Implementation:** `src/probe/security-headers.ts`. Hooks into network-monitor.

---

### 10. Application graph — already partial

We already have `graph.edges[]`. Enhance edge with:
- `action` — `click_link` | `submit_form` | `redirect` | `navigation`
- `selector` — already partial (`trigger_selector`)
- `navigation_type` — same-page / hard-nav / SPA-route

**Implementation:** crawler.ts — populate trigger_selector properly, add action type.

---

### 11. State transition — Bucket C (advanced)

Run the crawler **twice**: once anonymous, once authenticated (if auth configured). Diff the resulting graphs:
- Pages reachable only as anon → public
- Pages reachable only as auth → protected
- Pages with different content → auth-aware page

Each transition recorded:

```json
{ "before": "guest", "trigger": "Login form submission", "after": "authenticated", "endpoint": "/api/login" }
```

**Implementation:** v2.2 (later). Requires double-crawl orchestration.

---

### 12. API response observation — Bucket B

For each endpoint captured in (#4), also record:
- HTTP status
- Content type
- Response time
- Response size
- Sampled response body for known content types (`application/json` only, first 2KB)
- Schema sketch (key names + types, no values)

Be careful: never log auth tokens, never log PII from response bodies.

**Implementation:** extend network-monitor.

---

### 13. Dynamic UI detection — Bucket C (low priority)

The big ones:
- **Modals** — track `dialog`-role elements that become visible after click
- **Tabs** — `role=tablist`, click each tab to extract content
- **Accordion** — `role=button[aria-expanded]`
- **Infinite scroll** — scroll until no new content
- **Tooltip / popover** — hover known triggers

Each unlocked region runs the same browser-extract over its content.

**Implementation:** v2.2. Significant complexity; do after the security pipeline works.

---

### 14. Security test hints — Rule + D

Per component, output a ranked list of suggested tests so the Test Generator doesn't need to re-infer:

```json
"security_tests": [
  { "test_id": "EMPTY_REQUIRED",  "priority": "high" },
  { "test_id": "SQL_INJECTION",   "priority": "high",   "payload_class": "sqli_basic" },
  { "test_id": "XSS_REFLECTED",   "priority": "med",    "payload_class": "xss_basic" },
  { "test_id": "MAX_LENGTH",      "priority": "low",    "value": 10000 }
]
```

Rule-based derivation from (semantic_type + validation + attack_surface). Optional LLM pass to add context.

**Implementation:** `src/security/test-hints.ts`.

---

### 15. LLM-friendly summary — Bucket D

Post-processing step. Send the structured JSON to Gemini with prompt:

> "Summarize this discovery JSON in <=200 words: what is this application, primary user flows, primary security-relevant components. Output as JSON."

Add at top level of `DiscoveryOutput`:

```json
"summary": {
  "application": "...",
  "purpose": "...",
  "primary_flows": [...],
  "authentication": "...",
  "security_relevant_components": [...]
}
```

**Implementation:** `src/enrich/llm-summary.ts`. Optional via config (`llm.enabled: true`).

---

## Output schema diff (v1 → v2)

### `ExtractedInput`
```diff
{
  "selector": "input[name='email']",
  "playwright_locator": "page.getByLabel('Email')",
  "name": "email",
  "type": "email",
  "label": "Your Email",
  "required": true,
+ "semantic_type": "email",
+ "data_category": "PII",
+ "validation": {
+   "rules": [
+     {"kind": "required", "source": "html_attribute"},
+     {"kind": "email_format", "source": "input_type"}
+   ]
+ },
+ "attack_surface": ["email_injection", "xss_reflected", "sql_injection"],
+ "security_tests": [
+   {"test_id": "EMPTY_REQUIRED", "priority": "high"},
+   {"test_id": "INVALID_EMAIL",  "priority": "med"}
+ ]
}
```

### `ExtractedForm`
```diff
{
  "selector": "form[data-testid='contact-form']",
  "action": null,
  "method": "POST",
  ...
+ "endpoint": { "url": "/api/contact", "method": "POST", "discovered_via": "network_monitor" },
+ "expected_outcome": {
+   "success_redirect": "/thank-you",
+   "success_status": 200,
+   "error_indicator_selector": "[role='alert']"
+ },
+ "workflow": [
+   {"step": "fill_form"},
+   {"step": "submit"},
+   {"step": "post", "endpoint": "/api/contact"},
+   {"step": "show_success_message", "selector": "..."}
+ ],
+ "business_goal": "Submit customer inquiry"
}
```

### `DiscoveredPage`
```diff
{
  "url": "...",
  "page_type": "contact_page",
+ "business_goal": "Customer support inquiry",
+ "workflow_name": "contact_form_submission",
  ...
+ "endpoints": [
+   {"url": "/api/csrf",    "method": "GET",  "status": 200},
+   {"url": "/api/contact", "method": "POST", "status": 200, "trigger_form": "contact-form-0"}
+ ],
+ "security_metadata": {
+   "https": true,
+   "headers": { "csp": {...}, "hsts": {...}, "x_frame_options": "DENY" },
+   "cookies": [{...}]
+ },
+ "authentication_context": {
+   "session_type": "cookie",
+   "required": true
+ }
}
```

### `DiscoveryOutput` (top level)
```diff
{
  "metadata": {...},
  "stats": {...},
  "pages": [...],
  "graph": {...},
  "errors": [...],
+ "summary": {
+   "application": "Contact Form site",
+   "purpose": "Customer inquiry submission",
+   "primary_flows": ["Submit contact form"],
+   "authentication": "None",
+   "security_relevant_components": ["POST contact endpoint", "Email input"]
+ }
}
```

---

## Proposed phased rollout

### Phase 2.0 — Network awareness (Bucket B, no opt-in needed)
*Biggest leverage, lowest risk. Pure observation, no side effects.*

- Endpoint discovery (#4)
- Security headers + cookies (#9)
- API response observation (#12) — passive only
- Auth detection from cookies/headers (#6 partial)

→ Already huge gain for security test generation.

### Phase 2.1 — Semantic enrichment (Buckets A + D)
*Rule-based first, LLM as fallback.*

- Semantic input type (#1)
- Business function (#2 enrich)
- Attack surface table (#8)
- Security test hints (#14)
- LLM summary (#15) — opt-in

### Phase 2.2 — Interactive probing (Bucket C, opt-in only)
*Side-effectful — flag-gated.*

- Form probing for validation rules (#5 C-part)
- Workflow capture (#3)
- Dynamic UI (#13) — modals/tabs/accordion

### Phase 2.3 — Advanced
*Multi-pass crawling.*

- Authorization differential crawl (#11)
- State transition mapping
- API schema inference

---

## Config surface for v2

```yaml
discovery:
  # New
  enable_network_monitor: true       # Phase 2.0 — recommended on
  enable_semantic_enrichment: true   # Phase 2.1 — rule-based, free
  enable_llm_enrichment: false       # Phase 2.1 — needs GEMINI_API_KEY
  
  probe:
    enable: false                    # Phase 2.2 — opt-in (side effects)
    forms: false                     # try empty + invalid submissions
    modals: false
    tabs: false

llm:
  provider: gemini
  api_key: ${GEMINI_API_KEY}
  model: gemini-2.5-flash
  semantic_fallback: true            # use LLM for inputs the rules can't classify
  generate_summary: true             # final LLM-friendly summary
```

---

## Implementation order recommendation

If you want quick wins, start with **Phase 2.0** (network monitor) and **semantic input type rules** (Phase 2.1 first half). Both are deterministic, no side effects, no LLM cost — and they unlock 80% of the value the Test Generator needs.

LLM enrichment and form probing come after, when the rule-based pipeline is stable.
