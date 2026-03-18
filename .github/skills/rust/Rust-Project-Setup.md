---
name: rust-project-implementation
description: Implementing Rust CLI/TUI applications from specifications. Handles Cargo setup, module structure, dependency selection, error handling patterns, and system dependency documentation. Use when implementing a new Rust project from scratch or a detailed plan.
---

# Rust Project Implementation Skill

Implement Rust CLI/TUI applications following best practices for project structure, dependency management, error handling, and documentation.

## Core Principles

**Critical Rules:**
- Document system dependencies before implementation
- Use established crates for common tasks (don't reinvent)
- Prefer `Result` types with proper error handling
- Commit `Cargo.lock` for applications (not libraries)
- Validate incrementally with `cargo check` when possible
- Follow Rust API guidelines and conventions

## Workflow

Make a todo list for all the tasks in this workflow and work on them one after another.

### 1. Analyze Requirements

Read the specification, plan document, or requirements:

**Identify:**
- Application type (CLI tool, TUI app, daemon, service, library)
- Core functionality and features
- System-level operations (file I/O, network, audio, graphics, etc.)
- Platform targets (Linux-only, cross-platform, etc.)
- Performance requirements (real-time, async, concurrent, etc.)

**Determine module structure:**
- Configuration management
- State/domain models
- Business logic
- I/O operations
- External integrations
- UI/presentation
- Main orchestration

### 2. Identify System Dependencies

**CRITICAL: Document this before writing code**

Common Rust system dependencies by category:

**Audio:**
- ALSA: `libasound2-dev` (Debian) / `alsa-lib-devel` (Fedora) / `alsa-lib` (Arch)
- PulseAudio: `libpulse-dev`
- JACK: `libjack-dev`

**GUI/Graphics:**
- X11: `libx11-dev`, `libxtst-dev`, `libxcb-dev`
- Wayland: `libwayland-dev`
- OpenGL: `libgl1-mesa-dev`

**Networking/Crypto:**
- SSL/TLS: `libssl-dev`, `pkg-config`
- Modern crypto: Often pure Rust (ring, rustls)

**Databases:**
- PostgreSQL: `libpq-dev`
- MySQL: `libmysqlclient-dev`
- SQLite: `libsqlite3-dev`

**Compression:**
- zlib: `zlib1g-dev`
- bzip2: `libbz2-dev`
- lzma: `liblzma-dev`

**System utilities:**
- DBus: `libdbus-1-dev`
- systemd: `libsystemd-dev`

Document platform-specific install commands in README.

### 3. Create Cargo.toml

Set up project manifest with appropriate metadata and dependencies.

**Basic structure:**

```toml
[package]
name = "project-name"
version = "0.1.0"
edition = "2021"  # Use latest stable edition
authors = ["Author Name <email@example.com>"]
description = "Brief description"
license = "MIT"  # or MIT-OR-Apache-2.0, GPL-3.0, etc.
repository = "https://github.com/user/repo"
keywords = ["keyword1", "keyword2"]
categories = ["command-line-utilities"]

# For binary applications
[[bin]]
name = "binary-name"
path = "src/main.rs"

# For libraries, use:
# [lib]
# name = "library_name"
# path = "src/lib.rs"

[dependencies]
# Core dependencies here

[dev-dependencies]
# Testing dependencies here
```

**Dependency Selection Cheatsheet:**

| Need | Recommended Crate | Notes |
|------|-------------------|-------|
| Error handling (app) | `anyhow` | Flexible, ergonomic |
| Error handling (lib) | `thiserror` | Typed errors |
| CLI parsing | `clap` v4 | Feature-rich, derive API |
| TUI framework | `ratatui` | Modern, actively maintained |
| Terminal handling | `crossterm` | Cross-platform |
| Configuration | `serde` + `toml` | Standard approach |
| JSON | `serde_json` | Standard |
| Async runtime | `tokio` | Most popular, full-featured |
| HTTP client | `reqwest` | High-level, async |
| HTTP server | `axum` or `actix-web` | Modern frameworks |
| Logging | `tracing` | Structured logging |
| Date/Time | `chrono` | Comprehensive |
| Regex | `regex` | Standard |
| Random | `rand` | Standard |
| Audio | `cpal` | Cross-platform capture/playback |
| Keyboard/Mouse | `enigo` | Input simulation |
| Path expansion | `shellexpand` | Tilde expansion |

**Version specification:**
- Use `"1.0"` for stable APIs (allows patch updates)
- Use specific versions if you need exact behavior
- Avoid `"*"` - be explicit

### 4. Create Initial Project Structure

Create directory structure:

```bash
mkdir -p src
```

**Minimal `src/main.rs`:**

```rust
fn main() {
    println!("Hello, world!");
}
```

**OR for libraries, `src/lib.rs`:**

```rust
//! Library documentation here

pub fn example() {
    println!("Example function");
}
```

**Initial validation:**

```bash
cargo check
```

**If successful:** ✅ Proceed with implementation

**If fails due to system deps:** ⚠️ Document clearly, note code can't be validated until deps installed

**If fails due to code errors:** Fix them before proceeding

### 5. Implement Core Modules

Implement in dependency order (dependencies before dependents):

**Standard module pattern:**

```rust
// src/config.rs - Configuration module
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    // Configuration fields
}

impl Default for Config {
    fn default() -> Self {
        // Sensible defaults
    }
}

impl Config {
    pub fn load() -> Result<Self> {
        // Load from file, create default if missing
    }

    pub fn save(&self) -> Result<()> {
        // Save to file
    }

    fn validate(&self) -> Result<()> {
        // Validate configuration values
    }
}
```

**State machine pattern:**

```rust
// src/state.rs - Application state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppState {
    Idle,
    Processing,
    Complete,
    Error,
}

pub struct AppContext {
    pub state: AppState,
    // Other context fields
}

impl AppContext {
    pub fn new() -> Self {
        Self {
            state: AppState::Idle,
        }
    }

    pub fn transition(&mut self, new_state: AppState) {
        self.state = new_state;
    }
}
```

**Error handling pattern for libraries:**

```rust
// src/error.rs - Typed errors
use thiserror::Error;

#[derive(Error, Debug)]
pub enum MyError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),
}

pub type Result<T> = std::result::Result<T, MyError>;
```

**Module organization:**

```rust
// src/main.rs or src/lib.rs
mod config;
mod state;
mod error;
mod business_logic;
mod ui;

use anyhow::Result;
use config::Config;
use state::AppContext;

fn main() -> Result<()> {
    // Application entry point
    let config = Config::load()?;
    let mut app = AppContext::new();

    // Run application
    run(config, &mut app)?;

    Ok(())
}

fn run(config: Config, app: &mut AppContext) -> Result<()> {
    // Main logic
    Ok(())
}
```

### 6. Configuration System Pattern

**Standard configuration approach:**

**1. Config struct with serde:**

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub general: GeneralConfig,
    pub service: ServiceConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralConfig {
    pub log_level: String,
    pub data_dir: String,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            log_level: "info".to_string(),
            data_dir: "~/.local/share/myapp".to_string(),
        }
    }
}
```

**2. Create example config file:**

Location: `.config/<projectname>/config.toml.example`

```toml
# Example configuration file
# Copy to ~/.config/<projectname>/config.toml and customize

[general]
# Logging level: trace, debug, info, warn, error
log_level = "info"

# Data directory for application files
data_dir = "~/.local/share/myapp"

[service]
# Service-specific settings
host = "localhost"
port = 8080
```

**3. Config loading with validation:**

```rust
impl Config {
    pub fn load() -> Result<Self> {
        let config_path = Self::config_path()?;

        if !config_path.exists() {
            eprintln!("Config not found, creating default at {:?}", config_path);
            let config = Self::default();
            config.save()?;
            return Ok(config);
        }

        let content = fs::read_to_string(&config_path)
            .context("Failed to read config file")?;

        let mut config: Config = toml::from_str(&content)
            .context("Failed to parse config file")?;

        // Expand ~ in paths
        config.general.data_dir = shellexpand::tilde(&config.general.data_dir).to_string();

        config.validate()?;

        Ok(config)
    }

    fn config_path() -> Result<PathBuf> {
        let home = std::env::var("HOME")
            .context("HOME environment variable not set")?;
        Ok(PathBuf::from(home).join(".config/myapp/config.toml"))
    }

    fn validate(&self) -> Result<()> {
        // Validate configuration values
        if self.service.port == 0 {
            anyhow::bail!("Port must be non-zero");
        }
        Ok(())
    }
}
```

### 7. Async Patterns (if needed)

**When to use async:**
- Network I/O
- File I/O with many concurrent operations
- Multiple I/O sources (timers, sockets, etc.)

**When NOT to use async:**
- CPU-bound work
- Simple scripts
- When blocking is fine

**Basic async pattern with tokio:**

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
```

```rust
#[tokio::main]
async fn main() -> Result<()> {
    let config = Config::load()?;
    run(config).await?;
    Ok(())
}

async fn run(config: Config) -> Result<()> {
    // Async operations here
    Ok(())
}
```

### 8. TUI Pattern (if applicable)

**For terminal UI applications:**

```toml
[dependencies]
ratatui = "0.26"
crossterm = "0.27"
```

```rust
use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    widgets::{Block, Borders, Paragraph},
    Terminal,
};
use std::io;

fn main() -> Result<()> {
    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Run app
    let result = run_app(&mut terminal);

    // Restore terminal
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    result
}

fn run_app<B: ratatui::backend::Backend>(terminal: &mut Terminal<B>) -> Result<()> {
    loop {
        terminal.draw(|f| {
            let size = f.size();
            let block = Block::default().title("App").borders(Borders::ALL);
            let paragraph = Paragraph::new("Hello TUI").block(block);
            f.render_widget(paragraph, size);
        })?;

        if event::poll(std::time::Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                if key.code == KeyCode::Char('q') {
                    break;
                }
            }
        }
    }
    Ok(())
}
```

### 9. Build Validation

Attempt to build:

```bash
cargo check  # Fast, checks compilation
cargo build  # Full build
cargo build --release  # Optimized build
```

**Interpret results:**

**✅ Success:**
```
Compiling myproject v0.1.0
Finished dev [unoptimized + debuginfo] target(s) in 5.2s
```
→ Code is valid, continue

**⚠️ Missing system dependencies:**
```
error: failed to run custom build command for `alsa-sys v0.3.1`
...
The system library `alsa` required by crate `alsa-sys` was not found.
```
→ Expected, document in README, code structure is correct

**❌ Code errors:**
```
error[E0425]: cannot find value `x` in this scope
```
→ Fix the code errors, re-run `cargo check`

**Handle the build appropriately:**

```bash
# If build fails due to missing deps, clean up
cargo clean

# Document the requirement clearly
echo "Build requires: libasound2-dev libx11-dev" >> README.md
```

### 10. Testing Strategy

**Unit tests:**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_validation() {
        let config = Config::default();
        assert!(config.validate().is_ok());
    }
}
```

**Integration tests:**

Create `tests/integration_test.rs`:

```rust
use myproject::Config;

#[test]
fn test_full_workflow() {
    // Integration test here
}
```

**Run tests:**

```bash
cargo test
```

### 11. Documentation

**Code documentation:**

```rust
//! Module-level documentation
//!
//! Explain what this module does.

/// Brief description of function.
///
/// # Arguments
///
/// * `arg1` - Description
/// * `arg2` - Description
///
/// # Examples
///
/// ```
/// use myproject::example;
/// let result = example(42);
/// ```
///
/// # Errors
///
/// Returns error if...
pub fn example(arg1: i32) -> Result<String> {
    // Implementation
}
```

**Generate docs:**

```bash
cargo doc --open
```

### 12. README Documentation

Create comprehensive README with:

**Required sections:**

````markdown
# Project Name

Brief description and tagline.

## Features

- Feature 1
- Feature 2
- Feature 3

## Installation

### System Dependencies

**Ubuntu/Debian:**
```bash
sudo apt install libasound2-dev libx11-dev
```

**Fedora:**
```bash
sudo dnf install alsa-lib-devel libX11-devel
```

**Arch Linux:**
```bash
sudo pacman -S alsa-lib libx11
```

### Build from Source

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Clone and build
git clone https://github.com/user/project.git
cd project
cargo build --release

# Install
sudo cp target/release/myapp /usr/local/bin/
```

## Configuration

Create `~/.config/myapp/config.toml`:

```toml
# Configuration here
```

See `.config/myapp/config.toml.example` for all options.

## Usage

```bash
myapp [OPTIONS]
```

## Troubleshooting

### "System library not found"

Install the system dependencies listed above.

### Other common issues...

## License

MIT
````

## Common Patterns Reference

### Error Handling Decision Tree

```
Is this a library?
├─ Yes → Use thiserror for typed errors
│         Define error enum with all cases
│         Return Result<T, YourError>
│
└─ No (application) → Use anyhow
                      Return Result<T, anyhow::Error>
                      Use .context() for error context
```

### Dependency Decision Tree

```
Need configuration?
└─ Use serde + (toml | json | yaml)

Need CLI args?
└─ Use clap with derive feature

Need TUI?
└─ Use ratatui + crossterm

Need async?
├─ I/O bound → Use tokio
└─ CPU bound → Use rayon for parallelism

Need HTTP?
├─ Client → Use reqwest
└─ Server → Use axum or actix-web
```

### Cargo.lock Decision

```
What are you building?
├─ Application/Binary → Commit Cargo.lock ✅
│                        (Ensures reproducible builds)
│
└─ Library → Don't commit Cargo.lock ❌
             (Let downstream decide versions)
             Add to .gitignore
```

## Cargo Commands Reference

```bash
# Check compilation without building
cargo check

# Build debug version
cargo build

# Build optimized version
cargo build --release

# Run the application
cargo run

# Run with arguments
cargo run -- --arg1 value

# Run tests
cargo test

# Run specific test
cargo test test_name

# Generate and open documentation
cargo doc --open

# Check for outdated dependencies
cargo outdated  # Requires cargo-outdated

# Update dependencies
cargo update

# Clean build artifacts
cargo clean

# Format code
cargo fmt

# Lint code
cargo clippy
```

## Common Gotchas

### Gotcha 1: Cargo.lock confusion

**Problem:** Should I commit Cargo.lock?

**Solution:**
- Applications: YES
- Libraries: NO

### Gotcha 2: System dependency unknown until build

**Problem:** Build fails on missing system library

**Solution:**
- This is normal for system-dependent crates
- Document dependencies in README
- Note that code is correct, just needs deps
- Don't block on this if environment lacks deps

### Gotcha 3: Async complexity

**Problem:** Added tokio but everything got complicated

**Solution:**
- Ask: Do I really need async?
- Synchronous is simpler for many tasks
- Only use async for I/O-bound concurrent work

### Gotcha 4: Feature bloat in dependencies

**Problem:** Compile times are slow, binary is huge

**Solution:**
```toml
# Use minimal features
tokio = { version = "1", features = ["rt", "macros"] }
# Instead of
tokio = { version = "1", features = ["full"] }
```

### Gotcha 5: Path expansion

**Problem:** Config paths with `~` don't work

**Solution:**
```rust
// Use shellexpand
let path = shellexpand::tilde("~/.config/app/config.toml");
```

## Wrap Up

After implementation, provide summary:

**Rust Project Implementation Complete: <project-name>**

**Project Type:** [CLI / TUI / Library / Service]

**Module Structure:**
- `config.rs` - Configuration management
- `state.rs` - Application state
- [Other modules...]

**Dependencies:**
- Core: [list key crates]
- System: [list system libraries]

**Build Status:**
- ✅ Successfully compiled
  - OR -
- ⚠️ Requires system dependencies: [list packages]
  - Code structure verified correct
  - Will build once dependencies installed

**Features:**
- [Feature 1]
- [Feature 2]

**Configuration:**
- Format: TOML
- Location: `~/.config/<project>/config.toml`
- Example provided at: `.config/<project>/config.toml.example`

**Documentation:**
- README with installation and usage
- Inline code documentation
- Run `cargo doc --open` for API docs

**Next Steps:**
1. Install system dependencies (if needed)
2. Run `cargo build --release`
3. Test the application
4. Install to system path

**Notes:**
- [Platform-specific considerations]
- [Performance characteristics]
- [Known limitations]
