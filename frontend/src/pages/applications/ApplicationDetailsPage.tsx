import { Rocket, Settings2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog';
import { Alert } from '../../components/feedback/Alert';
import { CardSkeleton } from '../../components/feedback/CardSkeleton';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { TableSkeleton } from '../../components/feedback/TableSkeleton';
import { Button, ButtonLink } from '../../components/forms/Button';
import { PageHeader } from '../../components/layout/PageHeader';
import { Panel } from '../../components/layout/Panel';
import { ExternalLink } from '../../components/navigation/ExternalLink';
import { InlineStatus } from '../../components/status/InlineStatus';
import { DateTime, RelativeTime } from '../../components/status/RelativeTime';
import { StatusBadge } from '../../components/status/StatusBadge';
import { applicationStatus, deploymentStatus, isDeploymentActive } from '../../components/status/statusMaps';
import { DataTable } from '../../components/tables/DataTable';
import { useApi, useDemoMode } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useMutation } from '../../hooks/useMutation';
import { useResource } from '../../hooks/useResource';
import { useToast } from '../../hooks/useToast';
import { describeError, type ApiError } from '../../services/api/errors';
import type { Application, DeploymentSummary } from '../../types/api';
import { formatDuration } from '../../utils/format';
import { randomId, shortId } from '../../utils/id';
import { messages, simulated } from '../../utils/messages';
import { providerLabel } from '../../utils/providers';
import { AccessDeniedPage } from '../errors/AccessDeniedPage';
import { ApplicationNotFound } from './ApplicationsPage';
import { ApplicationSubNav } from './ApplicationSubNav';

function sourceText(app: Application): string {
  if (app.source.type === 'image') return app.source.image ?? '—';
  return `${app.source.repository_url ?? '—'} @ ${app.source.branch ?? 'default branch'}`;
}

export function ApplicationDetailsPage() {
  const { applicationId = '' } = useParams();
  const api = useApi();
  const demo = useDemoMode();
  const { can } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();

  const app = useResource(`application:${applicationId}`, (signal) => api.applications.get(applicationId, signal), {
    pollWhile: (a) => a.status === 'deploying' || a.status === 'deleting',
    pollIntervalMs: 4000,
    maxPollDurationMs: 20 * 60_000,
  });
  const deployments = useResource(
    `application:${applicationId}:deployments`,
    (signal) => api.deployments.list({ page: 1, page_size: 5, application_id: applicationId }, signal),
    { pollWhile: (d) => d.items.some((x) => isDeploymentActive(x.status)), pollIntervalMs: 4000, maxPollDurationMs: 20 * 60_000 },
  );

  const [dialog, setDialog] = useState<'deploy' | 'delete' | null>(null);
  const deployKey = useRef('');
  const deploy = useMutation(() => api.deployments.create(applicationId, { idempotencyKey: deployKey.current }));
  const remove = useMutation(() => api.applications.remove(applicationId));
  const [uncertain, setUncertain] = useState<{ action: 'deploy' | 'delete'; error: ApiError } | null>(null);
  const [verifyingDelete, setVerifyingDelete] = useState(false);

  if (app.status === 'loading') {
    return (
      <div className="page">
        <PageHeader title="Application" breadcrumbs={[{ label: 'Applications', to: '/applications' }, { label: 'Loading…' }]} />
        <Panel>
          <CardSkeleton lines={5} label="Loading application" />
        </Panel>
      </div>
    );
  }
  if (app.status === 'error' || (verifyingDelete && app.refreshError?.status === 404)) {
    const error = app.error ?? app.refreshError;
    if (verifyingDelete && error?.status === 404) {
      return (
        <div className="page">
          <PageHeader title="Application deleted" breadcrumbs={[{ label: 'Applications', to: '/applications' }, { label: 'Deleted' }]} />
          <Alert tone="success" title="The application was deleted" role="status" actions={<ButtonLink size="sm" to="/applications">Back to applications</ButtonLink>}>
            CloudBridge confirmed that this application no longer exists.
          </Alert>
        </div>
      );
    }
  }
  if (app.status === 'error') {
    if (app.error?.status === 404) return <ApplicationNotFound />;
    if (app.error?.status === 403) return <AccessDeniedPage resource="this application" requestId={app.error.requestId} />;
    return (
      <div className="page">
        <PageHeader title="Application" breadcrumbs={[{ label: 'Applications', to: '/applications' }, { label: 'Error' }]} />
        <Panel>
          <ErrorState error={app.error} onRetry={app.reload} />
        </Panel>
      </div>
    );
  }

  const application = app.data!;
  const activeDeployment = application.latest_deployment && isDeploymentActive(application.latest_deployment.status);
  const deleting = application.status === 'deleting';

  const openDeploy = () => {
    deploy.reset();
    deployKey.current = randomId();
    setDialog('deploy');
  };

  const confirmDeploy = async () => {
    const result = await deploy.run();
    if (result.ok) {
      setDialog(null);
      notify(simulated(messages.deploymentQueued(application.name), demo));
      navigate(`/deployments/${encodeURIComponent(result.data.id)}`);
    } else if (result.error && (result.error.kind === 'timeout' || result.error.kind === 'network' || (result.error.status ?? 0) >= 500)) {
      setDialog(null);
      setUncertain({ action: 'deploy', error: result.error });
      deployments.reload();
    }
  };

  const confirmDelete = async () => {
    const result = await remove.run();
    if (result.ok) {
      setDialog(null);
      notify(
        simulated(
          result.data === 'accepted'
            ? messages.applicationDeletionAccepted(application.name)
            : messages.applicationDeleted(application.name),
          demo,
        ),
      );
      navigate('/applications', { replace: true });
    } else if (result.error && (result.error.kind === 'timeout' || result.error.kind === 'network' || (result.error.status ?? 0) >= 500)) {
      setDialog(null);
      setUncertain({ action: 'delete', error: result.error });
    }
  };

  /** After an uncertain result, look at the real state instead of repeating the request. */
  const checkStatus = () => {
    if (uncertain?.action === 'delete') setVerifyingDelete(true);
    setUncertain(null);
    app.reload();
    deployments.reload();
  };

  return (
    <div className="page">
      <PageHeader
        title={application.name}
        meta={<StatusBadge status={applicationStatus[application.status]} />}
        description={application.description ?? undefined}
        breadcrumbs={[
          { label: 'Overview', to: '/' },
          { label: 'Applications', to: '/applications' },
          { label: application.name },
        ]}
        actions={
          <>
            {can('deployments:create') && (
              <Button
                variant="primary"
                icon={<Rocket size={16} aria-hidden="true" />}
                onClick={openDeploy}
                disabled={Boolean(activeDeployment) || deleting}
                title={activeDeployment ? 'A deployment is already in progress' : undefined}
              >
                Deploy
              </Button>
            )}
            <ButtonLink to={`/applications/${encodeURIComponent(application.id)}/configuration`} icon={<Settings2 size={16} aria-hidden="true" />}>
              Configuration
            </ButtonLink>
            {can('applications:delete') && (
              <Button variant="danger" icon={<Trash2 size={16} aria-hidden="true" />} onClick={() => { remove.reset(); setDialog('delete'); }} disabled={deleting}>
                Delete
              </Button>
            )}
          </>
        }
      />
      <ApplicationSubNav id={application.id} />

      {uncertain && (
        <Alert
          tone="warning"
          title={uncertain.action === 'deploy' ? 'Deployment status unknown' : 'Deletion status unknown'}
          role="alert"
          requestId={uncertain.error.requestId}
          actions={<Button size="sm" onClick={checkStatus}>Check current status</Button>}
        >
          {describeError(uncertain.error).message}
        </Alert>
      )}
      {app.refreshError && (
        <Alert tone="warning" title="Could not refresh this application" requestId={app.refreshError.requestId} role="status">
          The details below may be out of date.
        </Alert>
      )}
      {activeDeployment && application.latest_deployment && (
        <Alert tone="info" title="Deployment in progress" role="status">
          <Link to={`/deployments/${encodeURIComponent(application.latest_deployment.id)}`}>View the deployment</Link> to follow its progress.
        </Alert>
      )}
      {app.polling === 'stopped' && (
        <Alert tone="warning" title={messages.operationStillProcessing().title} actions={<Button size="sm" onClick={app.resumePolling}>Resume updates</Button>}>
          {messages.operationStillProcessing().message}
        </Alert>
      )}

      <div className="page-grid">
        <Panel title="Details" actions={<InlineStatus resource={app} />}>
          <dl className="description-list">
            <dt>Provider</dt>
            <dd>{providerLabel(application.provider)}</dd>
            <dt>Region</dt>
            <dd>{application.region}</dd>
            <dt>Connection</dt>
            <dd>
              <Link to={`/providers/${encodeURIComponent(application.connection_id)}`}>View connection</Link>
            </dd>
            <dt>Source</dt>
            <dd className="mono">{sourceText(application)}</dd>
            {application.source.type === 'repository' && (
              <>
                <dt>Dockerfile</dt>
                <dd className="mono">{application.source.dockerfile_path ?? 'Dockerfile'}</dd>
              </>
            )}
            <dt>Service URL</dt>
            <dd>{application.service_url ? <ExternalLink href={application.service_url} /> : <span className="text-muted">Available after the first successful deployment</span>}</dd>
            <dt>Created</dt>
            <dd>
              <DateTime value={application.created_at} />
              {application.created_by && <span className="text-muted"> by {application.created_by}</span>}
            </dd>
            <dt>Last updated</dt>
            <dd>
              <RelativeTime value={application.updated_at} />
            </dd>
            <dt>Application ID</dt>
            <dd className="mono">{application.id}</dd>
          </dl>
        </Panel>

        <Panel
          title="Recent deployments"
          flush
          actions={<Link to={`/deployments?application_id=${encodeURIComponent(application.id)}`}>View all</Link>}
        >
          {deployments.status === 'loading' && <TableSkeleton columns={3} rows={3} label="Loading deployments" />}
          {deployments.status === 'error' && <ErrorState compact error={deployments.error} onRetry={deployments.reload} />}
          {deployments.status === 'success' &&
            (deployments.data?.items.length ? (
              <DataTable<DeploymentSummary>
                caption="Recent deployments of this application"
                rows={deployments.data.items}
                rowKey={(d) => d.id}
                busy={deployments.isRefreshing}
                columns={[
                  {
                    key: 'id',
                    header: 'Deployment',
                    render: (d) => (
                      <Link to={`/deployments/${encodeURIComponent(d.id)}`} className="mono" title={d.id}>
                        {shortId(d.id)}
                      </Link>
                    ),
                  },
                  { key: 'status', header: 'Status', render: (d) => <StatusBadge status={deploymentStatus[d.status]} /> },
                  {
                    key: 'when',
                    header: 'Started',
                    render: (d) => (
                      <span>
                        <RelativeTime value={d.created_at} />
                        {d.finished_at && <span className="data-table__secondary">took {formatDuration(d.created_at, d.finished_at)}</span>}
                      </span>
                    ),
                  },
                ]}
              />
            ) : (
              <EmptyState compact icon={Rocket} title="Not deployed yet" message="Deploy this application to create its first revision on the provider." />
            ))}
        </Panel>
      </div>

      <ConfirmDialog
        open={dialog === 'deploy'}
        title={`Deploy ${application.name}?`}
        tone="primary"
        description="A new revision is built or pulled and rolled out. The current revision keeps serving traffic until the new one passes verification."
        affected={
          <dl className="description-list">
            <dt>Source</dt>
            <dd className="mono">{sourceText(application)}</dd>
            <dt>Target</dt>
            <dd>
              {providerLabel(application.provider)}, {application.region}
            </dd>
          </dl>
        }
        confirmLabel="Start deployment"
        pendingLabel="Starting…"
        pending={deploy.isPending}
        error={deploy.error && !uncertain ? deploy.error : null}
        onConfirm={confirmDeploy}
        onCancel={() => setDialog(null)}
        onCheckStatus={() => {
          setDialog(null);
          checkStatus();
        }}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        title={`Delete ${application.name}?`}
        description={
          <p>
            This deletes the application, its configuration and secrets, and removes the service from{' '}
            {providerLabel(application.provider)}. The service URL stops working. This cannot be undone.
          </p>
        }
        affected={
          <span>
            <strong>{application.name}</strong> · {providerLabel(application.provider)} · {application.region}
          </span>
        }
        confirmText={application.name}
        confirmLabel="Delete application"
        pendingLabel="Deleting…"
        pending={remove.isPending}
        error={remove.error && !uncertain ? remove.error : null}
        onConfirm={confirmDelete}
        onCancel={() => setDialog(null)}
        onCheckStatus={() => {
          setDialog(null);
          checkStatus();
        }}
      />
    </div>
  );
}
