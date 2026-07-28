## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## How it was verified

<!--
Real runs, not intentions. Command output, created IDs, screenshots — whatever proves it
works. "Ran the tests" is fine if you paste the result.
-->

## Checklist

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format` and `pnpm test` pass
- [ ] No placeholders: no stubs, no mocked third-party calls in shipped paths, no fake
      data in the UI, no buttons that do nothing
- [ ] New environment variables are documented in `.env.example` with where to obtain them
- [ ] State changes a firm might need to prove are written to the audit chain, in the same
      transaction as the change
- [ ] `plan.md` updated if this changes architecture or scope
- [ ] Database changes ship as a generated migration (`pnpm db:generate`), not an edit to
      one that already shipped
