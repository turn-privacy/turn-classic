use aiken/interval.{Finite, IntervalBound}
use cardano/transaction.{ValidityRange}

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
