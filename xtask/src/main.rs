use std::env;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;

use anyhow::{Context, Result, bail};
use clap::{CommandFactory, Parser, Subcommand};
use clap_complete::aot::{Bash, Fish, Generator, Zsh};
use clap_mangen::Man;
use inkfinite_cli::cli::{Cli, CompletionShell};
use sha2::{Digest, Sha256};

const CLI_BINARY_NAME: &str = "inkfinite";
const MCP_BINARY_NAME: &str = "inkfinite-mcp";
const RELEASE_VERSION: &str = env!("CARGO_PKG_VERSION");

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
    /// Build host release archives for the CLI and MCP server.
    Dist {
        /// Rust target triple. Defaults to CARGO_BUILD_TARGET or rustc's host.
        #[arg(long)]
        target: Option<String>,
    },
    /// Write or verify SHA256SUMS for release artifacts in dist/.
    Checksums {
        /// Verify the existing checksum file instead of replacing it.
        #[arg(long)]
        check: bool,
    },
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
        Task::Dist { target } => generate_distribution(target.as_deref()),
        Task::Checksums { check } => write_checksums(&workspace_root().join("dist"), check),
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

fn generate_distribution(requested_target: Option<&str>) -> Result<()> {
    let root = workspace_root();
    let target = release_target(requested_target)?;
    build_release_binaries(&root, &target)?;

    let distribution = root.join("dist");
    let staging = distribution.join(".staging");
    fs::create_dir_all(&staging).with_context(|| format!("could not create {}", staging.display()))?;

    let executable_suffix = if target.contains("windows") { ".exe" } else { "" };
    let release_dir = target_dir().join(&target).join("release");

    let cli_name = format!("inkfinite-cli-v{RELEASE_VERSION}-{target}");
    let cli_root = staging.join(&cli_name);
    if cli_root.exists() {
        fs::remove_dir_all(&cli_root).with_context(|| format!("could not remove {}", cli_root.display()))?;
    }
    copy_file(
        &release_dir.join(format!("{CLI_BINARY_NAME}{executable_suffix}")),
        &cli_root
            .join("bin")
            .join(format!("{CLI_BINARY_NAME}{executable_suffix}")),
    )?;
    generate_man(&cli_root.join("share/man/man1"))?;
    write_completion(
        CompletionShell::Bash,
        &cli_root.join("share/bash-completion/completions/inkfinite"),
    )?;
    write_completion(
        CompletionShell::Fish,
        &cli_root.join("share/fish/vendor_completions.d/inkfinite.fish"),
    )?;
    write_completion(
        CompletionShell::Zsh,
        &cli_root.join("share/zsh/site-functions/_inkfinite"),
    )?;
    copy_file(&root.join("LICENSE"), &cli_root.join("LICENSE"))?;
    copy_file(&root.join("README.md"), &cli_root.join("README.md"))?;
    archive_distribution(&distribution, &staging, &cli_name, target.contains("windows"))?;

    let mcp_name = format!("inkfinite-mcp-v{RELEASE_VERSION}-{target}");
    let mcp_root = staging.join(&mcp_name);
    if mcp_root.exists() {
        fs::remove_dir_all(&mcp_root).with_context(|| format!("could not remove {}", mcp_root.display()))?;
    }
    copy_file(
        &release_dir.join(format!("{MCP_BINARY_NAME}{executable_suffix}")),
        &mcp_root
            .join("bin")
            .join(format!("{MCP_BINARY_NAME}{executable_suffix}")),
    )?;
    copy_file(&root.join("LICENSE"), &mcp_root.join("LICENSE"))?;
    copy_file(&root.join("README.md"), &mcp_root.join("README.md"))?;
    archive_distribution(&distribution, &staging, &mcp_name, target.contains("windows"))?;

    fs::remove_dir_all(&staging).with_context(|| format!("could not remove {}", staging.display()))?;
    write_checksums(&distribution, false)?;
    println!("release artifacts written to {}", distribution.display());
    Ok(())
}

fn release_target(requested: Option<&str>) -> Result<String> {
    let target = if let Some(target) = requested {
        target.to_owned()
    } else if let Some(target) = env::var_os("CARGO_BUILD_TARGET") {
        target
            .into_string()
            .map_err(|_| anyhow::anyhow!("CARGO_BUILD_TARGET is not valid UTF-8"))?
    } else {
        let rustc = env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());
        let output = ProcessCommand::new(rustc)
            .arg("-vV")
            .output()
            .context("could not query the rustc host")?;
        if !output.status.success() {
            bail!("rustc -vV failed with {}", output.status);
        }
        String::from_utf8(output.stdout)
            .context("rustc -vV returned non-UTF-8 output")?
            .lines()
            .find_map(|line| line.strip_prefix("host: "))
            .context("rustc -vV did not report a host")?
            .to_owned()
    };
    if target.is_empty()
        || !target
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        bail!("invalid Rust target triple {target:?}");
    }
    if target.contains("windows") != cfg!(windows) {
        bail!("package Windows release archives on Windows and non-Windows archives on macOS or Linux");
    }
    Ok(target)
}

fn build_release_binaries(root: &Path, target: &str) -> Result<()> {
    let cargo = env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let status = ProcessCommand::new(cargo)
        .args([
            "build",
            "--locked",
            "--release",
            "--target",
            target,
            "-p",
            "inkfinite-cli",
            "--bin",
            CLI_BINARY_NAME,
            "-p",
            "inkfinite-mcp",
            "--bin",
            MCP_BINARY_NAME,
        ])
        .current_dir(root)
        .status()
        .context("could not start the release build")?;
    if !status.success() {
        bail!("release build failed with {status}");
    }
    Ok(())
}

fn copy_file(source: &Path, destination: &Path) -> Result<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).with_context(|| format!("could not create {}", parent.display()))?;
    }
    fs::copy(source, destination)
        .with_context(|| format!("could not copy {} to {}", source.display(), destination.display()))?;
    Ok(())
}

fn archive_distribution(distribution: &Path, staging: &Path, name: &str, windows: bool) -> Result<()> {
    let archive = distribution.join(if windows { format!("{name}.zip") } else { format!("{name}.tar.gz") });
    if archive.exists() {
        fs::remove_file(&archive).with_context(|| format!("could not remove {}", archive.display()))?;
    }
    let mut command = ProcessCommand::new("tar");
    if windows {
        command.args(["-a", "-cf"]);
    } else {
        command.arg("-czf");
    }
    let status = command
        .arg(&archive)
        .arg("-C")
        .arg(staging)
        .arg(name)
        .status()
        .context("could not start the archive command")?;
    if !status.success() {
        bail!("could not create {}: tar failed with {status}", archive.display());
    }
    println!("created {}", archive.display());
    Ok(())
}

fn write_checksums(distribution: &Path, check: bool) -> Result<()> {
    let mut artifacts = Vec::new();
    for entry in fs::read_dir(distribution).with_context(|| format!("could not read {}", distribution.display()))? {
        let path = entry
            .with_context(|| format!("could not read an entry in {}", distribution.display()))?
            .path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if path.is_file()
            && (name.ends_with(".tar.gz")
                || name.ends_with(".zip")
                || name.ends_with(".dmg")
                || name.ends_with(".AppImage")
                || name.ends_with(".deb")
                || name.ends_with(".msi")
                || name.ends_with(".exe"))
        {
            if !name.contains(&format!("v{RELEASE_VERSION}-")) {
                bail!(
                    "{} is not a version {RELEASE_VERSION} artifact; remove stale artifacts from dist",
                    path.display()
                );
            }
            artifacts.push(path);
        }
    }
    artifacts.sort();
    if artifacts.is_empty() {
        bail!("no release artifacts found in {}", distribution.display());
    }

    let mut rendered = String::new();
    for artifact in artifacts {
        let mut file = File::open(&artifact).with_context(|| format!("could not open {}", artifact.display()))?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = file
                .read(&mut buffer)
                .with_context(|| format!("could not read {}", artifact.display()))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        let digest = hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let name = artifact
            .file_name()
            .and_then(|name| name.to_str())
            .context("artifact name is not valid UTF-8")?;
        rendered.push_str(&format!("{digest}  {name}\n"));
    }

    let checksums = distribution.join("SHA256SUMS");
    if check {
        let existing =
            fs::read_to_string(&checksums).with_context(|| format!("could not read {}", checksums.display()))?;
        if existing != rendered {
            bail!("{} does not match the release artifacts", checksums.display());
        }
        println!("verified {}", checksums.display());
    } else {
        fs::write(&checksums, rendered).with_context(|| format!("could not write {}", checksums.display()))?;
        println!("wrote {}", checksums.display());
    }
    Ok(())
}

fn write_completion(shell: CompletionShell, output: &Path) -> Result<()> {
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).with_context(|| format!("could not create {}", parent.display()))?;
    }
    let mut command = Cli::command();
    command.set_bin_name(CLI_BINARY_NAME);
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
