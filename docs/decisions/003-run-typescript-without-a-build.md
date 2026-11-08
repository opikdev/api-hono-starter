# 003. Run TypeScript without a build

- **Status**: accepted
- **Context**: Node 26 runs TypeScript directly by stripping types. A build step adds a tool, an output folder, and a gap between the code you test and the code you run.
- **Decision**: Run `src/` directly in development and production, and use `tsc` only to check types.
- **Consequences**:
  - Dockerfiles and scripts are simpler, and stack traces match the source.
  - `erasableSyntaxOnly` bans `enum` and parameter properties.
  - Imports must include the `.ts` extension.
