use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{OutputReference, Transaction}
use goldilocks/unlockconditions.{UnlockConditions}
use goldilocks/valid_after.{valid_after}

// Allow spending if 
// 1. lock period has expired AND the user has signed the transaction
// 2. the admin and the user have both signed the transaction

// I wonder if this could be done with a phase 1 script?

validator turn_queue_lock_no_rdmr(admin: VerificationKeyHash) {
  spend(
    datum: Option<UnlockConditions>,
    _redeemer: Data,
    _utxo: OutputReference,
    self: Transaction,
  ) {
    expect Some(unlock_conditions) = datum
    and {
      list.has(self.extra_signatories, unlock_conditions.owner),
      or {
        list.has(self.extra_signatories, admin),
        valid_after(self.validity_range, unlock_conditions.unlock_time),
      },
    }
  }

  else(_) {
    fail
  }
}
