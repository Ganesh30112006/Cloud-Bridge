/**
 * Wire types for the CloudBridge REST API (see docs/api-contract.md).
 * Field names match the JSON the FastAPI backend sends, so they are snake_case.
 * Every response is checked at runtime by the decoders in services/api/decoders.ts.
 */

export type IsoDateTime = string;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/* ---------- Session and users ---------- */

export type UserRole = 'owner' | 'admin' | 'developer' | 'viewer';

export type Permission =
  | 'applications:create'
  | 'applications:update'
  | 'applications:delete'
  | 'deployments:create'
  | 'deployments:cancel'
  | 'deployments:rollback'
  | 'providers:manage'
  | 'audit:read'
  | 'organization:manage';

export type TimeFormat = '12h' | '24h';

export interface UserPreferences {
  timezone: string | null;
  time_format: TimeFormat;
}

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  preferences: UserPreferences;
}

export interface OrganizationRef {
  id: string;
  name: string;
}

export interface SessionFeatures {
  organization_settings: boolean;
  notification_preferences: boolean;
}

export interface Session {
  user: User;
  organization: OrganizationRef;
  permissions: Permission[];
  features: SessionFeatures;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/* ---------- Providers ---------- */

export type ProviderKind = 'aws_app_runner' | 'gcp_cloud_run';

export type ConnectionStatus =
  | 'pending_validation'
  | 'validating'
  | 'connected'
  | 'invalid_credentials'
  | 'insufficient_permissions'
  | 'provider_unavailable'
  | 'timed_out'
  | 'disconnected'
  | 'error'
  | 'unknown';

export type ValidationStage = 'connecting' | 'validating_permissions' | 'checking_readiness';

export type CheckStatus = 'pending' | 'passed' | 'failed' | 'skipped' | 'unknown';

export interface ValidationCheck {
  name: string;
  status: CheckStatus;
  detail: string | null;
}

export interface ConnectionValidation {
  stage: ValidationStage | null;
  started_at: IsoDateTime | null;
  finished_at: IsoDateTime | null;
  checks: ValidationCheck[];
  error_code: string | null;
}

export interface ConnectionSetup {
  /** AWS: the external ID the IAM role's trust policy must require. */
  external_id: string | null;
  /** The CloudBridge principal the role or workload identity pool must trust. */
  trusted_principal: string | null;
}

export interface ConnectionConfig {
  account_id: string | null;
  role_arn: string | null;
  project_id: string | null;
  workload_identity_provider: string | null;
  service_account_email: string | null;
}

export interface ProviderConnection {
  id: string;
  name: string;
  provider: ProviderKind;
  status: ConnectionStatus;
  default_region: string;
  config: ConnectionConfig;
  setup: ConnectionSetup | null;
  validation: ConnectionValidation | null;
  created_at: IsoDateTime;
  last_validated_at: IsoDateTime | null;
}

export interface CreateConnectionRequest {
  name: string;
  provider: ProviderKind;
  default_region: string;
  aws?: { account_id: string; role_arn: string };
  gcp?: { project_id: string; workload_identity_provider: string; service_account_email: string };
}

/* ---------- Applications ---------- */

export type ApplicationStatus =
  | 'draft'
  | 'deploying'
  | 'running'
  | 'failed'
  | 'stopped'
  | 'deleting'
  | 'unknown';

export type SourceType = 'image' | 'repository';

export interface ApplicationSource {
  type: SourceType;
  image: string | null;
  repository_url: string | null;
  branch: string | null;
  dockerfile_path: string | null;
}

export interface DeploymentRef {
  id: string;
  status: DeploymentStatus;
  created_at: IsoDateTime;
}

export interface ApplicationSummary {
  id: string;
  name: string;
  description: string | null;
  provider: ProviderKind;
  connection_id: string;
  region: string;
  status: ApplicationStatus;
  latest_deployment: DeploymentRef | null;
  updated_at: IsoDateTime;
}

export interface Application extends ApplicationSummary {
  source: ApplicationSource;
  service_url: string | null;
  created_at: IsoDateTime;
  created_by: string | null;
}

export interface ListApplicationsParams {
  page: number;
  page_size: number;
  search?: string;
  status?: ApplicationStatus;
}

export interface CreateApplicationRequest {
  name: string;
  description: string | null;
  connection_id: string;
  region: string;
  source: ApplicationSource;
  port: number;
  cpu: string;
  memory: string;
  min_instances: number;
  max_instances: number;
}

export interface EnvironmentVariable {
  name: string;
  value: string;
}

export interface SecretSummary {
  name: string;
  updated_at: IsoDateTime;
}

export interface ApplicationConfiguration {
  application_id: string;
  version: number;
  port: number;
  cpu: string;
  memory: string;
  min_instances: number;
  max_instances: number;
  health_check_path: string | null;
  environment: EnvironmentVariable[];
  /** Secret names only. The API never returns secret values. */
  secrets: SecretSummary[];
  updated_at: IsoDateTime;
}

export interface UpdateConfigurationRequest {
  version: number;
  port: number;
  cpu: string;
  memory: string;
  min_instances: number;
  max_instances: number;
  health_check_path: string | null;
  environment: EnvironmentVariable[];
}

/** Returned with 202 when the backend accepts a long-running operation. */
export interface OperationAccepted {
  operation_id: string;
  status: 'accepted';
}

/* ---------- Deployments ---------- */

export type DeploymentStatus =
  | 'queued'
  | 'in_progress'
  | 'succeeded'
  | 'failed'
  | 'cancelling'
  | 'cancelled'
  | 'unknown';

export type DeploymentKind = 'deploy' | 'rollback';

export type StageName =
  | 'queued'
  | 'validation'
  | 'build'
  | 'publishing'
  | 'provisioning'
  | 'verification';

export type StageStatus = 'pending' | 'active' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';

export interface DeploymentStage {
  name: StageName;
  status: StageStatus;
  started_at: IsoDateTime | null;
  finished_at: IsoDateTime | null;
}

export interface DeploymentFailure {
  code: string;
  message: string;
}

export interface DeploymentSummary {
  id: string;
  application_id: string;
  application_name: string;
  provider: ProviderKind;
  status: DeploymentStatus;
  kind: DeploymentKind;
  source_ref: string | null;
  initiated_by: string | null;
  created_at: IsoDateTime;
  finished_at: IsoDateTime | null;
}

export interface Deployment extends DeploymentSummary {
  rollback_of: string | null;
  started_at: IsoDateTime | null;
  stages: DeploymentStage[];
  failure: DeploymentFailure | null;
  service_url: string | null;
  /** Only present when the provider reports real progress. Never estimated. */
  progress_percent: number | null;
}

export type EventLevel = 'info' | 'warning' | 'error';

export interface DeploymentEvent {
  id: string;
  timestamp: IsoDateTime;
  level: EventLevel;
  stage: StageName | null;
  message: string;
}

export interface ListDeploymentsParams {
  page: number;
  page_size: number;
  application_id?: string;
  status?: DeploymentStatus;
}

/* ---------- Audit ---------- */

export type AuditOutcome = 'success' | 'failure' | 'denied' | 'unknown';

export interface AuditActor {
  id: string;
  display_name: string;
  email: string | null;
}

export interface AuditEvent {
  id: string;
  occurred_at: IsoDateTime;
  actor: AuditActor | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  outcome: AuditOutcome;
  request_id: string | null;
}

export interface ListAuditEventsParams {
  page: number;
  page_size: number;
  search?: string;
  outcome?: AuditOutcome;
  resource_type?: string;
  from?: string;
  to?: string;
}

/* ---------- Settings ---------- */

export interface UpdateProfileRequest {
  display_name: string;
  preferences: UserPreferences;
}

export interface Organization {
  id: string;
  name: string;
  created_at: IsoDateTime;
}

export interface OrganizationMember {
  id: string;
  display_name: string;
  email: string;
  role: UserRole;
  joined_at: IsoDateTime;
}

export type NotificationEvent =
  | 'deployment_succeeded'
  | 'deployment_failed'
  | 'rollback_completed'
  | 'provider_connection_failed'
  | 'application_deleted';

export interface NotificationPreferences {
  email_enabled: boolean;
  events: Record<NotificationEvent, boolean>;
}
