import { Rocket, SearchX, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert } from '../../components/feedback/Alert';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { TableSkeleton } from '../../components/feedback/TableSkeleton';
import { Button, ButtonLink } from '../../components/forms/Button';
import { PageHeader } from '../../components/layout/PageHeader';
import { Panel } from '../../components/layout/Panel';
import { InlineStatus } from '../../components/status/InlineStatus';
import { RelativeTime } from '../../components/status/RelativeTime';
import { StatusBadge } from '../../components/status/StatusBadge';
import { deploymentStatus, isDeploymentActive } from '../../components/status/statusMaps';
import { DataTable } from '../../components/tables/DataTable';
import { Pagination } from '../../components/tables/Pagination';
import { useApi } from '../../hooks/useApi';
import { useListParams } from '../../hooks/usePaginationParams';
import { useResource } from '../../hooks/useResource';
import { DEPLOYMENT_STATUSES } from '../../services/api/decoders';
import type { DeploymentStatus, DeploymentSummary } from '../../types/api';
import { formatDuration } from '../../utils/format';
import { shortId } from '../../utils/id';
import { providerLabel } from '../../utils/providers';
import { AccessDeniedPage } from '../errors/AccessDeniedPage';

const FILTER_KEYS = ['status', 'application_id'] as const;

export function DeploymentsPage() {
  const api = useApi();
  const { page, pageSize, filters, update } = useListParams(FILTER_KEYS);
  const status = (DEPLOYMENT_STATUSES as readonly string[]).includes(filters.status)
    ? (filters.status as DeploymentStatus)
    : undefined;
  const applicationId = filters.application_id || undefined;
  const query = { page, page_size: pageSize, status, application_id: applicationId };

  const list = useResource(`deployments:${JSON.stringify(query)}`, (signal) => api.deployments.list(query, signal), {
    pollWhile: (d) => d.items.some((x) => isDeploymentActive(x.status)),
    pollIntervalMs: 4000,
    maxPollDurationMs: 15 * 60_000,
  });
  const app = useResource(`deployments:app:${applicationId ?? ''}`, (signal) => api.applications.get(applicationId ?? '', signal), {
    enabled: Boolean(applicationId),
  });

  if (list.status === 'error' && list.error?.status === 403) {
    return <AccessDeniedPage resource="deployments" requestId={list.error.requestId} />;
  }

  const filtering = Boolean(status || applicationId);
  const appName = app.data?.name ?? (app.status === 'error' ? 'an unknown application' : 'the selected application');

  return (
    <div className="page">
      <PageHeader
        title="Deployments"
        description="Every deployment and rollback across all applications and providers."
        breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'Deployments' }]}
      />
      <div className="toolbar">
        <label className="visually-hidden" htmlFor="deployment-status-filter">
          Filter by status
        </label>
        <select
          id="deployment-status-filter"
          className="select"
          style={{ width: 'auto' }}
          value={status ?? ''}
          onChange={(e) => update({ status: e.target.value || null })}
        >
          <option value="">All statuses</option>
          {DEPLOYMENT_STATUSES.filter((s) => s !== 'unknown').map((s) => (
            <option key={s} value={s}>
              {deploymentStatus[s].label}
            </option>
          ))}
        </select>
        {applicationId && (
          <span className="cluster">
            <span className="text-muted">
              Application: <strong>{appName}</strong>
            </span>
            <Button size="sm" variant="ghost" icon={<X size={14} aria-hidden="true" />} onClick={() => update({ application_id: null })}>
              Show all applications
            </Button>
          </span>
        )}
        <span className="toolbar__spacer" />
        {list.status === 'success' && <InlineStatus resource={list} />}
      </div>

      {list.refreshError && list.data && (
        <Alert tone="warning" title="Could not refresh deployments" requestId={list.refreshError.requestId} role="status">
          The list below may be out of date.
        </Alert>
      )}
      {list.polling === 'stopped' && (
        <Alert tone="warning" title="Automatic updates stopped" actions={<Button size="sm" onClick={list.resumePolling}>Resume updates</Button>}>
          Some deployments are still running. Resume updates or refresh to see their latest status.
        </Alert>
      )}

      <Panel flush>
        {list.status === 'loading' && <TableSkeleton columns={6} rows={6} label="Loading deployments" />}
        {list.status === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
        {list.status === 'success' && list.data?.items.length === 0 && (
          filtering ? (
            <EmptyState
              icon={SearchX}
              title="No matching deployments"
              message="No deployments match the selected filters."
              actions={<Button onClick={() => update({ status: null, application_id: null })}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              icon={Rocket}
              title="No deployments yet"
              message="Deploy an application to see its deployments here."
              actions={<ButtonLink to="/applications">Go to applications</ButtonLink>}
            />
          )
        )}
        {list.status === 'success' && list.data && list.data.items.length > 0 && (
          <>
            <DataTable<DeploymentSummary>
              caption="Deployments"
              rows={list.data.items}
              rowKey={(d) => d.id}
              busy={list.isRefreshing}
              columns={[
                {
                  key: 'id',
                  header: 'Deployment',
                  render: (d) => (
                    <Link to={`/deployments/${encodeURIComponent(d.id)}`} className="mono data-table__primary" title={d.id}>
                      {shortId(d.id)}
                    </Link>
                  ),
                },
                {
                  key: 'app',
                  header: 'Application',
                  render: (d) => (
                    <span>
                      <Link to={`/applications/${encodeURIComponent(d.application_id)}`}>{d.application_name}</Link>
                      <span className="data-table__secondary">{providerLabel(d.provider)}</span>
                    </span>
                  ),
                },
                { key: 'status', header: 'Status', render: (d) => <StatusBadge status={deploymentStatus[d.status]} /> },
                {
                  key: 'kind',
                  header: 'Type',
                  render: (d) => (
                    <span>
                      {d.kind === 'rollback' ? 'Rollback' : 'Deploy'}
                      {d.source_ref && <span className="data-table__secondary mono">{d.source_ref}</span>}
                    </span>
                  ),
                },
                { key: 'by', header: 'Initiated by', render: (d) => d.initiated_by ?? <span className="text-muted">System</span> },
                {
                  key: 'started',
                  header: 'Started',
                  className: 'data-table__nowrap',
                  render: (d) => (
                    <span>
                      <RelativeTime value={d.created_at} />
                      {d.finished_at && <span className="data-table__secondary">{formatDuration(d.created_at, d.finished_at)}</span>}
                    </span>
                  ),
                },
              ]}
            />
            <Pagination
              page={page}
              pageSize={pageSize}
              total={list.data.total}
              itemLabel="deployments"
              onPageChange={(p) => update({ page: p })}
              onPageSizeChange={(s) => update({ page_size: s })}
            />
          </>
        )}
      </Panel>
    </div>
  );
}
