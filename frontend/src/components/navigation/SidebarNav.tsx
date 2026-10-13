import {
  Activity,
  Bell,
  Boxes,
  Building2,
  Cloud,
  LayoutDashboard,
  Rocket,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import type { Permission, SessionFeatures } from '../../types/api';
import './navigation.css';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  permission?: Permission;
  feature?: keyof SessionFeatures;
}

const GROUPS: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: 'Platform',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/applications', label: 'Applications', icon: Boxes },
      { to: '/deployments', label: 'Deployments', icon: Rocket },
      { to: '/providers', label: 'Cloud providers', icon: Cloud },
      { to: '/activity', label: 'Activity log', icon: Activity, permission: 'audit:read' },
    ],
  },
  {
    heading: 'Settings',
    items: [
      { to: '/settings/profile', label: 'Profile', icon: UserRound },
      { to: '/settings/organization', label: 'Organization', icon: Building2, feature: 'organization_settings' },
      { to: '/settings/notifications', label: 'Notifications', icon: Bell, feature: 'notification_preferences' },
    ],
  },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { can, session } = useAuth();
  return (
    <nav className="sidebar-nav" aria-label="Main">
      {GROUPS.map((group) => {
        const items = group.items.filter(
          (item) => (!item.permission || can(item.permission)) && (!item.feature || session?.features[item.feature]),
        );
        if (items.length === 0) return null;
        return (
          <div className="sidebar-nav__group" key={group.heading}>
            <span className="sidebar-nav__heading">{group.heading}</span>
            {items.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className="sidebar-nav__link" onClick={onNavigate}>
                <Icon size={16} aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
