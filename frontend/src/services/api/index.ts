import { createApplicationsApi } from './applications';
import { createAuditApi } from './audit';
import { createAuthApi } from './auth';
import { createHttpClient, type HttpClientOptions } from './client';
import type { CloudBridgeApi } from './contract';
import { createDeploymentsApi } from './deployments';
import { createProvidersApi } from './providers';
import { createSettingsApi } from './settings';

export type { CloudBridgeApi } from './contract';
export { ApiError, describeError, isAbort, isApiError, isMaintenance, toApiError } from './errors';

/** The production API: every call goes to the FastAPI backend. */
export function createHttpApi(options: HttpClientOptions): CloudBridgeApi {
  const http = createHttpClient(options);
  return {
    mode: 'live',
    auth: createAuthApi(http),
    applications: createApplicationsApi(http),
    deployments: createDeploymentsApi(http),
    providers: createProvidersApi(http),
    audit: createAuditApi(http),
    settings: createSettingsApi(http),
    on: http.on,
  };
}
