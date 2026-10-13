import { array } from './decode';
import type { HttpClient } from './client';
import type { ProvidersApi } from './contract';
import { providerConnection } from './decoders';

const enc = encodeURIComponent;

export function createProvidersApi(http: HttpClient): ProvidersApi {
  return {
    list: (signal) => http.request({ path: '/api/v1/provider-connections', signal }, array(providerConnection)),
    get: (id, signal) =>
      http.request({ path: `/api/v1/provider-connections/${enc(id)}`, signal }, providerConnection),
    create: (input, { idempotencyKey }) =>
      http.request(
        { method: 'POST', path: '/api/v1/provider-connections', body: input, idempotencyKey },
        providerConnection,
      ),
    validate: (id) =>
      http.request(
        { method: 'POST', path: `/api/v1/provider-connections/${enc(id)}/validate` },
        providerConnection,
      ),
    remove: async (id) =>
      (await http.send({ method: 'DELETE', path: `/api/v1/provider-connections/${enc(id)}` })) === 202
        ? 'accepted'
        : 'deleted',
  };
}
