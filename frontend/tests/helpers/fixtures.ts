import type {
  Application,
  ApplicationConfiguration,
  ApplicationSummary,
  AuditEvent,
  Deployment,
  Paginated,
  Permission,
  ProviderConnection,
  Session,
} from '../../src/types/api';

export const ALL_PERMISSIONS: Permission[] = [
  'applications:create',
  'applications:update',
  'applications:delete',
  'deployments:create',
  'deployments:cancel',
  'deployments:rollback',
  'providers:manage',
  'audit:read',
  'organization:manage',
];

export function makeSession(permissions: Permission[] = ALL_PERMISSIONS, overrides: Partial<Session> = {}): Session {
  return {
    user: {
      id: 'u1',
      email: 'ada@example.com',
      display_name: 'Ada Admin',
      role: 'admin',
      preferences: { timezone: 'UTC', time_format: '24h' },
    },
    organization: { id: 'o1', name: 'Acme' },
    permissions,
    features: { organization_settings: true, notification_preferences: true },
    ...overrides,
  };
}

const T = '2026-10-01T10:00:00Z';

export function makeAppSummary(overrides: Partial<ApplicationSummary> = {}): ApplicationSummary {
  return {
    id: 'app-1',
    name: 'orders-api',
    description: 'Order service',
    provider: 'aws_app_runner',
    connection_id: 'conn-1',
    region: 'eu-west-1',
    status: 'running',
    latest_deployment: { id: 'dep-1', status: 'succeeded', created_at: T },
    updated_at: T,
    ...overrides,
  };
}

export function makeApp(overrides: Partial<Application> = {}): Application {
  return {
    ...makeAppSummary(),
    source: { type: 'image', image: 'registry.example.com/orders:1.0.0', repository_url: null, branch: null, dockerfile_path: null },
    service_url: 'https://orders.example.com',
    created_at: T,
    created_by: 'Ada Admin',
    ...overrides,
  };
}

export function page<T>(items: T[], total = items.length, pageNo = 1, pageSize = 25): Paginated<T> {
  return { items, total, page: pageNo, page_size: pageSize };
}

export function makeConfig(overrides: Partial<ApplicationConfiguration> = {}): ApplicationConfiguration {
  return {
    application_id: 'app-1',
    version: 3,
    port: 8080,
    cpu: '1',
    memory: '2Gi',
    min_instances: 1,
    max_instances: 3,
    health_check_path: '/healthz',
    environment: [{ name: 'LOG_LEVEL', value: 'info' }],
    secrets: [{ name: 'DATABASE_URL', updated_at: T }],
    updated_at: T,
    ...overrides,
  };
}

export function makeDeployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    id: 'dep-12345678abcd',
    application_id: 'app-1',
    application_name: 'orders-api',
    provider: 'aws_app_runner',
    status: 'in_progress',
    kind: 'deploy',
    source_ref: 'orders:1.0.0',
    initiated_by: 'Ada Admin',
    created_at: T,
    finished_at: null,
    rollback_of: null,
    started_at: T,
    stages: [
      { name: 'queued', status: 'succeeded', started_at: T, finished_at: T },
      { name: 'validation', status: 'succeeded', started_at: T, finished_at: T },
      { name: 'build', status: 'active', started_at: T, finished_at: null },
      { name: 'publishing', status: 'pending', started_at: null, finished_at: null },
      { name: 'provisioning', status: 'pending', started_at: null, finished_at: null },
      { name: 'verification', status: 'pending', started_at: null, finished_at: null },
    ],
    failure: null,
    service_url: null,
    progress_percent: null,
    ...overrides,
  };
}

export function makeConnection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: 'conn-1',
    name: 'Production AWS',
    provider: 'aws_app_runner',
    status: 'connected',
    default_region: 'eu-west-1',
    config: {
      account_id: '123456789012',
      role_arn: 'arn:aws:iam::123456789012:role/CloudBridge',
      project_id: null,
      workload_identity_provider: null,
      service_account_email: null,
    },
    setup: { external_id: 'ext-123', trusted_principal: 'arn:aws:iam::999999999999:role/cloudbridge' },
    validation: null,
    created_at: T,
    last_validated_at: T,
    ...overrides,
  };
}

export function makeAuditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'a1',
    occurred_at: T,
    actor: { id: 'u1', display_name: 'Ada Admin', email: 'ada@example.com' },
    action: 'deployment.created',
    resource_type: 'deployment',
    resource_id: 'dep-1',
    resource_name: 'orders-api',
    outcome: 'success',
    request_id: 'req-1',
    ...overrides,
  };
}
