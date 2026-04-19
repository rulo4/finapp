import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import type { NavigationTab } from '../config/navigation';

type TabbedSectionLayoutProps = {
  tabs: readonly NavigationTab[];
  ariaLabel: string;
};

export function TabbedSectionLayout({ tabs, ariaLabel }: TabbedSectionLayoutProps) {
  const { pathname } = useLocation();
  const activeTab = tabs.find((tab) => ((tab.end ?? true) ? pathname === tab.to : pathname === tab.to || pathname.startsWith(`${tab.to}/`))) ?? tabs[0];

  return (
    <div className="page section-page">
      <section className="card section-tabs-card">
        <div className="section-tabs-card__header">
          <div className="section-tabs" role="tablist" aria-label={ariaLabel}>
            {tabs.map((tab) => {
              const isActive = tab.to === activeTab.to;

              return (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  end={tab.end ?? true}
                  role="tab"
                  aria-selected={isActive}
                  title={tab.label}
                  aria-label={tab.label}
                  className={`section-tabs__link${isActive ? ' section-tabs__link--active' : ''}`}
                >
                  <FontAwesomeIcon icon={tab.icon} className="section-tabs__icon" />
                  {isActive ? <span className="section-tabs__label">{tab.label}</span> : null}
                </NavLink>
              );
            })}
          </div>

          <div className="section-tabs__current" aria-live="polite">
            {activeTab.label}
          </div>
        </div>
      </section>

      <Outlet />
    </div>
  );
}