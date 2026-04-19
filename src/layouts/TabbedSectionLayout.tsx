import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { NavLink, Outlet } from 'react-router-dom';
import type { NavigationTab } from '../config/navigation';

type TabbedSectionLayoutProps = {
  tabs: readonly NavigationTab[];
  ariaLabel: string;
};

export function TabbedSectionLayout({ tabs, ariaLabel }: TabbedSectionLayoutProps) {
  return (
    <div className="page section-page">
      <section className="card section-tabs-card">
        <div className="section-tabs" role="tablist" aria-label={ariaLabel}>
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end ?? true}
              className={({ isActive }) => `section-tabs__link${isActive ? ' section-tabs__link--active' : ''}`}
            >
              <FontAwesomeIcon icon={tab.icon} className="section-tabs__icon" />
              <span className="section-tabs__label">{tab.label}</span>
            </NavLink>
          ))}
        </div>
      </section>

      <Outlet />
    </div>
  );
}