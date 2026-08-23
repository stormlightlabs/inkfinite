//! Materializes the shared native performance corpus for process benchmarks.

use std::env;
use std::fs;
use std::path::PathBuf;

use inkfinite_core::performance::{cases, fixture};

fn main() {
    let mut arguments = env::args_os().skip(1);
    let output_dir = match arguments.next().as_deref() {
        Some(flag) if flag == "--output-dir" => arguments
            .next()
            .map(PathBuf::from)
            .unwrap_or_else(|| usage("--output-dir requires a path")),
        _ => usage("expected --output-dir PATH"),
    };
    if arguments.next().is_some() {
        usage("unexpected argument");
    }

    fs::create_dir_all(&output_dir)
        .unwrap_or_else(|error| panic!("could not create {}: {error}", output_dir.display()));
    let (seed, cases) = cases();
    for (profile, size) in cases {
        let generated = fixture(&profile, size, seed);
        let path = output_dir.join(format!("{}-{size}.inkfinite", profile.id));
        fs::write(&path, generated.bytes).unwrap_or_else(|error| panic!("could not write {}: {error}", path.display()));
        println!("{}\t{}\t{}", profile.id, size, path.display());
    }
}

fn usage(message: &str) -> ! {
    eprintln!("performance-fixture: {message}");
    eprintln!("usage: performance-fixture --output-dir PATH");
    std::process::exit(2);
}
