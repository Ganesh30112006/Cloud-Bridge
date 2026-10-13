import { CheckCircle2, Circle, MinusCircle, SearchX, ShieldCheck, Unplug, XCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog';
import { Alert } from '../../components/feedback/Alert';
import { CardSkeleton } from '../../components/feedback/CardSkeleton';
import { ErrorState } from '../../components/feedback/ErrorState';
import { OperationStatus } from '../../components/feedback/OperationStatus';
import { Button, ButtonLink } from '../../components/forms/Button';
import { CopyButton } from '../../components/forms/CopyButton';
import { PageHeader } from '../../components/layout/PageHeader';
import { Panel } from '../../components/layout/Panel';
import { ConnectionProgress } from '../../components/status/ConnectionProgress';
import { InlineStatus } from '../../components/status/InlineStatus';
import { DateTime } from '../../components/status/RelativeTime';
import { StatusBadge } from '../../components/status/StatusBadge';
import { checkStatus as checkStatusInfo, connectionStatus } from '../../components/status/statusMaps';
import { useAnnouncer } from '../../hooks/useAnnouncer';
import { useApi, useDemoMode } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useMutation } from '../../hooks/useMutation';
import { useResource } from '../../hooks/useResource';
import { useToast } from '../../hooks/useToast';
import { describeError, type ApiError } from '../../services/api/errors';
import type { ConnectionStatus, ProviderConnection, ValidationCheck, ValidationStage } from '../../types/api';
import { messages, simulated } from '../../utils/messages';
import { providerLabel } from '../../utils/providers';
import { redact } from '../../utils/redact';
import { AccessDeniedPage } from '../errors/AccessDeniedPage';
import { ErrorPageLayout } from '../errors/ErrorPageLayout';
import './providers.css';

const FAILED_STATUSES: readonly ConnectionStatus[] = [
  'invalid_credentials',
  'insufficient_permissions',
  'provider_unavailable',
  'timed_out',
  'error',
];

const CHECK_ICON = { passed: CheckCircle2, failed: XCircle, pending: Circle, skipped: MinusCircle, unknown: Circle };

function CheckList({ checks }: { checks: ValidationCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <ul className="check-list" aria-label="Validation checks">
      {checks.map((c) => {
        const Icon = CHECK_ICON[c.status];
        return (
          <li key={c.name} className={`check-list__item check-list__item--${c.status}`}>
            <Icon size={16} aria-hidden="true" />
            <span>
              {c.name} <span className="text-muted text-small">· {checkStatusInfo[c.status].label}</span>
              {c.detail && <span className="data-table__secondary">{redact(c.detail)}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ValueRow({ value, label }: { value: string; label: string }) {
  return (
    <span className="value-row">
      <code>{value}</code>
      <CopyButton value={value} label={label} />
    </span>
  );
}

function SetupInstructions({ connection }: { connection: ProviderConnection }) {
  const principal = connection.setup?.trusted_principal;
  const externalId = connection.setup?.external_id;
  if (connection.provider === 'aws_app_runner') {
    const policy = JSON.stringify(
      {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: principal ?? '<provided by CloudBridge>' },
            Action: 'sts:AssumeRole',
            Condition: { StringEquals: { 'sts:ExternalId': externalId ?? '<provided by CloudBridge>' } },
          },
        ],
      },
      null,
      2,
    );
    return (
      <ol className="setup-steps">
        <li>
          In AWS account <code>{connection.config.account_id ?? '—'}</code>, open the IAM role{' '}
          <code>{connection.config.role_arn ?? '—'}</code>.
        </li>
        <li>
          Set its trust policy so only CloudBridge can assume it, and only with this connection's external ID:
          {externalId && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              External ID: <ValueRow value={externalId} label="external ID" />
            </div>
          )}
          <pre className="code-block">{policy}</pre>
          <CopyButton value={policy} label="trust policy" showLabel />
        </li>
        <li>
          Attach permissions for App Runner (create, update and describe services), read access to the ECR repositories
          you deploy from, and <code>iam:PassRole</code> for the App Runner access role. Scope them to the resources CloudBridge manages.
        </li>
        <li>Select “Validate connection” at the top of this page.</li>
      </ol>
    );
  }
  return (
    <ol className="setup-steps">
      <li>
        In project <code>{connection.config.project_id ?? '—'}</code>, configure workload identity provider{' '}
        <code>{connection.config.workload_identity_provider ?? '—'}</code> to trust CloudBridge
        {principal && (
          <>
            : <ValueRow value={principal} label="CloudBridge principal" />
          </>
        )}
        .
      </li>
      <li>
        Allow that identity to impersonate <code>{connection.config.service_account_email ?? '—'}</code> (role{' '}
        <code>roles/iam.workloadIdentityUser</code>).
      </li>
      <li>
        Grant the service account <code>roles/run.admin</code>, <code>roles/iam.serviceAccountUser</code> and{' '}
        <code>roles/artifactregistry.reader</code>.
      </li>
      <li>Select “Validate connection” at the top of this page.</li>
    </ol>
  );
}

function statusExplanation(c: ProviderConnection): { tone: 'info' | 'success' | 'warning' | 'danger'; title: string; body: ReactNode } | null {
  const target = c.provider === 'aws_app_runner' ? 'the IAM role' : 'the service account';
  switch (c.status) {
    case 'pending_validation':
      return { tone: 'info', title: 'Not validated yet', body: 'Complete the setup steps, then validate. Applications cannot use this connection until it is verified.' };
    case 'connected':
      return { tone: 'success', title: 'Connection verified', body: c.last_validated_at ? <>CloudBridge last verified access on <DateTime value={c.last_validated_at} />.</> : 'CloudBridge verified access.' };
    case 'invalid_credentials':
      return {
        tone: 'danger',
        title: 'Invalid credentials',
        body: `CloudBridge could not authenticate as ${target}. Check that the identifier is correct and that the trust configuration matches the setup steps exactly.`,
      };
    case 'insufficient_permissions':
      return {
        tone: 'danger',
        title: 'Required permissions are missing',
        body: `CloudBridge authenticated, but ${target} lacks permissions it needs. Grant the permissions marked as failed below, then validate again.`,
      };
    case 'provider_unavailable':
      return { tone: 'warning', title: 'The provider could not be reached', body: `${providerLabel(c.provider)} did not respond. This is usually temporary; validate again in a few minutes.` };
    case 'timed_out':
      return {
        tone: 'warning',
        title: 'Validation timed out',
        body: 'The last validation did not finish in time, so its result is unknown. Check the status before validating again.',
      };
    case 'disconnected':
      return { tone: 'warning', title: 'Disconnected', body: 'CloudBridge no longer has access through this connection. Validate it again to restore access.' };
    case 'error':
      return { tone: 'danger', title: 'Validation failed', body: 'CloudBridge could not complete validation. Try again; contact support if it keeps failing.' };
    case 'unknown':
      return { tone: 'warning', title: 'Status unknown', body: 'CloudBridge reported a status this page does not recognise. Refresh to check again.' };
    case 'validating':
      return null;
  }
}

/** The step at which a failed validation stopped, inferred from what failed. */
function failedStageOf(c: ProviderConnection): ValidationStage | null {
  if (c.status === 'invalid_credentials' || c.status === 'provider_unavailable') return 'connecting';
  if (c.status === 'insufficient_permissions') return 'validating_permissions';
  return null;
}

export function ProviderConnectionPage() {
  const { connectionId = '' } = useParams();
  const api = useApi();
  const demo = useDemoMode();
  const { can } = useAuth();
  const { notify } = useToast();
  const { announce } = useAnnouncer();
  const navigate = useNavigate();
  const canManage = can('providers:manage');

  const conn = useResource(`provider:${connectionId}`, (signal) => api.providers.get(connectionId, signal), {
    pollWhile: (c) => c.status === 'validating',
    pollIntervalMs: 2000,
    maxPollDurationMs: 5 * 60_000,
  });

  const validate = useMutation(() => api.providers.validate(connectionId));
  const remove = useMutation(() => api.providers.remove(connectionId));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [uncertain, setUncertain] = useState<ApiError | null>(null);

  // Report the result of a validation this page watched, not statuses seen on first load.
  const previous = useRef<{ id: string; status: ConnectionStatus } | null>(null);
  useEffect(() => {
    const c = conn.data;
    if (!c) return;
    const before = previous.current?.id === c.id ? previous.current.status : null;
    previous.current = { id: c.id, status: c.status };
    if (before !== 'validating' || c.status === 'validating') return;
    if (c.status === 'connected') {
      const msg = messages.providerConnected(c.name);
      notify(simulated(msg, demo));
      announce(msg.title);
    } else if (FAILED_STATUSES.includes(c.status)) {
      announce(`${messages.providerValidationFailed(c.name).title}: ${connectionStatus[c.status].label}`);
    }
  }, [conn.data, notify, announce, demo]);

  if (conn.status === 'loading') {
    return (
      <div className="page">
        <PageHeader title="Provider connection" breadcrumbs={[{ label: 'Cloud providers', to: '/providers' }, { label: 'Loading…' }]} />
        <Panel>
          <CardSkeleton lines={5} label="Loading connection" />
        </Panel>
      </div>
    );
  }
  if (conn.status === 'error') {
    if (conn.error?.status === 404) {
      return (
        <ErrorPageLayout
          icon={SearchX}
          code="Error 404"
          title="Connection not found"
          message="This provider connection does not exist or was removed."
          actions={<ButtonLink variant="primary" to="/providers">Back to cloud providers</ButtonLink>}
        />
      );
    }
    if (conn.error?.status === 403) return <AccessDeniedPage resource="this provider connection" requestId={conn.error.requestId} />;
    return (
      <div className="page">
        <PageHeader title="Provider connection" breadcrumbs={[{ label: 'Cloud providers', to: '/providers' }, { label: 'Error' }]} />
        <Panel>
          <ErrorState error={conn.error} onRetry={conn.reload} />
        </Panel>
      </div>
    );
  }

  const c = conn.data!;
  const validating = c.status === 'validating';
  const explanation = statusExplanation(c);
  const showSetup = c.status !== 'connected';

  const startValidation = async () => {
    setUncertain(null);
    const result = await validate.run();
    if (result.ok) {
      conn.setData(() => result.data);
      conn.resumePolling();
      announce('Validation started');
    } else if (result.error && (result.error.kind === 'timeout' || result.error.kind === 'network' || (result.error.status ?? 0) >= 500)) {
      setUncertain(result.error);
    }
  };

  /** Re-reads the connection rather than repeating a request whose outcome is unknown. */
  const recheck = () => {
    setUncertain(null);
    validate.reset();
    conn.reload();
  };

  const confirmDisconnect = async () => {
    const result = await remove.run();
    if (result.ok) {
      setConfirmRemove(false);
      notify(
        simulated(
          result.data === 'accepted' ? messages.providerDisconnectAccepted(c.name) : messages.providerDisconnected(c.name),
          demo,
        ),
      );
      navigate('/providers', { replace: true });
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={c.name}
        meta={<StatusBadge status={connectionStatus[c.status]} />}
        description={`${providerLabel(c.provider)} · default region ${c.default_region}`}
        breadcrumbs={[
          { label: 'Overview', to: '/' },
          { label: 'Cloud providers', to: '/providers' },
          { label: c.name },
        ]}
        actions={
          canManage ? (
            <>
              <Button
                variant={c.status === 'connected' ? 'secondary' : 'primary'}
                icon={<ShieldCheck size={16} aria-hidden="true" />}
                onClick={startValidation}
                loading={validate.isPending}
                loadingLabel="Connecting…"
                disabled={validating}
              >
                {c.status === 'connected' ? 'Validate again' : 'Validate connection'}
              </Button>
              <Button variant="danger" icon={<Unplug size={16} aria-hidden="true" />} onClick={() => { remove.reset(); setConfirmRemove(true); }} disabled={validating}>
                Disconnect
              </Button>
            </>
          ) : undefined
        }
      />

      {uncertain && (
        <Alert
          tone="warning"
          title="The validation request did not complete"
          role="alert"
          requestId={uncertain.requestId}
          actions={<Button size="sm" onClick={recheck}>Check status</Button>}
        >
          {describeError(uncertain).message} Validation may have started anyway.
        </Alert>
      )}
      {validate.error && !uncertain && (
        <Alert tone="danger" title={describeError(validate.error).title} role="alert" requestId={validate.error.requestId}>
          {describeError(validate.error).message}
        </Alert>
      )}
      {conn.refreshError && (
        <Alert tone="warning" title="Status updates are failing" requestId={conn.refreshError.requestId} role="status">
          The status shown may be out of date.
        </Alert>
      )}

      <Panel title="Status" actions={<InlineStatus resource={conn} refreshLabel="Check status" />}>
        <div className="stack">
          {(validating || FAILED_STATUSES.includes(c.status) || c.status === 'connected') && (
            <ConnectionProgress status={c.status} stage={validating ? (c.validation?.stage ?? null) : null} failedStage={failedStageOf(c)} />
          )}
          {validating && conn.polling !== 'stopped' && (
            <OperationStatus phase="in_progress" title="Validating connection">
              CloudBridge is checking access to {providerLabel(c.provider)}. This usually takes under a minute.
              {demo && ' Simulated in demo mode.'}
            </OperationStatus>
          )}
          {validating && conn.polling === 'stopped' && (
            <OperationStatus phase="stale" title="Validation is taking longer than expected" actions={<Button size="sm" onClick={recheck}>Check status</Button>}>
              Automatic updates stopped. The result is not known yet.
            </OperationStatus>
          )}
          {explanation && (
            <Alert tone={explanation.tone} title={explanation.title} role={explanation.tone === 'danger' ? 'alert' : 'status'}>
              {explanation.body}
              {c.validation?.error_code && c.status !== 'connected' && (
                <span className="data-table__secondary">
                  Error code: <code>{c.validation.error_code}</code>
                </span>
              )}
            </Alert>
          )}
          {c.status === 'timed_out' && (
            <div>
              <Button onClick={recheck}>Check status</Button>
            </div>
          )}
          <CheckList checks={c.validation?.checks ?? []} />
        </div>
      </Panel>

      <div className="page-grid page-grid--even">
        <Panel title="Details">
          <dl className="description-list">
            <dt>Provider</dt>
            <dd>{providerLabel(c.provider)}</dd>
            {c.provider === 'aws_app_runner' ? (
              <>
                <dt>Account ID</dt>
                <dd className="mono">{c.config.account_id ?? '—'}</dd>
                <dt>Role ARN</dt>
                <dd className="mono">{c.config.role_arn ?? '—'}</dd>
              </>
            ) : (
              <>
                <dt>Project ID</dt>
                <dd className="mono">{c.config.project_id ?? '—'}</dd>
                <dt>Service account</dt>
                <dd className="mono">{c.config.service_account_email ?? '—'}</dd>
                <dt>Identity provider</dt>
                <dd className="mono">{c.config.workload_identity_provider ?? '—'}</dd>
              </>
            )}
            <dt>Default region</dt>
            <dd>{c.default_region}</dd>
            <dt>Created</dt>
            <dd>
              <DateTime value={c.created_at} />
            </dd>
            <dt>Last verified</dt>
            <dd>{c.last_validated_at ? <DateTime value={c.last_validated_at} /> : 'Never'}</dd>
          </dl>
        </Panel>
        {showSetup && (
          <Panel title="Setup steps">
            <SetupInstructions connection={c} />
          </Panel>
        )}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title={`Disconnect ${c.name}?`}
        description={
          <p>
            CloudBridge stops using this connection and forgets its configuration. Services already running in{' '}
            {providerLabel(c.provider)} are not deleted, but CloudBridge can no longer deploy or manage them. Remove the IAM role or
            identity binding in your cloud account separately.
          </p>
        }
        affected={
          <span>
            <strong>{c.name}</strong> · {providerLabel(c.provider)} · <span className="mono">{c.config.account_id ?? c.config.project_id}</span>
          </span>
        }
        confirmText={c.name}
        confirmLabel="Disconnect"
        pendingLabel="Disconnecting…"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={confirmDisconnect}
        onCancel={() => setConfirmRemove(false)}
        onCheckStatus={() => {
          setConfirmRemove(false);
          recheck();
        }}
      />
    </div>
  );
}
