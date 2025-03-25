use aiken/crypto.{VerificationKeyHash}

pub type UnlockConditions {
  owner: VerificationKeyHash,
  unlock_time: Int,
}
