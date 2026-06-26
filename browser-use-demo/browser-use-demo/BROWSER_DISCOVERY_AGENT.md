# Browser-use Discovery Agent Specification

## Purpose

The Browser-use Discovery Agent is responsible for automatically exploring a target website and producing a structured representation of the application.

Unlike a traditional crawler that only extracts HTML or hyperlinks, this agent identifies pages, UI components, navigation structure, business actions, and user interaction points that will later be used for automated security test generation.

The output of this agent becomes the primary input of the Application Modeling phase.

---

# Position in System Architecture

```
Target Website
        │
        ▼
Browser-use Discovery Agent
        │
        ▼
Discovery Result (JSON)
        │
        ▼
Application Model Generator (LLM)
        │
        ▼
Security Test Generator
        │
        ▼
Playwright Generator
        │
        ▼
Playwright Security Tests
```

---

# Objectives

The agent shall:

* Discover reachable pages.
* Identify navigation paths.
* Detect forms and input fields.
* Detect buttons and links.
* Detect tables and dialogs.
* Detect business actions.
* Discover authentication requirements.
* Build a machine-readable representation of the website.

The generated output must be sufficiently rich so that downstream LLMs can understand the application's workflow without accessing the website again.

---

# Discovery Scope

For each discovered page, the agent should extract:

## Basic Information

* URL
* Title
* Page Type
* Authentication Requirement
* Breadcrumb
* Language

---

## Navigation

* Navbar
* Sidebar
* Footer
* Internal Links
* External Links
* Candidate Pages

---

## User Interface Components

### Forms

* Name
* Action
* Method
* Inputs
* Validation Rules

### Inputs

* Label
* Name
* Type
* Placeholder
* Required
* Default Value

### Buttons

* Label
* Type
* Business Meaning

### Tables

* Name
* Columns
* Row Count

### Dialogs

* Modal Name
* Trigger
* Buttons

### Links

* Text
* URL
* External/Internal

---

## Business Information

The agent should infer business-level operations whenever possible.

Examples:

* Login
* Register
* Search
* Checkout
* Submit Application
* Add Account
* Delete Record
* Update Profile
* Export Report

These should be stored under:

```
business_actions
```

---

## Workflow Information

The agent should record:

* Candidate next pages
* Navigation flow
* Parent page
* Child page

Example:

```
Homepage
    ↓
Login
    ↓
Dashboard
    ↓
Account Details
```

---

## Security-Relevant Components

Whenever possible, identify:

* Login Forms
* Registration Forms
* Password Fields
* Search Boxes
* Upload Controls
* Download Buttons
* Payment Forms
* Admin Functions

These components are considered security-sensitive and will receive higher testing priority.

---

# Output Format

The discovery result must be generated as structured JSON.

Example:

```
{
  "base_url": "...",
  "pages": [
      {
          "url": "...",
          "title": "...",
          "page_type": "...",

          "navigation": [],
          "forms": [],
          "buttons": [],
          "tables": [],
          "dialogs": [],
          "links": [],

          "business_actions": [],
          "next_candidate_pages": []
      }
  ]
}
```

The output should remain deterministic and machine-readable.

---

# File Output Rules

The Discovery Agent MUST NEVER overwrite an existing discovery result.

Each execution must create a brand-new file.

Filename format:

```
discovery_YYYYMMDD_HHMMSS.json
```

Example:

```
discovery_20260626_134523.json
```

Older discovery files must be preserved for:

* Version comparison
* Change tracking
* Regression analysis
* Incremental discovery

The latest file should always be treated as the newest snapshot of the target application.

---

# Error Handling

The agent should continue discovery even if:

* A page returns HTTP errors.
* A component cannot be parsed.
* JavaScript execution fails.
* An individual page crashes.

Errors should be recorded instead of terminating the discovery process.

---

# Success Criteria

A successful discovery process should produce:

* Multiple discovered pages
* Navigation graph
* Forms
* Buttons
* Tables
* Business actions
* Candidate pages
* Structured JSON output
* Timestamped discovery file

without requiring manual interaction.

---

# Future Extensions

The Discovery Agent may later support:

* Authentication using test credentials
* Session persistence
* API endpoint discovery
* Role-based crawling
* Multi-step workflow detection
* Screenshot generation
* DOM snapshot storage
* Accessibility metadata
* JavaScript event extraction
* Automatic Application Model generation


