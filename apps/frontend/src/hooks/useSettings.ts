import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSettings, updateSettings, type HubSettingsPatch } from '../api/settings';

export const SETTINGS_QUERY_KEY = ['hub-settings'];

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: fetchSettings,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: HubSettingsPatch) => updateSettings(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
    },
  });
}
