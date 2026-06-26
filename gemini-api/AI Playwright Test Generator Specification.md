# Project Specification

## Project Name

AI Playwright Test Generator

---

## Objective

Build a lightweight NodeJS application that converts Browser Discovery Results into executable Playwright test scripts using Gemini.

The purpose of this project is to validate the feasibility of AI-generated test automation before implementing a complete Security Testing Framework.

---

## Scope

Phase 1 only.

No execution.

No security testing.

No browser-use integration yet.

Input is a manually prepared discovery JSON file.

Output is a generated Playwright TypeScript test file.

---

## Workflow

```text
Discovery Result JSON
          ↓
Prompt Builder
          ↓
Gemini API
          ↓
Playwright Script
          ↓
Write File
```

---

## Example Input

File:

```text
input/discovery.json
```

Content:

```json
{
  "page": "Login",
  "url": "/login",
  "fields": [
    {
      "label": "Email",
      "name": "email",
      "type": "email"
    },
    {
      "label": "Password",
      "name": "password",
      "type": "password"
    }
  ],
  "buttons": [
    "Login"
  ]
}
```

---

## Example Output

File:

```text
output/login.spec.ts
```

Content:

```typescript
import { test, expect } from '@playwright/test';

test('login success', async ({ page }) => {

  await page.goto(BASE_URL);

  await page.fill('[name=email]', 'test@example.com');

  await page.fill('[name=password]', 'Password123');

  await page.click('text=Login');

  await expect(page).not.toHaveURL(/login/);

});
```

---

## Technology Stack

### Runtime

* NodeJS 22+
* TypeScript

### AI

* Gemini 2.5 Flash

### Configuration

* dotenv

### File Operations

* fs/promises

---

## Project Structure

```text
src/

├── index.ts

├── services/
│   └── gemini.service.ts

├── generators/
│   ├── prompt.generator.ts
│   └── playwright.generator.ts

├── models/
│   └── discovery.model.ts

├── utils/
│   ├── file.util.ts
│   └── logger.util.ts

input/
└── discovery.json

output/
└── generated.spec.ts

.env

package.json

tsconfig.json
```

---

## Environment Variables

File:

```text
.env
```

Content:

```env
GEMINI_API_KEY=YOUR_API_KEY
```

---

## Discovery Model

Create TypeScript interface.

```typescript
export interface DiscoveryResult {

  page: string;

  url: string;

  fields: DiscoveryField[];

  buttons: string[];
}

export interface DiscoveryField {

  label: string;

  name: string;

  type: string;
}
```

---

## Gemini Service

Responsibilities:

* Initialize Gemini client
* Send prompt
* Receive response
* Return generated Playwright script

Methods:

```typescript
generatePlaywrightScript(
    prompt: string
): Promise<string>
```

---

## Prompt Generator

Input:

```typescript
DiscoveryResult
```

Output:

```typescript
string
```

Responsibilities:

Generate a prompt that instructs Gemini to:

1. Act as a senior QA automation engineer.
2. Generate Playwright TypeScript tests.
3. Create:

   * Happy Path
   * Invalid Input
   * Empty Required Fields
4. Output TypeScript code only.
5. Do not output markdown.

---

## Prompt Template

```text
You are a senior QA automation engineer.

Generate Playwright TypeScript tests.

Application Information:

{DISCOVERY_JSON}

Requirements:

1. Generate Happy Path Test.
2. Generate Invalid Input Test.
3. Generate Empty Required Field Test.
4. Use Playwright Test framework.
5. Output TypeScript only.
6. No markdown.
```

---

## Playwright Generator

Responsibilities:

1. Load discovery.json
2. Build prompt
3. Call Gemini
4. Save result to output/generated.spec.ts

Method:

```typescript
generate()
```

---

## Main Entry

File:

```text
src/index.ts
```

Responsibilities:

1. Read discovery file
2. Generate prompt
3. Call Gemini
4. Save generated test

Run command:

```bash
npm run generate
```

---

## Package Scripts

```json
{
  "scripts": {
    "generate": "tsx src/index.ts"
  }
}
```

---

## Error Handling

Handle:

* Missing API key
* Missing discovery file
* Gemini API failure
* Empty Gemini response
* Invalid JSON

---

## Logging

Log:

* Discovery file loaded
* Prompt generated
* Gemini request sent
* Gemini response received
* Playwright file written

Use simple console logging.

---

## Success Criteria

Given a valid discovery.json file:

1. Application successfully calls Gemini.
2. Gemini generates Playwright TypeScript code.
3. Generated code is saved into:

```text
output/generated.spec.ts
```

4. File is compilable by Playwright.

---

## Future Phases (Not Implemented)

Phase 2

```text
browser-use
     ↓
Discovery Result
```

instead of manual discovery.json.

Phase 3

Generate Security Test Cases.

Phase 4

Auto execute Playwright tests.

Phase 5

Generate Security Assessment Reports.
