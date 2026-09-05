import type { CapabilityResult, RiskAxisId, SignalId } from '../schema/report.v1.js';
import { SIGNAL_AXIS } from '../schema/report.v1.js';

export function isSignalSupported(signalId: SignalId, capabilities: CapabilityResult[]): boolean {
  return capabilities.some((capability) => capability.supportedSignals.includes(signalId));
}

export function axisHasSupportedSignals(axisId: RiskAxisId, capabilities: CapabilityResult[]): boolean {
  const axisSignals = (Object.entries(SIGNAL_AXIS) as Array<[SignalId, RiskAxisId]>)
    .filter(([, mappedAxis]) => mappedAxis === axisId)
    .map(([signal]) => signal);
  return capabilities.some((capability) => axisSignals.some((signal) => capability.supportedSignals.includes(signal)));
}
