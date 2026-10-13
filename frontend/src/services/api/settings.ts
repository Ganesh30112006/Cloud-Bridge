import { array } from './decode';
import type { HttpClient } from './client';
import type { SettingsApi } from './contract';
import { notificationPreferences, organization, organizationMember, user } from './decoders';

export function createSettingsApi(http: HttpClient): SettingsApi {
  return {
    updateProfile: (input) => http.request({ method: 'PATCH', path: '/api/v1/me', body: input }, user),
    getOrganization: (signal) => http.request({ path: '/api/v1/organization', signal }, organization),
    updateOrganization: (input) =>
      http.request({ method: 'PATCH', path: '/api/v1/organization', body: input }, organization),
    listMembers: (signal) =>
      http.request({ path: '/api/v1/organization/members', signal }, array(organizationMember)),
    getNotificationPreferences: (signal) =>
      http.request({ path: '/api/v1/me/notification-preferences', signal }, notificationPreferences),
    updateNotificationPreferences: (input) =>
      http.request(
        { method: 'PUT', path: '/api/v1/me/notification-preferences', body: input },
        notificationPreferences,
      ),
  };
}
