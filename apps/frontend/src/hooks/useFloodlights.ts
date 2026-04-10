import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchFloodlights,
  turnFloodlightOff,
  turnFloodlightOn,
} from '../api/floodlights';

const FLOODLIGHTS_QUERY_KEY = ['floodlights'];

export function useFloodlights() {
  return useQuery({
    queryKey: FLOODLIGHTS_QUERY_KEY,
    queryFn: fetchFloodlights,
    refetchInterval: 5000,
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
