use std::env;
use std::error::Error;
use std::fs;
use std::process::Command;
use std::time::Instant;

use inkfinite_crdt_proof::{DocumentPath, ProofDocument};

fn main() {
    if let Err(error) = run() {
        eprintln!("inkfinite-crdt-proof: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error + Send + Sync>> {
    let arguments: Vec<String> = env::args().skip(1).collect();
    match arguments.as_slice() {
        [command, input, output] if command == "import" => {
            let snapshot = serde_json::from_slice(&fs::read(input)?)?;
            let mut document = ProofDocument::from_snapshot(&snapshot, b"rust-import")?;
            fs::write(output, document.save())?;
        }
        [command, input, output] if command == "materialize" => {
            let bytes = fs::read(input)?;
            let mut document = ProofDocument::load(&bytes, b"rust-materialize")?;
            fs::write(output, serde_json::to_vec_pretty(&document.snapshot()?)?)?;
        }
        [command, input] if command == "benchmark" => benchmark(input)?,
        _ => {
            return Err(
                "usage: inkfinite-crdt-proof (import <json> <am>|materialize <am> <json>|benchmark <json>)"
                    .into(),
            );
        }
    }
    Ok(())
}

fn benchmark(input: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let source = fs::read(input)?;
    let snapshot = serde_json::from_slice(&source)?;
    let rss_before = resident_memory_bytes();

    let import_started = Instant::now();
    let mut document = ProofDocument::from_snapshot(&snapshot, b"rust-benchmark")?;
    let import_milliseconds = import_started.elapsed().as_secs_f64() * 1_000.0;
    let rss_after_import = resident_memory_bytes();

    let save_started = Instant::now();
    let saved = document.save();
    let save_milliseconds = save_started.elapsed().as_secs_f64() * 1_000.0;

    let load_started = Instant::now();
    let mut loaded = ProofDocument::load(&saved, b"rust-benchmark-load")?;
    let loaded_snapshot = loaded.snapshot()?;
    let load_milliseconds = load_started.elapsed().as_secs_f64() * 1_000.0;
    if loaded_snapshot != snapshot {
        return Err("benchmark round-trip changed the materialized snapshot".into());
    }

    let _initial_increment = loaded.save_incremental();
    let mut incremental_journal_bytes = 0;
    for index in 1..=100 {
        loaded.set_scalar(
            &DocumentPath::new(&["doc", "shapes", "shape:perf:00000", "x"]),
            &serde_json::json!(index),
            "storage growth",
        )?;
        incremental_journal_bytes += loaded.save_incremental().len();
    }
    let compacted_after_changes_bytes = loaded.save().len();

    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "importMilliseconds": import_milliseconds,
            "compactedAfter100ChangesBytes": compacted_after_changes_bytes,
            "incrementalJournal100ChangesBytes": incremental_journal_bytes,
            "loadMilliseconds": load_milliseconds,
            "memoryRssBeforeBytes": rss_before,
            "memoryRssAfterImportBytes": rss_after_import,
            "memoryRssDeltaBytes": rss_after_import.saturating_sub(rss_before),
            "saveMilliseconds": save_milliseconds,
            "sourceJsonBytes": source.len(),
            "storageBytes": saved.len()
        }))?
    );
    Ok(())
}

fn resident_memory_bytes() -> u64 {
    let process_id = std::process::id().to_string();
    Command::new("ps")
        .args(["-o", "rss=", "-p", &process_id])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|rss| rss.trim().parse::<u64>().ok())
        .map_or(0, |kilobytes| kilobytes * 1_024)
}
