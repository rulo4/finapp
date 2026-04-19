import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAnglesLeft, faAnglesRight, faBars, faCircleQuestion, faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { getNavigationItemForPathname, sidebarNavigationItems } from '../config/navigation';
import { ENABLE_MOBILE_OPTIMIZED_LAYOUTS } from '../config/ui';
import { useAuth } from '../features/auth/AuthContext';
import { useMediaQuery } from '../features/shared/useMediaQuery';
import { usePageTour } from '../features/tours/usePageTour';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'auna.sidebar.collapsed';

function getPageTitle(pathname: string) {
  const match = getNavigationItemForPathname(pathname);
  return match?.label ?? 'Auna';
}

export function AppShell() {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { hasTour, startTour } = usePageTour(location.pathname);
  const matchesCompactShell = useMediaQuery('(max-width: 900px)');
  const isCompactShell = ENABLE_MOBILE_OPTIMIZED_LAYOUTS && matchesCompactShell;
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

  useEffect(() => {
    const storedValue = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);

    if (storedValue == null) {
      setIsSidebarCollapsed(true);
      return;
    }

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
  const activeNavigationItem = getNavigationItemForPathname(location.pathname);

  return (
    <div
      className={clsx(
        'app-shell',
        isSidebarIconOnly && 'app-shell--sidebar-collapsed',
        !ENABLE_MOBILE_OPTIMIZED_LAYOUTS && 'app-shell--mobile-layout-disabled',
      )}
    >
      <button
        type="button"
        className={clsx('shell-backdrop', isMobileNavOpen && 'shell-backdrop--visible')}
        aria-label="Cerrar menú"
        aria-hidden={!isMobileNavOpen}
        tabIndex={isMobileNavOpen ? 0 : -1}
        onClick={() => setIsMobileNavOpen(false)}
      />

      <aside className={clsx('sidebar', isCompactShell && 'sidebar--compact', isSidebarIconOnly && 'sidebar--collapsed', isMobileNavOpen && 'sidebar--open')}>
        <div className="sidebar__brand">
          <div className="sidebar__brand-main">
            <img className="sidebar__brand-logo" src="/auna-icon-1.png" alt="Auna" />
            <h1 className="sidebar__title">Auna</h1>
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
          {sidebarNavigationItems.map((item) => {
            const tabs = !isSidebarIconOnly && activeNavigationItem?.to === item.to && item.tabs && item.tabs.length > 0 ? item.tabs : null;

            return (
              <div key={item.to} className="sidebar__group">
                <NavLink
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

                {tabs ? (
                  <div className="sidebar__subnav" role="tablist" aria-label={item.label}>
                    {tabs.map((tab) => (
                      <NavLink
                        key={tab.to}
                        to={tab.to}
                        end={tab.end ?? true}
                        className={({ isActive }) => clsx('sidebar__sublink', isActive && 'sidebar__sublink--active')}
                        onClick={() => {
                          if (isCompactShell) {
                            setIsMobileNavOpen(false);
                          }
                        }}
                      >
                        <FontAwesomeIcon icon={tab.icon} className="sidebar__sublink-icon" />
                        <span className="sidebar__sublink-label">{tab.label}</span>
                      </NavLink>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__leading">
            <button type="button" className="topbar__menu" onClick={() => setIsMobileNavOpen(true)}>
              <FontAwesomeIcon icon={faBars} />
              <span>Menú</span>
            </button>
            <h2 className="topbar__title">{getPageTitle(location.pathname)}</h2>
          </div>
          <div className="topbar__actions">
            {hasTour ? (
              <button
                type="button"
                className="topbar__button topbar__button--icon topbar__button--tour"
                onClick={() => {
                  void startTour();
                }}
                aria-label="Abrir tour"
                title="Abrir tour"
                data-tour="topbar-help"
              >
                <FontAwesomeIcon icon={faCircleQuestion} />
              </button>
            ) : null}
            <div className="topbar__session">
              <strong>{user?.email ?? 'Usuario autenticado'}</strong>
            </div>
            <button
              type="button"
              className="topbar__button topbar__button--icon"
              onClick={() => void signOut()}
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <FontAwesomeIcon icon={faRightFromBracket} />
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
