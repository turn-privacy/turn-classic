import { Blockfrost, getAddressDetails, Kupmios, Lucid, SLOT_CONFIG_NETWORK, UTxO } from "npm:@lucid-evolution/lucid";
import { OPERATOR_FEE, UNIFORM_OUTPUT_VALUE } from "../config/constants.ts";
import { Assets } from "../types/index.ts";

// Get environment variables
const operatorMnemonic = Deno.env.get("OPERATOR_MNEMONIC");

type NetworkConfig = {
  network: "LOCAL_TESTNET" | "PREVIEW_TESTNET" | "MAINNET";
  blockfrostApiKey?: string;
  adminPort?: string;
  kupoPort?: string;
  ogmiosPort?: string;
};

const getNetworkConfig = (): NetworkConfig => {
  const network = Deno.env.get("NETWORK");
  if (!network) {
    console.error("Error: NETWORK environment variable is not set");
    Deno.exit(1);
  }

  if (network === "LOCAL_TESTNET") {
    const config = {
      network: network as "LOCAL_TESTNET",
      adminPort: Deno.env.get("ADMIN_PORT"),
      kupoPort: Deno.env.get("KUPO_PORT"),
      ogmiosPort: Deno.env.get("OGMIOS_PORT"),
    };

    if (!config.adminPort || !config.kupoPort || !config.ogmiosPort) {
      console.error("Error: Required port environment variables are not set");
      Deno.exit(1);
    }

    return config;
  }

  const config = {
    network: network as "PREVIEW_TESTNET" | "MAINNET",
    blockfrostApiKey: Deno.env.get("BLOCKFROST_API_KEY"),
  };

  if (!config.blockfrostApiKey) {
    console.error("Error: BLOCKFROST_API_KEY environment variable is not set");
    Deno.exit(1);
  }

  return config;
};

// Check for required environment variables
if (!operatorMnemonic) {
  console.error("Error: OPERATOR_MNEMONIC environment variable is not set");
  console.error("Please configure the OPERATOR_MNEMONIC in your .env file");
  Deno.exit(1);
}

const networkConfig = getNetworkConfig();

const getLucid = async () => {
  if (networkConfig.network === "LOCAL_TESTNET") {
    console.log("Initializing Lucid for LOCAL_TESTNET");
    // Initialize Lucid
    const shelleyParams: any = await fetch(`http://localhost:${networkConfig.adminPort}/local-cluster/api/admin/devnet/genesis/shelley`).then((res) => res.json());

    const zeroTime = new Date(shelleyParams.systemStart).getTime();
    const slotLength = shelleyParams.slotLength * 1000; // in milliseconds

    // for a default devkit cluster, we can now configure time parameters
    SLOT_CONFIG_NETWORK["Custom"] = { zeroTime, slotLength, zeroSlot: 0 };

    const lucid = await Lucid(
      new Kupmios(
        `http://localhost:${networkConfig.kupoPort}`,
        `http://localhost:${networkConfig.ogmiosPort}`,
      ),
      "Custom",
    );
    return lucid;
  }
  console.log("Initializing Lucid for PREVIEW_TESTNET or MAINNET");

  if (!networkConfig.blockfrostApiKey) {
    console.error("Error: BLOCKFROST_API_KEY environment variable is expected but is not set");
    Deno.exit(1);
  }

  const lucid = await Lucid(
    // new Blockfrost(networkConfig.blockfrostApiKey),
    new Blockfrost("https://cardano-preview.blockfrost.io/api/v0", networkConfig.blockfrostApiKey ),
    networkConfig.network === "PREVIEW_TESTNET" ? "Preview" : "Mainnet",
  );
  return lucid;
};

export const lucid = await getLucid();
lucid.selectWallet.fromSeed(operatorMnemonic);

export const operator = {
  address: await lucid.wallet().address(),
};

export const getBalance = async (address: string, unit: string = "lovelace") => (await lucid.utxosAt(address)).reduce((acc, utxo) => acc + (utxo.assets[unit] ?? 0n), 0n);

export const selectUserUtxos = async (userAddress: string) => {
  try {
    // Ensure we're using the full address for Kupo
    const addressDetails = getAddressDetails(userAddress);
    // const utxos = await lucid.utxosAt(addressDetails.address.hex);
    const utxos = await lucid.utxosAt(userAddress);
    const aproxMinOutput = 1_000_000n; // don't want to run into issues with minUTXO
    const minimumInputValue = UNIFORM_OUTPUT_VALUE + aproxMinOutput + OPERATOR_FEE;

    const sumUtxos = (utxos: UTxO[]) => utxos.reduce((acc, utxo) => acc + utxo.assets.lovelace, 0n);
    const selectedUtxos: UTxO[] = [];

    for (const utxo of utxos) {
      selectedUtxos.push(utxo);
      if (sumUtxos(selectedUtxos) > minimumInputValue) {
        return selectedUtxos;
      }
    }

    throw new Error(`Insufficient funds at ${userAddress}`);
  } catch (error: unknown) {
    console.error("Error selecting UTXOs:", error);
    throw new Error(`Failed to select UTXOs for ${userAddress}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const mergeAssets = (a: Assets, b: Assets): Assets => {
  const assets = { ...a };
  for (const [key, value] of Object.entries(b)) {
    assets[key] = (assets[key] ?? 0n) + value;
  }

  for (const key of Object.keys(assets)) { // remove zeros
    if (assets[key] === 0n) {
      delete assets[key];
    }
  }

  return assets;
};

export const negateAssets = (assets: Assets): Assets => {
  const negated: Assets = {};
  for (const [key, value] of Object.entries(assets)) {
    negated[key] = -1n * value;
  }
  return negated;
};

export const calculateUserChange = (utxos: UTxO[]): Assets => { // what needs to be returned to the user as change?
  const b0: Assets = utxos.reduce((acc, utxo) => mergeAssets(acc, utxo.assets), {} as Assets); // balance (all assets owned) before tx
  const b1 = mergeAssets(mergeAssets(b0, negateAssets({ lovelace: OPERATOR_FEE })), negateAssets({ lovelace: UNIFORM_OUTPUT_VALUE })); // balance after tx
  return b1;
};
