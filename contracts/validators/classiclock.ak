use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval.{Finite, IntervalBound}
use cardano/transaction.{OutputReference, Transaction, ValidityRange}

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

// function "valid_after" retreived from https://github.com/sidan-lab/vodka/blob/d1ad88d8f1f235cdb4a664327b942687cef8a247/lib/cocktail/vodka_validity_range.ak on March 24th 2025
pub fn valid_after(
  validity_range: ValidityRange,
  required_timestamp: Int,
) -> Bool {
  let IntervalBound { bound_type, is_inclusive } = validity_range.lower_bound
  when (bound_type, is_inclusive) is {
    (Finite(lower_bound), True) -> lower_bound > required_timestamp
    (Finite(lower_bound), False) -> lower_bound >= required_timestamp
    _ -> False
  }
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
          list.has(self.extra_signatories, unlock_conditions.owner),
          list.has(self.extra_signatories, admin),
        }
      Reclaim -> and {
          valid_after(self.validity_range, unlock_conditions.unlock_time),
          list.has(self.extra_signatories, unlock_conditions.owner),
          True,
        }
    }
  }

  else(_) {
    fail
  }
}
