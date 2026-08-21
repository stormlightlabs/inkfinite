use std::env;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;

use anyhow::{Context, Result, bail};
use clap::{CommandFactory, Parser, Subcommand};
use clap_complete::aot::{Bash, Fish, Generator, Zsh};
use clap_mangen::Man;
use inkfinite_cli::cli::{Cli, CompletionShell};

const BINARY_NAME: &str = "inkfinite";

#[derive(Debug, Parser)]
#[command(
    name = "cargo xtask",
    bin_name = "cargo xtask",
    about = "Inkfinite source distribution tasks"
)]
struct Xtask {
    #[command(subcommand)]
    command: Task,
}

#[derive(Debug, Subcommand)]
enum Task {
    /// Generate the Inkfinite man page.
    Man,
    /// Generate Bash, Fish, and Zsh completion scripts.
    Completions,
    /// Build a release binary with its man page and shell completions.
    Dist,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("cargo xtask: {error:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    match Xtask::parse().command {
        Task::Man => generate_man(&target_dir().join("man")),
        Task::Completions => generate_completions(&target_dir().join("completions")),
        Task::Dist => generate_distribution(),
    }
}

fn generate_man(output_dir: &Path) -> Result<()> {
    fs::create_dir_all(output_dir).with_context(|| format!("could not create {}", output_dir.display()))?;
    let output = output_dir.join("inkfinite.1");
    let mut file = File::create(&output).with_context(|| format!("could not create {}", output.display()))?;
    Man::new(Cli::command())
        .render(&mut file)
        .with_context(|| format!("could not write {}", output.display()))?;
    println!("generated {}", output.display());
    Ok(())
}

fn generate_completions(output_dir: &Path) -> Result<()> {
    fs::create_dir_all(output_dir).with_context(|| format!("could not create {}", output_dir.display()))?;
    for (shell, filename) in [
        (CompletionShell::Bash, "inkfinite.bash"),
        (CompletionShell::Fish, "inkfinite.fish"),
        (CompletionShell::Zsh, "_inkfinite"),
    ] {
        write_completion(shell, &output_dir.join(filename))?;
    }
    println!("generated completions in {}", output_dir.display());
    Ok(())
}

fn generate_distribution() -> Result<()> {
    let target = target_dir();
    build_release_binary(&workspace_root())?;

    let distribution = target.join("dist");
    if distribution.exists() {
        fs::remove_dir_all(&distribution).with_context(|| format!("could not remove {}", distribution.display()))?;
    }
    fs::create_dir_all(distribution.join("bin"))
        .with_context(|| format!("could not create {}", distribution.display()))?;

    let binary_name = if cfg!(windows) { "inkfinite.exe" } else { BINARY_NAME };
    let binary = target.join("release").join(binary_name);
    let installed_binary = distribution.join("bin").join(binary_name);
    fs::copy(&binary, &installed_binary).with_context(|| format!("could not copy {}", binary.display()))?;

    generate_man(&distribution.join("share/man/man1"))?;
    write_completion(
        CompletionShell::Bash,
        &distribution.join("share/bash-completion/completions/inkfinite"),
    )?;
    write_completion(
        CompletionShell::Fish,
        &distribution.join("share/fish/vendor_completions.d/inkfinite.fish"),
    )?;
    write_completion(
        CompletionShell::Zsh,
        &distribution.join("share/zsh/site-functions/_inkfinite"),
    )?;

    println!("distribution written to {}", distribution.display());
    Ok(())
}

fn build_release_binary(root: &Path) -> Result<()> {
    let cargo = env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let status = ProcessCommand::new(cargo)
        .args(["build", "--release", "-p", "inkfinite-cli", "--bin", BINARY_NAME])
        .current_dir(root)
        .status()
        .context("could not start the release build")?;
    if !status.success() {
        bail!("release build failed with {status}");
    }
    Ok(())
}

fn write_completion(shell: CompletionShell, output: &Path) -> Result<()> {
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).with_context(|| format!("could not create {}", parent.display()))?;
    }
    let mut command = Cli::command();
    command.set_bin_name(BINARY_NAME);
    command.build();
    let mut file = File::create(output).with_context(|| format!("could not create {}", output.display()))?;
    let result = match shell {
        CompletionShell::Bash => Bash.try_generate(&command, &mut file),
        CompletionShell::Fish => Fish.try_generate(&command, &mut file),
        CompletionShell::Zsh => Zsh.try_generate(&command, &mut file),
    };
    result.with_context(|| format!("could not write {}", output.display()))?;
    println!("generated {}", output.display());
    Ok(())
}

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask is inside the workspace")
        .to_path_buf()
}

fn target_dir() -> PathBuf {
    let root = workspace_root();
    let target = env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("target"));
    if target.is_absolute() { target } else { root.join(target) }
}
