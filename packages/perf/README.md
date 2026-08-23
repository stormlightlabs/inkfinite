# @inkfinite/perf

Private TypeScript CLI for Inkfinite performance measurements.

From the repository root:

```sh
pnpm performance:capture
pnpm performance:process
pnpm performance:browser
pnpm performance:profile -- --filter 'transactions/commit/semantic-binding-heavy/100'
```

Run `pnpm --filter @inkfinite/perf build`, then use
`packages/perf/dist/cli.mjs --help` to inspect commands and options. The CLI uses
`@bomb.sh/args` for argument parsing and Clack with Chalk for human-readable
progress.
Its child measurement processes retain ordinary exit codes and stream their
output, so the same commands work in CI.
