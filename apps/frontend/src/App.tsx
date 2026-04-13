import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { FloodlightsPage } from './pages/Floodlights';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-semibold ${
    isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
  }`;

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 p-4 md:p-8">
      <header className="mb-6 border-b border-slate-800 pb-4">
        <nav className="flex items-center gap-2">
          <NavLink to="/dashboard" className={navLinkClass}>
            Dashboard
          </NavLink>
          <NavLink to="/floodlights" className={navLinkClass}>
            Floodlights
          </NavLink>
        </nav>
      </header>

      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/floodlights" element={<FloodlightsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </div>
  );
}
