import { Boxes, Plus, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../../components/feedback/Alert';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { TableSkeleton } from '../../components/feedback/TableSkeleton';
import { Button, ButtonLink } from '../../components/forms/Button';
import { SearchInput } from '../../components/forms/SearchInput';
import { PageHeader } from '../../components/layout/PageHeader';
import { Panel } from '../../components/layout/Panel';
import { InlineStatus } from '../../components/status/InlineStatus';
import { RelativeTime } from '../../components/status/RelativeTime';
import { StatusBadge } from '../../components/status/StatusBadge';
import { applicationStatus, deploymentStatus, isDeploymentActive } from '../../components/status/statusMaps';
import { DataTable } from '../../components/tables/DataTable';
import { Pagination } from '../../components/tables/Pagination';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useListParams } from '../../hooks/usePaginationParams';
import { useResource } from '../../hooks/useResource';
import { APPLICATION_STATUSES } from '../../services/api/decoders';
import type { ApplicationStatus, ApplicationSummary } from '../../types/api';
import { providerLabel } from '../../utils/providers';
import { ErrorPageLayout } from '../errors/ErrorPageLayout';
import { AccessDeniedPage } from '../errors/AccessDeniedPage';

const FILTER_KEYS = ['q', 'status'] as const;

export function ApplicationsPage() {
  const api = useApi();
  const { can } = useAuth();
  const { page, pageSize, filters, update } = useListParams(FILTER_KEYS);
  const [searchText, setSearchText] = useState(filters.q);
  const debouncedSearch = useDebouncedValue(searchText.trim(), 300);
  const status = (APPLICATION_STATUSES as readonly string[]).includes(filters.status)
    ? (filters.status as ApplicationStatus)
    : undefined;

  useEffect(() => {
    if (debouncedSearch !== filters.q) update({ q: debouncedSearch });
  }, [debouncedSearch, filters.q, update]);

  const query = { page, page_size: pageSize, search: filters.q || undefined, status };
  const apps = useResource(
    `applications:${JSON.stringify(query)}`,
    (signal) => api.applications.list(query, signal),
    {
      pollWhile: (data) => data.items.some((a) => a.status === 'deploying' || a.status === 'deleting'),
      pollIntervalMs: 5000,
      maxPollDurationMs: 10 * 60_000,
    },
  );

  const filtering = Boolean(filters.q || status);
  const clearFilters = () => {
    setSearchText('');
    update({ q: null, status: null });
  };

  if (apps.status === 'error' && apps.error?.status === 403) {
    return <AccessDeniedPage resource="applications" requestId={apps.error.requestId} />;
  }

  const createButton = can('applications:create') ? (
    <ButtonLink variant="primary" to="/applications/new" icon={<Plus size={16} aria-hidden="true" />}>
      Create application
    </ButtonLink>
  ) : undefined;

  return (
    <div className="page">
      <PageHeader
        title="Applications"
        description="Containerized applications managed by CloudBridge, on any connected provider."
        breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'Applications' }]}
        actions={createButton}
      />

      <div className="toolbar">
        <SearchInput label="Search applications" placeholder="Search by name or description" value={searchText} onChange={setSearchText} />
        <label className="visually-hidden" htmlFor="app-status-filter">
          Filter by status
        </label>
        <select
          id="app-status-filter"
          className="select"
          style={{ width: 'auto' }}
          value={status ?? ''}
          onChange={(e) => update({ status: e.target.value || null })}
        >
          <option value="">All statuses</option>
          {APPLICATION_STATUSES.filter((s) => s !== 'unknown').map((s) => (
            <option key={s} value={s}>
              {applicationStatus[s].label}
            </option>
          ))}
        </select>
        <span className="toolbar__spacer" />
        {apps.status === 'success' && <InlineStatus resource={apps} />}
      </div>

      {apps.refreshError && apps.data && (
        <Alert tone="warning" title="Could not refresh applications" requestId={apps.refreshError.requestId} role="status">
          The list below may be out of date.
        </Alert>
      )}

      <Panel flush>
        {apps.status === 'loading' && <TableSkeleton columns={6} rows={6} label="Loading applications" />}
        {apps.status === 'error' && <ErrorState error={apps.error} onRetry={apps.reload} />}
        {apps.status === 'success' && apps.data && apps.data.items.length === 0 && !filtering && apps.data.total === 0 && (
          <EmptyState
            icon={Boxes}
            title="No applications yet"
            message={
              can('applications:create')
                ? 'Create an application to deploy a container image or repository to a connected provider.'
                : 'No applications exist in this organization yet. Ask a developer or administrator to create one.'
            }
            actions={createButton}
          />
        )}
        {apps.status === 'success' && apps.data && apps.data.items.length === 0 && filtering && (
          <EmptyState
            icon={SearchX}
            title="No matching applications"
            message={filters.q ? `Nothing matched “${filters.q}”${status ? ' with the selected status' : ''}.` : 'No applications have the selected status.'}
            actions={<Button onClick={clearFilters}>Clear search and filters</Button>}
          />
        )}
        {apps.status === 'success' && apps.data && apps.data.items.length === 0 && !filtering && apps.data.total > 0 && (
          <EmptyState
            icon={SearchX}
            title="This page is empty"
            message="There are no applications on this page. The list may have changed."
            actions={<Button onClick={() => update({ page: 1 })}>Go to first page</Button>}
          />
        )}
        {apps.status === 'success' && apps.data && apps.data.items.length > 0 && (
          <>
            <DataTable<ApplicationSummary>
              caption="Applications"
              rows={apps.data.items}
              rowKey={(a) => a.id}
              busy={apps.isRefreshing}
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  render: (a) => (
                    <span>
                      <Link className="data-table__primary" to={`/applications/${encodeURIComponent(a.id)}`}>
                        {a.name}
                      </Link>
                      {a.description && <span className="data-table__secondary">{a.description}</span>}
                    </span>
                  ),
                },
                { key: 'status', header: 'Status', render: (a) => <StatusBadge status={applicationStatus[a.status]} /> },
                {
                  key: 'provider',
                  header: 'Provider',
                  render: (a) => (
                    <span>
                      {providerLabel(a.provider)}
                      <span className="data-table__secondary">{a.region}</span>
                    </span>
                  ),
                },
                {
                  key: 'deployment',
                  header: 'Latest deployment',
                  render: (a) =>
                    a.latest_deployment ? (
                      <span className="cluster">
                        <Link to={`/deployments/${encodeURIComponent(a.latest_deployment.id)}`}>
                          <StatusBadge status={deploymentStatus[a.latest_deployment.status]} />
                        </Link>
                        {!isDeploymentActive(a.latest_deployment.status) && <RelativeTime value={a.latest_deployment.created_at} />}
                      </span>
                    ) : (
                      <span className="text-muted">Never deployed</span>
                    ),
                },
                { key: 'updated', header: 'Updated', className: 'data-table__nowrap', render: (a) => <RelativeTime value={a.updated_at} /> },
              ]}
            />
            <Pagination
              page={page}
              pageSize={pageSize}
              total={apps.data.total}
              itemLabel="applications"
              onPageChange={(p) => update({ page: p })}
              onPageSizeChange={(s) => update({ page_size: s })}
            />
          </>
        )}
      </Panel>
    </div>
  );
}

/** Used by detail pages when the application ID does not exist. */
export function ApplicationNotFound() {
  return (
    <ErrorPageLayout
      icon={SearchX}
      code="Error 404"
      title="Application not found"
      message="This application does not exist or has been deleted."
      actions={<ButtonLink variant="primary" to="/applications">Back to applications</ButtonLink>}
    />
  );
}
