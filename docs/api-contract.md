# CloudBridge API contract (frontend expectations)

The FastAPI backend is not part of this repository yet. This document is the
contract the frontend is built and tested against. Every response is checked
at runtime by `frontend/src/services/api/decoders.ts`; anything that does not
match is shown to the user as an "unexpected response" error and never used.

All paths are relative to `VITE_API_BASE_URL` and prefixed with `/api/v1`.
JSON field names are `snake_case`. Timestamps are ISO 8601 strings in UTC.

## Conventions

### Authentication and CSRF

- Cookie sessions: the backend sets an `HttpOnly; Secure; SameSite=Lax` (or
  `Strict`) session cookie on login. The frontend never sees or stores a token.
- All requests are sent with `credentials: 'include'`. For a cross-origin API,
  CORS must allow exactly the frontend origin with `Access-Control-Allow-Credentials: true`.
- CSRF (double submit): the backend sets a readable, non-HttpOnly `cb_csrf`
  cookie. The frontend copies it into the `X-CSRF-Token` header on every
  `POST`, `PUT`, `PATCH` and `DELETE`. The backend must reject unsafe requests
  whose header does not match the cookie.
- A `401` from any endpoint except `/auth/*` ends the session in the UI and
  returns the user to the sign-in page.

### Request headers sent by the frontend

| Header            | When                                   | Purpose                                     |
| ----------------- | -------------------------------------- | ------------------------------------------- |
| `X-Request-ID`    | every request                          | Correlation ID (the backend may replace it) |
| `X-CSRF-Token`    | unsafe methods, when `cb_csrf` is set  | CSRF protection                             |
| `Idempotency-Key` | creating applications, deployments, rollbacks and provider connections | De-duplicates retried submissions |

The same `Idempotency-Key` is reused when the user re-submits an identical
payload (for example after a timeout). The backend should return the original
result for a repeated key, and `409` or `422` if the key is reused with a
different payload.

### Response headers

- `X-Request-ID`: echoed or generated; shown to users next to errors.
- `Retry-After`: on `429` and `503`, in seconds or as an HTTP date.

### Errors

Preferred envelope:

```json
{
  "error": {
    "code": "duplicate_name",
    "message": "An application with this name already exists.",
    "request_id": "req_01H…",
    "fields": [{ "field": "name", "message": "This name is already in use." }]
  }
}
```

FastAPI's defaults are also understood: `{"detail": "text"}` and
`{"detail": [{"loc": ["body", "source", "image"], "msg": "…"}]}` (the `loc`
becomes the dotted field `source.image`).

The frontend shows `message` only for `400`, `409` and `422`, and only after
removing anything that looks like a stack trace, SQL, a file path, an
internal host or a credential. It never shows server text for `5xx`. The
backend must still not put internal details in messages.

| Status          | Meaning in the UI                                                |
| --------------- | ---------------------------------------------------------------- |
| 400             | Invalid request (message shown)                                  |
| 401             | Not signed in / session expired                                  |
| 403             | Access denied (pages show an access-denied state, not empty data)|
| 404             | Resource not found; for optional settings endpoints, "not supported" |
| 409             | Conflict: duplicate, version mismatch, operation already running |
| 422             | Field validation errors (`fields`)                               |
| 429             | Rate limited (`Retry-After` shown)                               |
| 500             | Server error                                                     |
| 502 / 503 / 504 | Upstream unavailable or timed out                                |
| 503 + `code: "maintenance"` | Maintenance screen for the whole app                 |

Reads (`GET`) are retried at most twice on network errors, `429` (short
`Retry-After` only), `502`, `503` and `504`. Writes are never retried
automatically.

### Pagination

List endpoints take `page` (1-based) and `page_size` (10, 25 or 50) and return:

```json
{ "items": [], "total": 0, "page": 1, "page_size": 25 }
```

Lists are sorted newest first unless stated otherwise.

### Long-running operations

Deployments, rollbacks, provider validation and (optionally) deletion are
asynchronous. The backend answers `202 Accepted` with the current resource
and the frontend polls it:

- Deployments: every 3 s while `queued`, `in_progress` or `cancelling`,
  stopping after 30 minutes (the user can resume).
- Provider validation: every 2 s while `validating`, for at most 5 minutes.
- Lists containing running work: every 4–5 s, for at most 10–15 minutes.

Polling pauses while the browser tab is hidden and backs off after errors.
Server-sent events can replace polling later without changing the UI.

## Endpoints

### Session

| Method | Path              | Body                  | Response          |
| ------ | ----------------- | --------------------- | ----------------- |
| GET    | `/auth/session`   | —                     | `Session` or 401  |
| POST   | `/auth/login`     | `{ email, password }` | `Session`, sets cookies; 401 for bad credentials (same response whether or not the email exists); 429 when rate limited |
| POST   | `/auth/logout`    | —                     | 204, clears cookies |

```ts
Session = {
  user: { id, email, display_name, role: 'owner'|'admin'|'developer'|'viewer',
          preferences: { timezone: string|null, time_format: '12h'|'24h' } },
  organization: { id, name },
  permissions: Permission[],   // see below; unknown values are ignored
  features: { organization_settings: boolean, notification_preferences: boolean }
}
Permission = 'applications:create' | 'applications:update' | 'applications:delete'
  | 'deployments:create' | 'deployments:cancel' | 'deployments:rollback'
  | 'providers:manage' | 'audit:read' | 'organization:manage'
```

Permissions only decide what the UI shows. Every endpoint must authorise the
request itself, including tenant isolation (a user can only reach resources of
their organization).

### Applications

| Method | Path                                         | Notes |
| ------ | -------------------------------------------- | ----- |
| GET    | `/applications?page&page_size&search&status` | `Paginated<ApplicationSummary>` |
| POST   | `/applications`                              | `CreateApplicationRequest` → 201 `Application`; `Idempotency-Key` |
| GET    | `/applications/{id}`                         | `Application` |
| DELETE | `/applications/{id}`                         | 204 deleted, or 202 when removal continues in the background |
| GET    | `/applications/{id}/configuration`           | `ApplicationConfiguration` |
| PUT    | `/applications/{id}/configuration`           | `UpdateConfigurationRequest` (includes `version`) → `ApplicationConfiguration`; 409 on version mismatch |
| PUT    | `/applications/{id}/secrets/{name}`          | `{ value }` → `{ name, updated_at }`. Write-only. |
| DELETE | `/applications/{id}/secrets/{name}`          | 204 |

```ts
ApplicationSummary = { id, name, description|null, provider: 'aws_app_runner'|'gcp_cloud_run',
  connection_id, region, status: 'draft'|'deploying'|'running'|'failed'|'stopped'|'deleting',
  latest_deployment: { id, status, created_at } | null, updated_at }
Application = ApplicationSummary & { source: ApplicationSource, service_url|null, created_at, created_by|null }
ApplicationSource = { type: 'image'|'repository', image|null, repository_url|null, branch|null, dockerfile_path|null }
CreateApplicationRequest = { name, description|null, connection_id, region, source,
  port, cpu: '0.25'|'0.5'|'1'|'2'|'4', memory: '512Mi'|'1Gi'|'2Gi'|'4Gi'|'8Gi',
  min_instances, max_instances }
ApplicationConfiguration = { application_id, version, port, cpu, memory, min_instances, max_instances,
  health_check_path|null, environment: {name, value}[], secrets: {name, updated_at}[], updated_at }
```

Secret values are never returned by any endpoint, including configuration
reads, audit events and deployment events.

### Deployments

| Method | Path                                         | Notes |
| ------ | -------------------------------------------- | ----- |
| GET    | `/deployments?page&page_size&application_id&status` | `Paginated<DeploymentSummary>` |
| POST   | `/applications/{id}/deployments`             | 202 `Deployment` (queued); `Idempotency-Key`; 409 if one is running |
| GET    | `/deployments/{id}`                          | `Deployment` |
| GET    | `/deployments/{id}/events`                   | `DeploymentEvent[]` |
| POST   | `/deployments/{id}/cancel`                   | `Deployment` (`cancelling`); 409 if already finished |
| POST   | `/deployments/{id}/rollback`                 | 202 new `Deployment` with `kind: 'rollback'`; `Idempotency-Key` |

```ts
DeploymentStatus = 'queued'|'in_progress'|'succeeded'|'failed'|'cancelling'|'cancelled'
DeploymentSummary = { id, application_id, application_name, provider, status, kind: 'deploy'|'rollback',
  source_ref|null, initiated_by|null, created_at, finished_at|null }
Deployment = DeploymentSummary & { rollback_of|null, started_at|null,
  stages: { name: 'queued'|'validation'|'build'|'publishing'|'provisioning'|'verification',
            status: 'pending'|'active'|'succeeded'|'failed'|'cancelled'|'skipped',
            started_at|null, finished_at|null }[],
  failure: { code, message } | null, service_url|null,
  progress_percent: number|null }   // only real provider-reported progress, never an estimate
DeploymentEvent = { id, timestamp, level: 'info'|'warning'|'error', stage|null, message }
```

### Provider connections

| Method | Path                                    | Notes |
| ------ | --------------------------------------- | ----- |
| GET    | `/provider-connections`                 | `ProviderConnection[]` |
| POST   | `/provider-connections`                 | `CreateConnectionRequest` → 201 (`pending_validation`, with `setup`); `Idempotency-Key` |
| GET    | `/provider-connections/{id}`            | `ProviderConnection` |
| POST   | `/provider-connections/{id}/validate`   | 202 (`validating`) |
| DELETE | `/provider-connections/{id}`            | 204 or 202; 409 `connection_in_use` while applications use it |

```ts
CreateConnectionRequest = { name, provider, default_region,
  aws?: { account_id, role_arn },
  gcp?: { project_id, workload_identity_provider, service_account_email } }
ProviderConnection = { id, name, provider, default_region, created_at, last_validated_at|null,
  status: 'pending_validation'|'validating'|'connected'|'invalid_credentials'
        |'insufficient_permissions'|'provider_unavailable'|'timed_out'|'disconnected'|'error',
  config: { account_id|null, role_arn|null, project_id|null, workload_identity_provider|null, service_account_email|null },
  setup: { external_id|null, trusted_principal|null } | null,
  validation: { stage: 'connecting'|'validating_permissions'|'checking_readiness'|null,
                started_at|null, finished_at|null, error_code|null,
                checks: { name, status: 'pending'|'passed'|'failed'|'skipped', detail|null }[] } | null }
```

No long-lived cloud credentials are accepted: AWS uses `sts:AssumeRole` with a
per-connection external ID generated by the backend; Google Cloud uses
workload identity federation. `validation.stage` should be reported while
validating; if it is `null` the UI shows an indeterminate indicator instead
of inventing steps.

### Activity log

`GET /audit-events?page&page_size&search&outcome&resource_type&from&to` →
`Paginated<AuditEvent>` (requires `audit:read`).

```ts
AuditEvent = { id, occurred_at, actor: { id, display_name, email|null } | null,
  action, resource_type, resource_id|null, resource_name|null,
  outcome: 'success'|'failure'|'denied', request_id|null }
```

### Settings

| Method | Path                              | Notes |
| ------ | --------------------------------- | ----- |
| PATCH  | `/me`                             | `{ display_name, preferences }` → `User` |
| GET    | `/me/notification-preferences`    | `{ email_enabled, events: Record<event, boolean> }`; 404 = not supported |
| PUT    | `/me/notification-preferences`    | same shape |
| GET    | `/organization`                   | `{ id, name, created_at }`; 404 = not supported |
| PATCH  | `/organization`                   | `{ name }` (requires `organization:manage`) |
| GET    | `/organization/members`           | `{ id, display_name, email, role, joined_at }[]` |

Notification events: `deployment_succeeded`, `deployment_failed`,
`rollback_completed`, `provider_connection_failed`, `application_deleted`.

## Not yet in the contract

These are intentionally not offered in the UI until the backend supports them:
member invitations and role changes, application log streaming, custom
domains, metrics and cost data.
