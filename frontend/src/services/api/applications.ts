import type { HttpClient } from './client';
import type { ApplicationsApi } from './contract';
import { application, applicationConfiguration, applicationSummary, paginated, secretSummary } from './decoders';

const enc = encodeURIComponent;

export function createApplicationsApi(http: HttpClient): ApplicationsApi {
  return {
    list: (params, signal) =>
      http.request(
        {
          path: '/api/v1/applications',
          query: {
            page: params.page,
            page_size: params.page_size,
            search: params.search,
            status: params.status,
          },
          signal,
        },
        paginated(applicationSummary),
      ),
    get: (id, signal) => http.request({ path: `/api/v1/applications/${enc(id)}`, signal }, application),
    create: (input, { idempotencyKey }) =>
      http.request(
        { method: 'POST', path: '/api/v1/applications', body: input, idempotencyKey },
        application,
      ),
    remove: async (id) =>
      (await http.send({ method: 'DELETE', path: `/api/v1/applications/${enc(id)}` })) === 202 ? 'accepted' : 'deleted',
    getConfiguration: (id, signal) =>
      http.request({ path: `/api/v1/applications/${enc(id)}/configuration`, signal }, applicationConfiguration),
    updateConfiguration: (id, input) =>
      http.request(
        { method: 'PUT', path: `/api/v1/applications/${enc(id)}/configuration`, body: input },
        applicationConfiguration,
      ),
    setSecret: (id, name, value) =>
      http.request(
        { method: 'PUT', path: `/api/v1/applications/${enc(id)}/secrets/${enc(name)}`, body: { value } },
        secretSummary,
      ),
    deleteSecret: async (id, name) => {
      await http.send({ method: 'DELETE', path: `/api/v1/applications/${enc(id)}/secrets/${enc(name)}` });
    },
  };
}
