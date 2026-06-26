# Page Discovery Agent

## Overview

Page Discovery Agent là thành phần chịu trách nhiệm khám phá **một trang web tại một thời điểm**.

Nó không crawl toàn bộ website.

Nó không sinh Security Test.

Nó không sinh Playwright Script.

Nó chỉ có một nhiệm vụ duy nhất:

> Quan sát một webpage và trả về mô hình cấu trúc của trang đó dưới dạng JSON.

---

# Responsibilities

Đầu vào:

* Current URL
* Browser Session
* User Context (optional)

Đầu ra:

```json
{
  "url": "",
  "title": "",
  "pageType": "",
  "navigation": [],
  "forms": [],
  "buttons": [],
  "inputs": [],
  "tables": [],
  "dialogs": [],
  "links": [],
  "businessActions": [],
  "nextCandidatePages": []
}
```

---

# Internal Workflow

```
Current URL
      │
      ▼
Browser-Use Agent
      │
      ▼
Observe Page
      │
      ▼
Understand DOM
      │
      ▼
Identify UI Components
      │
      ▼
Extract Business Meaning
      │
      ▼
Generate Structured JSON
```

---

# Discovery Scope

Agent cần khám phá:

## General Information

* URL
* Page title
* Breadcrumb
* Page type

Ví dụ:

* Landing Page
* Login
* Register
* Dashboard
* Profile
* Settings
* Transaction
* Report

---

## Navigation

Thu thập:

* Navbar
* Sidebar
* Footer Menu
* Internal Links

Ví dụ

```
Home

Accounts

Transactions

Goals

Reports
```

---

## Forms

Phát hiện tất cả form.

Ví dụ

```
Login Form

Register Form

Transfer Form

Goal Form
```

Thông tin cần lấy:

* action
* method
* fields
* validation

---

## Inputs

Mỗi input cần:

```
label

name

type

required

placeholder
```

Ví dụ

```
Email

Password

Amount

Description
```

---

## Buttons

Mỗi button cần:

```
label

type

businessMeaning
```

Ví dụ

```
Login

Register

Delete Transaction

Save Goal
```

---

## Tables

Ví dụ

```
Transaction Table

Account Table

Budget Table
```

---

## Dialogs

Ví dụ

```
Delete Confirmation

Edit Transaction

Upload Receipt
```

---

## Business Actions

LLM cần suy luận business action.

Ví dụ

```
Create Account

Update Account

Delete Transaction

Transfer Money

Create Financial Goal
```

Đây là dữ liệu quan trọng cho Security Testing.

---

## Authentication

Agent cần phát hiện:

```
Anonymous

Authenticated

Role Based

Admin

User
```

---

## Candidate Pages

Agent trả về các URL tiếp theo cần khám phá.

Ví dụ

```
/login

/register

/dashboard

/profile

/settings

/transactions
```

---

# Output Example

```json
{
  "url": "/login",
  "pageType": "Login",

  "forms":[
    {
      "name":"Login Form",
      "inputs":[
        "email",
        "password"
      ]
    }
  ],

  "buttons":[
    "Login"
  ],

  "businessActions":[
    "Authenticate User"
  ],

  "nextCandidatePages":[
    "/register"
  ]
}
```

---

# Design Principles

Page Discovery Agent không quyết định sẽ đi đâu tiếp theo.

Nó chỉ khám phá **một trang**.

Mọi quyết định điều hướng sẽ do Discovery Controller đảm nhiệm.

Điều này giúp:

* Agent đơn giản.
* Có thể chạy song song nhiều Agent.
* Dễ mở rộng.
* Dễ kiểm thử.
* Dễ thay thế LLM hoặc Browser Framework trong tương lai.

---

# Position in System Architecture

```
Target Website
        │
        ▼
Discovery Controller
        │
        ├───────────────┐
        ▼               ▼
Page Discovery Agent    Page Discovery Agent
        │               │
        ▼               ▼
Page Model         Page Model
        └───────────────┘
                │
                ▼
Application Model Builder
                │
                ▼
application_model.json
```

---

# Future Extensions

Trong tương lai, Page Discovery Agent có thể bổ sung:

* API Endpoint Discovery
* Role-based Discovery
* Authentication Flow Discovery
* State Transition Discovery
* Business Rule Discovery
* Security-Relevant Component Discovery

Những dữ liệu này sẽ là đầu vào trực tiếp cho Security Test Generator để sinh Playwright Security Test Scripts.
