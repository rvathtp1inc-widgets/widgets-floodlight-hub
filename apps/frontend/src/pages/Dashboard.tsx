import { FloodlightCard } from '../components/FloodlightCard';
import {
  useFloodlights,
  useTurnFloodlightOff,
  useTurnFloodlightOn,
} from '../hooks/useFloodlights';

export function Dashboard() {
  const { data, isLoading, isError, error } = useFloodlights();
  const onMutation = useTurnFloodlightOn();
  const offMutation = useTurnFloodlightOff();

  if (isLoading) {
    return <p className="text-slate-300">Loading floodlights...</p>;
  }

  if (isError) {
    return (
      <p className="rounded-md border border-red-600/40 bg-red-950/40 p-3 text-red-200">
        Failed to load floodlights: {error instanceof Error ? error.message : 'Unknown error'}
      </p>
    );
  }

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-slate-400">Manual control and live status for each zone.</p>
      </header>

      {data && data.length === 0 ? (
        <p className="rounded-md border border-slate-700 bg-slate-900 p-4 text-slate-300">
          No floodlights were returned from the backend.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.map((floodlight) => (
            <FloodlightCard
              key={floodlight.id}
              floodlight={floodlight}
              onTurnOn={(id) => onMutation.mutate(id)}
              onTurnOff={(id) => offMutation.mutate(id)}
              isMutating={onMutation.isPending || offMutation.isPending}
            />
          ))}
        </div>
      )}
    </section>
  );
}
