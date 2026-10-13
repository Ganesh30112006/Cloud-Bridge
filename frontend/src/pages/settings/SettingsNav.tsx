import { SubNav } from '../../components/navigation/SubNav';
import { useAuth } from '../../hooks/useAuth';

export function SettingsNav() {
  const { session } = useAuth();
  const items = [{ to: '/settings/profile', label: 'Profile and preferences' }];
  if (session?.features.organization_settings) items.push({ to: '/settings/organization', label: 'Organization' });
  if (session?.features.notification_preferences) items.push({ to: '/settings/notifications', label: 'Notifications' });
  return <SubNav label="Settings sections" items={items} />;
}
