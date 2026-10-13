import { Activity, Boxes, CheckCircle2, Circle, Cloud, Plus, Rocket } from 'lucide-react';
import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { CardSkeleton } from '../../components/feedback/CardSkeleton';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { TableSkeleton } from '../../components/feedback/TableSkeleton';
import { ButtonLink } from '../../components/forms/Button';
import { PageHeader } from '../../components/layout/PageHeader';
import { Panel } from '../../components/layout/Panel';
import { InlineStatus } from '../../components/status/InlineStatus';
import { RelativeTime } from '../../components/status/RelativeTime';
import { StatusBadge } from '../../components/status/StatusBadge';
import {
  auditOutcome,
  connectionStatus,
  deploymentStatus,
  isDeploymentActive,
} from '../../components/status/statusMaps';
import { DataTable } from '../../components/tables/DataTable';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useResource } from '../../hooks/useResource';
import type { DeploymentSummary } from '../../types/api';
import { humanize } from '../../utils/format';
import { providerLabel } from '../../utils/providers';
import './overview.css';

function GettingStarted({ hasConnection, hasApplication, hasDeployment }: { hasConnection: boolean; hasApplication: boolean; hasDeployment: boolean }) {
  const steps = [
    { done: hasConnection, label: 'Connect a cloud provider', to: '/providers/new' },
    { done: hasApplication, label: 'Create an application', to: '/applications/new' },
    { done: hasDeployment, label: 'Deploy the application', to: '/applications' },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <Panel title="Get started">
      <ol className="checklist">
        {steps.map((step) => (
          <li key={step.label} className={step.done ? 'checklist__item checklist__item--done' : 'checklist__item'}>
            {step.done ? <CheckCircle2 size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
            {step.done ? (
              <span>
                {step.label} <span className="visually-hidden">(done)</span>
              </span>
            ) : (
              <Link to={step.to}>{step.label}</Link>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function OverviewPage() {
  const api = useApi();
  const { can, session } = useAuth();
  const canReadAudit = can('audit:read');

  const apps = useResource('overview:apps', (signal) => api.applications.list({ page: 1, page_size: 1 }, signal));
  const running = useResource('overview:running', (signal) =>
    api.applications.list({ page: 1, page_size: 1, status: 'running' }, signal),
  );
  const deployments = useResource(
    'overview:deployments',
    (signal) => api.deployments.list({ page: 1, page_size: 5 }, signal),
    { pollWhile: (d) => d.items.some((x) => isDeploymentActive(x.status)), pollIntervalMs: 5000, maxPollDurationMs: 10 * 60_000 },
  );
  const connections = useResource('overview:connections', (signal) => api.providers.list(signal));
  const activity = useResource('overview:activity', (signal) => api.audit.list({ page: 1, page_size: 5 }, signal), {
    enabled: canReadAudit,
  });

  const reloadAll = useCallback(() => {
    apps.reload();
    running.reload();
    deployments.reload();
    connections.reload();
    if (canReadAudit) activity.reload();
  }, [apps, running, deployments, connections, activity, canReadAudit]);

  const anyFailed = [apps, running, deployments, connections, ...(canReadAudit ? [activity] : [])].some(
    (r) => r.status === 'error',
  );
  const connected = connections.data?.filter((c) => c.status === 'connected').length ?? 0;
  const needsAttention =
    connections.data?.filter((c) => ['invalid_credentials', 'insufficient_permissions', 'error', 'timed_out', 'provider_unavailable'].includes(c.status)).length ?? 0;

  const summaryValue = (value: number | undefined, status: string) =>
    status === 'loading' ? <span className="skeleton summary__skeleton" aria-label="Loading" /> : status === 'error' ? <span className="text-muted">Unavailable</span> : value?.toLocaleString();

  return (
    <div className="page">
      <PageHeader
        title="Overview"
        description={`Applications, deployments and provider connections for ${session?.organization.name ?? 'your organization'}.`}
        actions={
          can('applications:create') ? (
            <ButtonLink variant="primary" to="/applications/new" icon={<Plus size={16} aria-hidden="true" />}>
              Create application
            </ButtonLink>
          ) : undefined
        }
      />

      {anyFailed && (
        <p className="inline-status inline-status--warning" role="status">
          Some sections could not be loaded. The rest of the page is up to date.{' '}
          <button type="button" className="link-button" onClick={reloadAll}>
            Retry all
          </button>
        </p>
      )}

      <section className="summary panel" aria-label="Summary">
        <dl className="summary__list">
          <div className="summary__item">
            <dt>
              <Boxes size={14} aria-hidden="true" /> Applications
            </dt>
            <dd>{summaryValue(apps.data?.total, apps.status)}</dd>
          </div>
          <div className="summary__item">
            <dt>
              <CheckCircle2 size={14} aria-hidden="true" /> Running
            </dt>
            <dd>{summaryValue(running.data?.total, running.status)}</dd>
          </div>
          <div className="summary__item">
            <dt>
              <Cloud size={14} aria-hidden="true" /> Connected providers
            </dt>
            <dd>
              {connections.status === 'success' ? (
                <>
                  {connected} of {connections.data?.length ?? 0}
                  {needsAttention > 0 && <span className="summary__note"> · {needsAttention} {needsAttention === 1 ? 'needs' : 'need'} attention</span>}
                </>
              ) : (
                summaryValue(undefined, connections.status)
              )}
            </dd>
          </div>
        </dl>
      </section>

      {apps.status === 'success' && connections.status === 'success' && deployments.status === 'success' && (
        <GettingStarted
          hasConnection={connected > 0}
          hasApplication={(apps.data?.total ?? 0) > 0}
          hasDeployment={(deployments.data?.total ?? 0) > 0}
        />
      )}

      <div className="page-grid">
        <Panel
          title="Recent deployments"
          flush
          actions={
            <>
              {deployments.status === 'success' && <InlineStatus resource={deployments} />}
              <Link to="/deployments">View all</Link>
            </>
          }
        >
          {deployments.status === 'loading' && <TableSkeleton columns={4} rows={5} label="Loading deployments" />}
          {deployments.status === 'error' && <ErrorState compact error={deployments.error} onRetry={deployments.reload} />}
          {deployments.status === 'success' &&
            (deployments.data?.items.length ? (
              <DataTable<DeploymentSummary>
                caption="Recent deployments"
                rows={deployments.data.items}
                rowKey={(d) => d.id}
                busy={deployments.isRefreshing}
                columns={[
                  {
                    key: 'app',
                    header: 'Application',
                    render: (d) => (
                      <Link to={`/deployments/${encodeURIComponent(d.id)}`} className="data-table__primary">
                        {d.application_name}
                      </Link>
                    ),
                  },
                  { key: 'status', header: 'Status', render: (d) => <StatusBadge status={deploymentStatus[d.status]} /> },
                  { key: 'kind', header: 'Type', render: (d) => (d.kind === 'rollback' ? 'Rollback' : 'Deploy') },
                  { key: 'created', header: 'Started', render: (d) => <RelativeTime value={d.created_at} /> },
                ]}
              />
            ) : (
              <EmptyState compact icon={Rocket} title="No deployments yet" message="Deployments appear here once an application is deployed." />
            ))}
        </Panel>

        <Panel title="Provider connections" flush actions={<Link to="/providers">Manage</Link>}>
          {connections.status === 'loading' && <CardSkeleton lines={3} label="Loading connections" />}
          {connections.status === 'error' && <ErrorState compact error={connections.error} onRetry={connections.reload} />}
          {connections.status === 'success' &&
            (connections.data?.length ? (
              <ul className="simple-list">
                {connections.data.map((c) => (
                  <li key={c.id} className="simple-list__item">
                    <span>
                      <Link to={`/providers/${encodeURIComponent(c.id)}`}>{c.name}</Link>
                      <span className="data-table__secondary">
                        {providerLabel(c.provider)} · {c.default_region}
                      </span>
                    </span>
                    <StatusBadge status={connectionStatus[c.status]} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={Cloud}
                title="No providers connected"
                message="Connect AWS App Runner or Google Cloud Run to deploy applications."
                actions={
                  can('providers:manage') ? (
                    <ButtonLink to="/providers/new" variant="primary">
                      Connect a provider
                    </ButtonLink>
                  ) : undefined
                }
              />
            ))}
        </Panel>
      </div>

      {canReadAudit && (
        <Panel title="Recent activity" flush actions={<Link to="/activity">View activity log</Link>}>
          {activity.status === 'loading' && <TableSkeleton columns={4} rows={5} label="Loading activity" />}
          {activity.status === 'error' && <ErrorState compact error={activity.error} onRetry={activity.reload} />}
          {activity.status === 'success' &&
            (activity.data?.items.length ? (
              <ul className="simple-list">
                {activity.data.items.map((e) => (
                  <li key={e.id} className="simple-list__item">
                    <span>
                      <span className="data-table__primary">{humanize(e.action)}</span>
                      {e.resource_name && <span> · {e.resource_name}</span>}
                      <span className="data-table__secondary">
                        {e.actor?.display_name ?? 'System'} · <RelativeTime value={e.occurred_at} />
                      </span>
                    </span>
                    <StatusBadge status={auditOutcome[e.outcome]} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon={Activity} title="No activity yet" message="Actions taken in this organization appear here." />
            ))}
        </Panel>
      )}
    </div>
  );
}
