import { array } from './decode';
import type { HttpClient } from './client';
import type { DeploymentsApi } from './contract';
import { deployment, deploymentEvent, deploymentSummary, paginated } from './decoders';

const enc = encodeURIComponent;

export function createDeploymentsApi(http: HttpClient): DeploymentsApi {
  return {
    list: (params, signal) =>
      http.request(
        {
          path: '/api/v1/deployments',
          query: {
            page: params.page,
            page_size: params.page_size,
            application_id: params.application_id,
            status: params.status,
          },
          signal,
        },
        paginated(deploymentSummary),
      ),
    get: (id, signal) => http.request({ path: `/api/v1/deployments/${enc(id)}`, signal }, deployment),
    listEvents: (id, signal) =>
      http.request({ path: `/api/v1/deployments/${enc(id)}/events`, signal }, array(deploymentEvent)),
    create: (applicationId, { idempotencyKey }) =>
      http.request(
        { method: 'POST', path: `/api/v1/applications/${enc(applicationId)}/deployments`, idempotencyKey },
        deployment,
      ),
    cancel: (id) => http.request({ method: 'POST', path: `/api/v1/deployments/${enc(id)}/cancel` }, deployment),
    rollback: (id, { idempotencyKey }) =>
      http.request(
        { method: 'POST', path: `/api/v1/deployments/${enc(id)}/rollback`, idempotencyKey },
        deployment,
      ),
  };
}
