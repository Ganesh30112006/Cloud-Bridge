import type {
  Application,
  ConnectionValidation,
  Deployment,
  DeploymentEvent,
  DeploymentStage,
  Paginated,
  ProviderConnection,
  StageName,
} from '../../types/api';
import { randomId } from '../../utils/id';
import { ApiError } from '../api/errors';
import type { CloudBridgeApi } from '../api/contract';
import { createSeed, type DemoState } from './seed';

/**
 * Development-only simulated backend. It is selected once at start-up when
 * VITE_DEMO_MODE=true in a non-production build, and is never used as a
 * fallback when the real API fails. Nothing here talks to a cloud provider.
 */

const STAGES: readonly StageName[] = ['queued', 'validation', 'build', 'publishing', 'provisioning', 'verification'];
const STAGE_MS = 3500;
const VALIDATION_STEP_MS = 2500;

interface DeploymentSimulation {
  startedMs: number;
  failAt: StageName | null;
  cancelRequestedMs: number | null;
}

interface ValidationSimulation {
  startedMs: number;
  outcome: 'connected' | 'insufficient_permissions';
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function delay(signal?: AbortSignal): Promise<void> {
  const ms = 250 + Math.random() * 350;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new ApiError({ kind: 'aborted' }));
      },
      { once: true },
    );
  });
}

function notFound(): ApiError {
  return new ApiError({ kind: 'http', status: 404, code: 'not_found', requestId: `demo-${randomId().slice(0, 8)}` });
}

function paginate<T>(items: T[], page: number, pageSize: number): Paginated<T> {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, page_size: pageSize };
}

const iso = (ms: number) => new Date(ms).toISOString();

export function createDemoApi(): CloudBridgeApi {
  const state: DemoState = createSeed();
  let signedIn = false;
  const deploymentSims = new Map<string, DeploymentSimulation>();
  const validationSims = new Map<string, ValidationSimulation>();
  const idempotency = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();

  function requireSession() {
    if (!signedIn) {
      listeners.get('session-expired')?.forEach((l) => l());
      throw new ApiError({ kind: 'http', status: 401, code: 'unauthenticated' });
    }
  }

  function audit(action: string, resourceType: string, resourceId: string | null, resourceName: string | null) {
    state.audit.unshift({
      id: `demo-audit-${randomId().slice(0, 8)}`,
      occurred_at: new Date().toISOString(),
      actor: { id: state.session.user.id, display_name: state.session.user.display_name, email: state.session.user.email },
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      resource_name: resourceName,
      outcome: 'success',
      request_id: `demo-${randomId().slice(0, 8)}`,
    });
  }

  /** Recomputes a simulated deployment from elapsed time. */
  function advanceDeployment(dep: Deployment): void {
    const sim = deploymentSims.get(dep.id);
    if (!sim) return;
    const now = Date.now();
    const elapsed = now - sim.startedMs;
    const cancelled = sim.cancelRequestedMs !== null && now - sim.cancelRequestedMs > 2000;
    const stages: DeploymentStage[] = [];
    let terminal: Deployment['status'] | null = null;

    STAGES.forEach((name, index) => {
      const startMs = sim.startedMs + index * STAGE_MS;
      const endMs = startMs + STAGE_MS;
      if (terminal) {
        stages.push({ name, status: terminal === 'cancelled' ? 'cancelled' : 'skipped', started_at: null, finished_at: null });
        return;
      }
      if (elapsed < index * STAGE_MS) {
        if (cancelled) {
          terminal = 'cancelled';
          stages.push({ name, status: 'cancelled', started_at: null, finished_at: null });
        } else {
          stages.push({ name, status: 'pending', started_at: null, finished_at: null });
        }
        return;
      }
      if (now < endMs) {
        if (cancelled) {
          terminal = 'cancelled';
          stages.push({ name, status: 'cancelled', started_at: iso(startMs), finished_at: iso(now) });
        } else {
          stages.push({ name, status: 'active', started_at: iso(startMs), finished_at: null });
        }
        return;
      }
      if (sim.failAt === name) {
        terminal = 'failed';
        stages.push({ name, status: 'failed', started_at: iso(startMs), finished_at: iso(endMs) });
        return;
      }
      stages.push({ name, status: 'succeeded', started_at: iso(startMs), finished_at: iso(endMs) });
    });

    dep.stages = stages;
    const allDone = stages.every((s) => s.status === 'succeeded');
    if (terminal === 'failed') {
      dep.status = 'failed';
      dep.failure = {
        code: 'build_failed',
        message: 'Simulated failure: the demo build step failed. No cloud resources were changed.',
      };
    } else if (terminal === 'cancelled') {
      dep.status = 'cancelled';
    } else if (allDone) {
      dep.status = 'succeeded';
    } else if (sim.cancelRequestedMs !== null) {
      dep.status = 'cancelling';
    } else {
      dep.status = elapsed < STAGE_MS ? 'queued' : 'in_progress';
    }
    const finished = dep.status === 'succeeded' || dep.status === 'failed' || dep.status === 'cancelled';
    if (finished && !dep.finished_at) {
      dep.finished_at = new Date().toISOString();
      deploymentSims.delete(dep.id);
      const app = state.applications.find((a) => a.id === dep.application_id);
      if (app) {
        app.status = dep.status === 'succeeded' ? 'running' : dep.status === 'failed' ? 'failed' : app.status;
        app.latest_deployment = { id: dep.id, status: dep.status, created_at: dep.created_at };
        app.updated_at = dep.finished_at;
        if (dep.status === 'succeeded') app.service_url = `https://${app.name}.demo.invalid`;
      }
    }
    if (!dep.started_at && elapsed >= STAGE_MS) dep.started_at = iso(sim.startedMs + STAGE_MS);
  }

  function advanceConnection(conn: ProviderConnection): void {
    const sim = validationSims.get(conn.id);
    if (!sim) return;
    const elapsed = Date.now() - sim.startedMs;
    const steps: Array<NonNullable<ConnectionValidation['stage']>> = [
      'connecting',
      'validating_permissions',
      'checking_readiness',
    ];
    const stepIndex = Math.floor(elapsed / VALIDATION_STEP_MS);
    const checkNames =
      conn.provider === 'aws_app_runner'
        ? ['Assume role', 'App Runner permissions', 'ECR read access']
        : ['Exchange workload identity token', 'Cloud Run Admin', 'Artifact Registry read access'];

    if (stepIndex < steps.length) {
      conn.status = 'validating';
      conn.validation = {
        stage: steps[stepIndex] ?? null,
        started_at: iso(sim.startedMs),
        finished_at: null,
        checks: checkNames.map((name, i) => ({
          name,
          status: i < stepIndex ? 'passed' : 'pending',
          detail: null,
        })),
        error_code: null,
      };
      return;
    }
    validationSims.delete(conn.id);
    const failed = sim.outcome === 'insufficient_permissions';
    conn.status = sim.outcome;
    conn.last_validated_at = new Date().toISOString();
    conn.validation = {
      stage: null,
      started_at: iso(sim.startedMs),
      finished_at: conn.last_validated_at,
      checks: checkNames.map((name, i) => ({
        name,
        status: failed && i === 1 ? 'failed' : failed && i === 2 ? 'skipped' : 'passed',
        detail: failed && i === 1 ? 'Simulated: the role is missing a required permission.' : null,
      })),
      error_code: failed ? 'insufficient_permissions' : null,
    };
  }

  function findApp(id: string): Application {
    const app = state.applications.find((a) => a.id === id);
    if (!app) throw notFound();
    return app;
  }

  function findDeployment(id: string): Deployment {
    const dep = state.deployments.find((d) => d.id === id);
    if (!dep) throw notFound();
    advanceDeployment(dep);
    return dep;
  }

  function findConnection(id: string): ProviderConnection {
    const conn = state.connections.find((c) => c.id === id);
    if (!conn) throw notFound();
    advanceConnection(conn);
    return conn;
  }

  function startDeployment(app: Application, kind: Deployment['kind'], rollbackOf: string | null): Deployment {
    const now = Date.now();
    const dep: Deployment = {
      id: `demo-dep-${randomId().slice(0, 8)}`,
      application_id: app.id,
      application_name: app.name,
      provider: app.provider,
      status: 'queued',
      kind,
      source_ref: app.source.type === 'image' ? (app.source.image?.split('/').pop() ?? null) : `${app.source.branch ?? 'main'}@HEAD`,
      initiated_by: state.session.user.display_name,
      created_at: iso(now),
      started_at: null,
      finished_at: null,
      rollback_of: rollbackOf,
      stages: STAGES.map((name) => ({ name, status: name === 'queued' ? 'active' : 'pending', started_at: null, finished_at: null })),
      failure: null,
      service_url: null,
      progress_percent: null,
    };
    state.deployments.unshift(dep);
    deploymentSims.set(dep.id, {
      startedMs: now,
      failAt: app.name.includes('fail') ? 'build' : null,
      cancelRequestedMs: null,
    });
    app.status = 'deploying';
    app.latest_deployment = { id: dep.id, status: dep.status, created_at: dep.created_at };
    audit(kind === 'rollback' ? 'deployment.rollback_started' : 'deployment.created', 'deployment', dep.id, app.name);
    return dep;
  }

  function once<T>(key: string, produce: () => T): T {
    if (idempotency.has(key)) return idempotency.get(key) as T;
    const result = produce();
    idempotency.set(key, result);
    return result;
  }

  return {
    mode: 'demo',
    on(event, listener) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return () => set.delete(listener);
    },

    auth: {
      async getSession(signal) {
        await delay(signal);
        if (!signedIn) throw new ApiError({ kind: 'http', status: 401, code: 'unauthenticated' });
        return clone(state.session);
      },
      async login(input) {
        await delay();
        if (!input.email.trim() || !input.password) {
          throw new ApiError({ kind: 'http', status: 401, code: 'invalid_credentials', method: 'POST' });
        }
        signedIn = true;
        return clone(state.session);
      },
      async logout() {
        await delay();
        signedIn = false;
      },
    },

    applications: {
      async list(params, signal) {
        await delay(signal);
        requireSession();
        const q = params.search?.trim().toLowerCase();
        const filtered = state.applications.filter(
          (a) =>
            (!q || a.name.includes(q) || (a.description ?? '').toLowerCase().includes(q)) &&
            (!params.status || a.status === params.status),
        );
        filtered.forEach((a) => {
          if (a.latest_deployment) {
            const dep = state.deployments.find((d) => d.id === a.latest_deployment?.id);
            if (dep) advanceDeployment(dep);
          }
        });
        return clone(paginate(filtered, params.page, params.page_size));
      },
      async get(id, signal) {
        await delay(signal);
        requireSession();
        const app = findApp(id);
        if (app.latest_deployment) {
          const dep = state.deployments.find((d) => d.id === app.latest_deployment?.id);
          if (dep) advanceDeployment(dep);
        }
        return clone(app);
      },
      async create(input, { idempotencyKey }) {
        await delay();
        requireSession();
        return clone(
          once(idempotencyKey, () => {
            if (state.applications.some((a) => a.name === input.name)) {
              throw new ApiError({
                kind: 'http',
                status: 409,
                code: 'duplicate_name',
                serverMessage: 'An application with this name already exists.',
                fieldErrors: [{ field: 'name', message: 'This name is already in use.' }],
                method: 'POST',
              });
            }
            const conn = state.connections.find((c) => c.id === input.connection_id);
            if (!conn) {
              throw new ApiError({
                kind: 'http',
                status: 422,
                fieldErrors: [{ field: 'connection_id', message: 'Select a provider connection.' }],
                method: 'POST',
              });
            }
            const now = new Date().toISOString();
            const app: Application = {
              id: `demo-app-${randomId().slice(0, 8)}`,
              name: input.name,
              description: input.description,
              provider: conn.provider,
              connection_id: conn.id,
              region: input.region,
              status: 'draft',
              latest_deployment: null,
              updated_at: now,
              source: input.source,
              service_url: null,
              created_at: now,
              created_by: state.session.user.display_name,
            };
            state.applications.unshift(app);
            state.configurations[app.id] = {
              application_id: app.id,
              version: 1,
              port: input.port,
              cpu: input.cpu,
              memory: input.memory,
              min_instances: input.min_instances,
              max_instances: input.max_instances,
              health_check_path: null,
              environment: [],
              secrets: [],
              updated_at: now,
            };
            audit('application.created', 'application', app.id, app.name);
            return app;
          }),
        );
      },
      async remove(id) {
        await delay();
        requireSession();
        const app = findApp(id);
        state.applications = state.applications.filter((a) => a.id !== id);
        audit('application.deleted', 'application', id, app.name);
        return 'deleted';
      },
      async getConfiguration(id, signal) {
        await delay(signal);
        requireSession();
        findApp(id);
        const config = state.configurations[id];
        if (!config) throw notFound();
        return clone(config);
      },
      async updateConfiguration(id, input) {
        await delay();
        requireSession();
        const app = findApp(id);
        const current = state.configurations[id];
        if (!current) throw notFound();
        if (current.version !== input.version) {
          throw new ApiError({
            kind: 'http',
            status: 409,
            code: 'version_conflict',
            serverMessage: 'The configuration was changed by someone else. Reload to see the latest version.',
            method: 'PUT',
          });
        }
        const next = { ...current, ...input, version: current.version + 1, updated_at: new Date().toISOString() };
        state.configurations[id] = next;
        audit('application.configuration_updated', 'application', id, app.name);
        return clone(next);
      },
      async setSecret(id, name) {
        await delay();
        requireSession();
        const config = state.configurations[id];
        if (!config) throw notFound();
        const summary = { name, updated_at: new Date().toISOString() };
        config.secrets = [...config.secrets.filter((s) => s.name !== name), summary];
        audit('application.secret_set', 'application', id, name);
        return clone(summary);
      },
      async deleteSecret(id, name) {
        await delay();
        requireSession();
        const config = state.configurations[id];
        if (!config) throw notFound();
        config.secrets = config.secrets.filter((s) => s.name !== name);
        audit('application.secret_deleted', 'application', id, name);
      },
    },

    deployments: {
      async list(params, signal) {
        await delay(signal);
        requireSession();
        state.deployments.forEach(advanceDeployment);
        const filtered = [...state.deployments].sort((a, b) => b.created_at.localeCompare(a.created_at)).filter(
          (d) =>
            (!params.application_id || d.application_id === params.application_id) &&
            (!params.status || d.status === params.status),
        );
        return clone(paginate(filtered, params.page, params.page_size));
      },
      async get(id, signal) {
        await delay(signal);
        requireSession();
        return clone(findDeployment(id));
      },
      async listEvents(id, signal) {
        await delay(signal);
        requireSession();
        const dep = findDeployment(id);
        const events: DeploymentEvent[] = [];
        for (const stage of dep.stages) {
          if (stage.started_at) {
            events.push({
              id: `${dep.id}-${stage.name}-start`,
              timestamp: stage.started_at,
              level: 'info',
              stage: stage.name,
              message: `Simulated: ${stage.name} started.`,
            });
          }
          if (stage.finished_at) {
            const failed = stage.status === 'failed';
            events.push({
              id: `${dep.id}-${stage.name}-end`,
              timestamp: stage.finished_at,
              level: failed ? 'error' : stage.status === 'cancelled' ? 'warning' : 'info',
              stage: stage.name,
              message: `Simulated: ${stage.name} ${stage.status}.`,
            });
          }
        }
        return clone(events);
      },
      async create(applicationId, { idempotencyKey }) {
        await delay();
        requireSession();
        const app = findApp(applicationId);
        return clone(
          once(idempotencyKey, () => {
            if (deploymentSims.size && state.deployments.some((d) => d.application_id === app.id && deploymentSims.has(d.id))) {
              throw new ApiError({
                kind: 'http',
                status: 409,
                code: 'deployment_in_progress',
                serverMessage: 'A deployment for this application is already in progress.',
                method: 'POST',
              });
            }
            return startDeployment(app, 'deploy', null);
          }),
        );
      },
      async cancel(id) {
        await delay();
        requireSession();
        const dep = findDeployment(id);
        const sim = deploymentSims.get(id);
        if (!sim) {
          throw new ApiError({
            kind: 'http',
            status: 409,
            code: 'not_cancellable',
            serverMessage: 'This deployment has already finished.',
            method: 'POST',
          });
        }
        sim.cancelRequestedMs ??= Date.now();
        dep.status = 'cancelling';
        audit('deployment.cancel_requested', 'deployment', id, dep.application_name);
        return clone(dep);
      },
      async rollback(id, { idempotencyKey }) {
        await delay();
        requireSession();
        const target = findDeployment(id);
        const app = findApp(target.application_id);
        return clone(once(idempotencyKey, () => startDeployment(app, 'rollback', target.id)));
      },
    },

    providers: {
      async list(signal) {
        await delay(signal);
        requireSession();
        state.connections.forEach(advanceConnection);
        return clone(state.connections);
      },
      async get(id, signal) {
        await delay(signal);
        requireSession();
        return clone(findConnection(id));
      },
      async create(input, { idempotencyKey }) {
        await delay();
        requireSession();
        return clone(
          once(idempotencyKey, () => {
            const conn: ProviderConnection = {
              id: `demo-conn-${randomId().slice(0, 8)}`,
              name: input.name,
              provider: input.provider,
              status: 'pending_validation',
              default_region: input.default_region,
              config: {
                account_id: input.aws?.account_id ?? null,
                role_arn: input.aws?.role_arn ?? null,
                project_id: input.gcp?.project_id ?? null,
                workload_identity_provider: input.gcp?.workload_identity_provider ?? null,
                service_account_email: input.gcp?.service_account_email ?? null,
              },
              setup: {
                external_id: input.provider === 'aws_app_runner' ? `demo-${randomId().slice(0, 12)}` : null,
                trusted_principal:
                  input.provider === 'aws_app_runner'
                    ? 'arn:aws:iam::000000000000:role/cloudbridge-demo-worker'
                    : 'principal://demo.invalid/cloudbridge-worker',
              },
              validation: null,
              created_at: new Date().toISOString(),
              last_validated_at: null,
            };
            state.connections.push(conn);
            audit('provider_connection.created', 'provider_connection', conn.id, conn.name);
            return conn;
          }),
        );
      },
      async validate(id) {
        await delay();
        requireSession();
        const conn = findConnection(id);
        if (!validationSims.has(id)) {
          const roleRef = conn.config.role_arn ?? conn.config.service_account_email ?? '';
          validationSims.set(id, {
            startedMs: Date.now(),
            outcome: /readonly/i.test(roleRef) ? 'insufficient_permissions' : 'connected',
          });
          advanceConnection(conn);
          audit('provider_connection.validation_started', 'provider_connection', id, conn.name);
        }
        return clone(conn);
      },
      async remove(id) {
        await delay();
        requireSession();
        const conn = findConnection(id);
        if (state.applications.some((a) => a.connection_id === id)) {
          throw new ApiError({
            kind: 'http',
            status: 409,
            code: 'connection_in_use',
            serverMessage: 'Applications still use this connection. Delete or move them first.',
            method: 'DELETE',
          });
        }
        state.connections = state.connections.filter((c) => c.id !== id);
        audit('provider_connection.deleted', 'provider_connection', id, conn.name);
        return 'deleted';
      },
    },

    audit: {
      async list(params, signal) {
        await delay(signal);
        requireSession();
        const q = params.search?.trim().toLowerCase();
        const filtered = [...state.audit].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).filter(
          (e) =>
            (!q ||
              e.action.includes(q) ||
              (e.resource_name ?? '').toLowerCase().includes(q) ||
              (e.actor?.display_name ?? '').toLowerCase().includes(q)) &&
            (!params.outcome || e.outcome === params.outcome) &&
            (!params.resource_type || e.resource_type === params.resource_type) &&
            (!params.from || e.occurred_at >= params.from) &&
            (!params.to || e.occurred_at <= params.to),
        );
        return clone(paginate(filtered, params.page, params.page_size));
      },
    },

    settings: {
      async updateProfile(input) {
        await delay();
        requireSession();
        state.session.user = { ...state.session.user, display_name: input.display_name, preferences: input.preferences };
        return clone(state.session.user);
      },
      async getOrganization(signal) {
        await delay(signal);
        requireSession();
        return { ...state.session.organization, created_at: state.organizationCreatedAt };
      },
      async updateOrganization(input) {
        await delay();
        requireSession();
        state.session.organization = { ...state.session.organization, name: input.name };
        audit('organization.updated', 'organization', state.session.organization.id, input.name);
        return { ...state.session.organization, created_at: state.organizationCreatedAt };
      },
      async listMembers(signal) {
        await delay(signal);
        requireSession();
        return clone(state.members);
      },
      async getNotificationPreferences(signal) {
        await delay(signal);
        requireSession();
        return clone(state.notifications);
      },
      async updateNotificationPreferences(input) {
        await delay();
        requireSession();
        state.notifications = clone(input);
        return clone(state.notifications);
      },
    },
  };
}
