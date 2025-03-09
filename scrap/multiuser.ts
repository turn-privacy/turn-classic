import { Assets, Emulator, fromText, generateSeedPhrase, Lucid, mintingPolicyToId, scriptFromNative, toText, TxBuilder, UTxO } from "npm:@lucid-evolution/lucid";

/*
    Simple simulation of a multi-user mixing ceremony. 
*/

async function init_get_wallet_address(): Promise<[string, string]> {
    const emulator = new Emulator([]);
    const offlineLucid = await Lucid(emulator, "Preview");
    const seedPhrase = generateSeedPhrase();
    offlineLucid.selectWallet.fromSeed(seedPhrase);
    const address = await offlineLucid.wallet().address();
    return [address, seedPhrase];
}

const createAsset = (nameEnglish: string): string => { // calculate the UNIT of an asset with a specific name
    const mintingPolicy = scriptFromNative(
        {
            type: "all",
            scripts: [],
        },
    );

    const policyId = mintingPolicyToId(mintingPolicy);
    const name = fromText(nameEnglish);
    const unit = policyId + name;
    return unit;
}

const [operatorAddr, operatorSeed] = await init_get_wallet_address();
const [aliceAddr, aliceSeed] = await init_get_wallet_address();
const [bobAddr, bobSeed] = await init_get_wallet_address();
const [charlieAddr, charlieSeed] = await init_get_wallet_address();

const [aliceReceiveAddr,] = await init_get_wallet_address();
const [bobReceiveAddr,] = await init_get_wallet_address();
const [charlieReceiveAddr,] = await init_get_wallet_address();

const people = [
    { name: "operator", address: operatorAddr },
    { name: "alice", address: aliceAddr },
    { name: "bob", address: bobAddr },
    { name: "charlie", address: charlieAddr }
]

const sillycoin = createAsset("sillycoin");
const dogcoin = createAsset("dogcoin");

const emulator = new Emulator(
    people.map((obj) => ({
        address: obj.address,
        assets: {
            lovelace: 1_500_000_000n,
            [createAsset(obj.name)]: 1n,
            [sillycoin]: 1n,
            [dogcoin]: 100n,
        },
    }))
);

const lucid = await Lucid(emulator, "Preview");
lucid.selectWallet.fromSeed(operatorSeed);

const getBalance = async (address: string, unit: string = 'lovelace') => (await lucid.utxosAt(address)).reduce((acc, utxo) => acc + (utxo.assets[unit] ?? 0n), 0n);

const outputSize = 5_000_000n; // how much ada does each user mix
const operatorFee = 5_000_000n;

const minute = 60 * 1000;

const selectUserUtxos = async (userAddress: string) => {
    const utxos = await lucid.utxosAt(userAddress);
    const aproxMinOutput = 1_000_000n;  // don't want to run into issues with minUTXO
    const minimumInputValue = outputSize + aproxMinOutput + operatorFee;

    const sumUtxos = (utxos: UTxO[]) => utxos.reduce((acc, utxo) => acc + utxo.assets.lovelace, 0n);
    const selectedUtxos: UTxO[] = [];

    for (const utxo of utxos) {
        selectedUtxos.push(utxo);
        if (sumUtxos(selectedUtxos) > minimumInputValue)
            return selectedUtxos;
    }

    throw new Error(`Insufficient funds at ${userAddress}`);
}

const operatorUtxos = await lucid.utxosAt(operatorAddr);
const aliceUtxos = await selectUserUtxos(aliceAddr);
const bobUtxos = await selectUserUtxos(bobAddr);
const charlieUtxos = await selectUserUtxos(charlieAddr);

const mergeAssets = (a: Assets, b: Assets): Assets => {
    const assets = { ...a };
    for (const [key, value] of Object.entries(b))
        assets[key] = (assets[key] ?? 0n) + value;

    for (const key of Object.keys(assets))  // remove zeros 
        if (assets[key] === 0n)
            delete assets[key];

    return assets;
}

const negateAssets = (assets: Assets): Assets => {
    const negated: Assets = {};
    for (const [key, value] of Object.entries(assets))
        negated[key] = -1n * value;
    return negated;
}

const calculateUserChange = (utxos: UTxO[]): Assets => { // what needs to be returned to the user as change?
    const b0: Assets = utxos.reduce((acc, utxo) => mergeAssets(acc, utxo.assets), {} as Assets);   // balance (all assets owned) before tx
    const b1 = mergeAssets(mergeAssets(b0, negateAssets({ lovelace: operatorFee })), negateAssets({ lovelace: outputSize })); // balance after tx
    return b1;
}

const aliceChange = calculateUserChange(aliceUtxos);
const bobChange = calculateUserChange(bobUtxos);
const charlieChange = calculateUserChange(charlieUtxos);

type StateTestRecord = {
    operator: Assets;
    alice: Assets;
    bob: Assets;
    charlie: Assets;
    aliceReceive: Assets;
    bobReceive: Assets;
    charlieReceive: Assets;
}

const makeStateTestRecord = async (): Promise<StateTestRecord> => {
    const allAssetsOf = async (address: string): Promise<Assets> => {
        const utxos = await lucid.utxosAt(address);
        return utxos.reduce((acc, utxo) => mergeAssets(acc, utxo.assets), {} as Assets);
    }
    return {
        operator: await allAssetsOf(operatorAddr),
        alice: await allAssetsOf(aliceAddr),
        bob: await allAssetsOf(bobAddr),
        charlie: await allAssetsOf(charlieAddr),
        aliceReceive: await allAssetsOf(aliceReceiveAddr),
        bobReceive: await allAssetsOf(bobReceiveAddr),
        charlieReceive: await allAssetsOf(charlieReceiveAddr),
    }
}

const displayStateTestRecord = (record: StateTestRecord) => {   // print table where rows are users and columns are assets
    const users = Object.keys(record);
    const allAssets: Assets = Object.values(record).reduce((acc, assets) => mergeAssets(acc, assets), {} as Assets);
    const assets = Object.keys(allAssets);
    const assetToEnglish = (asset: string) => asset === 'lovelace' ? asset : toText(asset.slice(56));
    console.log("\n");
    console.log("User".padEnd(16, '.'), ...(assets.map(assetToEnglish)).map(asset => asset.padEnd(16, '.')));
    users.forEach(user =>
        console.log(user.padEnd(16, ' '), ...(assets.map(asset => record[user as keyof StateTestRecord][asset] ?? 0n)).map(value => value.toString().padEnd(16, ' ')))
    );
    console.log("\n");
}

const stateBefore = await makeStateTestRecord();
displayStateTestRecord(stateBefore);

const tx = lucid
    .newTx()
    .collectFrom(operatorUtxos)
    .collectFrom(aliceUtxos)
    .collectFrom(bobUtxos)
    .collectFrom(charlieUtxos)
    .pay.ToAddress(aliceReceiveAddr, { lovelace: outputSize })      // mixer outputs
    .pay.ToAddress(bobReceiveAddr, { lovelace: outputSize })
    .pay.ToAddress(charlieReceiveAddr, { lovelace: outputSize })
    .pay.ToAddress(operatorAddr, { lovelace: operatorFee * 3n })    // operator fee
    .pay.ToAddress(aliceAddr, aliceChange)                          // change outputs
    .pay.ToAddress(bobAddr, bobChange)
    .pay.ToAddress(charlieAddr, charlieChange)
    .addSigner(operatorAddr)
    .addSigner(aliceAddr)
    .addSigner(bobAddr)
    .addSigner(charlieAddr)
    .validTo(emulator.now() + (15 * minute));


    
const completeTx = await tx.complete();

console.log("Transaction ID:", completeTx.toHash());

const rawUnsigned = completeTx.toCBOR();
const operatorWitness = await lucid.fromTx(rawUnsigned).partialSign.withWallet();

lucid.selectWallet.fromSeed(aliceSeed);
const aliceWitness = await lucid.fromTx(rawUnsigned).partialSign.withWallet();

lucid.selectWallet.fromSeed(bobSeed);
const bobWitness = await lucid.fromTx(rawUnsigned).partialSign.withWallet();

lucid.selectWallet.fromSeed(charlieSeed);
const charlieWitness = await lucid.fromTx(rawUnsigned).partialSign.withWallet();

const displayWitnesses = () => {
    console.log("\n");
    console.log("Operator Witness".padEnd(32, '.'), operatorWitness);
    console.log("Alice Witness".padEnd(32, '.'), aliceWitness);
    console.log("Bob Witness".padEnd(32, '.'), bobWitness);
    console.log("Charlie Witness".padEnd(32, '.'), charlieWitness);
    console.log("\n");
}

// displayWitnesses();

const assembled = completeTx.assemble([operatorWitness, aliceWitness, bobWitness, charlieWitness]);
const ready = await assembled.complete();

const submitted = await ready.submit();
emulator.awaitBlock(10);

console.log("Submitted ", submitted);
console.log("Block height: ", emulator.blockHeight);

const stateAfter = await makeStateTestRecord();
displayStateTestRecord(stateAfter);

const lovelaceCheck = (user: keyof StateTestRecord) => () => {
    const expected = stateBefore[user].lovelace;
    const actual : bigint = stateAfter[user].lovelace + stateAfter[`${user}Receive` as keyof StateTestRecord].lovelace + operatorFee;
    const delta = expected - actual;
    if (delta === 0n)
        return console.log(`%c${user}'s lovelace balance is correct`, "color: green");
    console.log(`%c${user}'s lovelace balance is incorrect (expected: ${expected}, actual: ${actual}, delta: ${delta})`, "color: red");
}

const otherAssetCheck = (assetName : string) => (user: keyof StateTestRecord) => () =>  stateAfter[user][assetName] === stateBefore[user][assetName] ? console.log(`%c${user}'s ${assetName} balance is correct (${stateBefore[user][assetName]})`, "color: green") : console.log(`%c${user}'s ${assetName} balance is incorrect`, "color: red");
const dogcoinCheck = otherAssetCheck(dogcoin);
const sillycoinCheck = otherAssetCheck(sillycoin);
const alicecoinCheck = otherAssetCheck(createAsset("alice"));
const bobcoinCheck = otherAssetCheck(createAsset("bob"));
const charliecoinCheck = otherAssetCheck(createAsset("charlie"));

const ValidityChecks = {
    lovelaceChecks: {
        alice: lovelaceCheck("alice"), 
        bob: lovelaceCheck("bob"),
        charlie: lovelaceCheck("charlie"),
        operator: () => { //  B_0 = B_1 + F_n - (F_o \cdot P)
            const expected = stateBefore.operator.lovelace;
            const actual = stateAfter.operator.lovelace + completeTx.toTransaction().body().fee() - (operatorFee * 3n);
            const delta = expected - actual;
            if (delta === 0n)
                return console.log(`%cOperator's lovelace balance is correct`, "color: green");
            console.log(`%cOperator's lovelace balance is incorrect (expected: ${expected}, actual: ${actual}, delta: ${delta})`, "color: red");
        },
        aliceReceiveAddr: () => stateAfter.aliceReceive.lovelace === outputSize ? console.log(`%cAlice's receive address balance is correct`, "color: green") : console.log(`%cAlice's receive address balance is incorrect`, "color: red"),
        bobReceiveAddr: () => stateAfter.bobReceive.lovelace === outputSize ? console.log(`%cBob's receive address balance is correct`, "color: green") : console.log(`%cBob's receive address balance is incorrect`, "color: red"),
        charlieReceiveAddr: () => stateAfter.charlieReceive.lovelace === outputSize ? console.log(`%cCharlie's receive address balance is correct`, "color: green") : console.log(`%cCharlie's receive address balance is incorrect`, "color: red"),
    },
    dogcoinChecks: {
        alice: dogcoinCheck("alice"),
        bob: dogcoinCheck("bob"),
        charlie: dogcoinCheck("charlie"),
        operator: dogcoinCheck("operator"),
    },
    sillycoinChecks: {
        alice: sillycoinCheck("alice"),
        bob: sillycoinCheck("bob"),
        charlie: sillycoinCheck("charlie"),
        operator: sillycoinCheck("operator"),
    },
    alicecoinChecks: {
        alice: alicecoinCheck("alice"),
        bob: alicecoinCheck("bob"),
        charlie: alicecoinCheck("charlie"),
        operator: alicecoinCheck("operator"),
    },
    bobcoinChecks: {
        alice: bobcoinCheck("alice"),
        bob: bobcoinCheck("bob"),
        charlie: bobcoinCheck("charlie"),
        operator: bobcoinCheck("operator"),
    },
    charliecoinChecks: {
        alice: charliecoinCheck("alice"),
        bob: charliecoinCheck("bob"),
        charlie: charliecoinCheck("charlie"),
        operator: charliecoinCheck("operator"),
    }

}

ValidityChecks.lovelaceChecks.alice()
ValidityChecks.lovelaceChecks.bob()
ValidityChecks.lovelaceChecks.charlie()
ValidityChecks.lovelaceChecks.operator()
ValidityChecks.lovelaceChecks.aliceReceiveAddr()
ValidityChecks.lovelaceChecks.bobReceiveAddr()
ValidityChecks.lovelaceChecks.charlieReceiveAddr()

ValidityChecks.dogcoinChecks.alice()
ValidityChecks.dogcoinChecks.bob()
ValidityChecks.dogcoinChecks.charlie()
ValidityChecks.dogcoinChecks.operator()

ValidityChecks.sillycoinChecks.alice()
ValidityChecks.sillycoinChecks.bob()
ValidityChecks.sillycoinChecks.charlie()
ValidityChecks.sillycoinChecks.operator()

ValidityChecks.alicecoinChecks.alice()
ValidityChecks.alicecoinChecks.bob()
ValidityChecks.alicecoinChecks.charlie()
ValidityChecks.alicecoinChecks.operator()

ValidityChecks.bobcoinChecks.alice()
ValidityChecks.bobcoinChecks.bob()
ValidityChecks.bobcoinChecks.charlie()
ValidityChecks.bobcoinChecks.operator()

ValidityChecks.charliecoinChecks.alice()
ValidityChecks.charliecoinChecks.bob()
ValidityChecks.charliecoinChecks.charlie()
ValidityChecks.charliecoinChecks.operator()


/*
    Todo: 
        - calculate operator change properly
*/
