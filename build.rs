use std::path::Path;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=frontend/dist");
    if std::env::var("PROFILE").ok().as_deref() != Some("release") {
        return;
    }
    if Path::new("frontend/dist/index.html").exists() {
        return;
    }
    let npm_cmd = if cfg!(target_os = "windows") { "npm.cmd" } else { "npm" };
    let status = Command::new(npm_cmd)
        .args(["run", "build"])
        .current_dir("frontend")
        .status()
        .expect("npm run build in frontend/ (needed to embed UI in release)");
    assert!(status.success(), "frontend vite build failed");
}
