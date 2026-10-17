use anyhow::Result;
use console::style;
use cortex::config::paths::Paths;
use cortex_providers::endpoint_capabilities::read_probe_cache;
use std::fs;

/// The file `OpenAiProvider` seeds its `ProbeCache` from. One file, one
/// command: the cache is a single JSON document of negative conclusions with a
/// 30-day TTL, so "inspect" and "clear" are all the tooling it needs.
const CACHE_FILE: &str = "model_capabilities.json";

fn cache_path() -> std::path::PathBuf {
    Paths::in_config_dir(CACHE_FILE)
}

pub async fn handle_capability_cache(clear: bool) -> Result<()> {
    let path = cache_path();
    if clear {
        match fs::remove_file(&path) {
            Ok(()) => {
                println!("{} {}", style("Cleared").green().bold(), path.display());
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                println!("{} {}", style("Already empty").dim(), path.display());
            }
            Err(error) => {
                return Err(anyhow::anyhow!(
                    "Failed to remove {}: {error}",
                    path.display()
                ));
            }
        }
        return Ok(());
    }

    if !path.exists() {
        println!(
            "{} {}",
            style("No capability cache at").dim(),
            path.display()
        );
        println!(
            "Conclusions are recorded the first time an endpoint refuses a feature. \
             Clear with: cortex capability-cache --clear"
        );
        return Ok(());
    }

    let Some(cache) = read_probe_cache(&path) else {
        println!(
            "{} exists but is not valid JSON: {}",
            style("Cache file").yellow(),
            path.display()
        );
        println!("Clear it with: cortex capability-cache --clear");
        return Ok(());
    };

    println!("{} {}", style("Capability cache").bold(), path.display());
    println!("{}", serde_json::to_string_pretty(&cache)?);
    println!();
    println!("Clear with: cortex capability-cache --clear");
    Ok(())
}
