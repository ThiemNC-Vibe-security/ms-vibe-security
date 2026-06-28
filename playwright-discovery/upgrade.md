# GUIDE: Upgrade `playwright-discovery` theo từng phase

## 0. Mục tiêu chung

Project `playwright-discovery` hiện là một CLI dùng Playwright để crawl website và trích xuất DOM, forms, inputs, buttons, links, navigation, tables, URL parameters, page classification và security components.

Mục tiêu nâng cấp là biến tool từ:

```text
DOM Discovery MVP
```

thành:

```text
Security Testing Context Generator
```

Flow mục tiêu:

```text
Target Website
  -> Playwright Discovery
  -> Application Model
  -> Attack Surface Model
  -> Security Testing Context
  -> LLM-generated Playwright Security Tests
```

Tool này không phải DAST scanner. Tool này là tầng Discovery Engine để tạo ngữ cảnh có cấu trúc cho LLM hoặc DAST orchestrator sử dụng tiếp.

---

# Quy tắc chung cho AI code

## Yêu cầu bắt buộc

* Không rewrite toàn bộ source.
* Giữ backward compatibility với `discovery.json` hiện tại nếu có thể.
* Thêm field mới thay vì phá schema cũ.
* Không tự submit form nguy hiểm.
* Không click các nút nguy hiểm như delete, remove, logout, transfer, pay, submit, save nếu chưa có config cho phép.
* Các tính năng có side-effect phải mặc định tắt.
* Code phải pass:

```bash
npm run typecheck
npm run build
```

* Nếu thêm test thì phải có:

```bash
npm test
```

## Output file

Nếu tool sinh output mới, không ghi đè file cũ. Ưu tiên thêm timestamp suffix:

```text
discovery_2026-06-28_153000.json
```

---

# Phase 0: Baseline & Stabilization

## Mục tiêu

Xác nhận project hiện tại build được, hiểu output hiện tại, tạo baseline để các phase sau không phá vỡ chức năng cũ.

## Yêu cầu

* Không thay đổi logic lớn.
* Chỉ thêm baseline sample, docs hoặc script nhỏ nếu cần.
* Chạy được build hiện tại.

## Việc cần làm

1. Chạy:

```bash
npm install
npm run typecheck
npm run build
```

2. Tạo hoặc cập nhật tài liệu:

```text
docs/BASELINE.md
```

3. Ghi lại các thông tin:

```text
- CLI commands hiện có
- Config hiện có
- Output schema hiện tại
- Các module chính hiện tại
```

4. Nếu có sample website local, chạy discovery một lần và lưu output mẫu vào:

```text
examples/output/discovery_baseline.json
```

## Result cụ thể

Sau phase này cần có:

```text
docs/BASELINE.md
examples/output/discovery_baseline.json
```

Trong `docs/BASELINE.md` cần mô tả:

```text
- Tool hiện tại làm được gì
- Tool chưa làm được gì
- Output hiện tại gồm những field nào
- Command chạy mẫu
```

## Definition of Done

Phase 0 hoàn thành khi:

```bash
npm run typecheck
npm run build
```

đều pass, và có baseline output để so sánh ở các phase sau.

---

# Phase 1: Fix Core Issues

## Mục tiêu

Sửa các lỗi nền tảng đang ảnh hưởng trực tiếp đến chất lượng Discovery.

## Yêu cầu

* Không thêm feature lớn.
* Ưu tiên sửa đúng dữ liệu đầu ra.
* Không phá schema cũ.

---

## Task 1.1: Fix screenshot directory

### Vấn đề

`screenshotPathFor()` tạo path dạng:

```text
output/screenshots/page_001.png
```

Nhưng nếu thư mục `output/screenshots/` chưa tồn tại thì `page.screenshot()` có thể fail.

### Cần làm

Trước khi gọi `page.screenshot`, tạo thư mục cha:

```ts
await mkdir(dirname(screenshotPath), { recursive: true })
```

### Result cụ thể

Khi bật screenshot, output có:

```text
output/screenshots/page_001.png
output/screenshots/page_002.png
...
```

### Acceptance Criteria

* Screenshot không fail do thiếu folder.
* Nếu screenshot fail vì lý do khác, log warning rõ ràng.
* Không bỏ qua lỗi âm thầm.

---

## Task 1.2: Fix input metadata trong form

### Vấn đề

Standalone input có nhiều metadata:

```text
required
pattern
minLength
maxLength
autocomplete
defaultValue
```

Nhưng input nằm trong form đang bị mất một số metadata.

### Cần làm

Khi extract input trong form, phải lấy đủ metadata giống standalone input.

### Output mong muốn

Input trong form cần có dạng:

```json
{
  "name": "email",
  "type": "email",
  "required": true,
  "placeholder": "Email",
  "pattern": null,
  "min_length": null,
  "max_length": 255,
  "autocomplete": "email",
  "default_value": "",
  "validation_rules": []
}
```

### Result cụ thể

Trong `discovery.json`, các input thuộc form không còn bị thiếu:

```text
required
pattern
min_length
max_length
autocomplete
default_value
```

### Acceptance Criteria

* Input trong form và input ngoài form có cùng mức metadata.
* Không làm mất field cũ.
* Có test hoặc sample chứng minh input trong form giữ được `required`, `maxLength`, `pattern`.

---

## Task 1.3: Config field chưa implement

### Vấn đề

Một số field config đã khai báo nhưng chưa implement rõ:

```yaml
parallel
respect_robots_txt
save_traces
```

### Cần làm

Chọn một trong hai hướng:

#### Hướng A: Implement thật

* `parallel`: crawl nhiều page với concurrency limit.
* `respect_robots_txt`: đọc robots.txt và không crawl disallowed path.
* `save_traces`: bật Playwright trace.

#### Hướng B: Mark reserved

Nếu chưa implement trong phase này, ghi rõ trong schema/docs:

```text
reserved_for_future_use
```

### Result cụ thể

Trong README hoặc config docs phải ghi rõ:

```text
parallel: reserved_for_future_use
respect_robots_txt: reserved_for_future_use
save_traces: reserved_for_future_use
```

hoặc có implementation thật.

## Definition of Done Phase 1

Phase 1 hoàn thành khi:

```bash
npm run typecheck
npm run build
```

pass và output discovery giữ đủ input metadata, screenshot hoạt động đúng.

---

# Phase 2: Selector Verification

## Mục tiêu

Đảm bảo selector sinh ra không chỉ là suy đoán từ DOM, mà được verify bằng Playwright.

## Yêu cầu

* Không claim selector verified nếu chưa check thật.
* Ưu tiên verify các element quan trọng: form, input, button, link.
* Không làm chậm crawl quá mức.

## Việc cần làm

Thêm module:

```text
src/selectors/selector-verifier.ts
```

Module này nhận:

```ts
page
selectorCandidates
```

và kiểm tra:

```ts
const count = await page.locator(selector).count()
```

## Output mong muốn

Mỗi element quan trọng cần có thêm metadata:

```json
{
  "selector": "input[name=\"email\"]",
  "selector_strategy": "name",
  "selector_verified": true,
  "selector_unique": true,
  "selector_match_count": 1,
  "selector_confidence": "high"
}
```

## Quy tắc confidence

```text
high:
  selector_verified = true
  selector_match_count = 1

medium:
  selector_verified = true
  selector_match_count > 1

low:
  selector chưa verify được
  hoặc fallback css path
```

## Result cụ thể

Trong `discovery.json`, các object như input/button/link/form có thêm:

```json
{
  "selector_verified": true,
  "selector_unique": true,
  "selector_match_count": 1,
  "selector_confidence": "high"
}
```

## Test cần có

Thêm test cho:

```text
selector generation
selector verification
selector confidence
```

## Definition of Done Phase 2

Phase 2 hoàn thành khi:

* Selector được verify bằng Playwright.
* Output có metadata selector.
* Không còn mô tả trong docs rằng selector đã verify nếu code chưa verify.
* `npm run typecheck`, `npm run build`, `npm test` pass.

---

# Phase 3: Semantic Input Classification

## Mục tiêu

Phân loại ý nghĩa bảo mật của input để LLM biết input đó nên sinh test gì.

## Yêu cầu

* Rule-based trước, chưa dùng LLM.
* Dựa vào `type`, `name`, `id`, `placeholder`, `label`, `autocomplete`.
* Không phá input schema cũ.

## Việc cần làm

Thêm module:

```text
src/classifier/semantic-input-classifier.ts
```

## Output mong muốn

Mỗi input có thêm:

```json
{
  "semantic_type": "email",
  "data_category": "pii",
  "security_relevance": "high"
}
```

## Danh sách semantic type

```text
email
password
username
search
amount
date
file
phone
id
comment
hidden_token
unknown
```

## Danh sách data category

```text
credential
pii
financial
user_input
identifier
security_token
unknown
```

## Rule gợi ý

```text
type=password
  -> semantic_type=password
  -> data_category=credential
  -> security_relevance=high

name/id/placeholder chứa email
  -> semantic_type=email
  -> data_category=pii
  -> security_relevance=high

name chứa amount, price, balance
  -> semantic_type=amount
  -> data_category=financial
  -> security_relevance=high

type=file
  -> semantic_type=file
  -> data_category=user_input
  -> security_relevance=high

input search hoặc placeholder chứa search
  -> semantic_type=search
  -> data_category=user_input
  -> security_relevance=high

hidden input chứa csrf/token
  -> semantic_type=hidden_token
  -> data_category=security_token
  -> security_relevance=high
```

## Result cụ thể

Trong `discovery.json`, input có thêm:

```json
{
  "semantic_type": "password",
  "data_category": "credential",
  "security_relevance": "high"
}
```

## Test cần có

Test các case:

```text
email input
password input
search input
amount input
file input
csrf hidden input
unknown input
```

## Definition of Done Phase 3

Phase 3 hoàn thành khi:

* Input được phân loại semantic.
* Có unit test cho classifier.
* Output có đủ `semantic_type`, `data_category`, `security_relevance`.
* Build và test pass.

---

# Phase 4: Application Security Model

## Mục tiêu

Nâng output từ danh sách page/form/component rời rạc thành model cấp cao phục vụ sinh security tests.

## Yêu cầu

* Không bỏ output cũ.
* Thêm field mới ở cấp root.
* Model phải dùng dữ liệu đã discover, không hallucinate.

## Cần thêm output

Thêm vào `discovery.json`:

```json
{
  "application_model": {
    "pages": [],
    "routes": [],
    "forms": [],
    "navigation_graph": []
  },
  "attack_surface_model": {
    "entry_points": [],
    "auth_surfaces": [],
    "data_input_surfaces": [],
    "file_upload_surfaces": [],
    "admin_surfaces": [],
    "api_surfaces": []
  },
  "security_testing_context": {
    "recommended_test_categories": [],
    "priority_targets": [],
    "candidate_playwright_flows": []
  }
}
```

## Mapping gợi ý

```text
login form
  -> broken authentication
  -> brute force
  -> rate limit

registration form
  -> weak password policy
  -> duplicate email
  -> validation bypass

search input
  -> reflected XSS
  -> injection

file upload
  -> unrestricted file upload
  -> path traversal
  -> stored XSS

admin button/link/page
  -> broken access control

form without CSRF signal
  -> CSRF candidate
```

## Result cụ thể

Output root có thêm:

```json
{
  "attack_surface_model": {
    "auth_surfaces": [
      {
        "type": "login_form",
        "page_url": "/login",
        "risk_level": "high",
        "recommended_tests": [
          "broken_authentication",
          "rate_limit",
          "credential_stuffing"
        ]
      }
    ]
  }
}
```

## Definition of Done Phase 4

Phase 4 hoàn thành khi:

* Output có `application_model`.
* Output có `attack_surface_model`.
* Output có `security_testing_context`.
* Model chỉ dựa trên evidence từ discovery.
* Build pass.

---

# Phase 5: Network/API Discovery

## Mục tiêu

Phát hiện endpoint thật được gọi bởi frontend thông qua `fetch`, `axios`, XHR.

Đây là phase quan trọng nhất để tool có giá trị bảo mật cao hơn DOM crawler thông thường.

## Yêu cầu

* Capture request/response ở mức Playwright.
* Redact dữ liệu nhạy cảm.
* Deduplicate endpoint.
* Không lưu raw token/password thật.
* Không capture response body lớn.

## Việc cần làm

Thêm module:

```text
src/probe/network-monitor.ts
```

hoặc:

```text
src/crawler/network-monitor.ts
```

Gắn listener:

```ts
page.on('request', ...)
page.on('response', ...)
```

## Config đề xuất

```yaml
network:
  enabled: true
  capture_request_body: true
  capture_response_body: false
  redact_sensitive_values: true
  max_body_sample_size: 2048
```

## Endpoint object mong muốn

```json
{
  "method": "POST",
  "url": "https://example.com/api/auth/login",
  "path": "/api/auth/login",
  "resource_type": "xhr",
  "initiator_page_url": "https://example.com/login",
  "request_headers": {},
  "request_body_sample": {
    "email": "REDACTED_SAMPLE",
    "password": "REDACTED"
  },
  "response_status": 200,
  "response_content_type": "application/json",
  "response_body_sample": {},
  "query_parameters": [],
  "auth_related": true,
  "sensitive_data_detected": [
    "password",
    "token"
  ],
  "discovered_at": "2026-06-28T00:00:00Z"
}
```

## Sensitive fields cần redact

```text
password
token
accessToken
refreshToken
authorization
cookie
secret
apiKey
jwt
session
csrf
```

## Root output cần thêm

```json
{
  "endpoints": [],
  "network_summary": {
    "total_requests": 0,
    "total_api_endpoints": 0,
    "methods": {
      "GET": 0,
      "POST": 0,
      "PUT": 0,
      "DELETE": 0,
      "PATCH": 0
    }
  }
}
```

## Dedup rule

Deduplicate theo:

```text
method + normalized_path
```

Ví dụ:

```text
GET /api/users/1
GET /api/users/2
```

có thể normalize thành:

```text
GET /api/users/:id
```

nếu implement được.

## Result cụ thể

Sau khi crawl web có login/API, output có:

```json
{
  "endpoints": [
    {
      "method": "POST",
      "path": "/api/auth/login",
      "resource_type": "xhr",
      "auth_related": true
    }
  ]
}
```

## Test cần có

Test cho:

```text
endpoint normalizer
request body redactor
response body truncation
endpoint deduplication
```

## Definition of Done Phase 5

Phase 5 hoàn thành khi:

* Tool capture được XHR/fetch endpoints.
* Output có `endpoints`.
* Output có `network_summary`.
* Sensitive value được redact.
* Build và test pass.

---

# Phase 6: Safe Dynamic UI Discovery

## Mục tiêu

Crawl thêm dynamic UI như modal, tab, dropdown, accordion, sidebar mà không gây side-effect nguy hiểm.

## Yêu cầu

* Mặc định tắt.
* Chỉ bật khi config `interact_buttons: true`.
* Không click nút nguy hiểm.
* Có giới hạn số interaction mỗi page.

## Config đề xuất

```yaml
crawl:
  interact_buttons: false
  max_interactions_per_page: 10
  discover_modals: true
  discover_tabs: true
  discover_dropdowns: true
```

## Safe click candidates

Chỉ click nếu text/role/aria-label có vẻ an toàn:

```text
tab
menu
filter
search
details
view
open
expand
show
more
next
previous
dropdown
```

## Dangerous click denylist

Không click nếu text/role/aria-label chứa:

```text
delete
remove
logout
submit
pay
purchase
confirm
save
send
update
create
transfer
withdraw
deposit
```

## Output mong muốn

Trong mỗi page:

```json
{
  "dynamic_components": [
    {
      "type": "modal",
      "trigger_selector": "button:has-text('Filter')",
      "title": "Filter transactions",
      "forms": [],
      "buttons": []
    }
  ],
  "interactions_performed": [
    {
      "action": "click",
      "selector": "button:has-text('Filter')",
      "result": "modal_opened"
    }
  ]
}
```

## Result cụ thể

Khi bật config dynamic interaction, tool discover thêm:

```text
modal forms
dropdown options
tab content
hidden panels
```

## Definition of Done Phase 6

Phase 6 hoàn thành khi:

* Dynamic discovery mặc định tắt.
* Khi bật, có interaction log.
* Không click các nút nguy hiểm trong denylist.
* Output có `dynamic_components`.
* Build pass.

---

# Phase 7: Evaluation Metrics

## Mục tiêu

Thêm metrics để phục vụ báo cáo luận văn, đánh giá tool và so sánh qua các lần chạy.

## Yêu cầu

* Metrics phải tính từ output thật.
* Không cần baseline thủ công ở phase này.
* Nếu có selector verification thì tính selector success rate.

## Output cần thêm

```json
{
  "evaluation_metrics": {
    "pages_discovered": 0,
    "forms_discovered": 0,
    "inputs_discovered": 0,
    "buttons_discovered": 0,
    "links_discovered": 0,
    "endpoints_discovered": 0,
    "selectors_total": 0,
    "selectors_verified": 0,
    "selector_success_rate": 0.0,
    "security_components_detected": 0,
    "attack_surface_count": 0,
    "crawl_errors": 0
  }
}
```

## Nếu sau này có baseline thủ công

Có thể thêm:

```json
{
  "coverage_metrics": {
    "page_coverage": 0.0,
    "form_coverage": 0.0,
    "endpoint_coverage": 0.0
  }
}
```

## Result cụ thể

Sau mỗi lần chạy, `discovery.json` có:

```json
{
  "evaluation_metrics": {
    "pages_discovered": 12,
    "forms_discovered": 5,
    "inputs_discovered": 24,
    "endpoints_discovered": 8,
    "selector_success_rate": 0.91
  }
}
```

## Definition of Done Phase 7

Phase 7 hoàn thành khi:

* Output có `evaluation_metrics`.
* Metrics không bị NaN/null sai.
* Selector success rate tính đúng nếu có selector verification.
* Build pass.

---

# Phase 8: Automated Tests

## Mục tiêu

Bổ sung test để tool có độ tin cậy nghiên cứu, tránh sửa phase sau làm hỏng phase trước.

## Yêu cầu

* Test không phụ thuộc internet.
* Dùng fixture HTML local.
* Có unit test cho logic thuần.
* Có integration test nhẹ nếu có thể.

## Fixtures cần tạo

```text
tests/fixtures/login.html
tests/fixtures/search.html
tests/fixtures/form-without-csrf.html
tests/fixtures/admin.html
tests/fixtures/file-upload.html
tests/fixtures/dynamic-modal.html
```

## Unit test cần có

```text
normalizeUrl
matchGlob
generateSelector
verifySelector
classifyPage
detectSecurityComponents
loadConfig / validateConfig
semantic input classifier
network endpoint normalizer
sensitive value redactor
```

## Result cụ thể

Có command:

```bash
npm test
```

Và test pass.

## Definition of Done Phase 8

Phase 8 hoàn thành khi:

```bash
npm test
npm run typecheck
npm run build
```

đều pass.

---

# Phase 9: Documentation & Example Output

## Mục tiêu

Cập nhật docs để người dùng hiểu đúng tool và biết dùng output cho LLM sinh security tests.

## Yêu cầu

README không được claim quá mức rằng đây là DAST scanner.

## README cần bổ sung

### Tool là gì

```text
playwright-discovery is a Discovery Engine for generating Security Testing Context from web applications. It is not a vulnerability scanner and does not exploit vulnerabilities.
```

### Flow

```text
Target Website
  -> Playwright Discovery
  -> Application Model
  -> Attack Surface Model
  -> Security Testing Context
  -> LLM-generated Playwright Security Tests
```

### Limitations

```text
- Không tự khai thác lỗ hổng.
- Không tự submit form nguy hiểm nếu chưa bật config.
- Không thay thế ZAP/Wapiti/Nuclei.
- Không đảm bảo crawl hết dynamic UI nếu safe interaction bị tắt.
- Network capture có thể thiếu API nếu interaction chưa trigger request.
```

## File cần có

```text
README.md
docs/OUTPUT_SCHEMA.md
docs/SECURITY_TESTING_CONTEXT.md
examples/config.discovery.yaml
examples/output/discovery_full_example.json
```

## Result cụ thể

Người dùng đọc docs biết:

```text
- Cài tool như nào
- Chạy CLI như nào
- Config ra sao
- Output gồm gì
- Output dùng để sinh security test như nào
```

## Definition of Done Phase 9

Phase 9 hoàn thành khi docs mô tả đúng trạng thái tool, có example config và example output.

---

# Tổng thứ tự triển khai khuyến nghị

## Nhóm bắt buộc làm trước

```text
Phase 0: Baseline & Stabilization
Phase 1: Fix Core Issues
Phase 2: Selector Verification
Phase 3: Semantic Input Classification
```

## Nhóm tạo giá trị nghiên cứu chính

```text
Phase 4: Application Security Model
Phase 5: Network/API Discovery
Phase 7: Evaluation Metrics
```

## Nhóm nâng cấp độ phủ

```text
Phase 6: Safe Dynamic UI Discovery
Phase 8: Automated Tests
Phase 9: Documentation & Example Output
```

---

# Milestone đề xuất

## Milestone 1: Discovery Engine ổn định

Bao gồm:

```text
Phase 0
Phase 1
Phase 2
Phase 3
```

Result:

```text
Tool crawl ổn định hơn, input metadata đủ hơn, selector đáng tin cậy hơn, input có semantic security meaning.
```

## Milestone 2: Security Testing Context Generator

Bao gồm:

```text
Phase 4
Phase 5
Phase 7
```

Result:

```text
Tool có Application Model, Attack Surface Model, Security Testing Context, Endpoint Discovery và Evaluation Metrics.
```

## Milestone 3: Research-ready CLI

Bao gồm:

```text
Phase 6
Phase 8
Phase 9
```

Result:

```text
Tool có dynamic UI discovery an toàn, test tự động, docs đầy đủ, example output rõ ràng, đủ nền tảng để đưa vào luận văn/bài báo.
```

---

# Prompt mẫu để đưa cho AI code

## Prompt chạy Phase 1

```text
Implement Phase 1 only from GUIDE.md.

Requirements:
- Do not rewrite the whole project.
- Fix screenshot directory creation.
- Fix missing metadata for inputs inside forms.
- Mark unimplemented config fields as reserved_for_future_use if not implemented.
- Keep backward compatibility with existing discovery.json.
- Add or update tests if suitable.
- Ensure npm run typecheck and npm run build pass.

Expected result:
- Screenshot output works when enabled.
- Inputs inside forms include required, pattern, min_length, max_length, autocomplete, default_value.
- Docs/config clearly mark unimplemented fields.
```

## Prompt chạy Phase 2

```text
Implement Phase 2 only from GUIDE.md.

Requirements:
- Add selector verification using Playwright locator count.
- Add selector_verified, selector_unique, selector_match_count, selector_confidence to important discovered elements.
- Do not claim selector is verified if not checked.
- Keep old selector fields.
- Add tests for selector verification and confidence.
- Ensure npm run typecheck, npm run build, and npm test pass.

Expected result:
- Inputs, buttons, links, and forms have selector verification metadata.
- Selector confidence is high, medium, or low based on verification result.
```

## Prompt chạy Phase 5

```text
Implement Phase 5 only from GUIDE.md.

Requirements:
- Add Network/API Discovery using page.on('request') and page.on('response').
- Capture method, url, path, resource_type, initiator_page_url, request body sample, response status, content type.
- Redact sensitive values such as password, token, authorization, cookie, secret, apiKey.
- Deduplicate endpoints by method + normalized path.
- Add endpoints and network_summary to discovery.json.
- Add config network.enabled, capture_request_body, capture_response_body, redact_sensitive_values, max_body_sample_size.
- Ensure npm run typecheck, npm run build, and npm test pass.

Expected result:
- discovery.json contains endpoints array and network_summary.
- Sensitive values are redacted.
- Existing output remains backward compatible.
```
