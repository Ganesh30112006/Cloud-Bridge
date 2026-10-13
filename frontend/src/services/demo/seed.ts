import type {
  Application,
  ApplicationConfiguration,
  AuditEvent,
  Deployment,
  DeploymentStage,
  NotificationPreferences,
  OrganizationMember,
  ProviderConnection,
  Session,
} from '../../types/api';

/**
 * Sample records for development demo mode. Names and identifiers are
 * deliberately fictitious (".invalid" hosts, zeroed account numbers) so they
 * cannot be mistaken for real cloud resources.
 */

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export function stagesAllSucceeded(start: string, end: string): DeploymentStage[] {
  return (['queued', 'validation', 'build', 'publishing', 'provisioning', 'verification'] as const).map((name) => ({
    name,
    status: 'succeeded',
    started_at: start,
    finished_at: end,
  }));
}

export interface DemoState {
  session: Session;
  connections: ProviderConnection[];
  applications: Application[];
  configurations: Record<string, ApplicationConfiguration>;
  deployments: Deployment[];
  audit: AuditEvent[];
  members: OrganizationMember[];
  notifications: NotificationPreferences;
  organizationCreatedAt: string;
}

export function createSeed(): DemoState {
  const session: Session = {
    user: {
      id: 'demo-user-1',
      email: 'demo.user@example.com',
      display_name: 'Demo User',
      role: 'admin',
      preferences: { timezone: null, time_format: '24h' },
    },
    organization: { id: 'demo-org', name: 'Demo organization' },
    permissions: [
      'applications:create',
      'applications:update',
      'applications:delete',
      'deployments:create',
      'deployments:cancel',
      'deployments:rollback',
      'providers:manage',
      'audit:read',
      'organization:manage',
    ],
    features: { organization_settings: true, notification_preferences: true },
  };

  const connections: ProviderConnection[] = [
    {
      id: 'demo-conn-aws',
      name: 'Demo AWS account',
      provider: 'aws_app_runner',
      status: 'connected',
      default_region: 'eu-west-1',
      config: {
        account_id: '000000000000',
        role_arn: 'arn:aws:iam::000000000000:role/CloudBridgeDemo',
        project_id: null,
        workload_identity_provider: null,
        service_account_email: null,
      },
      setup: { external_id: 'demo-external-id', trusted_principal: 'arn:aws:iam::000000000000:root' },
      validation: {
        stage: null,
        started_at: minutesAgo(3000),
        finished_at: minutesAgo(2999),
        checks: [
          { name: 'Assume role', status: 'passed', detail: null },
          { name: 'App Runner permissions', status: 'passed', detail: null },
          { name: 'ECR read access', status: 'passed', detail: null },
        ],
        error_code: null,
      },
      created_at: minutesAgo(4000),
      last_validated_at: minutesAgo(2999),
    },
    {
      id: 'demo-conn-gcp',
      name: 'Demo Google Cloud project',
      provider: 'gcp_cloud_run',
      status: 'insufficient_permissions',
      default_region: 'europe-west1',
      config: {
        account_id: null,
        role_arn: null,
        project_id: 'demo-project-000',
        workload_identity_provider:
          'projects/000000000000/locations/global/workloadIdentityPools/demo-pool/providers/demo-provider',
        service_account_email: 'cloudbridge@demo-project-000.iam.gserviceaccount.com',
      },
      setup: { external_id: null, trusted_principal: 'demo-principal' },
      validation: {
        stage: null,
        started_at: minutesAgo(600),
        finished_at: minutesAgo(599),
        checks: [
          { name: 'Exchange workload identity token', status: 'passed', detail: null },
          { name: 'Cloud Run Admin (run.services.create)', status: 'failed', detail: 'Permission not granted to the service account.' },
          { name: 'Artifact Registry read access', status: 'skipped', detail: null },
        ],
        error_code: 'insufficient_permissions',
      },
      created_at: minutesAgo(700),
      last_validated_at: minutesAgo(599),
    },
  ];

  const applications: Application[] = [
    {
      id: 'demo-app-orders',
      name: 'orders-api',
      description: 'Sample order service (demo data).',
      provider: 'aws_app_runner',
      connection_id: 'demo-conn-aws',
      region: 'eu-west-1',
      status: 'running',
      latest_deployment: { id: 'demo-dep-3', status: 'succeeded', created_at: minutesAgo(90) },
      updated_at: minutesAgo(85),
      source: {
        type: 'image',
        image: '000000000000.dkr.ecr.eu-west-1.amazonaws.com/orders-api:1.4.2',
        repository_url: null,
        branch: null,
        dockerfile_path: null,
      },
      service_url: 'https://orders-api.demo.invalid',
      created_at: minutesAgo(5000),
      created_by: 'Demo User',
    },
    {
      id: 'demo-app-web',
      name: 'storefront-web',
      description: null,
      provider: 'aws_app_runner',
      connection_id: 'demo-conn-aws',
      region: 'eu-west-1',
      status: 'failed',
      latest_deployment: { id: 'demo-dep-2', status: 'failed', created_at: minutesAgo(300) },
      updated_at: minutesAgo(295),
      source: {
        type: 'repository',
        image: null,
        repository_url: 'https://git.example.com/demo/storefront-web.git',
        branch: 'main',
        dockerfile_path: 'Dockerfile',
      },
      service_url: null,
      created_at: minutesAgo(4500),
      created_by: 'Demo User',
    },
  ];

  const baseConfig = {
    port: 8080,
    cpu: '1',
    memory: '2Gi',
    min_instances: 1,
    max_instances: 4,
    health_check_path: '/healthz',
  };

  const configurations: Record<string, ApplicationConfiguration> = {
    'demo-app-orders': {
      application_id: 'demo-app-orders',
      version: 3,
      ...baseConfig,
      environment: [
        { name: 'LOG_LEVEL', value: 'info' },
        { name: 'FEATURE_RETURNS', value: 'true' },
      ],
      secrets: [{ name: 'DATABASE_URL', updated_at: minutesAgo(4000) }],
      updated_at: minutesAgo(100),
    },
    'demo-app-web': {
      application_id: 'demo-app-web',
      version: 1,
      ...baseConfig,
      port: 3000,
      environment: [{ name: 'NODE_ENV', value: 'production' }],
      secrets: [],
      updated_at: minutesAgo(4500),
    },
  };

  const deployments: Deployment[] = [
    {
      id: 'demo-dep-1',
      application_id: 'demo-app-orders',
      application_name: 'orders-api',
      provider: 'aws_app_runner',
      status: 'succeeded',
      kind: 'deploy',
      source_ref: 'orders-api:1.4.1',
      initiated_by: 'Demo User',
      created_at: minutesAgo(2000),
      started_at: minutesAgo(2000),
      finished_at: minutesAgo(1994),
      rollback_of: null,
      stages: stagesAllSucceeded(minutesAgo(2000), minutesAgo(1994)),
      failure: null,
      service_url: 'https://orders-api.demo.invalid',
      progress_percent: null,
    },
    {
      id: 'demo-dep-2',
      application_id: 'demo-app-web',
      application_name: 'storefront-web',
      provider: 'aws_app_runner',
      status: 'failed',
      kind: 'deploy',
      source_ref: 'main@3f2a9c1',
      initiated_by: 'Demo User',
      created_at: minutesAgo(300),
      started_at: minutesAgo(300),
      finished_at: minutesAgo(296),
      rollback_of: null,
      stages: [
        { name: 'queued', status: 'succeeded', started_at: minutesAgo(300), finished_at: minutesAgo(300) },
        { name: 'validation', status: 'succeeded', started_at: minutesAgo(300), finished_at: minutesAgo(299) },
        { name: 'build', status: 'failed', started_at: minutesAgo(299), finished_at: minutesAgo(296) },
        { name: 'publishing', status: 'skipped', started_at: null, finished_at: null },
        { name: 'provisioning', status: 'skipped', started_at: null, finished_at: null },
        { name: 'verification', status: 'skipped', started_at: null, finished_at: null },
      ],
      failure: { code: 'build_failed', message: 'The container build failed: npm ci exited with code 1.' },
      service_url: null,
      progress_percent: null,
    },
    {
      id: 'demo-dep-3',
      application_id: 'demo-app-orders',
      application_name: 'orders-api',
      provider: 'aws_app_runner',
      status: 'succeeded',
      kind: 'deploy',
      source_ref: 'orders-api:1.4.2',
      initiated_by: 'Demo User',
      created_at: minutesAgo(90),
      started_at: minutesAgo(90),
      finished_at: minutesAgo(85),
      rollback_of: null,
      stages: stagesAllSucceeded(minutesAgo(90), minutesAgo(85)),
      failure: null,
      service_url: 'https://orders-api.demo.invalid',
      progress_percent: null,
    },
  ];

  const audit: AuditEvent[] = [
    {
      id: 'demo-audit-1',
      occurred_at: minutesAgo(90),
      actor: { id: 'demo-user-1', display_name: 'Demo User', email: 'demo.user@example.com' },
      action: 'deployment.created',
      resource_type: 'deployment',
      resource_id: 'demo-dep-3',
      resource_name: 'orders-api',
      outcome: 'success',
      request_id: 'demo-req-0003',
    },
    {
      id: 'demo-audit-2',
      occurred_at: minutesAgo(300),
      actor: { id: 'demo-user-1', display_name: 'Demo User', email: 'demo.user@example.com' },
      action: 'deployment.created',
      resource_type: 'deployment',
      resource_id: 'demo-dep-2',
      resource_name: 'storefront-web',
      outcome: 'success',
      request_id: 'demo-req-0002',
    },
    {
      id: 'demo-audit-3',
      occurred_at: minutesAgo(599),
      actor: null,
      action: 'provider_connection.validated',
      resource_type: 'provider_connection',
      resource_id: 'demo-conn-gcp',
      resource_name: 'Demo Google Cloud project',
      outcome: 'failure',
      request_id: 'demo-req-0001',
    },
  ];

  const members: OrganizationMember[] = [
    {
      id: 'demo-user-1',
      display_name: 'Demo User',
      email: 'demo.user@example.com',
      role: 'admin',
      joined_at: minutesAgo(9000),
    },
    {
      id: 'demo-user-2',
      display_name: 'Sample Developer',
      email: 'sample.developer@example.com',
      role: 'developer',
      joined_at: minutesAgo(8000),
    },
  ];

  return {
    session,
    connections,
    applications,
    configurations,
    deployments,
    audit,
    members,
    notifications: {
      email_enabled: true,
      events: {
        deployment_succeeded: false,
        deployment_failed: true,
        rollback_completed: true,
        provider_connection_failed: true,
        application_deleted: false,
      },
    },
    organizationCreatedAt: minutesAgo(9000),
  };
}
