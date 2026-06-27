# Product Summary

This is an academic research project: **Automatic Security Test Generation and Execution Framework for Web Applications using LLM and Playwright**.

## What It Does

A 2-stage pipeline that:
1. **Discovers** a target web app's structure (pages, forms, inputs, security-relevant components) using Playwright — fully deterministic, no AI.
2. **Generates** Playwright security test scripts via LLM (Gemini) using a Plan-then-Generate pattern, guided by OWASP knowledge and tester requirements.

## Key Concepts

- **Security Testing Context (STC)**: Combination of discovery output + security knowledge base + tester requirements fed to the LLM.
- **Plan-then-Generate**: One LLM planner call produces a test plan, then N parallel generator calls produce individual test scripts.
- **Config-driven**: Targets QA users who don't write code — all configuration via YAML files.

## Target Application

The project includes a sample target app (VC-AWG-Demo_FinalCode) — a personal finance management system with auth, accounts, transactions, bills, expenses, goals, and savings.

## Language

Documentation is primarily in Vietnamese. Code is in English.
