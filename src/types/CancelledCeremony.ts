export type CancelledCeremony = {
  reason: string;
  timestamp: number;
  transactionHash: string;
  ceremonyId: string;
};

export const cancelledCeremony = (reason: string, transactionHash: string, ceremonyId: string): CancelledCeremony => ({
  reason,
  timestamp: Date.now(),
  transactionHash,
  ceremonyId,
});

