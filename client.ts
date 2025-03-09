import { Emulator, fromText, generateSeedPhrase, Lucid, SignedMessage } from "npm:@lucid-evolution/lucid";

const ws = new WebSocket("ws://localhost:8081");

async function init_get_wallet_address(): Promise<[string, string]> {
    const emulator = new Emulator([]);
    const offlineLucid = await Lucid(emulator, "Preview");
    const seedPhrase = generateSeedPhrase();
    offlineLucid.selectWallet.fromSeed(seedPhrase);
    const address = await offlineLucid.wallet().address();
    return [address, seedPhrase];
}

const lucid = await Lucid(new Emulator([]), "Custom");
const [address, phrase] = await init_get_wallet_address();
lucid.selectWallet.fromSeed(phrase);
console.log("Address:", address);

const [recipientAddress, recipientPhrase] = await init_get_wallet_address();

const signup = async () => { 
    const payload = fromText(JSON.stringify({
        recipient: recipientAddress,
        extraMsg: "this is another field"
    }));

    const signedMessage: SignedMessage = await lucid.wallet().signMessage(address, payload);
    ws.send(JSON.stringify({
        type: "signup",
        address,
        signedMessage,
        payload
    }));
}

const faucet = () => {
    ws.send(JSON.stringify({
        type: "faucet",
        address,
    }));
}

const handleCommand = async (input: string) => {
    console.log("Command:", input);
    switch (input) {
        case "faucet":
            faucet();
            break;
        case "signup":
            await signup();
            break;
        default:
            console.log("Unknown command:", input);
            break;
    }
}

function readInput() {
    const buf = new Uint8Array(1024);
    Deno.stdin.read(buf).then(async (n) => {
        const input = new TextDecoder().decode(buf.subarray(0, n)).trim();
        await handleCommand(input);
        readInput();
    });
}

ws.onopen = () => {
    console.log("Connected to server.\n");
    readInput();
};

const signTransactionAndRespond = async (data: any) => {
    const {tx} = data;
    const witness : string = await lucid.fromTx(tx).partialSign.withWallet();
    ws.send(JSON.stringify({
        type: "submit_signature",
        data: {
            witness: witness,
            address: address,
        }
    }));
}

ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
        case "Marco!":
            console.log("sending heartbeat (Polo!)");
            ws.send(JSON.stringify({type: "Polo!"})); // heart beat
            break;
        case "failed_signup":
            console.log("%cFailed to sign up:", "color: red", msg.data);
            break;
        case "signup_ack":
            console.log("%cSigned up successfully:", "color: green", msg.data);
            break;
        case "show_participant_queue":
            console.log("%cParticipant queue:", "color: teal", msg.data);
            break;
        case "transactionReady":
            console.log("Transaction ready:", msg.data);
            await signTransactionAndRespond(msg.data);
            break;
        case "faucet_sent":
            console.log("%cYour account has been funded:", "color: lime", msg.data);
            break;
        case "signature_ack":
            console.log("%cSignature acknowledged:", "color: hotpink", msg.data);
            break;
        case "ceremonyConcluded":
            console.log(`%cCeremony concluded with transaction ${msg.data.tx}`, "color: purple", msg.data.msg);
            break;
        default:
            console.log("Unknown server message:", msg);
            break;
    }
}

ws.onerror = (err) => {
    console.error("WebSocket error:", err);
};

ws.onclose = () => {
    console.log("Disconnected from server.");
    Deno.exit(0);
};