---
inclusion: fileMatch
fileMatchPattern: 'test-generator/**'
---

# Security Knowledge Base

The test-generator depends on a YAML-based attack catalogue at `test-generator/knowledge/attacks/`. This file documents the schema, current coverage, and how to extend it.

## Schema (test-generator/knowledge/README.md is the canonical doc)

Each `attacks/*.yml` declares one attack class. Required fields:

```yaml
id: <snake_case>                  # join key with TestCase.attack_id
name: <human readable>
owasp:  [A05:2025, A03:2021]      # OWASP Top 10 — include both 2025 and 2021
cwe:    [CWE-89]                  # MITRE CWE IDs
asvs:   [V5.3.4]                  # ASVS v5.0.0 requirement IDs
applies_to: [login_form, ...]     # component types OR "any_page"
payloads: ["..."]                 # may be empty for behavioral attacks
detection: ["..."]                # detection rule identifiers
test_template_hints: ["..."]      # nudges to the generator LLM
description: |
  Optional longer text.
```

Schema is enforced by Zod in `src/input/knowledge-loader.ts`. Invalid files are skipped with a warning rather than aborting the run.

## Standards alignment

| Standard | Version | Use |
|----------|---------|-----|
| OWASP Top 10 | 2025 (primary) + 2021 (backward compat) | Risk category |
| OWASP ASVS | v5.0.0 (May 2025) | Verification requirements |
| MITRE CWE | latest | Root weakness type |

## Current catalogue (25 attacks)

Grouped by OWASP 2025 primary category:

- **A01:2025 Broken Access Control**: `idor`, `open_redirect`, `path_traversal`, `ssrf`
- **A02:2025 Security Misconfiguration**: `security_headers_missing`, `clickjacking`, `cors_misconfig`, `default_credentials`
- **A04:2025 Cryptographic Failures**: `mixed_content`, `sensitive_data_in_url`
- **A05:2025 Injection**: `sql_injection`, `nosql_injection`, `command_injection`, `ssti`, `xss_reflected`, `xss_stored`, `xss_dom`
- **A07:2025 Authentication Failures**: `broken_auth`, `weak_password_policy`, `rate_limit`, `csrf`, `session_cookie_flags`, `session_fixation`, `jwt_vulns`
- **A10:2025 Mishandling of Exceptional Conditions**: `stack_trace_leak`

## Intentional gaps (out of scope for black-box Playwright)

- A03:2025 Software Supply Chain — needs SBOM / SCA tooling
- A06:2025 Insecure Design — needs human review
- A08:2025 Software & Data Integrity — needs CI / signing context
- A09:2025 Logging & Alerting — server-side, not client-observable

These remain documented gaps; they're tracked outside the generator.

## Matching contract (planner ↔ knowledge ↔ discovery)

The planner joins three datasets:

1. **Discovery** emits `security_components[].type` and `url_parameters[].applicable_attacks`.
2. **Knowledge** declares `applies_to[]` (component types) and an `id` (matches `applicable_attacks` entries).
3. **Planner rule** picks an attack for a page when ANY of:
   - `attack.applies_to` contains `"any_page"` (page-level checks — sample only 1-3 reps)
   - `attack.applies_to` overlaps with a `security_component.type` on the page
   - `attack.id` appears in a `url_parameter.applicable_attacks` list, OR `attack.applies_to` contains `"url_param"`

When adding a new attack, ensure its `applies_to` includes a component type that `playwright-discovery/src/classifier/security-detector.ts` actually emits, or use `any_page`.

## Adding a new attack

1. Drop a new YAML in `test-generator/knowledge/attacks/<id>.yml`.
2. Populate `owasp`, `cwe`, `asvs` (cite the official IDs).
3. Choose `applies_to` values from existing component types or add `any_page`.
4. If a new component type is needed, also update `playwright-discovery/src/classifier/security-detector.ts` to emit it.
5. Run `npm run typecheck` in `test-generator/` — the loader will validate at runtime.

## Component types emitted by discovery

See `playwright-discovery/src/classifier/security-detector.ts`. Current types:

- Form-based: `login_form`, `admin_login_form`, `registration_form`, `password_recovery`, `password_change_form`, `payment_form`, `comment_form`, `profile_form`, `generic_form`
- Form properties: `csrf_protected_form`, `form_without_csrf`
- Input-based: `password_field`, `search_box`, `file_upload`
- Button-based: `file_download`
- Page-based: `admin_function`
- Pseudo (knowledge only): `any_page`, `url_param`
