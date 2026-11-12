# 007. Key rate limits by network and account

- **Status**: accepted
- **Context**: Keying limits by the exact client address lets one IPv6 subscriber, who usually holds a whole /64, rotate addresses for a fresh budget. A per-IP login limit also can't stop a password-guessing botnet spread over many addresses.
- **Decision**: Count IPv4 clients by address and IPv6 clients by /64, with IPv4-mapped addresses as IPv4. Also count failed logins per account, keyed by the SHA-256 of the lowercased email whether or not the account exists, and return 429 before checking the password once the limit is reached.
- **Consequences**:
  - One IPv6 subscriber gets one budget, and a botnet gets `LOGIN_FAILURE_LIMIT` guesses per account per window.
  - Clients behind one /64, such as a carrier-grade NAT, share a budget.
  - Anyone who knows an email can lock that account out of login for a window. The window is short, and the per-IP auth limit slows it down.
  - The limit never reveals whether an account exists, because unknown emails are counted and answered the same way.
  - Each attempt counts before the password check and a success takes its count back, so concurrent guesses can't overshoot the limit.
