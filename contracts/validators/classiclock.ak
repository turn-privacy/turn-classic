use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval
use cardano/transaction.{OutputReference, Transaction}

// Allow spending if 
// 1. lock period has expired AND the user has signed the transaction
// 2. the admin and the user have both signed the transaction

pub type Action {
  CoinJoin
  Reclaim
}

pub type UnlockConditions {
  owner: VerificationKeyHash,
  unlock_time: Int,
}

validator classiclock(admin: VerificationKeyHash) {
  spend(
    datum: Option<UnlockConditions>,
    redeemer: Action,
    _utxo: OutputReference,
    self: Transaction,
  ) {
    expect Some(unlock_conditions) = datum
    when redeemer is {
      CoinJoin -> and {
          list.has(self.extra_signatories, admin),
          list.has(self.extra_signatories, unlock_conditions.owner),
        }
      Reclaim -> and {
          interval.contains(self.validity_range, unlock_conditions.unlock_time),
          list.has(self.extra_signatories, unlock_conditions.owner),
        }
    }
  }

  else(_) {
    fail
  }
}
