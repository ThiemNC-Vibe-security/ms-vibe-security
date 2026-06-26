# Security Knowledge

Each YAML file under `attacks/` defines one attack class. The Planner reads only the high-level metadata (id, applies_to, owasp). The Generator gets the full file for the test case it's writing.

## File schema

```yaml
id: <snake_case_id>              # required, unique
name: <human readable>           # required
owasp: ["A03:2021"]              # OWASP Top 10 mappings
applies_to:                      # which discovery security_components this targets
  - login_form
  - search_box
  - generic_form
  - url_param
payloads:                        # actual strings to inject
  - "' OR '1'='1"
  - "'; DROP TABLE users--"
detection:                       # how to recognise a vulnerability
  - response_contains_sql_error
  - response_time_high
test_template_hints:             # nudges to the test-generator LLM
  - inject_into_each_input_separately
  - assert_no_stack_trace_visible
description: |
  Optional longer description for humans.
```

Add new attacks by dropping a new YAML file here. They are auto-discovered.

## Convention

- `id` is the join key referenced by `TestCase.attack_id` in the plan.
- `applies_to` values should match the `type` field on `security_components` produced by playwright-discovery.
- Payloads are passed verbatim to the LLM; keep them small and well-formed.
