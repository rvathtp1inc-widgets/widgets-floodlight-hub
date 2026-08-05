import { VirtualSecurityPanelConsumer } from '../virtualSecurityPanel/types.js';
import { createVirtualSecurityPanelAdapter, VirtualSecurityPanelAdapter } from './virtualSecurityPanelAdapter.js';

export async function initializeVirtualSecurityPanelRuntime(input: {
  consumer: VirtualSecurityPanelConsumer;
  configuredZoneNumbers: number[];
  registerAdapter: (adapter: VirtualSecurityPanelAdapter) => void;
}): Promise<number[]> {
  const configuredZones = [...new Set(input.configuredZoneNumbers)].sort((left, right) => left - right);
  for (const zoneNumber of configuredZones) {
    await input.consumer.setDesiredState({
      consumerBinding: { zoneNumber },
      desiredState: 'Normal',
      executionContext: { executionId: 'startup-seed' }
    });
  }
  await input.consumer.start();
  input.registerAdapter(createVirtualSecurityPanelAdapter(input.consumer));
  return configuredZones;
}
