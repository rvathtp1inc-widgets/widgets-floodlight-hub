import { NavLink, useSearchParams } from 'react-router-dom';
import { FloodlightsPage } from './Floodlights';
import { GroupsPage } from './Groups';

export function DevicesPage() {
  const [params] = useSearchParams();
  const tab = params.get('tab') === 'groups' ? 'groups' : 'floodlights';
  return <section className="space-y-4">
    <header><h1 className="text-2xl font-bold text-white">Devices</h1><p className="text-sm text-slate-400">Configure and test implementation-specific output hardware. Empty deployments are fully supported.</p></header>
    <nav className="flex gap-2">
      <NavLink to="/devices?tab=floodlights" className={`rounded px-3 py-2 text-sm ${tab === 'floodlights' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'}`}>Floodlights</NavLink>
      <NavLink to="/devices?tab=groups" className={`rounded px-3 py-2 text-sm ${tab === 'groups' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'}`}>Groups</NavLink>
    </nav>
    {tab === 'groups' ? <GroupsPage /> : <FloodlightsPage />}
  </section>;
}
