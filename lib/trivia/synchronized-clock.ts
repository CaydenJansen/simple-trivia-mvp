// Use a monotonic client timer after synchronization so changing the phone's
// wall clock cannot prematurely submit answers or change points shown.
export function createSynchronizedClock(monotonicNow: () => number) {
  let epochAtSample: number | null = null
  let sampledAt = 0
  return {
    sample(serverEpoch: number, requestStarted: number, responseReceived: number) {
      if (!Number.isFinite(serverEpoch) || responseReceived < requestStarted) return
      epochAtSample = serverEpoch + (responseReceived - requestStarted) / 2
      sampledAt = responseReceived
    },
    now() { return epochAtSample === null ? null : epochAtSample + monotonicNow() - sampledAt },
  }
}
