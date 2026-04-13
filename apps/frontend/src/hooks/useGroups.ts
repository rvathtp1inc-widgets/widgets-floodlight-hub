import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createGroup,
  deleteGroup,
  fetchGroupMembership,
  fetchGroups,
  triggerGroupTest,
  updateGroup,
  type GroupUpsertInput,
} from '../api/groups';

const GROUPS_QUERY_KEY = ['groups'];

export function useGroups() {
  return useQuery({
    queryKey: GROUPS_QUERY_KEY,
    queryFn: fetchGroups,
    refetchInterval: 5000,
  });
}

export function useGroupMemberships(groupIds: number[]) {
  const queries = useQueries({
    queries: groupIds.map((id) => ({
      queryKey: ['group-memberships', id],
      queryFn: () => fetchGroupMembership(id),
      enabled: Number.isFinite(id),
    })),
  });

  const map: Record<number, number[]> = {};
  for (let i = 0; i < groupIds.length; i += 1) {
    map[groupIds[i]] = queries[i].data ?? [];
  }

  return {
    memberships: map,
    isLoading: queries.some((query) => query.isLoading),
  };
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GroupUpsertInput) => createGroup(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: GROUPS_QUERY_KEY });
    },
  });
}

export function useUpdateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: GroupUpsertInput }) => updateGroup(id, input),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: GROUPS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['group-memberships', variables.id] });
    },
  });
}

export function useDeleteGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteGroup(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: GROUPS_QUERY_KEY });
    },
  });
}

export function useTriggerGroupTest() {
  return useMutation({
    mutationFn: (id: number) => triggerGroupTest(id),
  });
}
