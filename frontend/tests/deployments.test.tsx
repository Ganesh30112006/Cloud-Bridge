import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeploymentProgress } from '../src/components/status/DeploymentProgress';
import { createFakeApi, httpError } from './helpers/fakeApi';
import { makeDeployment, makeSession, page } from './helpers/fixtures';
import { renderApp } from './helpers/renderApp';

describe('DeploymentProgress', () => {
  it('labels every stage state in text, not only colour', () => {
    render(
      <DeploymentProgress
        stages={[
          { name: 'queued', status: 'succeeded', started_at: null, finished_at: null },
          { name: 'validation', status: 'succeeded', started_at: null, finished_at: null },
          { name: 'build', status: 'failed', started_at: null, finished_at: null },
          { name: 'publishing', status: 'skipped', started_at: null, finished_at: null },
          { name: 'provisioning', status: 'cancelled', started_at: null, finished_at: null },
          { name: 'verification', status: 'pending', started_at: null, finished_at: null },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Deployment stages' });
    expect(within(list).getAllByText(/Completed/)).toHaveLength(2);
    expect(within(list).getByText(/Failed/)).toBeInTheDocument();
    expect(within(list).getByText(/Skipped/)).toBeInTheDocument();
    expect(within(list).getByText(/Cancelled/)).toBeInTheDocument();
    expect(within(list).getByText(/Pending/)).toBeInTheDocument();
  });

  it('marks the confirmed current stage and never shows an invented percentage', () => {
    render(<DeploymentProgress stages={makeDeployment().stages} progressPercent={null} />);
    const current = screen.getByRole('listitem', { current: 'step' });
    expect(current).toHaveTextContent('Build');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('shows real provider progress when reported', () => {
    render(<DeploymentProgress stages={makeDeployment().stages} progressPercent={42} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
  });
});

describe('deployment details', () => {
  it('polls while active and announces the transition to success once', async () => {
    const api = createFakeApi();
    api.deployments.get
      .mockResolvedValueOnce(makeDeployment({ status: 'in_progress' }))
      .mockResolvedValue(makeDeployment({ status: 'succeeded', finished_at: '2026-10-01T10:05:00Z', stages: makeDeployment().stages.map((s) => ({ ...s, status: 'succeeded' as const })) }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderApp('/deployments/dep-12345678abcd', api);
      expect(await screen.findByText('Deployment in progress')).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(3500);
      expect(await screen.findByText('Deployment succeeded', { selector: '.alert__title' })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('announcer')).toHaveTextContent('Deployment succeeded'));
      const calls = api.deployments.get.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(api.deployments.get.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not notify about a status that was already final on first load', async () => {
    const api = createFakeApi();
    api.deployments.get.mockResolvedValue(makeDeployment({ status: 'failed', failure: { code: 'build_failed', message: 'npm ci failed with token=abc123' } }));
    renderApp('/deployments/dep-12345678abcd', api);
    expect(await screen.findByText('Failure reason')).toBeInTheDocument();
    expect(screen.queryByText('Deployment failed', { selector: '.toast__title' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('abc123');
  });

  it('asks for confirmation before cancelling', async () => {
    const api = createFakeApi();
    const { user } = renderApp('/deployments/dep-12345678abcd', api);
    await user.click(await screen.findByRole('button', { name: 'Cancel deployment' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel this deployment?' });
    expect(api.deployments.cancel).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel deployment' }));
    await waitFor(() => expect(api.deployments.cancel).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Cancellation requested')).toBeInTheDocument();
  });

  it('starts a rollback from a succeeded deployment and opens it', async () => {
    const api = createFakeApi();
    api.deployments.get.mockResolvedValue(makeDeployment({ status: 'succeeded', finished_at: '2026-10-01T10:05:00Z' }));
    const { user, router } = renderApp('/deployments/dep-12345678abcd', api);
    await user.click(await screen.findByRole('button', { name: 'Roll back to this revision' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Start rollback' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/deployments/dep-rb-0000000'));
    expect(await screen.findByText('Rollback started')).toBeInTheDocument();
  });

  it('shows a conflict inside the dialog without closing it', async () => {
    const api = createFakeApi();
    api.deployments.cancel.mockRejectedValue(httpError(409, { method: 'POST', serverMessage: 'This deployment has already finished.' }));
    const { user } = renderApp('/deployments/dep-12345678abcd', api);
    await user.click(await screen.findByRole('button', { name: 'Cancel deployment' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel deployment' }));
    expect(await within(dialog).findByText('This deployment has already finished.')).toBeInTheDocument();
  });

  it('hides actions the user cannot perform', async () => {
    const api = createFakeApi();
    api.auth.getSession.mockResolvedValue(makeSession([]));
    renderApp('/deployments/dep-12345678abcd', api);
    await screen.findByText('Deployment in progress');
    expect(screen.queryByRole('button', { name: 'Cancel deployment' })).not.toBeInTheDocument();
  });

  it('shows a not-found page for unknown deployments', async () => {
    const api = createFakeApi();
    api.deployments.get.mockRejectedValue(httpError(404));
    renderApp('/deployments/nope', api);
    expect(await screen.findByRole('heading', { name: 'Deployment not found' })).toBeInTheDocument();
  });
});

describe('deployments list', () => {
  it('filters by status through the URL', async () => {
    const api = createFakeApi();
    const { user, router } = renderApp('/deployments', api);
    await screen.findByRole('table', { name: 'Deployments' });
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'failed');
    await waitFor(() => expect(router.state.location.search).toContain('status=failed'));
    await waitFor(() => expect(api.deployments.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }), expect.anything()));
  });

  it('offers to clear filters when nothing matches', async () => {
    const api = createFakeApi();
    api.deployments.list.mockResolvedValue(page([]));
    renderApp('/deployments?status=cancelled', api);
    expect(await screen.findByRole('heading', { name: 'No matching deployments' })).toBeInTheDocument();
  });
});
