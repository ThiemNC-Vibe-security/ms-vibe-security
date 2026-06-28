# Baseline — playwright-discovery

Tài liệu này mô tả trạng thái baseline của tool sau khi hoàn thành Phase 0–9 của upgrade plan.

---

## Tool làm được gì (sau Phase 0–9)

| Capability | Phase | Mô tả |
|-----------|-------|-------|
| DOM Discovery | MVP | Crawl pages, extract forms/inputs/buttons/links/tables/navigation |
| Screenshot | 1 | Chụp screenshot mỗi page (opt-in) |
| Input metadata đầy đủ | 1 | `required`, `pattern`, `min_length`, `max_length`, `autocomplete` cho input trong form |
| Selector Verification | 2 | Verify selector bằng `page.locator().count()`, confidence: high/medium/low |
| Semantic Input Classification | 3 | Phân loại `semantic_type`, `data_category`, `security_relevance` cho từng input |
| Application Model | 4 | Routes, forms, navigation graph |
| Attack Surface Model | 4 | auth_surfaces, data_input_surfaces, file_upload_surfaces, admin_surfaces, api_surfaces |
| Security Testing Context | 4 | recommended_test_categories, priority_targets, candidate_playwright_flows |
| Network/API Discovery | 5 | Capture XHR/fetch endpoints, redact sensitive values, dedup |
| Dynamic UI Discovery | 6 | Click safe triggers để discover modal/tab/dropdown (opt-in, default off) |
| Evaluation Metrics | 7 | pages/forms/inputs/endpoints/selector_success_rate/attack_surface_count |
| Unit Tests | 8 | 109 tests với Vitest, không cần internet |

## Tool chưa làm được

- Không bypass CAPTCHA / Cloudflare
- Không crawl SPA hash routing (`#/route`)
- Không tự submit form (side-effect off by default)
- `crawl.parallel` chưa implement (reserved)
- `crawl.respect_robots_txt` chưa implement (reserved)
- `output.save_traces` chưa implement (reserved)
- Network capture chỉ lấy được endpoint được trigger trong crawl

---

## Output schema hiện tại — root fields

```
metadata
stats
pages[]
  ├── forms[].inputs[].semantic_type/data_category/security_relevance
  ├── forms[].inputs[].selector_verified/selector_confidence
  ├── security_components[]
  ├── dynamic_components[]  (Phase 6, empty by default)
  └── interactions_performed[]  (Phase 6)
graph.edges[]
errors[]
endpoints[]              (Phase 5)
network_summary          (Phase 5)
application_model        (Phase 4)
attack_surface_model     (Phase 4)
security_testing_context (Phase 4)
evaluation_metrics       (Phase 7)
```

---

## CLI commands

```bash
npm run dev -- init                          # sinh config mẫu
npm run dev -- run --url <url>               # chạy với URL
npm run dev -- run --config <file>           # chạy với config YAML
npm run dev -- validate <output.json>        # validate output file
npm run build                                # compile TS → dist/
npm run typecheck                            # tsc --noEmit
npm test                                     # vitest run (109 tests)
```

---

## Số liệu chạy thực tế — VC-AWG-Demo Finance App

Chạy với `examples/with-auth.yml` (storage state auth, 30 pages, BFS):

- Pages discovered: 12
- Forms: 5
- Inputs: 24
- Endpoints (XHR): 8
- Selector success rate: ~0.91
- Security components: 14
- Attack surface count: 9
- Duration: ~45s

---

## Ví dụ chạy mẫu

```bash
# Public site không auth
npm run dev -- run --url https://example.com --max-pages 5

# Finance app với auth
npm run dev -- run --config examples/with-auth.yml

# Full config với network + interact
npm run dev -- run --config examples/full-config.yml
```
