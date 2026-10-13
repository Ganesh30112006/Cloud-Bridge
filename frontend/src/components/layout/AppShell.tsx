import { Menu, Network, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { NetworkStatus } from '../feedback/NetworkStatus';
import { Button } from '../forms/Button';
import { SidebarNav } from '../navigation/SidebarNav';
import { UserMenu } from '../navigation/UserMenu';
import { GeneralErrorContent } from '../../pages/errors/GeneralErrorPage';
import { DemoBanner } from './DemoBanner';
import { ErrorBoundary } from './ErrorBoundary';
import './layout.css';

export function AppShell() {
  const { session } = useAuth();
  const location = useLocation();
  // The menu belongs to the page it was opened on, so it closes itself on navigation.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null);
  const menuOpen = menuOpenOn === location.pathname;
  const setMenuOpen = (open: boolean) => setMenuOpenOn(open ? location.pathname : null);
  const mainRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  // Move focus to the new page after navigation, so keyboard and screen-reader users start at its content.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    sidebarRef.current?.querySelector<HTMLElement>('a[href]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpenOn(null);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="app-shell__banners">
        <DemoBanner />
        <NetworkStatus />
      </div>
      <header className="app-header">
        <Button
          ref={toggleRef}
          className="app-header__menu-toggle"
          variant="ghost"
          iconOnly
          aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
        </Button>
        <Link to="/" className="app-header__brand">
          <span className="app-header__logo" aria-hidden="true">
            <Network size={16} />
          </span>
          CloudBridge
        </Link>
        {session && <span className="app-header__org">{session.organization.name}</span>}
        <span className="app-header__spacer" />
        <UserMenu />
      </header>
      <div
        className={`sidebar-backdrop${menuOpen ? ' sidebar-backdrop--open' : ''}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <aside id="app-sidebar" ref={sidebarRef} className={`app-sidebar${menuOpen ? ' app-sidebar--open' : ''}`} aria-label="Sidebar">
        <div className="app-sidebar__mobile-header">
          <span className="app-header__brand">CloudBridge</span>
          <Button
            variant="ghost"
            iconOnly
            aria-label="Close navigation"
            onClick={() => {
              setMenuOpenOn(null);
              toggleRef.current?.focus();
            }}
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </div>
        <SidebarNav onNavigate={() => setMenuOpen(false)} />
      </aside>
      <main id="main-content" className="app-main" ref={mainRef} tabIndex={-1}>
        <ErrorBoundary resetKey={location.pathname} fallback={(reset) => <GeneralErrorContent onRetry={reset} />}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
