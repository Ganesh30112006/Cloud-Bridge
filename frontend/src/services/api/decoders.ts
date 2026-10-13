import type {
  Application,
  ApplicationConfiguration,
  ApplicationSource,
  ApplicationStatus,
  AuditEvent,
  AuditOutcome,
  CheckStatus,
  ConnectionConfig,
  ConnectionSetup,
  ConnectionStatus,
  ConnectionValidation,
  Deployment,
  DeploymentEvent,
  DeploymentRef,
  DeploymentStage,
  DeploymentStatus,
  DeploymentSummary,
  ApplicationSummary,
  NotificationEvent,
  NotificationPreferences,
  OperationAccepted,
  Organization,
  OrganizationMember,
  Paginated,
  Permission,
  ProviderConnection,
  ProviderKind,
  SecretSummary,
  Session,
  StageName,
  StageStatus,
  User,
  UserRole,
  ValidationCheck,
  ValidationStage,
} from '../../types/api';
import {
  array,
  boolean,
  dateTime,
  integer,
  nullable,
  number,
  object,
  oneOf,
  oneOfOr,
  oneOfOrNull,
  record,
  string,
  withDefault,
  type Decoder,
} from './decode';

export const PROVIDER_KINDS: readonly ProviderKind[] = ['aws_app_runner', 'gcp_cloud_run'];
const providerKind = oneOf(PROVIDER_KINDS);

export const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'draft',
  'deploying',
  'running',
  'failed',
  'stopped',
  'deleting',
  'unknown',
];

export const DEPLOYMENT_STATUSES: readonly DeploymentStatus[] = [
  'queued',
  'in_progress',
  'succeeded',
  'failed',
  'cancelling',
  'cancelled',
  'unknown',
];

export const CONNECTION_STATUSES: readonly ConnectionStatus[] = [
  'pending_validation',
  'validating',
  'connected',
  'invalid_credentials',
  'insufficient_permissions',
  'provider_unavailable',
  'timed_out',
  'disconnected',
  'error',
  'unknown',
];

export const STAGE_NAMES: readonly StageName[] = [
  'queued',
  'validation',
  'build',
  'publishing',
  'provisioning',
  'verification',
];

const STAGE_STATUSES: readonly StageStatus[] = [
  'pending',
  'active',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
];

export const AUDIT_OUTCOMES: readonly AuditOutcome[] = ['success', 'failure', 'denied', 'unknown'];

const PERMISSIONS: readonly Permission[] = [
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

const USER_ROLES: readonly UserRole[] = ['owner', 'admin', 'developer', 'viewer'];

export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  'deployment_succeeded',
  'deployment_failed',
  'rollback_completed',
  'provider_connection_failed',
  'application_deleted',
];

/** Unknown permissions from a newer backend are ignored, never granted. */
const permissions: Decoder<Permission[]> = (value, path) =>
  array(string)(value, path).filter((p): p is Permission => PERMISSIONS.includes(p as Permission));

export function paginated<T>(item: Decoder<T>): Decoder<Paginated<T>> {
  return object<Paginated<T>>({
    items: array(item),
    total: integer,
    page: integer,
    page_size: integer,
  });
}

export const user = object<User>({
  id: string,
  email: string,
  display_name: string,
  role: oneOfOr(USER_ROLES, 'viewer'),
  preferences: withDefault(
    object<User['preferences']>({
      timezone: nullable(string),
      time_format: withDefault(oneOfOr(['12h', '24h'] as const, '24h'), '24h'),
    }),
    { timezone: null, time_format: '24h' },
  ),
});

export const session = object<Session>({
  user,
  organization: object<Session['organization']>({ id: string, name: string }),
  permissions,
  features: withDefault(
    object<Session['features']>({
      organization_settings: withDefault(boolean, false),
      notification_preferences: withDefault(boolean, false),
    }),
    { organization_settings: false, notification_preferences: false },
  ),
});

const deploymentStatus = oneOfOr(DEPLOYMENT_STATUSES, 'unknown');

const deploymentRef = object<DeploymentRef>({
  id: string,
  status: deploymentStatus,
  created_at: dateTime,
});

export const applicationSummary = object<ApplicationSummary>({
  id: string,
  name: string,
  description: nullable(string),
  provider: providerKind,
  connection_id: string,
  region: string,
  status: oneOfOr(APPLICATION_STATUSES, 'unknown'),
  latest_deployment: nullable(deploymentRef),
  updated_at: dateTime,
});

const applicationSource = object<ApplicationSource>({
  type: oneOf(['image', 'repository'] as const),
  image: nullable(string),
  repository_url: nullable(string),
  branch: nullable(string),
  dockerfile_path: nullable(string),
});

export const application: Decoder<Application> = (value, path) => ({
  ...applicationSummary(value, path),
  ...object<Pick<Application, 'source' | 'service_url' | 'created_at' | 'created_by'>>({
    source: applicationSource,
    service_url: nullable(string),
    created_at: dateTime,
    created_by: nullable(string),
  })(value, path),
});

const secretSummary = object<SecretSummary>({ name: string, updated_at: dateTime });

export const applicationConfiguration = object<ApplicationConfiguration>({
  application_id: string,
  version: integer,
  port: integer,
  cpu: string,
  memory: string,
  min_instances: integer,
  max_instances: integer,
  health_check_path: nullable(string),
  environment: array(object({ name: string, value: string })),
  secrets: array(secretSummary),
  updated_at: dateTime,
});

export { secretSummary };

export const operationAccepted = object<OperationAccepted>({
  operation_id: string,
  status: oneOf(['accepted'] as const),
});

const deploymentStage = object<DeploymentStage>({
  name: oneOf(STAGE_NAMES),
  status: oneOfOr(STAGE_STATUSES, 'pending'),
  started_at: nullable(dateTime),
  finished_at: nullable(dateTime),
});

export const deploymentSummary = object<DeploymentSummary>({
  id: string,
  application_id: string,
  application_name: string,
  provider: providerKind,
  status: deploymentStatus,
  kind: oneOfOr(['deploy', 'rollback'] as const, 'deploy'),
  source_ref: nullable(string),
  initiated_by: nullable(string),
  created_at: dateTime,
  finished_at: nullable(dateTime),
});

const progressPercent: Decoder<number | null> = (value, path) => {
  const n = nullable(number)(value, path);
  if (n === null) return null;
  return n >= 0 && n <= 100 ? n : null;
};

export const deployment: Decoder<Deployment> = (value, path) => ({
  ...deploymentSummary(value, path),
  ...object<
    Pick<Deployment, 'rollback_of' | 'started_at' | 'stages' | 'failure' | 'service_url' | 'progress_percent'>
  >({
    rollback_of: nullable(string),
    started_at: nullable(dateTime),
    stages: withDefault(array(deploymentStage), []),
    failure: nullable(object({ code: string, message: string })),
    service_url: nullable(string),
    progress_percent: progressPercent,
  })(value, path),
});

export const deploymentEvent = object<DeploymentEvent>({
  id: string,
  timestamp: dateTime,
  level: oneOfOr(['info', 'warning', 'error'] as const, 'info'),
  stage: oneOfOrNull(STAGE_NAMES),
  message: string,
});

const validationCheck = object<ValidationCheck>({
  name: string,
  status: oneOfOr<CheckStatus>(['pending', 'passed', 'failed', 'skipped', 'unknown'], 'unknown'),
  detail: nullable(string),
});

const connectionValidation = object<ConnectionValidation>({
  stage: oneOfOrNull<ValidationStage>(['connecting', 'validating_permissions', 'checking_readiness']),
  started_at: nullable(dateTime),
  finished_at: nullable(dateTime),
  checks: withDefault(array(validationCheck), []),
  error_code: nullable(string),
});

const connectionConfig = object<ConnectionConfig>({
  account_id: nullable(string),
  role_arn: nullable(string),
  project_id: nullable(string),
  workload_identity_provider: nullable(string),
  service_account_email: nullable(string),
});

export const providerConnection = object<ProviderConnection>({
  id: string,
  name: string,
  provider: providerKind,
  status: oneOfOr(CONNECTION_STATUSES, 'unknown'),
  default_region: string,
  config: withDefault(connectionConfig, {
    account_id: null,
    role_arn: null,
    project_id: null,
    workload_identity_provider: null,
    service_account_email: null,
  }),
  setup: nullable(object<ConnectionSetup>({ external_id: nullable(string), trusted_principal: nullable(string) })),
  validation: nullable(connectionValidation),
  created_at: dateTime,
  last_validated_at: nullable(dateTime),
});

export const auditEvent = object<AuditEvent>({
  id: string,
  occurred_at: dateTime,
  actor: nullable(object({ id: string, display_name: string, email: nullable(string) })),
  action: string,
  resource_type: string,
  resource_id: nullable(string),
  resource_name: nullable(string),
  outcome: oneOfOr(AUDIT_OUTCOMES, 'unknown'),
  request_id: nullable(string),
});

export const organization = object<Organization>({ id: string, name: string, created_at: dateTime });

export const organizationMember = object<OrganizationMember>({
  id: string,
  display_name: string,
  email: string,
  role: oneOfOr(USER_ROLES, 'viewer'),
  joined_at: dateTime,
});

export const notificationPreferences = object<NotificationPreferences>({
  email_enabled: boolean,
  events: record(NOTIFICATION_EVENTS, withDefault(boolean, false)),
});
