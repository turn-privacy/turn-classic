export type BlacklistEntry = {
  timestamp: number;
  reason: string;
  id: string; // will later allow us to offer the user a chance to remove a blacklist entry by paying a fee (id prevents replay attacks/using one payment to remove self multiple times)
  cred: string; // credential of the participant who was blacklisted
};

export const blacklistEntry = (reason: string, cred: string): BlacklistEntry => {
  return {
    timestamp: Date.now(),
    reason,
    id: crypto.randomUUID(),
    cred,
  }
};