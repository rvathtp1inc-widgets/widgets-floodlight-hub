import { FastifyInstance } from 'fastify';
import { MAX_VIRTUAL_SECURITY_ZONE, MIN_VIRTUAL_SECURITY_ZONE, VirtualSecurityPanelConsumer, VirtualSecurityPanelLifecycle, VirtualSecurityPanelTransportErrorStatus } from '../services/virtualSecurityPanel/types.js';

export type VirtualSecurityPanelListenerState = 'disabled' | 'starting' | 'listening' | 'stopped' | 'error';

export interface VirtualSecurityPanelServiceStatus {
  enabled: boolean;
  listenerState: VirtualSecurityPanelListenerState;
  listenHost: string;
  listenPort: number;
  savantClientConnected: boolean;
  configuredZoneCount: number;
  retainedZoneCount: number;
  lastClientConnectedAt: string | null;
  lastClientDisconnectedAt: string | null;
  lastTransportError: VirtualSecurityPanelTransportErrorStatus | null;
}

export interface VirtualSecurityPanelStatusProvider {
  getStatus(): Promise<VirtualSecurityPanelServiceStatus>;
}

export interface VirtualSecurityPanelStatusConfig {
  enabled: boolean;
  listenHost: string;
  listenPort: number;
}

function listenerState(enabled: boolean, lifecycle?: VirtualSecurityPanelLifecycle): VirtualSecurityPanelListenerState {
  if (!enabled) return 'disabled';
  if (lifecycle === 'starting') return 'starting';
  if (lifecycle === 'listening' || lifecycle === 'connected') return 'listening';
  if (lifecycle === 'faulted') return 'error';
  return 'stopped';
}

export function createVirtualSecurityPanelStatusProvider(input: {
  config: VirtualSecurityPanelStatusConfig;
  consumer?: VirtualSecurityPanelConsumer;
  readEnabledBindingJson: () => Promise<Array<{ bindingJson: string }>> | Array<{ bindingJson: string }>;
}): VirtualSecurityPanelStatusProvider {
  return {
    async getStatus() {
      const rows = await input.readEnabledBindingJson();
      const zones = new Set<number>();
      for (const row of rows) {
        try {
          const binding = JSON.parse(row.bindingJson) as { panelKey?: unknown; zoneNumber?: unknown };
          if (binding.panelKey === 'default' && Number.isInteger(binding.zoneNumber) &&
            (binding.zoneNumber as number) >= MIN_VIRTUAL_SECURITY_ZONE && (binding.zoneNumber as number) <= MAX_VIRTUAL_SECURITY_ZONE) {
            zones.add(binding.zoneNumber as number);
          }
        } catch {
          // Status inspection is read-only; malformed legacy bindings are ignored.
        }
      }

      const runtime = input.config.enabled ? input.consumer?.getStatus() : undefined;
      return {
        enabled: input.config.enabled,
        listenerState: listenerState(input.config.enabled, runtime?.lifecycle),
        listenHost: input.config.listenHost,
        listenPort: input.config.listenPort,
        savantClientConnected: runtime?.connected ?? false,
        configuredZoneCount: zones.size,
        retainedZoneCount: runtime?.retainedStates.length ?? 0,
        lastClientConnectedAt: runtime?.lastClientConnectedAt ?? null,
        lastClientDisconnectedAt: runtime?.lastClientDisconnectedAt ?? null,
        lastTransportError: runtime?.lastTransportError ? { ...runtime.lastTransportError } : null
      };
    }
  };
}

export async function virtualSecurityPanelStatusRoutes(app: FastifyInstance, provider: VirtualSecurityPanelStatusProvider) {
  app.get('/api/virtual-security-panel/status', async () => provider.getStatus());
}
