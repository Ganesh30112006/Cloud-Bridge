import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionProgress } from '../src/components/status/ConnectionProgress';
import { ApiError } from '../src/services/api/errors';
import { createFakeApi, httpError } from './helpers/fakeApi';
import { makeConnection } from './helpers/fixtures';
import { renderApp } from './helpers/renderApp';

describe('ConnectionProgress', () => {
  it('is indeterminate when the backend reports no stage', () => {
    render(<ConnectionProgress status="validating" stage={null} />);
    const bar = screen.getByRole('progressbar', { name: 'Validating connection' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByText('Connecting')).not.toBeInTheDocument();
  });

  it('advances only to the reported stage', () => {
    render(<ConnectionProgress status="validating" stage="validating_permissions" />);
    expect(screen.getByText('Connecting').closest('li')).toHaveTextContent('completed');
    expect(screen.getByText('Validating permissions').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Checking readiness').closest('li')).toHaveTextContent('not started');
  });

  it('never shows completed steps for a failed validation without a reported stage', () => {
    render(<ConnectionProgress status="error" stage={null} />);
    expect(screen.queryByText(/: completed/)).not.toBeInTheDocument();
  });
});

describe('provider connection page', () => {
  it('explains each failure without exposing credential material', async () => {
    const api = createFakeApi();
    api.providers.get.mockResolvedValue(
      makeConnection({
        status: 'insufficient_permissions',
        validation: {
          stage: null,
          started_at: null,
          finished_at: null,
          error_code: 'insufficient_permissions',
          checks: [{ name: 'App Runner permissions', status: 'failed', detail: 'Denied for key AKIAABCDEFGHIJKLMNOP' }],
        },
      }),
    );
    renderApp('/providers/conn-1', api);
    expect(await screen.findByText('Required permissions are missing')).toBeInTheDocument();
    expect(screen.getByText(/App Runner permissions/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('AKIAABCDEFGHIJKLMNOP');
  });

  it('runs validation, follows the reported stages and reports success only from the backend', async () => {
    const api = createFakeApi();
    api.providers.get
      .mockResolvedValueOnce(makeConnection({ status: 'pending_validation', last_validated_at: null }))
      .mockResolvedValueOnce(makeConnection({ status: 'validating', validation: { stage: 'checking_readiness', started_at: null, finished_at: null, checks: [], error_code: null } }))
      .mockResolvedValue(makeConnection({ status: 'connected' }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { user } = renderApp('/providers/conn-1', api);
      await user.click(await screen.findByRole('button', { name: 'Validate connection' }));
      expect(await screen.findByText('Validating connection', { selector: '.alert__title' })).toBeInTheDocument();
      expect(screen.queryByText('Provider connected')).not.toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(2500);
      await screen.findByText('Checking readiness');
      await vi.advanceTimersByTimeAsync(2500);
      expect(await screen.findByText('Connection verified')).toBeInTheDocument();
      await waitFor(() => expect(screen.getAllByText('Provider connected', { selector: '.toast__title' })).toHaveLength(1));
      expect(screen.getByTestId('announcer')).toHaveTextContent('Provider connected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a timed-out validate request as uncertain and rechecks with a read, not another validate', async () => {
    const api = createFakeApi();
    api.providers.get.mockResolvedValue(makeConnection({ status: 'pending_validation' }));
    api.providers.validate.mockRejectedValue(new ApiError({ kind: 'timeout', method: 'POST' }));
    const { user } = renderApp('/providers/conn-1', api);
    await user.click(await screen.findByRole('button', { name: 'Validate connection' }));
    expect(await screen.findByText('The validation request did not complete')).toBeInTheDocument();
    const reads = api.providers.get.mock.calls.length;
    await user.click(screen.getAllByRole('button', { name: 'Check status' })[0]!);
    await waitFor(() => expect(api.providers.get.mock.calls.length).toBeGreaterThan(reads));
    expect(api.providers.validate).toHaveBeenCalledTimes(1);
  });

  it('confirms disconnection only after the backend does', async () => {
    const api = createFakeApi();
    let finish: () => void = () => undefined;
    api.providers.remove.mockReturnValue(new Promise((r) => (finish = () => r('deleted'))));
    const { user, router } = renderApp('/providers/conn-1', api);
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(within(dialog).getByLabelText(/Type/), 'Production AWS');
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(await within(dialog).findByRole('button', { name: /Disconnecting/ })).toBeDisabled();
    expect(screen.queryByText('Provider disconnected')).not.toBeInTheDocument();
    finish();
    await waitFor(() => expect(router.state.location.pathname).toBe('/providers'));
    expect(await screen.findByText('Provider disconnected')).toBeInTheDocument();
  });

  it('shows a conflict when the connection is still in use', async () => {
    const api = createFakeApi();
    api.providers.remove.mockRejectedValue(httpError(409, { method: 'DELETE', serverMessage: 'Applications still use this connection.' }));
    const { user } = renderApp('/providers/conn-1', api);
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(within(dialog).getByLabelText(/Type/), 'Production AWS');
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(await within(dialog).findByText('Applications still use this connection.')).toBeInTheDocument();
  });
});

describe('provider setup', () => {
  it('asks for identifiers only, never secret keys, and validates them', async () => {
    const { user } = renderApp('/providers/new?provider=gcp_cloud_run');
    expect(await screen.findByText('No secret keys are needed')).toBeInTheDocument();
    expect(screen.queryByLabelText(/secret/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(screen.getAllByText(/Project IDs are 6–30/).length).toBeGreaterThan(0);
  });

  it('catches a role ARN from a different AWS account', async () => {
    const api = createFakeApi();
    const { user } = renderApp('/providers/new?provider=aws_app_runner', api);
    await user.type(await screen.findByLabelText(/Connection name/), 'Prod');
    await user.selectOptions(screen.getByLabelText(/Default region/), 'us-east-1');
    await user.type(screen.getByLabelText(/AWS account ID/), '111111111111');
    await user.type(screen.getByLabelText(/IAM role ARN/), 'arn:aws:iam::222222222222:role/Deploy');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(screen.getAllByText(/different account/).length).toBeGreaterThan(0);
    expect(api.providers.create).not.toHaveBeenCalled();
  });
});
