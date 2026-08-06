import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as platform from '../api/platform';

export const useConditions = () => useQuery({ queryKey: ['conditions'], queryFn: platform.fetchConditions });
export const useConsumerBindings = () => useQuery({ queryKey: ['consumer-bindings'], queryFn: platform.fetchConsumerBindings });
export const useCloudStatus = () => useQuery({ queryKey: ['cloud-status'], queryFn: platform.fetchCloudStatus, refetchInterval: 10000 });
export const useAccessStatus = () => useQuery({ queryKey: ['access-status'], queryFn: platform.fetchAccessPollStatus, refetchInterval: 10000 });
export const useAccessDoors = () => useQuery({ queryKey: ['access-doors'], queryFn: platform.fetchAccessDoors });
export const useSemanticWebhooks = () => useQuery({ queryKey: ['semantic-webhooks'], queryFn: platform.fetchSemanticWebhooks });

export function useSemanticWebhookMutations() {
  const client = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['semantic-webhooks'] }),
      client.invalidateQueries({ queryKey: ['conditions'] }),
      client.invalidateQueries({ queryKey: ['event-routes'] }),
    ]);
  };
  return {
    create: useMutation({ mutationFn: platform.createSemanticWebhook, onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, input }: { id: number; input: Parameters<typeof platform.updateSemanticWebhook>[1] }) => platform.updateSemanticWebhook(id, input), onSuccess: refresh }),
    remove: useMutation({ mutationFn: platform.deleteSemanticWebhook, onSuccess: refresh })
  };
}

export function useConditionMutations() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['conditions'] });
  return {
    create: useMutation({ mutationFn: platform.createCondition, onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, input }: { id: number; input: Parameters<typeof platform.updateCondition>[1] }) => platform.updateCondition(id, input), onSuccess: refresh }),
    remove: useMutation({ mutationFn: platform.deleteCondition, onSuccess: refresh }),
  };
}

export function useBindingMutations() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['consumer-bindings'] });
  return {
    create: useMutation({ mutationFn: platform.createConsumerBinding, onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, input }: { id: number; input: Parameters<typeof platform.updateConsumerBinding>[1] }) => platform.updateConsumerBinding(id, input), onSuccess: refresh }),
    remove: useMutation({ mutationFn: platform.deleteConsumerBinding, onSuccess: refresh }),
  };
}
