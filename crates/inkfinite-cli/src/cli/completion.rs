use clap::CommandFactory;
use clap_complete::aot::{Bash, Fish, Zsh, generate};

use super::support::map_output_error;
use super::{Cli, CompletionShell, Result, Write};

pub fn print_completions(shell: CompletionShell, stdout: &mut dyn Write) -> Result<()> {
    let mut command = Cli::command();
    let mut output = Vec::new();
    match shell {
        CompletionShell::Bash => generate(Bash, &mut command, "inkfinite", &mut output),
        CompletionShell::Fish => generate(Fish, &mut command, "inkfinite", &mut output),
        CompletionShell::Zsh => generate(Zsh, &mut command, "inkfinite", &mut output),
    }
    stdout.write_all(&output).map_err(map_output_error)
}
