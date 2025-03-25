use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{OutputReference, Transaction}
use goldilocks/unlockconditions.{UnlockConditions}
use goldilocks/valid_after.{valid_after}

// Allow spending if 
// 1. lock period has expired AND the user has signed the transaction
// 2. the admin and the user have both signed the transaction

pub type Action {
  CoinJoin
  Reclaim
}

validator turn_queue_lock(admin: VerificationKeyHash) {
  spend(
    datum: Option<UnlockConditions>,
    redeemer: Action,
    _utxo: OutputReference,
    self: Transaction,
  ) {
    expect Some(unlock_conditions) = datum
    when redeemer is {
      CoinJoin -> and {
          list.has(self.extra_signatories, unlock_conditions.owner),
          list.has(self.extra_signatories, admin),
        }
      Reclaim -> and {
          valid_after(self.validity_range, unlock_conditions.unlock_time),
          list.has(self.extra_signatories, unlock_conditions.owner),
        }
    }
  }

  else(_) {
    fail
  }
}
