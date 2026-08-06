import type { AxiosError } from 'axios';

export const INGRESS_CONFLICT_MESSAGE = 'This Condition is already controlled by another Automation or Semantic Webhook.';

type ApiErrorBody = { code?: string; error?: string; message?: string; details?: string };

export function apiErrorMessage(error: unknown): string {
  const body = (error as AxiosError<ApiErrorBody>).response?.data;
  if (body?.code === 'semantic_condition_ingress_conflict' || body?.error === 'semantic_condition_ingress_conflict') {
    return INGRESS_CONFLICT_MESSAGE;
  }
  return body?.details ?? body?.message ?? body?.error ?? (error instanceof Error ? error.message : 'Unknown error');
}
