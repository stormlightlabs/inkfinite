# Release and distribution

Inkfinite uses one version for the Rust workspace, pnpm workspace, desktop app, web app, and generated packages. A release tag has the form `vX.Y.Z` and must point to the commit used for every artifact.

| Package          | Distribution                                    | Publication status                      |
| ---------------- | ----------------------------------------------- | --------------------------------------- |
| `inkfinite-core` | Rust library                                    | Public on crates.io                     |
| `inkfinite-cli`  | `inkfinite` application and Rust library        | Public on crates.io and GitHub Releases |
| `inkfinite-mcp`  | `inkfinite-mcp` application and Rust library    | Public on crates.io and GitHub Releases |
| `inkfinite-wasm` | Browser adapter built through `@inkfinite/wasm` | Workspace-only                          |
| `desktop`        | Tauri application backend                       | Workspace-only                          |
| `xtask`          | Maintainer release and generation commands      | Workspace-only                          |

Publish `inkfinite-core` first. Publish `inkfinite-cli` and `inkfinite-mcp` after crates.io has indexed that version. The CLI and MCP server remain independent packages because they have different dependencies, security models, users, and installation needs. A user can install either application without installing the other.

The pnpm packages, web application, and generated WebAssembly package are not part of this release procedure. They remain workspace packages. Web deployment has its own deployment process.

## Matrix

### Desktop

| Operating system | Target                     | Artifact                                                         |
| ---------------- | -------------------------- | ---------------------------------------------------------------- |
| macOS            | `universal-apple-darwin`   | Signed and notarized DMG containing Apple silicon and Intel code |
| Linux            | `x86_64-unknown-linux-gnu` | AppImage and Debian package built on Ubuntu 22.04                |
| Windows          | `x86_64-pc-windows-msvc`   | Signed NSIS installer and MSI package                            |

Build each desktop release on its target operating system. The Linux build host sets the minimum glibc baseline. Do not publish an unsigned macOS or Windows installer as a supported release artifact. The release does not include ARM Linux or ARM Windows desktop installers.

### CLI and MCP

Build both application archives for each target:

- `aarch64-apple-darwin`
- `x86_64-apple-darwin`
- `x86_64-unknown-linux-gnu`
- `aarch64-unknown-linux-gnu`
- `x86_64-pc-windows-msvc`

macOS and Linux archives use `.tar.gz`; Windows archives use `.zip`. CLI archives contain the `inkfinite` binary, man page, and Bash, Fish, and Zsh completions. MCP archives contain `inkfinite-mcp`. Both archives include the project README and license.

The release scripts name application archives as follows:

```text
inkfinite-cli-vX.Y.Z-TARGET.tar.gz
inkfinite-mcp-vX.Y.Z-TARGET.tar.gz
```

Windows uses the same names with `.zip`. Desktop artifacts use `Inkfinite-vX.Y.Z-TARGET` with the installer's native extension. `dist/SHA256SUMS` covers every release artifact in `dist/`.

## Local release commands

Check that all manifests and both changelogs use the workspace version:

```sh
pnpm release:check-version
```

Build CLI and MCP archives for the current Rust host, or specify one installed target:

```sh
cargo xtask dist
cargo xtask dist --target aarch64-apple-darwin
```

The command builds with `--locked`, writes both archives to `dist/`, and refreshes `dist/SHA256SUMS`. Build Windows archives on Windows. Build each Linux archive on a matching Linux host. macOS can build both macOS targets after they are installed with `rustup target add`.

Build desktop installers on the target operating system:

```sh
pnpm release:desktop --target universal-apple-darwin
pnpm release:desktop --target x86_64-unknown-linux-gnu
pnpm release:desktop --target x86_64-pc-windows-msvc
```

The desktop script chooses the installer formats from the target, copies the results to `dist/`, and refreshes the checksum file. Use `--no-sign` only for local installation tests. For a universal macOS build, install both Rust targets first:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

After collecting artifacts from every build host in one `dist/` directory, regenerate and verify the checksum file:

```sh
cargo xtask checksums
cargo xtask checksums --check
```

## Checklist

### 1. Prepare the version

1. Choose `X.Y.Z` according to semantic versioning.
2. Update the version in `Cargo.toml`, every `package.json`, `apps/desktop/src-tauri/Cargo.toml`, and `apps/desktop/src-tauri/tauri.conf.json`.
3. Update the `inkfinite-core` version in `[workspace.dependencies]`.
4. Add the release to `CHANGELOG.md` and `apps/web/src/content/docs/changelog.md`.
5. Run `pnpm release:check-version X.Y.Z`.
6. Update `Cargo.lock` and `pnpm-lock.yaml` if the version changes either lockfile.

### 2. Verify the source

Run the repository checks from a clean working tree:

```sh
cargo fmt --all -- --check
cargo test --workspace --all-features
cargo clippy --workspace --all-targets --all-features -- -D warnings
pnpm format:check
pnpm bindings:check
pnpm bindings:test
pnpm test
pnpm check
pnpm lint
```

Inspect the crates.io package contents and package the public root crate:

```sh
cargo package -p inkfinite-core --locked --list
cargo package -p inkfinite-core --locked
```

Before the first publication of a new core version, Cargo cannot package the dependent CLI and MCP packages against crates.io. Inspect their file lists locally:

```sh
cargo package -p inkfinite-cli --locked --list
cargo package -p inkfinite-mcp --locked --list
```

Package both applications after crates.io has indexed `inkfinite-core`:

```sh
cargo package -p inkfinite-cli --locked
cargo package -p inkfinite-mcp --locked
```

### 3. Build and test artifacts

1. Build every CLI and MCP target in the binary matrix.
2. Build every desktop target in the desktop matrix.
3. Sign and notarize the macOS DMG. Sign the Windows installers.
4. Collect all artifacts in one empty `dist/` directory.
5. Run `cargo xtask checksums` and `cargo xtask checksums --check`.
6. Extract each CLI and MCP archive on its target operating system.
7. Run `inkfinite --version`, `inkfinite capabilities --json`, and `inkfinite-mcp --version` from the extracted archives.
8. Install each desktop package on a clean virtual machine. Open the app, create a board, save it, close the app, reopen the board, and export SVG and PNG files.

### 4. Test clean installations

Test Cargo installation in a clean Rust 1.89 container or virtual machine after the packages are available on crates.io:

```sh
cargo install inkfinite-cli --version X.Y.Z --locked --bin inkfinite
cargo install inkfinite-mcp --version X.Y.Z --locked --bin inkfinite-mcp
inkfinite --version
inkfinite capabilities --json
inkfinite-mcp --version
```

Download each GitHub archive on a machine that does not have the repository or its build dependencies. Verify `SHA256SUMS`, extract the archive, and repeat the binary smoke tests. The released binaries must not require Node.js, pnpm, or a Rust toolchain.

### 5. Tag and publish

1. Commit the version and changelog changes.
2. Create the annotated tag `vX.Y.Z` on that commit and push it without moving any existing tag.
3. Create a draft GitHub release from the tag and use the matching changelog entry as its notes:

    ```sh
    gh release create vX.Y.Z --draft --verify-tag --title "Inkfinite X.Y.Z" --notes-file RELEASE_NOTES.md
    gh release upload vX.Y.Z dist/*
    ```

4. Confirm that every GitHub asset is present and that `SHA256SUMS` verifies the downloaded files.
5. Publish and index the Rust packages in order:

    ```sh
    cargo publish -p inkfinite-core --locked
    cargo search inkfinite-core
    cargo package -p inkfinite-cli --locked
    cargo package -p inkfinite-mcp --locked
    cargo publish -p inkfinite-cli --locked
    cargo publish -p inkfinite-mcp --locked
    ```

6. Repeat the clean Cargo installation checks against crates.io.
7. Publish the draft GitHub release.
8. Confirm the release page, crates.io pages, installation commands, desktop installers, and changelog links.
