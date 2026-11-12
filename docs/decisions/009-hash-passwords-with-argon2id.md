# 009. Hash passwords with Argon2id

- **Status**: accepted
- **Context**: [ADR 001](001-use-opaque-session-tokens.md) chose scrypt at N=2^15, below the OWASP recommendation. Node 24.7 added Argon2 to `node:crypto`, so the recommended algorithm needs no dependency.
- **Decision**: Hash new passwords with Argon2id at OWASP's minimum, 19 MiB of memory, 2 passes, and 1 lane, with the async API so hashing runs off the event loop. On a successful login, rehash a scrypt hash or an Argon2id hash with older parameters.
- **Consequences**:
  - Existing users move to Argon2id as they log in, with no migration or reset.
  - The scrypt check stays until no stored hash uses it.
  - Each login uses 19 MiB for about 20 ms, so size memory for concurrent logins.
