# Contributing to Inkfinite

Inkfinite isn't accepting outside contributions right now. Pull requests from outside
Stormlight Labs will be closed. This guide is for the maintainers and the agents working
on the project.

## Set up

Follow [Building from source](apps/web/src/content/docs/development/building-from-source.md).

## Before you open a pull request

- Run `just check`. Run `just visual` too if the change affects the editor.
- Title commits and pull requests as [Conventional Commits](https://www.conventionalcommits.org/),
  such as `feat: add lasso selection`.
- Keep the description to what changed and why.

## Sign off your commits

Inkfinite uses the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO). Sign off each commit with `git commit -s`, or add missing sign-offs with
`git rebase --signoff main`. There's no contributor license agreement.

Only a person can sign off. Agents never add `Signed-off-by`; a maintainer signs off
on an agent's pull request when merging it.
