import type {
  Application,
  ApplicationConfiguration,
  ApplicationSummary,
  AuditEvent,
  CreateApplicationRequest,
  CreateConnectionRequest,
  Deployment,
  DeploymentEvent,
  DeploymentSummary,
  ListApplicationsParams,
  ListAuditEventsParams,
  ListDeploymentsParams,
  LoginRequest,
  NotificationPreferences,
  Organization,
  OrganizationMember,
  Paginated,
  ProviderConnection,
  SecretSummary,
  Session,
  UpdateConfigurationRequest,
  UpdateProfileRequest,
  User,
} from '../../types/api';

export type DeleteOutcome = 'deleted' | 'accepted';

/** Options for state-changing calls that the backend can de-duplicate. */
export interface WriteOptions {
  idempotencyKey: string;
}

export interface AuthApi {
  getSession(signal?: AbortSignal): Promise<Session>;
  login(input: LoginRequest): Promise<Session>;
  logout(): Promise<void>;
}

export interface ApplicationsApi {
  list(params: ListApplicationsParams, signal?: AbortSignal): Promise<Paginated<ApplicationSummary>>;
  get(id: string, signal?: AbortSignal): Promise<Application>;
  create(input: CreateApplicationRequest, options: WriteOptions): Promise<Application>;
  /** 'deleted' (204) when removal finished, 'accepted' (202) when it continues in the background. */
  remove(id: string): Promise<DeleteOutcome>;
  getConfiguration(id: string, signal?: AbortSignal): Promise<ApplicationConfiguration>;
  updateConfiguration(id: string, input: UpdateConfigurationRequest): Promise<ApplicationConfiguration>;
  /** Write-only. The value is sent once and never returned. */
  setSecret(id: string, name: string, value: string): Promise<SecretSummary>;
  deleteSecret(id: string, name: string): Promise<void>;
}

export interface DeploymentsApi {
  list(params: ListDeploymentsParams, signal?: AbortSignal): Promise<Paginated<DeploymentSummary>>;
  get(id: string, signal?: AbortSignal): Promise<Deployment>;
  listEvents(id: string, signal?: AbortSignal): Promise<DeploymentEvent[]>;
  /** Accepted (202): the deployment is queued, not finished. */
  create(applicationId: string, options: WriteOptions): Promise<Deployment>;
  cancel(id: string): Promise<Deployment>;
  /** Accepted (202): returns the new rollback deployment. */
  rollback(id: string, options: WriteOptions): Promise<Deployment>;
}

export interface ProvidersApi {
  list(signal?: AbortSignal): Promise<ProviderConnection[]>;
  get(id: string, signal?: AbortSignal): Promise<ProviderConnection>;
  create(input: CreateConnectionRequest, options: WriteOptions): Promise<ProviderConnection>;
  /** Accepted (202): validation runs on the backend; poll get() for progress. */
  validate(id: string): Promise<ProviderConnection>;
  remove(id: string): Promise<DeleteOutcome>;
}

export interface AuditApi {
  list(params: ListAuditEventsParams, signal?: AbortSignal): Promise<Paginated<AuditEvent>>;
}

export interface SettingsApi {
  updateProfile(input: UpdateProfileRequest): Promise<User>;
  getOrganization(signal?: AbortSignal): Promise<Organization>;
  updateOrganization(input: { name: string }): Promise<Organization>;
  listMembers(signal?: AbortSignal): Promise<OrganizationMember[]>;
  getNotificationPreferences(signal?: AbortSignal): Promise<NotificationPreferences>;
  updateNotificationPreferences(input: NotificationPreferences): Promise<NotificationPreferences>;
}

/** Everything the UI can ask of the backend. Implemented over HTTP and, for development only, by the demo service. */
export interface CloudBridgeApi {
  readonly mode: 'live' | 'demo';
  auth: AuthApi;
  applications: ApplicationsApi;
  deployments: DeploymentsApi;
  providers: ProvidersApi;
  audit: AuditApi;
  settings: SettingsApi;
  /** Subscribes to global session-expiry and maintenance signals. */
  on(event: 'session-expired' | 'maintenance', listener: () => void): () => void;
}
