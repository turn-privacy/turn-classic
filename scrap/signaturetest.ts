import { Emulator, Lucid, SignedMessage, fromText, generateSeedPhrase, getAddressDetails, verifyData } from "npm:@lucid-evolution/lucid";

const phrase = generateSeedPhrase();
const lucid = await Lucid(new Emulator([]), "Custom");
lucid.selectWallet.fromSeed(phrase);

const address = await lucid.wallet().address();
console.log("Address:", address);

const payload = fromText("Hello from Lucid!");
console.log("Payload:", payload);

const signedMessage : SignedMessage = await lucid.wallet().signMessage(address, payload);
console.log("Signed message:", signedMessage);

const addressDetails = getAddressDetails(address);
const hasSigned: boolean = verifyData(
    addressDetails.address.hex,
    addressDetails.paymentCredential!.hash,
    payload,
    signedMessage
);

console.log(hasSigned);