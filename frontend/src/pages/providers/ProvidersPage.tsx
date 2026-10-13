import { Cloud, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert } from '../../components/feedback/Alert';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { TableSkeleton } from '../../components/feedback/TableSkeleton';
import { ButtonLink } from '../../components/forms/Button';
import { PageHeader } from '../../components/layout/PageHeader';
import { Panel } from '../../components/layout/Panel';
import { InlineStatus } from '../../components/status/InlineStatus';
import { RelativeTime } from '../../components/status/RelativeTime';
import { StatusBadge } from '../../components/status/StatusBadge';
import { connectionStatus } from '../../components/status/statusMaps';
import { DataTable } from '../../components/tables/DataTable';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useResource } from '../../hooks/useResource';
import type { ProviderConnection } from '../../types/api';
import { PROVIDERS, accountRef, providerLabel } from '../../utils/providers';
import { AccessDeniedPage } from '../errors/AccessDeniedPage';

export function ProvidersPage() {
  const api = useApi();
  const { can } = useAuth();
  const list = useResource('providers', (signal) => api.providers.list(signal), {
    pollWhile: (items) => items.some((c) => c.status === 'validating'),
    pollIntervalMs: 3000,
    maxPollDurationMs: 5 * 60_000,
  });

  if (list.status === 'error' && list.error?.status === 403) {
    return <AccessDeniedPage resource="cloud provider connections" requestId={list.error.requestId} />;
  }

  const addButton = can('providers:manage') ? (
    <ButtonLink variant="primary" to="/providers/new" icon={<Plus size={16} aria-hidden="true" />}>
      Connect provider
    </ButtonLink>
  ) : undefined;

  return (
    <div className="page">
      <PageHeader
        title="Cloud providers"
        description="Connections CloudBridge uses to deploy to your cloud accounts. CloudBridge uses role assumption and workload identity, never long-lived access keys."
        breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'Cloud providers' }]}
        actions={addButton}
      />
      {list.status === 'success' && (
        <div className="toolbar">
          <span className="toolbar__spacer" />
          <InlineStatus resource={list} />
        </div>
      )}
      {list.refreshError && list.data && (
        <Alert tone="warning" title="Could not refresh connections" requestId={list.refreshError.requestId} role="status">
          The statuses below may be out of date.
        </Alert>
      )}
      <Panel flush>
        {list.status === 'loading' && <TableSkeleton columns={5} rows={3} label="Loading provider connections" />}
        {list.status === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
        {list.status === 'success' && list.data?.length === 0 && (
          <EmptyState
            icon={Cloud}
            title="No cloud providers connected"
            message={
              <>
                CloudBridge needs access to a cloud account before it can deploy. Supported: {PROVIDERS.aws_app_runner.label} (through
                an IAM role) and {PROVIDERS.gcp_cloud_run.label} (through workload identity federation).
                {!can('providers:manage') && ' Ask an administrator to connect one.'}
              </>
            }
            actions={addButton}
          />
        )}
        {list.status === 'success' && list.data && list.data.length > 0 && (
          <DataTable<ProviderConnection>
            caption="Provider connections"
            rows={list.data}
            rowKey={(c) => c.id}
            busy={list.isRefreshing}
            columns={[
              {
                key: 'name',
                header: 'Name',
                render: (c) => (
                  <Link className="data-table__primary" to={`/providers/${encodeURIComponent(c.id)}`}>
                    {c.name}
                  </Link>
                ),
              },
              { key: 'provider', header: 'Provider', render: (c) => providerLabel(c.provider) },
              {
                key: 'account',
                header: 'Account / project',
                render: (c) => (
                  <span>
                    <span className="mono">{accountRef(c)}</span>
                    <span className="data-table__secondary">Default region {c.default_region}</span>
                  </span>
                ),
              },
              { key: 'status', header: 'Status', render: (c) => <StatusBadge status={connectionStatus[c.status]} /> },
              {
                key: 'validated',
                header: 'Last verified',
                className: 'data-table__nowrap',
                render: (c) => (c.last_validated_at ? <RelativeTime value={c.last_validated_at} /> : <span className="text-muted">Never</span>),
              },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
