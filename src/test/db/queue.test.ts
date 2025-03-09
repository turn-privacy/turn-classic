import { assertEquals } from "@std/assert";
import { getQueue, setQueue, addParticipant, removeParticipant } from "../../db/queue.ts";
import { Participant } from "../../types/index.ts";

// Mock KV store
class MockKv {
  private store = new Map<string, unknown>();

  async get(key: string[]) {
    return {
      value: this.store.get(key.join(":"))
    };
  }

  async set(key: string[], value: unknown) {
    this.store.set(key.join(":"), value);
    return { ok: true };
  }

  async *list(_options: { prefix: unknown[] }) {
    for (const key of this.store.keys()) {
      yield { key: key.split(":") };
    }
  }

  async delete(key: string[]) {
    this.store.delete(key.join(":"));
    return { ok: true };
  }
}

// Store the real openKv function
const realOpenKv = Deno.openKv;

// Helper to clear KV store
async function clearKvStore(kv: Deno.Kv) {
  const entries = kv.list({ prefix: [] });
  for await (const entry of entries) {
    await kv.delete(entry.key);
  }
}

Deno.test("Queue Operations", async (t) => {
  // Setup: Replace real KV with mock before each test
  const mockKv = new MockKv();
  Deno.openKv = () => Promise.resolve(mockKv as unknown as Deno.Kv);

  // Reset queue before tests
  await setQueue([]);

  await t.step("should start with empty queue", async () => {
    const queue = await getQueue();
    assertEquals(queue.length, 0);
  });

  await t.step("should add participant to queue", async () => {
    const participant: Participant = {
      address: "test_address",
      recipient: "test_recipient",
      signedMessage: {
        key: "test_key",
        signature: "test_signature"
      }
    };

    await addParticipant(participant);
    const queue = await getQueue();
    
    assertEquals(queue.length, 1);
    assertEquals(queue[0], participant);
  });

  await t.step("should remove participant from queue", async () => {
    const participant: Participant = {
      address: "test_address",
      recipient: "test_recipient",
      signedMessage: {
        key: "test_key",
        signature: "test_signature"
      }
    };

    // Clear the queue and add our test participant
    await setQueue([]);
    await addParticipant(participant);
    
    // Verify participant was added
    let queue = await getQueue();
    assertEquals(queue.length, 1, "Queue should have 1 participant before removal");
    assertEquals(queue[0].address, participant.address, "Queue should contain our test participant");
    
    // Remove the participant
    const removed = await removeParticipant(participant.address);
    assertEquals(removed, true, "removeParticipant should return true");
    
    // Verify queue is empty
    queue = await getQueue();
    assertEquals(queue.length, 0, "Queue should be empty after removal");
  });

  await t.step("should return false when removing non-existent participant", async () => {
    const removed = await removeParticipant("non_existent_address");
    assertEquals(removed, false);
  });

  await t.step("should prevent duplicate addresses in queue", async () => {
    // Clear the queue
    await setQueue([]);

    const participant1: Participant = {
      address: "test_address",
      recipient: "recipient1",
      signedMessage: {
        key: "test_key1",
        signature: "test_signature1"
      }
    };

    const participant2: Participant = {
      address: "test_address", // Same sending address
      recipient: "recipient2",
      signedMessage: {
        key: "test_key2",
        signature: "test_signature2"
      }
    };

    const participant3: Participant = {
      address: "different_address",
      recipient: "recipient1", // Same receiving address
      signedMessage: {
        key: "test_key3",
        signature: "test_signature3"
      }
    };

    await addParticipant(participant1);
    
    try {
      await addParticipant(participant2);
      throw new Error("Should have thrown error for duplicate sending address");
    } catch (e: unknown) {
      if (e instanceof Error) {
        assertEquals(e.message, "Address already in queue", "Should throw specific error for duplicate sending address");
      } else {
        throw new Error("Unexpected error type");
      }
    }

    try {
      await addParticipant(participant3);
      throw new Error("Should have thrown error for duplicate receiving address");
    } catch (e: unknown) {
      if (e instanceof Error) {
        assertEquals(e.message, "Receiving address already in queue", "Should throw specific error for duplicate receiving address");
      } else {
        throw new Error("Unexpected error type");
      }
    }

    // Verify only the first participant was added
    const queue = await getQueue();
    assertEquals(queue.length, 1, "Queue should only contain the first participant");
    assertEquals(queue[0], participant1, "Queue should contain the first participant unchanged");
  });

  await t.step("should maintain correct queue size with multiple operations", async () => {
    // Clear the queue
    await setQueue([]);

    const participants = [
      {
        address: "addr1",
        recipient: "recipient1",
        signedMessage: {
          key: "test_key1",
          signature: "test_signature1"
        }
      },
      {
        address: "addr2",
        recipient: "recipient2",
        signedMessage: {
          key: "test_key2",
          signature: "test_signature2"
        }
      }
    ];

    // Add participants
    await addParticipant(participants[0]);
    let queue = await getQueue();
    assertEquals(queue.length, 1, "Queue should have 1 participant after first add");

    await addParticipant(participants[1]);
    queue = await getQueue();
    assertEquals(queue.length, 2, "Queue should have 2 participants after second add");

    // Remove a participant
    await removeParticipant(participants[0].address);
    queue = await getQueue();
    assertEquals(queue.length, 1, "Queue should have 1 participant after removal");
    assertEquals(queue[0], participants[1], "Remaining participant should be the second one");
  });
});

// After all tests, restore the real openKv and clean up
Deno.test({
  name: "Cleanup",
  fn: async () => {
    // Restore the real openKv
    Deno.openKv = realOpenKv;
    
    // Clean up the real KV store
    const kv = await Deno.openKv();
    await clearKvStore(kv);
    kv.close();
  },
  sanitizeResources: false,
  sanitizeOps: false
}); 