import type { HttpClient } from './client';
import type { AuditApi } from './contract';
import { auditEvent, paginated } from './decoders';

export function createAuditApi(http: HttpClient): AuditApi {
  return {
    list: (params, signal) =>
      http.request(
        {
          path: '/api/v1/audit-events',
          query: {
            page: params.page,
            page_size: params.page_size,
            search: params.search,
            outcome: params.outcome,
            resource_type: params.resource_type,
            from: params.from,
            to: params.to,
          },
          signal,
        },
        paginated(auditEvent),
      ),
  };
}
