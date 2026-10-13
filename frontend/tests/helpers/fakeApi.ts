import { vi } from 'vitest';
import type { CloudBridgeApi } from '../../src/services/api';
import { ApiError } from '../../src/services/api/errors';
import {
  makeApp,
  makeAppSummary,
  makeAuditEvent,
  makeConfig,
  makeConnection,
  makeDeployment,
  makeSession,
  page,
} from './fixtures';

type Listener = () => void;

/** A controllable in-memory API for component tests. Every method is a vi.fn. */
export function createFakeApi(mode: 'live' | 'demo' = 'live') {
  const listeners = new Map<string, Set<Listener>>();
  const api = {
    mode,
    on: vi.fn((event: string, listener: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(event, set);
      return () => set.delete(listener);
    }),
    auth: {
      getSession: vi.fn<CloudBridgeApi['auth']['getSession']>(async () => makeSession()),
      login: vi.fn<CloudBridgeApi['auth']['login']>(async () => makeSession()),
      logout: vi.fn<CloudBridgeApi['auth']['logout']>(async () => undefined),
    },
    applications: {
      list: vi.fn<CloudBridgeApi['applications']['list']>(async () => page([makeAppSummary()])),
      get: vi.fn<CloudBridgeApi['applications']['get']>(async () => makeApp()),
      create: vi.fn<CloudBridgeApi['applications']['create']>(async () => makeApp({ id: 'app-new', name: 'new-app' })),
      remove: vi.fn<CloudBridgeApi['applications']['remove']>(async () => 'deleted' as const),
      getConfiguration: vi.fn<CloudBridgeApi['applications']['getConfiguration']>(async () => makeConfig()),
      updateConfiguration: vi.fn<CloudBridgeApi['applications']['updateConfiguration']>(async () => makeConfig({ version: 4 })),
      setSecret: vi.fn<CloudBridgeApi['applications']['setSecret']>(async (_id, name) => ({ name, updated_at: '2026-10-02T00:00:00Z' })),
      deleteSecret: vi.fn<CloudBridgeApi['applications']['deleteSecret']>(async () => undefined),
    },
    deployments: {
      list: vi.fn<CloudBridgeApi['deployments']['list']>(async () => page([makeDeployment({ status: 'succeeded' })])),
      get: vi.fn<CloudBridgeApi['deployments']['get']>(async () => makeDeployment()),
      listEvents: vi.fn<CloudBridgeApi['deployments']['listEvents']>(async () => []),
      create: vi.fn<CloudBridgeApi['deployments']['create']>(async () => makeDeployment({ id: 'dep-new-000000', status: 'queued' })),
      cancel: vi.fn<CloudBridgeApi['deployments']['cancel']>(async () => makeDeployment({ status: 'cancelling' })),
      rollback: vi.fn<CloudBridgeApi['deployments']['rollback']>(async () => makeDeployment({ id: 'dep-rb-0000000', kind: 'rollback', status: 'queued' })),
    },
    providers: {
      list: vi.fn<CloudBridgeApi['providers']['list']>(async () => [makeConnection()]),
      get: vi.fn<CloudBridgeApi['providers']['get']>(async () => makeConnection()),
      create: vi.fn<CloudBridgeApi['providers']['create']>(async () => makeConnection({ id: 'conn-new', status: 'pending_validation' })),
      validate: vi.fn<CloudBridgeApi['providers']['validate']>(async () => makeConnection({ status: 'validating', validation: { stage: 'connecting', started_at: null, finished_at: null, checks: [], error_code: null } })),
      remove: vi.fn<CloudBridgeApi['providers']['remove']>(async () => 'deleted' as const),
    },
    audit: {
      list: vi.fn<CloudBridgeApi['audit']['list']>(async () => page([makeAuditEvent()])),
    },
    settings: {
      updateProfile: vi.fn<CloudBridgeApi['settings']['updateProfile']>(async () => makeSession().user),
      getOrganization: vi.fn<CloudBridgeApi['settings']['getOrganization']>(async () => ({ id: 'o1', name: 'Acme', created_at: '2026-01-01T00:00:00Z' })),
      updateOrganization: vi.fn<CloudBridgeApi['settings']['updateOrganization']>(async (input) => ({ id: 'o1', name: input.name, created_at: '2026-01-01T00:00:00Z' })),
      listMembers: vi.fn<CloudBridgeApi['settings']['listMembers']>(async () => [
        { id: 'u1', display_name: 'Ada Admin', email: 'ada@example.com', role: 'admin' as const, joined_at: '2026-01-01T00:00:00Z' },
      ]),
      getNotificationPreferences: vi.fn<CloudBridgeApi['settings']['getNotificationPreferences']>(async () => ({
        email_enabled: true,
        events: {
          deployment_succeeded: true,
          deployment_failed: true,
          rollback_completed: false,
          provider_connection_failed: true,
          application_deleted: false,
        },
      })),
      updateNotificationPreferences: vi.fn<CloudBridgeApi['settings']['updateNotificationPreferences']>(async (input) => input),
    },
  } satisfies CloudBridgeApi;

  return Object.assign(api, {
    /** Simulates the HTTP client noticing a 401 or a maintenance response. */
    emit(event: 'session-expired' | 'maintenance') {
      listeners.get(event)?.forEach((l) => l());
    },
  });
}

export type FakeApi = ReturnType<typeof createFakeApi>;

export function httpError(status: number, init: Partial<ConstructorParameters<typeof ApiError>[0]> = {}): ApiError {
  return new ApiError({ kind: 'http', status, requestId: 'req-test-1', ...init });
}

/** A promise that never settles: keeps a request "in flight" for loading-state tests. */
export function pending<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}
