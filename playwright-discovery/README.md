# Playwright Discovery

Auto-discover the structure of a website (pages, forms, inputs, buttons, navigation, security-relevant components) and emit a JSON model that an LLM can consume to generate Playwright security tests.

See [`overview.md`](./overview.md) for the full spec.

## Install

```bash
npm install
npx playwright install chromium
```

## Quick start

```bash
# Generate a starter config
npm run dev -- init

# Run discovery against any public site
npm run dev -- run --url https://example.com --max-pages 10

# Use a config file
npm run dev -- run --config ./discovery.yml

# Verbose logging
npm run dev -- run --url https://example.com -v
```

After building (`npm run build`), the same commands work via:

```bash
node dist/cli.js run --url https://example.com
```

## Common options

| Flag                    | What it does                                  |
|-------------------------|-----------------------------------------------|
| `-c, --config <path>`   | Load a YAML config                            |
| `-u, --url <url>`       | Target URL (overrides `config.target`)        |
| `--max-pages <n>`       | Max pages to crawl                            |
| `--max-depth <n>`       | Max crawl depth                               |
| `--strategy <bfs\|dfs>` | Crawl strategy                                |
| `--output-dir <dir>`    | Where to write the JSON                       |
| `--save-screenshots`    | Save per-page PNGs alongside the JSON         |
| `--headless` / `--no-headless` | Toggle headless mode                   |
| `--browser <type>`      | `chromium` / `firefox` / `webkit`             |
| `-v, --verbose`         | Debug logging                                 |

CLI flags always win over the config file.

## Examples

[`examples/basic.yml`](./examples/basic.yml) — public site, no auth.

[`examples/with-auth.yml`](./examples/with-auth.yml) — form login, reusable storage state.

[`examples/enterprise.yml`](./examples/enterprise.yml) — large site, scoped, timeouts tuned, screenshots on.

## Authentication

Set `auth.mode` in the YAML. Supported modes:

- `none` — public site (default)
- `basic` — HTTP Basic auth (`basic_user`, `basic_password`)
- `bearer` — sends `Authorization: Bearer <token>`
- `form` — fills a login form once, optionally saves storage state for reuse
- `storage_state` — loads a Playwright-format auth state file

Form auth example:

```yaml
auth:
  mode: form
  login_url: /login
  username_selector: 'input[name="email"]'
  password_selector: 'input[name="password"]'
  submit_selector: 'button[type="submit"]'
  username: ${TEST_USER}
  password: ${TEST_PASSWORD}
  success_indicator: url=/dashboard
  save_storage_state: ./auth-state.json
```

Credentials read from `.env`. Run once to log in, subsequent runs reuse `auth-state.json` (much faster).

## Output

A timestamped JSON file:

```
output/
├── discovery_20260626_153000.json
├── screenshots/         # if save_screenshots: true
│   └── page_001.png
```

Top-level shape:

```json
{
  "metadata": { "base_url": "...", "discovered_at": "...", "duration_seconds": 12.4 },
  "stats":    { "pages_discovered": 8, "total_forms": 3, "security_components": 5 },
  "pages":    [ /* DiscoveredPage objects */ ],
  "graph":    { "edges": [ /* parent → child links */ ] },
  "errors":   [ /* per-URL failures, not fatal */ ]
}
```

Each `DiscoveredPage` contains forms, inputs, buttons, links, tables, security components, and URL parameters — all with stable Playwright selectors (`page.getByRole(...)`, `page.getByLabel(...)`, `page.getByTestId(...)`).

This output is the **input** for the downstream test generator. It is combined with Security Knowledge (OWASP rules + payloads) and Tester Requirement (scope/priority config) to generate runnable Playwright security tests.

## Validate an output file

```bash
npm run dev -- validate ./output/discovery_20260626_153000.json
```

## Project layout

```
src/
├── cli.ts                       # entry
├── config/                      # YAML schema + loader
├── crawler/                     # BFS/DFS, queue, URL utils
├── auth/                        # form/basic/bearer/storage_state
├── extractors/                  # DOM extraction (browser + Node)
├── selectors/                   # stable Playwright selector generation
├── classifier/                  # page type + security component heuristics
├── output/                      # final schema + writer
└── utils/                       # logger, retry
```

## Limitations (MVP)

- No dynamic content depth (modals, infinite scroll, tabs) yet — see overview.md §G
- CAPTCHA / Cloudflare-protected sites are skipped, not bypassed
- Same-page hash-route SPAs are treated as one page
- No probing of forms by default (safe-by-default; opt-in coming later)

## Config fields — reserved for future use

The following config fields are **accepted but not yet implemented**. They are validated and stored, but have no effect at runtime:

| Field | Default | Status |
|-------|---------|--------|
| `crawl.parallel` | `1` | `reserved_for_future_use` — concurrent page crawling (currently sequential) |
| `crawl.respect_robots_txt` | `true` | `reserved_for_future_use` — robots.txt enforcement not yet active |
| `output.save_traces` | `false` | `reserved_for_future_use` — Playwright trace saving not yet wired |

## License

Internal project.
