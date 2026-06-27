# Security Knowledge

Each YAML file under `attacks/` defines one attack class. The Planner reads only the high-level metadata (id, name, owasp, cwe, asvs, applies_to). The Generator gets the full file for the test case it's writing.

## Coverage

The knowledge base aligns with the following standards:

- **OWASP Top 10:2025** (released November 2025) — primary mapping
- **OWASP Top 10:2021** — kept for backward traceability
- **OWASP ASVS v5.0.0** (released May 2025) — verification requirement IDs
- **MITRE CWE** — root weakness types

## File schema

```yaml
id: <snake_case_id>              # required, unique join key
name: <human readable>           # required

owasp:                           # OWASP Top 10 mappings (any year)
  - A05:2025
  - A03:2021

cwe:                             # MITRE CWE IDs
  - CWE-89

asvs:                            # ASVS v5.0 requirement IDs
  - V5.3.4

applies_to:                      # which discovery security_components this targets,
  - login_form                   # plus the special value "any_page" for
  - search_box                   # page-level checks (headers, cookies, CORS).
  - any_page

payloads:                        # strings to inject; may be empty for
  - "' OR '1'='1"                # behavioral attacks (rate limit, csrf).

detection:                       # how to recognise a vulnerability
  - response_contains_sql_error
  - response_time_above_threshold:5000

test_template_hints:             # nudges to the test-generator LLM
  - inject_into_each_input_separately
  - assert_no_stack_trace_visible

description: |
  Optional longer description for humans.
```

## Conventions

- `id` is the join key referenced by `TestCase.attack_id` in the plan.
- `applies_to` values are matched against:
  - `security_components[].type` produced by playwright-discovery, OR
  - `url_parameters[].applicable_attacks`, OR
  - the special string `any_page` (page-level checks).
- Payloads are passed verbatim to the LLM; keep them small and well-formed.
- New attacks: drop a YAML file into `attacks/`. They are auto-discovered.

## Current attack catalogue

### Injection (OWASP A05:2025 / A03:2021)
- `sql_injection`, `nosql_injection`, `command_injection`, `ssti`
- `xss_reflected`, `xss_stored`, `xss_dom`

### Broken Access Control (OWASP A01:2025)
- `idor`, `open_redirect`, `path_traversal`, `ssrf`

### Authentication Failures (OWASP A07:2025)
- `broken_auth`, `weak_password_policy`, `rate_limit`, `csrf`
- `session_cookie_flags`, `session_fixation`, `jwt_vulns`

### Security Misconfiguration (OWASP A02:2025)
- `security_headers_missing`, `clickjacking`, `cors_misconfig`, `default_credentials`

### Cryptographic Failures (OWASP A04:2025)
- `mixed_content`, `sensitive_data_in_url`

### Mishandling of Exceptional Conditions (OWASP A10:2025 — new)
- `stack_trace_leak`

## Gaps and known limits

The following OWASP Top 10:2025 categories are intentionally **not** in the knowledge base because they cannot be meaningfully tested with a black-box Playwright frontend:

- **A03:2025 Software Supply Chain Failures** — requires SBOM / dependency analysis.
- **A06:2025 Insecure Design** — design-level, needs human review.
- **A08:2025 Software & Data Integrity Failures** — SRI checks possible but limited; needs CI signing context.
- **A09:2025 Logging & Alerting Failures** — server-side, not observable from the client.

These are tracked outside the test generator (in code review, SCA tools, SIEM).
