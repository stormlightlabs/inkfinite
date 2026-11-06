# Contributing to Inkfinite

Thanks for helping. This page covers setup, the checks to run, and how to sign off
your commits.

## Set up

Follow [Building from source](apps/web/src/content/docs/development/building-from-source.md)
to install Node.js, pnpm, Rust, the WebAssembly target, `wasm-bindgen` and `just`.

For a larger change, open a GitHub issue first so we can agree on the approach.

## Before you open a pull request

Run the gate from the repository root:

```sh
just check
```

It checks Rust formatting, runs Clippy and the Rust tests, then runs the pnpm format,
type, lint and test commands. If your change affects the editor, also run the
Playwright visual tests and look at any changed baselines:

```sh
just visual
```

[Testing](apps/web/src/content/docs/development/testing.md) covers focused test
commands. [AGENTS.md](AGENTS.md) holds the code conventions.

Title commits and pull requests as [Conventional Commits](https://www.conventionalcommits.org/),
such as `feat: add lasso selection` or `fix: keep arrow bindings after undo`. Keep the
description to what changed and why.

## Sign off your commits

Inkfinite uses the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO). By signing off, you certify that you wrote the change, or otherwise have the
right to submit it under the project's license.

Add a sign-off to each commit with `-s`:

```sh
git commit -s -m "Add lasso selection"
```

That appends a line with the name and email from your git config:

```text
Signed-off-by: Your Name <you@example.com>
```

To add a missing sign-off to the commits on your branch:

```sh
git rebase --signoff main
```

Inkfinite doesn't use a contributor license agreement. You keep the copyright on
your contribution. Under section 5 of the [Apache License 2.0](LICENSE), it's licensed
to the project under the same terms as the rest of the code.

## AI-assisted and agent contributions

Only a person can sign off. If you used an AI assistant, you still sign off and you
answer for the whole change. Say which assistant you used in the pull request
description.

Coding agents that work on Inkfinite directly never add `Signed-off-by`. A maintainer
reviews each agent pull request and signs off on it when merging.
