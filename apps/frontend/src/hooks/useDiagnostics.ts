import { useQuery } from '@tanstack/react-query';
import { fetchCommands, fetchEvents, fetchHealth, fetchTimers } from '../api/diagnostics';

const DIAGNOSTICS_POLL_MS = 10000;

export function useDiagnosticsHealth() {
  return useQuery({
    queryKey: ['diagnostics', 'health'],
    queryFn: fetchHealth,
    refetchInterval: DIAGNOSTICS_POLL_MS,
  });
}

export function useDiagnosticsEvents() {
  return useQuery({
    queryKey: ['diagnostics', 'events'],
    queryFn: fetchEvents,
    refetchInterval: DIAGNOSTICS_POLL_MS,
  });
}

export function useDiagnosticsCommands() {
  return useQuery({
    queryKey: ['diagnostics', 'commands'],
    queryFn: fetchCommands,
    refetchInterval: DIAGNOSTICS_POLL_MS,
  });
}

export function useDiagnosticsTimers() {
  return useQuery({
    queryKey: ['diagnostics', 'timers'],
    queryFn: fetchTimers,
    refetchInterval: DIAGNOSTICS_POLL_MS,
  });
}
