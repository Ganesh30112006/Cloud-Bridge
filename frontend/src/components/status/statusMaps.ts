import type {
  ApplicationStatus,
  AuditOutcome,
  CheckStatus,
  ConnectionStatus,
  DeploymentStatus,
  StageName,
  StageStatus,
} from '../../types/api';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface StatusInfo {
  label: string;
  tone: StatusTone;
  /** True while work is still happening (shows a spinner instead of a static icon). */
  busy?: boolean;
}

export const applicationStatus: Record<ApplicationStatus, StatusInfo> = {
  draft: { label: 'Not deployed', tone: 'neutral' },
  deploying: { label: 'Deploying', tone: 'info', busy: true },
  running: { label: 'Running', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  stopped: { label: 'Stopped', tone: 'neutral' },
  deleting: { label: 'Deleting', tone: 'warning', busy: true },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

export const deploymentStatus: Record<DeploymentStatus, StatusInfo> = {
  queued: { label: 'Queued', tone: 'info', busy: true },
  in_progress: { label: 'In progress', tone: 'info', busy: true },
  succeeded: { label: 'Succeeded', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelling: { label: 'Cancelling', tone: 'warning', busy: true },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

export const connectionStatus: Record<ConnectionStatus, StatusInfo> = {
  pending_validation: { label: 'Not validated', tone: 'warning' },
  validating: { label: 'Validating', tone: 'info', busy: true },
  connected: { label: 'Connected', tone: 'success' },
  invalid_credentials: { label: 'Invalid credentials', tone: 'danger' },
  insufficient_permissions: { label: 'Missing permissions', tone: 'danger' },
  provider_unavailable: { label: 'Provider unreachable', tone: 'warning' },
  timed_out: { label: 'Validation timed out', tone: 'warning' },
  disconnected: { label: 'Disconnected', tone: 'neutral' },
  error: { label: 'Error', tone: 'danger' },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

export const auditOutcome: Record<AuditOutcome, StatusInfo> = {
  success: { label: 'Success', tone: 'success' },
  failure: { label: 'Failure', tone: 'danger' },
  denied: { label: 'Denied', tone: 'warning' },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

export const stageStatus: Record<StageStatus, StatusInfo> = {
  pending: { label: 'Pending', tone: 'neutral' },
  active: { label: 'In progress', tone: 'info', busy: true },
  succeeded: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

export const checkStatus: Record<CheckStatus, StatusInfo> = {
  pending: { label: 'Pending', tone: 'neutral' },
  passed: { label: 'Passed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

export const stageLabel: Record<StageName, string> = {
  queued: 'Queued',
  validation: 'Validation',
  build: 'Build',
  publishing: 'Publishing',
  provisioning: 'Provisioning',
  verification: 'Verification',
};

export const TERMINAL_DEPLOYMENT_STATUSES: readonly DeploymentStatus[] = ['succeeded', 'failed', 'cancelled'];

export function isDeploymentActive(status: DeploymentStatus): boolean {
  return status === 'queued' || status === 'in_progress' || status === 'cancelling';
}

export function isConnectionUsable(status: ConnectionStatus): boolean {
  return status === 'connected';
}
