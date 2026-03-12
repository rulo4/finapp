import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { navigationItems } from '../config/navigation';
import { useAuth } from '../features/auth/AuthContext';
import { useMediaQuery } from '../features/shared/useMediaQuery';

function getPageTitle(pathname: string) {
  const match = navigationItems.find((item) => pathname.startsWith(item.to));
  return match?.label ?? 'Finapp';
}

export function AppShell() {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const isCompactShell = useMediaQuery('(max-width: 900px)');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isCompactShell) {
      setIsMobileNavOpen(false);
    }
  }, [isCompactShell]);

  return (
    <div className="app-shell">
      <button
        type="button"
        className={clsx('shell-backdrop', isMobileNavOpen && 'shell-backdrop--visible')}
        aria-label="Cerrar menu"
        aria-hidden={!isMobileNavOpen}
        tabIndex={isMobileNavOpen ? 0 : -1}
        onClick={() => setIsMobileNavOpen(false)}
      />

      <aside className={clsx('sidebar', isCompactShell && 'sidebar--compact', isMobileNavOpen && 'sidebar--open')}>
        <div className="sidebar__brand">
          <h1 className="sidebar__title">Finapp</h1>
          <button type="button" className="sidebar__close" onClick={() => setIsMobileNavOpen(false)}>
            Cerrar
          </button>
        </div>

        <nav className="sidebar__nav">
          {navigationItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => {
                if (isCompactShell) {
                  setIsMobileNavOpen(false);
                }
              }}
              className={({ isActive }) => clsx('sidebar__link', isActive && 'sidebar__link--active')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__leading">
            <button type="button" className="topbar__menu" onClick={() => setIsMobileNavOpen(true)}>
              Menu
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
