import { useState } from 'react';
import { HealthSummary } from '../components/HealthSummary';
import { EventLogTable } from '../components/EventLogTable';
import { CommandLogTable } from '../components/CommandLogTable';
import { ActiveTimersTable } from '../components/ActiveTimersTable';
import { ExecutionDiagnosticsTable } from '../components/ExecutionDiagnosticsTable';
import { VirtualSecurityPanelStatusCard } from '../components/VirtualSecurityPanelStatusCard';
import { useDiagnosticsCommands, useDiagnosticsEvents, useDiagnosticsHealth, useDiagnosticsTimers, useExecutionDiagnostics, useVirtualSecurityPanelStatus } from '../hooks/useDiagnostics';

const tabs = ['Source Events', 'Semantic / Output Execution', 'Commands', 'Active Timers', 'Service Health'] as const;
type Tab = typeof tabs[number];
const toErrorMessage = (error: unknown) => error instanceof Error ? error.message : undefined;

export function DiagnosticsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Semantic / Output Execution');
  const [searchText, setSearchText] = useState('');
  const healthQuery = useDiagnosticsHealth(); const eventsQuery = useDiagnosticsEvents(); const commandsQuery = useDiagnosticsCommands(); const timersQuery = useDiagnosticsTimers(); const executionsQuery = useExecutionDiagnostics();
  const vspStatusQuery = useVirtualSecurityPanelStatus();
  const activeTimers = (timersQuery.data ?? []).filter((timer) => timer.active !== false);
  const commandFailures = (commandsQuery.data ?? []).filter((item) => item.success === false);

  return <section className="min-w-0 space-y-4">
    <header><h1 className="text-2xl font-bold text-white">Hub Diagnostics</h1><p className="text-sm text-slate-400">Trace inbound events through Conditions, Outputs, commands, timers, and service health.</p></header>
    <div className="max-w-full overflow-x-auto border-b border-slate-700" role="tablist" aria-label="Diagnostics sections"><div className="flex min-w-max gap-1">{tabs.map((tab) => <button key={tab} role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className={`whitespace-nowrap rounded-t px-3 py-2 text-sm ${activeTab === tab ? 'bg-slate-700 font-semibold text-white' : 'text-slate-300 hover:bg-slate-800'}`}>{tab}</button>)}</div></div>

    {activeTab === 'Source Events' ? <EventLogTable events={eventsQuery.data} searchText={searchText} onSearchTextChange={setSearchText} isLoading={eventsQuery.isLoading} isError={eventsQuery.isError} errorMessage={toErrorMessage(eventsQuery.error)} onRefresh={() => void eventsQuery.refetch()} isRefreshing={eventsQuery.isFetching} /> : null}
    {activeTab === 'Semantic / Output Execution' ? <ExecutionDiagnosticsTable records={executionsQuery.data} searchText={searchText} onSearchTextChange={setSearchText} isLoading={executionsQuery.isLoading} isError={executionsQuery.isError} errorMessage={toErrorMessage(executionsQuery.error)} onRefresh={() => void executionsQuery.refetch()} isRefreshing={executionsQuery.isFetching} /> : null}
    {activeTab === 'Commands' ? <CommandLogTable commands={commandsQuery.data} searchText={searchText} isLoading={commandsQuery.isLoading} isError={commandsQuery.isError} errorMessage={toErrorMessage(commandsQuery.error)} onRefresh={() => void commandsQuery.refetch()} isRefreshing={commandsQuery.isFetching} /> : null}
    {activeTab === 'Active Timers' ? <ActiveTimersTable timers={timersQuery.data} isLoading={timersQuery.isLoading} isError={timersQuery.isError} errorMessage={toErrorMessage(timersQuery.error)} onRefresh={() => void timersQuery.refetch()} isRefreshing={timersQuery.isFetching} /> : null}
    {activeTab === 'Service Health' ? <div className="space-y-4"><HealthSummary health={healthQuery.data} recentEventsCount={eventsQuery.data?.length ?? 0} recentCommandFailuresCount={commandFailures.length} activeTimersCount={activeTimers.length} isLoading={healthQuery.isLoading} isError={healthQuery.isError} errorMessage={toErrorMessage(healthQuery.error)} onRefresh={() => void healthQuery.refetch()} isRefreshing={healthQuery.isFetching} /><VirtualSecurityPanelStatusCard detail="full" status={vspStatusQuery.data} isLoading={vspStatusQuery.isLoading} isError={vspStatusQuery.isError} isFetching={vspStatusQuery.isFetching} onRefresh={() => void vspStatusQuery.refetch()} /></div> : null}
  </section>;
}
