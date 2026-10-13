# CloudBridge

**Application Platform Abstraction Over Heterogeneous Cloud Infrastructure**

CloudBridge manages and deploys containerized applications across cloud
providers through one interface. The first supported providers are **AWS App
Runner** and **Google Cloud Run**.

This repository currently contains the web frontend. The FastAPI backend and
PostgreSQL database are separate; the API the frontend expects is specified in
[`docs/api-contract.md`](docs/api-contract.md).

## Features

- **Applications**: list, search and filter; a four-step create wizard; details;
  configuration (runtime, environment variables, write-only secrets); delete with
  typed confirmation.
- **Deployments**: list with filters; details with stage progress and an event
  timeline; deploy, cancel and roll back with confirmation; bounded polling while
  work is running.
- **Cloud providers**: connect AWS (IAM role and external ID) or Google Cloud
  (workload identity federation), with no long-lived keys; validation progress
  that follows the stages the backend reports; disconnect.
- **Activity log** with search, filters and date range.
- **Settings**: profile and preferences (time zone, time format), organization
  and members, and notification preferences when the backend supports them.
- **Error and recovery pages**: sign-in, sign-out, access denied, not found,
  service unavailable, maintenance, and unexpected errors.

Every page handles loading, empty, no-results, error, stale-data, permission
and session-expiry states. See the "Frontend behaviour" section below.

## Repository layout

```
frontend/                React + TypeScript + Vite app
  src/
    app/                 App root, router, providers, route guards
    components/          Shared UI: layout, navigation, forms, feedback, dialogs, tables, status
    pages/               One folder per area (auth, overview, applications, deployments, providers, audit, settings, errors)
    services/api/        HTTP client, error model, response decoders, one module per resource
    services/demo/       Development-only simulated backend (never in production builds)
    hooks/               Data loading, mutations, polling, unsaved-change protection
    types/               API and error types
    utils/               Formatting, validation, URL safety, redaction, messages
    styles/              Design tokens, base styles, layout, animations
  tests/                 Vitest + React Testing Library
docs/                    API contract and security notes
deploy/nginx.conf        Example production server with security headers
```

## Getting started

Requirements: Node.js 22 or newer.

```bash
cd frontend
npm ci
cp .env.example .env.local      # then set VITE_API_BASE_URL if needed
npm run dev                     # http://localhost:5173, talks to the real backend
```

### Demo mode (development only)

To work on the UI without a backend:

```bash
npm run dev:demo
```

This loads `.env.demo` (`VITE_DEMO_MODE=true`) and serves simulated data:

- Every screen shows a **DEMO MODE** banner, and notifications say the result
  was simulated. No cloud provider is contacted.
- Any email and password sign in. The simulated state resets on page reload.
- Demo mode is chosen once at start-up. The app never switches to demo data
  because a real request failed.
- `npm run build` (production mode) **fails** if `VITE_DEMO_MODE=true`, and the
  demo module is removed from production bundles (CI checks both). A demo
  preview can be built explicitly with `npx vite build --mode demo`. Never deploy
  that build as the real product.

### Environment variables

| Variable            | Default | Purpose |
| ------------------- | ------- | ------- |
| `VITE_API_BASE_URL` | empty (same origin) | Backend base URL, e.g. `http://localhost:8000` in development. Leave empty in production when `/api/` is proxied on the same origin. |
| `VITE_DEMO_MODE`    | `false` | Development-only simulated backend (see above). |
| `VITE_SUPPORT_URL`  | empty   | Optional `https://` link shown on error pages as "Contact support". |

All `VITE_*` values are compiled into public JavaScript. **Never put secrets in
them.**

For local development against FastAPI on another port, the backend must allow
CORS from `http://localhost:5173` with credentials, and set its cookies for
`localhost`.

## Scripts

Run inside `frontend/`:

| Command             | What it does |
| ------------------- | ------------ |
| `npm run dev`       | Development server against the real API |
| `npm run dev:demo`  | Development server with simulated data |
| `npm run typecheck` | TypeScript strict type checking |
| `npm run lint`      | ESLint (including bans on `dangerouslySetInnerHTML` and browser storage) |
| `npm test`          | Unit and component tests |
| `npm run build`     | Type check and production build into `dist/` |
| `npm run preview`   | Serve the production build locally |

## Deployment

1. Build with `VITE_DEMO_MODE` unset: `npm ci && npm run build`.
2. Serve `frontend/dist` over HTTPS. `deploy/nginx.conf` is a working example:
   it falls back to `index.html` for client-side routes, proxies `/api/` to
   FastAPI on the same origin, caches hashed assets, hides source maps, and
   sets a strict Content Security Policy, HSTS and other security headers.
3. If the API is on a different origin, set `VITE_API_BASE_URL` at build
   time, add that origin to the CSP `connect-src`, and configure CORS with
   credentials for the frontend origin only.

## Frontend behaviour

- **Loading**: skeletons shaped like the content; background refreshes keep
  the data on screen and show "Refreshing…".
- **Errors**: a central error model (`services/api/errors.ts`) maps network
  failures, timeouts, malformed responses and every HTTP status to a title,
  explanation and recovery action, and shows the request ID. Server text is
  shown only for request errors and only after sanitising.
- **Stale data**: when a refresh fails, the last data stays visible with a
  warning.
- **Writes**: buttons show a spinner and prevent duplicate submissions;
  nothing state-changing is retried automatically; after a timeout the UI
  says the outcome is unknown and offers a status check.
- **Async work**: "accepted" and "completed" are separate messages; progress
  follows what the backend reports and is never estimated; polling is bounded,
  pauses in hidden tabs, and can be resumed.
- **Forms**: labels, required and optional markers, client validation,
  server field errors mapped back to fields, input kept on recoverable errors,
  and a prompt before leaving with unsaved changes.
- **Accessibility**: semantic landmarks, skip link, visible focus, keyboard-
  operable dialogs and menus with focus restoration, one polite live region for
  state changes, text labels on every status, and reduced-motion support.
- **Responsive**: a sidebar becomes a drawer below 56rem; tables become
  labelled blocks below 40rem.

## Testing

```bash
cd frontend
npm run typecheck && npm run lint && npm test && npm run build
```

Tests use a fake API (`tests/helpers/fakeApi.ts`) and mocked `fetch`; they
never contact a real backend or cloud provider. Coverage includes every
route, loading, empty and error states, HTTP status handling, malformed
responses, form validation and server error mapping, session expiry,
permissions, duplicate submissions, idempotency keys, connection and
deployment progress, polling limits, confirmation dialogs, demo-mode
isolation, secret redaction, keyboard interaction, reduced motion, the mobile
navigation and the error boundary.

## Security

See [`docs/security.md`](docs/security.md) for what the frontend does and,
more importantly, what FastAPI, the deployment worker and cloud IAM must
enforce. The frontend alone does not make the platform secure.
