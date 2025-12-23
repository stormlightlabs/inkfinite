{
  pkgs ? import <nixpkgs> { },
}:

pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs_20
    pnpm
  ];

  shellHook = ''
    # Unset Nix's compiler/linker overrides
    unset CC CXX AR LD RANLIB STRIP

    # Use macOS system SDK
    export SDKROOT="$(xcrun --show-sdk-path)"

    # Ensure system tools are prioritized
    export PATH="/usr/bin:$PATH"

    # Add cargo to PATH if installed
    if [ -f "$HOME/.cargo/env" ]; then
      source "$HOME/.cargo/env"
    fi

    echo "✓ Node.js: $(node --version)"
    echo "✓ pnpm: $(pnpm --version)"
    echo "✓ Rust: $(rustc --version 2>/dev/null || echo 'not found - install from rustup.rs')"
    echo "✓ SDK: $SDKROOT"
    echo ""
    echo "Ready for Tauri development!"
  '';
}
