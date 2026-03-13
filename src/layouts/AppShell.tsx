import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAnglesLeft, faAnglesRight, faBars } from '@fortawesome/free-solid-svg-icons';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { navigationItems } from '../config/navigation';
import { useAuth } from '../features/auth/AuthContext';
import { useMediaQuery } from '../features/shared/useMediaQuery';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'finapp.sidebar.collapsed';

function getPageTitle(pathname: string) {
  const match = navigationItems.find((item) => pathname.startsWith(item.to));
  return match?.label ?? 'Finapp';
}

export function AppShell() {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const isCompactShell = useMediaQuery('(max-width: 900px)');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    const storedValue = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    setIsSidebarCollapsed(storedValue === 'true');
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isCompactShell) {
      setIsMobileNavOpen(false);
    }
  }, [isCompactShell]);

  const isSidebarIconOnly = !isCompactShell && isSidebarCollapsed;

  return (
    <div className={clsx('app-shell', isSidebarIconOnly && 'app-shell--sidebar-collapsed')}>
      <button
        type="button"
        className={clsx('shell-backdrop', isMobileNavOpen && 'shell-backdrop--visible')}
        aria-label="Cerrar menu"
        aria-hidden={!isMobileNavOpen}
        tabIndex={isMobileNavOpen ? 0 : -1}
        onClick={() => setIsMobileNavOpen(false)}
      />

      <aside className={clsx('sidebar', isCompactShell && 'sidebar--compact', isSidebarIconOnly && 'sidebar--collapsed', isMobileNavOpen && 'sidebar--open')}>
        <div className="sidebar__brand">
          <div className="sidebar__brand-main">
            <span className="sidebar__brand-mark" aria-hidden="true">
              F
            </span>
            <h1 className="sidebar__title">Finapp</h1>
          </div>
          <div className="sidebar__brand-actions">
            {!isCompactShell ? (
              <button
                type="button"
                className="sidebar__toggle"
                onClick={() => setIsSidebarCollapsed((currentValue) => !currentValue)}
                aria-label={isSidebarIconOnly ? 'Expandir sidebar' : 'Compactar sidebar'}
                title={isSidebarIconOnly ? 'Expandir sidebar' : 'Compactar sidebar'}
              >
                <FontAwesomeIcon icon={isSidebarIconOnly ? faAnglesRight : faAnglesLeft} />
              </button>
            ) : null}
            <button type="button" className="sidebar__close" onClick={() => setIsMobileNavOpen(false)}>
              Cerrar
            </button>
          </div>
        </div>

        <nav className="sidebar__nav">
          {navigationItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={isSidebarIconOnly ? item.label : undefined}
              aria-label={item.label}
              onClick={() => {
                if (isCompactShell) {
                  setIsMobileNavOpen(false);
                }
              }}
              className={({ isActive }) => clsx('sidebar__link', isActive && 'sidebar__link--active')}
            >
              <FontAwesomeIcon icon={item.icon} className="sidebar__link-icon" />
              <span className="sidebar__link-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__leading">
            <button type="button" className="topbar__menu" onClick={() => setIsMobileNavOpen(true)}>
              <FontAwesomeIcon icon={faBars} />
              <span>Menu</span>
            </button>
            <h2 className="topbar__title">{getPageTitle(location.pathname)}</h2>
          </div>
          <div className="topbar__actions">
            <div className="topbar__session">
              <strong>{user?.email ?? 'Usuario autenticado'}</strong>
            </div>
            <button type="button" className="topbar__button" onClick={() => void signOut()}>
              Cerrar sesion
            </button>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
