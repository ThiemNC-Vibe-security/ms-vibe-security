# An End-to-End Security Testing Framework for Vibe-Coded Web Applications using Playwright and LLM

## 1. Overview

### Problem Statement

The emergence of AI-assisted software development and Vibe Coding platforms enables developers to rapidly generate web applications with minimal manual coding effort. However, these generated applications often lack systematic security validation before deployment.

Traditional security assessment methods require significant manual effort from security engineers, including:

* Understanding application functionality.
* Identifying attack surfaces.
* Designing security test cases.
* Executing tests.
* Analyzing results and generating reports.

This process is time-consuming and difficult to scale when applications are generated rapidly through AI-assisted development.

### Proposed Solution

This research proposes an automated security testing framework that combines:

* Playwright
* Large Language Models (LLMs)
* OWASP security knowledge
* Automated application discovery

The framework automatically explores a target web application, builds an application model, generates security test scenarios, executes security tests, and produces security assessment reports.

---

## 2. Research Objectives

The objectives of this research are:

1. Automatically discover application functionalities and workflows.
2. Construct an application model representing:

   * Pages
   * Forms
   * Inputs
   * Navigation flows
   * User actions
3. Generate security testing scenarios using OWASP knowledge.
4. Execute generated security tests automatically through Playwright.
5. Collect evidence and generate security reports.
6. Reduce manual effort required for security assessment.

---

## 3. Scope

### In Scope

* Web Applications
* Vibe-Coded Applications
* Playwright-based automation
* OWASP Top 10 related testing
* LLM-assisted test generation
* Automated reporting

### Out of Scope

* Source code security review
* Mobile application testing
* Infrastructure penetration testing
* Manual penetration testing activities

---

## 4. System Architecture

### High-Level Architecture

```text
Target Website
       │
       ▼
Discovery Engine
(Browser-use / Playwright Crawl)
       │
       ▼
Application Model
(routes, forms, workflows)
       │
       ▼
Security Testing Context
       │
       ▼
Security Test Generator
(LLM + OWASP Knowledge Base)
       │
       ▼
Playwright Security Runner
       │
       ▼
Evidence Collection
       │
       ▼
Security Report Generator
```

---

## 5. Framework Components

### 5.1 Discovery Engine

Purpose:

Automatically explore the target application.

Responsibilities:

* Crawl pages
* Discover routes
* Identify forms
* Detect authentication pages
* Capture user workflows

Possible implementations:

* Browser-use
* Playwright Crawl
* Hybrid approach

Output:

```json
{
  "page": "/login",
  "elements": [
    {
      "type": "input",
      "name": "email"
    },
    {
      "type": "input",
      "name": "password"
    }
  ]
}
```

---

### 5.2 Application Model

The Application Model serves as an abstraction of the discovered application.

It stores:

* Pages
* Forms
* Inputs
* Navigation paths
* User journeys

Example:

```json
{
  "route": "/register",
  "workflow": [
    "Fill Form",
    "Submit",
    "Verify Account"
  ]
}
```

---

### 5.3 Security Testing Context

The Security Testing Context combines:

1. Application Model
2. OWASP Security Knowledge
3. Security Testing Templates

Purpose:

Provide sufficient context for the LLM to generate meaningful security tests.

Example:

```text
Page: Login

Inputs:
- Email
- Password

Potential Risks:
- SQL Injection
- Authentication Bypass
- Credential Stuffing
- Broken Authentication
```

---

### 5.4 Security Test Generator

The Security Test Generator uses LLMs to generate Playwright-based security tests.

Inputs:

* Application Model
* Security Testing Context
* OWASP Knowledge

Outputs:

* Security Test Scripts (STS)

Example:

```typescript
test('SQL Injection Login Test', async ({ page }) => {
  await page.goto('/login');

  await page.fill('#email', "admin' OR '1'='1");
  await page.fill('#password', 'password');

  await page.click('button[type=submit]');

  await expect(page).not.toHaveURL('/dashboard');
});
```

---

### 5.5 Playwright Security Runner

Purpose:

Execute generated Security Test Scripts.

Responsibilities:

* Launch browser
* Run tests
* Capture screenshots
* Collect logs
* Record network traffic

Outputs:

* Test Results
* Evidence
* Execution Logs

---

### 5.6 Evidence Collection Module

Collects:

* Screenshots
* Request/Response logs
* Browser console logs
* Playwright traces

Example:

```text
evidence/
├── screenshots/
├── traces/
├── logs/
└── reports/
```

---

### 5.7 Security Report Generator

Generates a final assessment report.

Report includes:

* Executive Summary
* Findings
* Severity
* Reproduction Steps
* Evidence
* Remediation Suggestions

Example:

```text
Finding:
SQL Injection Candidate

Severity:
High

Location:
Login Form

Evidence:
login_sqli.png

Recommendation:
Use parameterized queries.
```

---

## 6. Security Test Categories

The framework initially focuses on OWASP Top 10.

### Authentication Testing

* Weak authentication
* Authentication bypass
* Session fixation

### Input Validation Testing

* SQL Injection
* XSS
* Command Injection

### Authorization Testing

* Broken Access Control
* IDOR

### Session Management Testing

* Session expiration
* Session reuse

### Client-Side Security Testing

* Sensitive data exposure
* Insecure storage

---

## 7. Research Methodology

### Phase 1

Discovery & Modeling

Deliverables:

* Discovery Engine
* Application Model

### Phase 2

Security Context Construction

Deliverables:

* Security Testing Context
* OWASP Knowledge Base

### Phase 3

Security Test Generation

Deliverables:

* LLM-based STS Generator

### Phase 4

Automated Execution

Deliverables:

* Playwright Security Runner

### Phase 5

Evaluation

Metrics:

* Coverage
* Accuracy
* Number of vulnerabilities detected
* Execution time
* Reduction in manual effort

---

## 8. Expected Contributions

### Academic Contributions

* A framework for automated security testing of AI-generated web applications.
* A methodology combining application discovery and LLM-based security test generation.

### Practical Contributions

* Reduced security testing effort.
* Faster vulnerability identification.
* Reusable security testing workflow.
* Improved security assurance for Vibe-Coded applications.

---

## 9. Future Work

Potential extensions include:

* Mobile application security testing.
* API security testing.
* Continuous Security Testing (CI/CD integration).
* Multi-agent security testing systems.
* Autonomous penetration testing agents.

```
```
