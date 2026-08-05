import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createEventRoute,
  deleteEventRoute,
  fetchEventRoutes,
  fetchProtectSources,
  fetchRouteFloodlightTargets,
  fetchRouteGroupTargets,
  updateEventRoute,
  type EventRouteInput,
} from '../api/eventRoutes';

const ROUTES_QUERY_KEY = ['event-routes'];
export const PROTECT_SOURCES_QUERY_KEY = ['protect-sources'];
const ROUTE_TARGETS_QUERY_KEY = ['route-targets'];

export function useEventRoutes() {
  return useQuery({
    queryKey: ROUTES_QUERY_KEY,
    queryFn: fetchEventRoutes,
    refetchInterval: 5000,
  });
}

export function useProtectSources() {
  return useQuery({
    queryKey: PROTECT_SOURCES_QUERY_KEY,
    queryFn: fetchProtectSources,
    refetchInterval: 10000,
  });
}

export function useRouteTargets() {
  const floodlights = useQuery({
    queryKey: [...ROUTE_TARGETS_QUERY_KEY, 'floodlights'],
    queryFn: fetchRouteFloodlightTargets,
    refetchInterval: 10000,
  });

  const groups = useQuery({
    queryKey: [...ROUTE_TARGETS_QUERY_KEY, 'groups'],
    queryFn: fetchRouteGroupTargets,
    refetchInterval: 10000,
  });

  return { floodlights, groups };
}

export function useCreateEventRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EventRouteInput) => createEventRoute(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ROUTES_QUERY_KEY });
    },
  });
}

export function useUpdateEventRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: EventRouteInput }) => updateEventRoute(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ROUTES_QUERY_KEY });
    },
  });
}

export function useDeleteEventRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteEventRoute(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ROUTES_QUERY_KEY });
    },
  });
}
