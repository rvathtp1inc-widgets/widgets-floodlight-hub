import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { FloodlightsPage } from './pages/Floodlights';
import { GroupsPage } from './pages/Groups';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { EventRoutesPage } from './pages/EventRoutesPage';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-slate-700/90 text-white shadow-[inset_0_0_0_1px_rgba(148,163,184,0.25)]'
      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
  }`;

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800/90 bg-slate-950/90 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-200/20 bg-white px-2 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.2)]">
              <img
                src="/assets/widgets-logo.svg"
                alt="Widgets logo"
                className="h-6 w-auto max-w-none"
              />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide text-white">Widgets Floodlight Hub</p>
              <p className="text-xs text-slate-400">Local installer console</p>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-2">
            <NavLink to="/dashboard" className={navLinkClass}>
              Dashboard
            </NavLink>
            <NavLink to="/floodlights" className={navLinkClass}>
              Floodlights
            </NavLink>
            <NavLink to="/groups" className={navLinkClass}>
              Groups
            </NavLink>
            <NavLink to="/routes" className={navLinkClass}>
              Routes
            </NavLink>
            <NavLink to="/diagnostics" className={navLinkClass}>
              Diagnostics
            </NavLink>
            <NavLink to="/settings" className={navLinkClass}>
              Settings
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl p-4 md:p-8">
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/floodlights" element={<FloodlightsPage />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/routes" element={<EventRoutesPage />} />
          <Route path="/diagnostics" element={<DiagnosticsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
