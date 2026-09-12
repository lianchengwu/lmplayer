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
    let status = Command::new("npm")
        .args(["run", "build"])
        .current_dir("frontend")
        .status()
        .expect("npm run build in frontend/ (needed to embed UI in release)");
    assert!(status.success(), "frontend vite build failed");
}
