import { useState } from 'react';
import { HealthSummary } from '../components/HealthSummary';
import { EventLogTable } from '../components/EventLogTable';
import { CommandLogTable } from '../components/CommandLogTable';
import { ActiveTimersTable } from '../components/ActiveTimersTable';
import {
  useDiagnosticsCommands,
  useDiagnosticsEvents,
  useDiagnosticsHealth,
  useDiagnosticsTimers,
} from '../hooks/useDiagnostics';

function toErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  return undefined;
}

export function DiagnosticsPage() {
  const [searchText, setSearchText] = useState('');
  const healthQuery = useDiagnosticsHealth();
  const eventsQuery = useDiagnosticsEvents();
  const commandsQuery = useDiagnosticsCommands();
  const timersQuery = useDiagnosticsTimers();

  const activeTimers = (timersQuery.data ?? []).filter((timer) => timer.active !== false);
  const commandFailures = (commandsQuery.data ?? []).filter((item) => item.success === false);

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-white">Hub Diagnostics</h1>
        <p className="text-sm text-slate-400">
          Installer/service diagnostics for inbound webhooks, automation decisions, outbound device
          commands, and active timers.
        </p>
      </header>

      <HealthSummary
        health={healthQuery.data}
        recentEventsCount={eventsQuery.data?.length ?? 0}
        recentCommandFailuresCount={commandFailures.length}
        activeTimersCount={activeTimers.length}
        isLoading={healthQuery.isLoading}
        isError={healthQuery.isError}
        errorMessage={toErrorMessage(healthQuery.error)}
        onRefresh={() => {
          void healthQuery.refetch();
        }}
        isRefreshing={healthQuery.isFetching}
      />

      <EventLogTable
        events={eventsQuery.data}
        searchText={searchText}
        onSearchTextChange={setSearchText}
        isLoading={eventsQuery.isLoading}
        isError={eventsQuery.isError}
        errorMessage={toErrorMessage(eventsQuery.error)}
        onRefresh={() => {
          void eventsQuery.refetch();
        }}
        isRefreshing={eventsQuery.isFetching}
      />

      <CommandLogTable
        commands={commandsQuery.data}
        searchText={searchText}
        isLoading={commandsQuery.isLoading}
        isError={commandsQuery.isError}
        errorMessage={toErrorMessage(commandsQuery.error)}
        onRefresh={() => {
          void commandsQuery.refetch();
        }}
        isRefreshing={commandsQuery.isFetching}
      />

      <ActiveTimersTable
        timers={timersQuery.data}
        isLoading={timersQuery.isLoading}
        isError={timersQuery.isError}
        errorMessage={toErrorMessage(timersQuery.error)}
        onRefresh={() => {
          void timersQuery.refetch();
        }}
        isRefreshing={timersQuery.isFetching}
      />
    </section>
  );
}
