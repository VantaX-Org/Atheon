# Atheon E2E Tests (Playwright)

Playwright-driven end-to-end tests for the Atheon frontend.

## Layout

```
e2e/
├── playwright.config.ts    # Config — baseURL, webServer, projects
├── README.md               # (this file)
├── fixtures/
│   ├── auth.ts             # seedAuth() — puts mock JWT/user in localStorage
│   └── mocks.ts            # page.route() helpers for mocking the API
├── tests/
│   ├── auth.spec.ts                      # Login form, public pages (pre-existing)
│   ├── pages.spec.ts                     # All 16 protected pages load    (pre-existing)
│   ├── traceability.spec.ts              # Apex/Pulse drill-down          (pre-existing)
│   ├── mfa-enrollment.spec.ts            # /settings/mfa wizard           (new)
│   ├── webhook-create.spec.ts            # /webhooks wizard + show-once   (new)
│   ├── company-switcher.spec.ts          # Header company switcher        (new)
│   ├── catalyst-run-detail.spec.ts       # /catalysts/runs/:id            (new)
│   ├── dashboard-scoped.spec.ts          # /dashboard + MFA banner        (new)
│   ├── admin-tenant-llm-budget.spec.ts   # /admin/tenants/:id/llm         (new)
│   └── bulk-users.spec.ts                # /bulk-users CSV import         (new)
└── load-test.ts            # Not a Playwright spec — standalone tsx script
```

## Running locally

Playwright is not (yet) in `package.json`. To install and run:

```bash
# 1. Install the runner + browsers
npm install -D @playwright/test
npx playwright install chromium

# 2. From the repo root — Playwright auto-starts `npm run dev` on :5173
npx playwright test --config=e2e/playwright.config.ts

# Or point at a different dev server:
E2E_BASE_URL=http://localhost:4173 npx playwright test --config=e2e/playwright.config.ts

# Run a single spec:
npx playwright test --config=e2e/playwright.config.ts e2e/tests/mfa-enrollment.spec.ts

# Headed / debug:
npx playwright test --config=e2e/playwright.config.ts --headed --debug
```

## Mocking strategy

**All new specs mock the backend with `page.route()`** — they do NOT need a
running `wrangler dev` worker. The baseline mocks live in `fixtures/mocks.ts`
and are installed at the top of every test via `installBaselineMocks(page)`.

The router matches the glob `**/api/**` so it catches requests to both
`https://atheon-api.vantax.co.za/...` (default `VITE_API_URL`) and any
`VITE_API_URL` override. Spec-specific handlers (e.g. `mockWebhookCreate`,
`mockLlmBudget`) register AFTER the baseline so their response wins.

If a test needs the real backend (e.g. a smoke test against staging), set
`E2E_BASE_URL` to the staging origin and skip the mock helpers.

## Auth

`seedAuth(page)` writes a mock JWT and user into `localStorage` so protected
pages render. The default user is `superadmin` for the `vantax` tenant. For
tests that need a non-superadmin:

```ts
import { seedAuth, DEFAULT_ADMIN } from '../fixtures/auth';
await seedAuth(page, DEFAULT_ADMIN);
```

## CI gating

Currently the audit (docs/FEATURE_AUDIT.md §3.8) flags E2E as **not gated**.
To wire Playwright into CI:

```yaml
# .github/workflows/e2e.yml (illustrative)
- run: npm ci
- run: npm install -D @playwright/test
- run: npx playwright install --with-deps chromium
- run: npm run build
- run: npx playwright test --config=e2e/playwright.config.ts
```

## Environment variables

| Var             | Default                   | Purpose                                             |
| --------------- | ------------------------- | --------------------------------------------------- |
| `E2E_BASE_URL`  | `http://localhost:5173`   | SPA origin Playwright hits                          |
| `E2E_EMAIL`     | _unset_                   | Real-login fallback for live-backend specs          |
| `E2E_PASSWORD`  | _unset_                   | Real-login fallback for live-backend specs          |
| `CI`            | _unset_                   | Switches Playwright to headless + GitHub reporter   |

Do **not** commit credentials — set `E2E_EMAIL`/`E2E_PASSWORD` via your shell
or the CI secret store.

## Adding new specs

1. Put the file in `e2e/tests/<feature>.spec.ts`.
2. Start with `installBaselineMocks(page)` + `seedAuth(page)` in `beforeEach`.
3. Add spec-specific `page.route()` handlers AFTER the baseline.
4. Prefer role-based locators (`getByRole`, `getByLabel`) over CSS.
5. Keep specs focused — one flow per file. Don't build a kitchen sink.
