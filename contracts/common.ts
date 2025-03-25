import { Emulator, generateSeedPhrase, Lucid } from "npm:@lucid-evolution/lucid";

export async function init_get_wallet_address(): Promise<[string, string]> {
  const emulator = new Emulator([]);
  const offlineLucid = await Lucid(emulator, "Preview");
  const seedPhrase = generateSeedPhrase();
  offlineLucid.selectWallet.fromSeed(seedPhrase);
  const address = await offlineLucid.wallet().address();
  return [address, seedPhrase];
}

export type User = {
  address: string;
  seed: string;
};

export const makeUser = async (): Promise<User> => {
  const [address, seed] = await init_get_wallet_address();
  return { address, seed };
};

export const ONE_HOUR = 3_600_000;

// if function passed thows... don't throw, if it doesn't throw, throw
export const invertFailure = async (fn: () => Promise<void>) => {
  try {
    await fn();
  } catch {
    console.log("%cFunction threw which is expected and good", "color: yellow");
    return;
  }
  throw new Error("Function should have thrown");
};