import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/services/api/errors';
import { createFakeApi, httpError, pending } from './helpers/fakeApi';
import { makeAppSummary, makeConnection, makeSession, page } from './helpers/fixtures';
import { renderApp } from './helpers/renderApp';

describe('applications list', () => {
  it('shows a table-shaped skeleton while loading', async () => {
    const api = createFakeApi();
    api.applications.list.mockReturnValue(pending());
    renderApp('/applications', api);
    expect(await screen.findByText('Loading applications…')).toBeInTheDocument();
  });

  it('lists applications', async () => {
    renderApp('/applications');
    const table = await screen.findByRole('table', { name: 'Applications' });
    expect(within(table).getByRole('link', { name: 'orders-api' })).toHaveAttribute('href', '/applications/app-1');
    expect(within(table).getByText('Running')).toBeInTheDocument();
  });

  it('explains an empty organization and offers to create an application', async () => {
    const api = createFakeApi();
    api.applications.list.mockResolvedValue(page([]));
    renderApp('/applications', api);
    expect(await screen.findByRole('heading', { name: 'No applications yet' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Create application' }).length).toBeGreaterThan(0);
  });

  it('distinguishes "no search results" and lets the user clear the search', async () => {
    const api = createFakeApi();
    api.applications.list.mockImplementation(async (params) => (params.search ? page([]) : page([makeAppSummary()])));
    const { user } = renderApp('/applications?q=zzz', api);
    expect(await screen.findByRole('heading', { name: 'No matching applications' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing matched “zzz”/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(await screen.findByRole('link', { name: 'orders-api' })).toBeInTheDocument();
  });

  it('shows an error with retry and the request id, then recovers', async () => {
    const api = createFakeApi();
    api.applications.list.mockRejectedValueOnce(httpError(500, { requestId: 'req-500' })).mockResolvedValue(page([makeAppSummary()]));
    const { user } = renderApp('/applications', api);
    expect(await screen.findByRole('heading', { name: 'Something went wrong on our side' })).toBeInTheDocument();
    expect(screen.getByText('req-500')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'orders-api' })).toBeInTheDocument();
  });

  it('keeps the last data visible when a refresh fails', async () => {
    const api = createFakeApi();
    api.applications.list.mockResolvedValueOnce(page([makeAppSummary()])).mockRejectedValue(new ApiError({ kind: 'network' }));
    const { user } = renderApp('/applications', api);
    await screen.findByRole('link', { name: 'orders-api' });
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Could not refresh applications')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'orders-api' })).toBeInTheDocument();
  });

  it('shows access denied rather than an empty list on 403', async () => {
    const api = createFakeApi();
    api.applications.list.mockRejectedValue(httpError(403));
    renderApp('/applications', api);
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.queryByText('No applications yet')).not.toBeInTheDocument();
  });

  it('hides the create action from users without permission', async () => {
    const api = createFakeApi();
    api.auth.getSession.mockResolvedValue(makeSession(['audit:read']));
    renderApp('/applications', api);
    await screen.findByRole('link', { name: 'orders-api' });
    expect(screen.queryByRole('link', { name: 'Create application' })).not.toBeInTheDocument();
  });
});

describe('create application', () => {
  async function fillToReview(user: ReturnType<typeof renderApp>['user']) {
    await user.type(await screen.findByLabelText(/Application name/), 'billing-api');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText(/Image reference/), 'registry.example.com/billing:1.0.0');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Step 4 of 4: Review');
  }

  it('requires a validated provider connection first', async () => {
    const api = createFakeApi();
    api.providers.list.mockResolvedValue([makeConnection({ status: 'pending_validation' })]);
    renderApp('/applications/new', api);
    expect(await screen.findByRole('heading', { name: 'Connect a provider first' })).toBeInTheDocument();
  });

  it('validates each step before moving on and keeps earlier values', async () => {
    const { user } = renderApp('/applications/new');
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(screen.getAllByText('Application name is required.').length).toBeGreaterThan(0);
    expect(screen.getByText('Step 1 of 4: Basics')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Application name/), 'billing-api');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Step 2 of 4: Source')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText(/Application name/)).toHaveValue('billing-api');
  });

  it('creates once, even when submit is clicked repeatedly, and reports success', async () => {
    const api = createFakeApi();
    let resolve: (v: Awaited<ReturnType<typeof api.applications.create>>) => void = () => undefined;
    api.applications.create.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user, router } = renderApp('/applications/new', api);
    await fillToReview(user);
    const submit = screen.getByRole('button', { name: 'Create application' });
    await user.click(submit);
    await user.click(submit);
    expect(api.applications.create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Creating/ })).toBeDisabled();
    resolve((await import('./helpers/fixtures')).makeApp({ id: 'app-new', name: 'billing-api' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/applications/app-new'));
    expect(await screen.findByText('Application created')).toBeInTheDocument();
  });

  it('maps server validation errors back to the right step and field', async () => {
    const api = createFakeApi();
    api.applications.create.mockRejectedValue(
      httpError(422, { method: 'POST', fieldErrors: [{ field: 'source.image', message: 'Image not found in registry.' }] }),
    );
    const { user } = renderApp('/applications/new', api);
    await fillToReview(user);
    await user.click(screen.getByRole('button', { name: 'Create application' }));
    expect(await screen.findByText('Step 2 of 4: Source')).toBeInTheDocument();
    expect(screen.getByText('Image not found in registry.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Image reference/)).toHaveValue('registry.example.com/billing:1.0.0');
  });

  it('reuses the idempotency key when the same submission is retried after a timeout', async () => {
    const api = createFakeApi();
    api.applications.create.mockRejectedValueOnce(new ApiError({ kind: 'timeout', method: 'POST' }));
    const { user } = renderApp('/applications/new', api);
    await fillToReview(user);
    await user.click(screen.getByRole('button', { name: 'Create application' }));
    expect(await screen.findByText(/outcome is unknown/)).toBeInTheDocument();
    expect(screen.getByText(/Submitting again with the same values is safe/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create application' }));
    await waitFor(() => expect(api.applications.create).toHaveBeenCalledTimes(2));
    const [first, second] = api.applications.create.mock.calls;
    expect(first?.[1].idempotencyKey).toBe(second?.[1].idempotencyKey);
  });
});

describe('application details', () => {
  it('requires typing the name before deleting, and confirms only after the backend does', async () => {
    const api = createFakeApi();
    const { user, router } = renderApp('/applications/app-1', api);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete orders-api?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete application' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Type/), 'orders-api');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(router.state.location.pathname).toBe('/applications'));
    expect(api.applications.remove).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Application deleted')).toBeInTheDocument();
  });

  it('reports an uncertain delete instead of claiming success, and checks status on request', async () => {
    const api = createFakeApi();
    api.applications.remove.mockRejectedValue(new ApiError({ kind: 'timeout', method: 'DELETE' }));
    const { user } = renderApp('/applications/app-1', api);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(within(dialog).getByLabelText(/Type/), 'orders-api');
    await user.click(within(dialog).getByRole('button', { name: 'Delete application' }));
    expect(await screen.findByText('Deletion status unknown')).toBeInTheDocument();
    expect(screen.queryByText('Application deleted')).not.toBeInTheDocument();
    api.applications.get.mockRejectedValue(httpError(404));
    await user.click(screen.getByRole('button', { name: 'Check current status' }));
    expect(await screen.findByText('The application was deleted')).toBeInTheDocument();
    expect(api.applications.remove).toHaveBeenCalledTimes(1);
  });

  it('queues a deployment and says it was accepted, not completed', async () => {
    const api = createFakeApi();
    api.deployments.get.mockResolvedValue((await import('./helpers/fixtures')).makeDeployment({ id: 'dep-new-000000', status: 'queued' }));
    const { user, router } = renderApp('/applications/app-1', api);
    await user.click(await screen.findByRole('button', { name: 'Deploy' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Start deployment' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/deployments/dep-new-000000'));
    expect(await screen.findByText('Deployment queued', { selector: '.toast__title' })).toBeInTheDocument();
    expect(api.deployments.create.mock.calls[0]?.[1].idempotencyKey).toBeTruthy();
  });

  it('only renders safe external service links', async () => {
    const api = createFakeApi();
    api.applications.get.mockResolvedValue((await import('./helpers/fixtures')).makeApp({ service_url: 'javascript:alert(1)' }));
    renderApp('/applications/app-1', api);
    expect(await screen.findByText('javascript:alert(1)')).not.toHaveAttribute('href');
  });
});

describe('configuration', () => {
  it('never displays secret values and saves configuration with the loaded version', async () => {
    const api = createFakeApi();
    const { user } = renderApp('/applications/app-1/configuration', api);
    expect(await screen.findByText('DATABASE_URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Value hidden')).toBeInTheDocument();
    const port = screen.getByLabelText(/Container port/);
    await user.clear(port);
    await user.type(port, '9090');
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => expect(api.applications.updateConfiguration).toHaveBeenCalledTimes(1));
    expect(api.applications.updateConfiguration.mock.calls[0]?.[1]).toMatchObject({ version: 3, port: 9090 });
    expect(await screen.findByText('Configuration saved')).toBeInTheDocument();
  });

  it('keeps edits and offers a reload on a version conflict', async () => {
    const api = createFakeApi();
    api.applications.updateConfiguration.mockRejectedValue(httpError(409, { method: 'PUT', code: 'version_conflict' }));
    const { user } = renderApp('/applications/app-1/configuration', api);
    const port = await screen.findByLabelText(/Container port/);
    await user.clear(port);
    await user.type(port, '9090');
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));
    expect(await screen.findByText('The configuration changed since you opened it')).toBeInTheDocument();
    expect(screen.getByLabelText(/Container port/)).toHaveValue(9090);
  });

  it('sends a secret value once and clears it from the form', async () => {
    const api = createFakeApi();
    const { user } = renderApp('/applications/app-1/configuration', api);
    await user.click(await screen.findByRole('button', { name: 'Add secret' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add secret' });
    await user.type(within(dialog).getByLabelText(/Name/), 'STRIPE_KEY');
    await user.type(within(dialog).getByLabelText(/Value/), 'sk_live_123');
    expect(within(dialog).getByLabelText(/Value/)).toHaveAttribute('type', 'password');
    await user.click(within(dialog).getByRole('button', { name: 'Save secret' }));
    await waitFor(() => expect(api.applications.setSecret).toHaveBeenCalledWith('app-1', 'STRIPE_KEY', 'sk_live_123'));
    expect(await screen.findByText('STRIPE_KEY')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('sk_live_123');
  });

  it('is read-only for users who cannot update applications', async () => {
    const api = createFakeApi();
    api.auth.getSession.mockResolvedValue(makeSession(['audit:read']));
    renderApp('/applications/app-1/configuration', api);
    expect(await screen.findByText(/You can view this configuration but not change it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save configuration' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add secret' })).not.toBeInTheDocument();
  });
});
