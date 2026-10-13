import type { HttpClient } from './client';
import type { AuthApi } from './contract';
import { session } from './decoders';

export function createAuthApi(http: HttpClient): AuthApi {
  return {
    getSession: (signal) =>
      http.request({ path: '/api/v1/auth/session', signal, authRequest: true }, session),
    login: (input) =>
      http.request({ method: 'POST', path: '/api/v1/auth/login', body: input, authRequest: true }, session),
    logout: async () => {
      await http.send({ method: 'POST', path: '/api/v1/auth/logout', authRequest: true });
    },
  };
}
