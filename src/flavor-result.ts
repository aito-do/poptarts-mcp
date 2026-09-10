import { pickRandomFlavor } from "./flavors.js";
import { maybeSimulateLatency } from "./latency.js";

export type FlavorResult = {
  flavor: string;
  callNumber: number;
  delayed: boolean;
  sleepMs: number;
};

/** Shared path for MCP tool + plain GET: random flavor with alternating latency. */
export async function getRandomFlavorResult(): Promise<FlavorResult> {
  const latency = await maybeSimulateLatency();
  return {
    flavor: pickRandomFlavor(),
    callNumber: latency.callNumber,
    delayed: latency.delayed,
    sleepMs: latency.sleepMs,
  };
}
