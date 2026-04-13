import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createFloodlight,
  deleteFloodlight,
  fetchFloodlights,
  updateFloodlight,
  standardizeFloodlightConfig,
  testFloodlightConnectivity,
  turnFloodlightOff,
  turnFloodlightOn,
  type FloodlightUpsertInput,
} from '../api/floodlights';

const FLOODLIGHTS_QUERY_KEY = ['floodlights'];

export function useFloodlights() {
  return useQuery({
    queryKey: FLOODLIGHTS_QUERY_KEY,
    queryFn: fetchFloodlights,
    refetchInterval: 5000,
  });
}

export function useCreateFloodlight() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: FloodlightUpsertInput) => createFloodlight(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FLOODLIGHTS_QUERY_KEY });
    },
  });
}

export function useUpdateFloodlight() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: FloodlightUpsertInput }) =>
      updateFloodlight(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FLOODLIGHTS_QUERY_KEY });
    },
  });
}

export function useDeleteFloodlight() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => deleteFloodlight(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FLOODLIGHTS_QUERY_KEY });
    },
  });
}

export function useTurnFloodlightOn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: turnFloodlightOn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FLOODLIGHTS_QUERY_KEY });
    },
  });
}

export function useTurnFloodlightOff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: turnFloodlightOff,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FLOODLIGHTS_QUERY_KEY });
    },
  });
}

export function useTestFloodlightConnectivity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: testFloodlightConnectivity,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FLOODLIGHTS_QUERY_KEY });
    },
  });
}

export function useStandardizeFloodlightConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: standardizeFloodlightConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FLOODLIGHTS_QUERY_KEY });
    },
  });
}
