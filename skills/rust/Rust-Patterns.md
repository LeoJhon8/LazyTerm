---
name: Rust
description: Rust development patterns for video processing, trait abstractions, error handling, and Linux device interaction
---

# Rust Development Patterns

## Instructions

When helping users write Rust code, follow these guidelines:

1. **Trait Abstractions**: Use traits to define interfaces for swappable implementations (capture sources, output sinks, processing effects)

2. **Error Handling**:
   - Use `anyhow` for application/binary code (main, CLI, orchestration)
   - Use `thiserror` for library code that might be reused
   - Always use `Result` for fallible operations
   - Add context with `.context()` for better error messages

3. **CLI Pattern**: Use `clap` with derive macros for type-safe CLI argument parsing

4. **Logging**: Use `tracing` for structured logging with spans for performance measurement

5. **Module Organization**: Group related functionality in modules with clear public APIs via `mod.rs`

6. **Performance**: Measure frame timing, avoid allocations in hot loops, reuse buffers

7. **Linux Device I/O**: Direct file operations for v4l2 devices, proper color space conversion

8. **Edition**: Always use Rust 2021 edition

## Examples

### Example 1: Trait-Based Abstraction for Swappable Implementations

```
User: I need to support multiple camera backends (v4l2, nokhwa, test fixtures)

Claude: I'll create a trait abstraction that lets you swap implementations:

1. Define a CaptureSource trait with the core operations
2. Implement it for each backend (nokhwa, v4l, mock)
3. Use trait bounds in your pipeline function
4. This allows testing without real hardware

[Provides trait definition and multiple implementations from reference below]
```

### Example 2: Application vs Library Error Handling

```
User: Should I use anyhow or thiserror for my errors?

Claude: It depends on the context:

**Use anyhow when:**
- Writing application/binary code (main.rs, CLI)
- You want easy error context chaining
- Generic "something went wrong" is acceptable

**Use thiserror when:**
- Writing library code that others might use
- You need specific error types
- Callers need to match on error variants

[Provides examples of both patterns from reference below]
```

### Example 3: Frame Timing and Performance Monitoring

```
User: How do I measure frame processing performance?

Claude: I'll add timing instrumentation to your frame loop:

1. Use Instant::now() before/after each stage
2. Accumulate timings and log averages periodically
3. Calculate actual FPS from total processing time
4. Add tracing spans for detailed profiling

[Provides frame timing implementation from reference below]
```

### Example 4: v4l2 Device Output with Color Space Conversion

```
User: I need to output frames to a v4l2loopback virtual camera

Claude: I'll implement direct file writing with proper color conversion:

1. Open the v4l2 device file for writing
2. Convert RGB to YUYV (v4l2loopback's expected format)
3. Write raw frame data directly to the device
4. Handle frame resizing if needed

[Provides V4L2Output implementation from reference below]
```

---

# Reference Implementation Details

The sections below contain proven working code from the webcam-fx project.

## Project Structure

```
project/
├── Cargo.toml
├── src/
│   ├── main.rs              # Entry point, CLI, orchestration
│   ├── lib.rs               # (optional) Re-exports for library usage
│   ├── module_name/
│   │   ├── mod.rs           # Module public API, trait definitions
│   │   └── impl_name.rs     # Specific implementations
│   └── pipeline/
│       └── runner.rs        # Main processing loop
├── models/                   # Model files (git-ignored)
└── assets/                   # Static resources
```

## Cargo.toml Conventions

```toml
[package]
name = "webcam-fx"
version = "0.1.0"
edition = "2021"

[dependencies]
# Error handling
anyhow = "1.0"           # For application code
thiserror = "1.0"        # For library code

# CLI
clap = { version = "4.0", features = ["derive"] }

# Logging
tracing = "0.1"
tracing-subscriber = "0.3"

# Image processing
image = "0.25"

# Domain-specific
nokhwa = { version = "0.10", features = ["input-v4l"] }
v4l = "0.14"
```

## Trait-Based Abstractions

### Define Interface Traits

```rust
// src/capture/mod.rs
use anyhow::Result;
use image::RgbImage;

/// Trait for camera capture sources
/// Allows swapping between real cameras, test fixtures, file playback
pub trait CaptureSource {
    /// Capture a single frame
    fn capture_frame(&mut self) -> Result<RgbImage>;

    /// Get the resolution of captured frames
    fn resolution(&self) -> (u32, u32);
}
```

### Implement for Specific Backends

```rust
// src/capture/nokhwa_impl.rs
use super::CaptureSource;
use anyhow::{Context, Result};
use image::RgbImage;
use nokhwa::pixel_format::RgbFormat;
use nokhwa::utils::{CameraIndex, RequestedFormat, RequestedFormatType};
use nokhwa::Camera;

pub struct NokhwaCapture {
    camera: Camera,
    width: u32,
    height: u32,
}

impl NokhwaCapture {
    pub fn new(device_index: u32, width: u32, height: u32) -> Result<Self> {
        tracing::info!("Initializing camera {} at {}x{}", device_index, width, height);

        let index = CameraIndex::Index(device_index);
        let requested = RequestedFormat::new::<RgbFormat>(
            RequestedFormatType::AbsoluteHighestResolution
        );

        let mut camera = Camera::new(index, requested)
            .context("Failed to open camera")?;

        camera.open_stream()
            .context("Failed to open camera stream")?;

        Ok(Self { camera, width, height })
    }
}

impl CaptureSource for NokhwaCapture {
    fn capture_frame(&mut self) -> Result<RgbImage> {
        let frame = self.camera.frame()
            .context("Failed to capture frame")?;

        let decoded = frame.decode_image::<RgbFormat>()
            .context("Failed to decode frame")?;

        Ok(decoded)
    }

    fn resolution(&self) -> (u32, u32) {
        (self.width, self.height)
    }
}
```

### Use with Trait Bounds

```rust
// src/main.rs or src/pipeline/runner.rs
fn run_pipeline<C, O>(capture: &mut C, output: &mut O, target_fps: u32) -> Result<()>
where
    C: CaptureSource,
    O: OutputSink,
{
    let frame_duration = Duration::from_secs_f32(1.0 / target_fps as f32);

    loop {
        let frame = capture.capture_frame()?;
        output.write_frame(&frame)?;

        // Frame rate limiting
        std::thread::sleep(frame_duration);
    }
}
```

**Benefits:**
- Swap implementations without touching pipeline code
- Easy mocking for tests
- Clear interface contracts
- Type-safe at compile time

## Error Handling Patterns

### Application Code (anyhow)

```rust
use anyhow::{Context, Result};

fn main() -> Result<()> {
    let args = Args::parse();

    // Easy error context chaining
    let capture = WebcamCapture::new(args.input_device, args.width, args.height)
        .context("Failed to initialize webcam capture")?;

    let output = V4L2Output::new(&args.output_device, args.output_width, args.output_height)
        .context("Failed to initialize v4l2loopback output")?;

    run_pipeline(&capture, &output, args.fps)?;

    Ok(())
}
```

### Library Code (thiserror)

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CaptureError {
    #[error("device not found: {0}")]
    DeviceNotFound(String),

    #[error("failed to open device: {0}")]
    OpenFailed(#[from] std::io::Error),

    #[error("invalid resolution: {width}x{height}")]
    InvalidResolution { width: u32, height: u32 },

    #[error("capture timeout after {0}ms")]
    Timeout(u64),
}

pub fn open_device(path: &str) -> Result<Device, CaptureError> {
    // ... can return specific error variants
    Err(CaptureError::DeviceNotFound(path.to_string()))
}
```

## CLI Patterns with Clap

```rust
use clap::Parser;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Input webcam device index
    #[arg(short, long, default_value_t = 0)]
    input_device: u32,

    /// Output v4l2loopback device path
    #[arg(short, long, default_value = "/dev/video10")]
    output_device: String,

    /// Capture resolution width
    #[arg(long, default_value_t = 1920)]
    capture_width: u32,

    /// Capture resolution height
    #[arg(long, default_value_t = 1080)]
    capture_height: u32,

    /// Target frames per second
    #[arg(long, default_value_t = 30)]
    fps: u32,

    /// Enable debug logging
    #[arg(long)]
    debug: bool,
}

fn main() -> Result<()> {
    let args = Args::parse();

    // args is now a type-safe struct
    println!("Input device: {}", args.input_device);
    println!("FPS: {}", args.fps);

    // ...
}
```

**Key Features:**
- Type-safe argument parsing
- Automatic help generation
- Default values
- Short and long flags
- Validation at parse time

## Logging with Tracing

### Basic Setup

```rust
fn main() -> Result<()> {
    let args = Args::parse();

    // Initialize logging
    let log_level = if args.debug {
        tracing::Level::DEBUG
    } else {
        tracing::Level::INFO
    };

    tracing_subscriber::fmt()
        .with_max_level(log_level)
        .with_target(false)  // Hide module paths
        .init();

    tracing::info!("Application starting");
    tracing::debug!("Debug info: {:?}", some_value);

    // ...
}
```

### Performance Spans

```rust
fn process_frame(frame: &RgbImage) -> Result<Matte> {
    let _span = tracing::info_span!("preprocessing").entered();

    // Resize, normalize, etc.
    let preprocessed = resize_frame(frame)?;

    drop(_span);  // End preprocessing span

    let _span = tracing::info_span!("inference").entered();
    let matte = model.run(&preprocessed)?;

    Ok(matte)
}
```

### Structured Logging

```rust
tracing::info!(
    frame = frame_count,
    capture_ms = capture_time.as_secs_f64() * 1000.0,
    output_ms = output_time.as_secs_f64() * 1000.0,
    fps = actual_fps,
    "Frame processed"
);
```

## Frame Timing and Performance Monitoring

```rust
use std::time::{Duration, Instant};

fn run_pipeline<C, O>(capture: &mut C, output: &mut O, target_fps: u32) -> Result<()>
where
    C: CaptureSource,
    O: OutputSink,
{
    let frame_duration = Duration::from_secs_f32(1.0 / target_fps as f32);
    let mut frame_count = 0u64;
    let mut total_capture_time = Duration::ZERO;
    let mut total_output_time = Duration::ZERO;

    tracing::info!("Starting main pipeline loop");

    loop {
        let loop_start = Instant::now();

        // Measure capture time
        let capture_start = Instant::now();
        let frame = capture.capture_frame()
            .context("Failed to capture frame")?;
        total_capture_time += capture_start.elapsed();

        // Measure output time
        let output_start = Instant::now();
        output.write_frame(&frame)
            .context("Failed to write frame")?;
        total_output_time += output_start.elapsed();

        frame_count += 1;

        // Log stats every 30 frames
        if frame_count % 30 == 0 {
            let avg_capture_ms = total_capture_time.as_secs_f64() * 1000.0 / frame_count as f64;
            let avg_output_ms = total_output_time.as_secs_f64() * 1000.0 / frame_count as f64;
            let total_ms = avg_capture_ms + avg_output_ms;
            let actual_fps = 1000.0 / total_ms;

            tracing::info!(
                "Frame {}: capture={:.1}ms, output={:.1}ms, total={:.1}ms, fps={:.1}",
                frame_count, avg_capture_ms, avg_output_ms, total_ms, actual_fps
            );
        }

        // Frame rate limiting
        let elapsed = loop_start.elapsed();
        if elapsed < frame_duration {
            std::thread::sleep(frame_duration - elapsed);
        }
    }
}
```

**Key Techniques:**
- Accumulate timings across frames for accurate averages
- Log periodically (every 30 frames) to avoid log spam
- Calculate actual FPS from measured processing time
- Sleep only the remaining time in frame budget

## v4l2 Device Interaction

### Direct File Writing

```rust
use std::fs::File;
use std::io::Write;
use std::path::Path;

pub struct V4L2Output {
    file: File,
    width: u32,
    height: u32,
}

impl V4L2Output {
    pub fn new<P: AsRef<Path>>(device_path: P, width: u32, height: u32) -> Result<Self> {
        let path = device_path.as_ref();

        tracing::info!(
            "Opening v4l2loopback device at {} ({}x{})",
            path.display(), width, height
        );

        // Open device file for writing
        let file = File::options()
            .write(true)
            .open(path)
            .with_context(|| format!("Failed to open {}", path.display()))?;

        Ok(Self { file, width, height })
    }
}

impl OutputSink for V4L2Output {
    fn write_frame(&mut self, frame: &RgbImage) -> Result<()> {
        // Resize if needed
        let frame = if frame.dimensions() != (self.width, self.height) {
            image::imageops::resize(
                frame,
                self.width,
                self.height,
                image::imageops::FilterType::Lanczos3,
            )
        } else {
            frame.clone()
        };

        // Convert RGB to YUYV
        let yuyv_data = Self::rgb_to_yuyv(&frame);

        // Write directly to device
        self.file.write_all(&yuyv_data)
            .context("Failed to write frame to v4l2loopback device")?;

        Ok(())
    }

    fn resolution(&self) -> (u32, u32) {
        (self.width, self.height)
    }
}
```

### RGB to YUYV Color Space Conversion

```rust
/// Convert RGB frame to YUYV (YUV 4:2:2) format
/// v4l2loopback typically expects YUYV
fn rgb_to_yuyv(rgb_image: &RgbImage) -> Vec<u8> {
    let (width, height) = rgb_image.dimensions();
    let mut yuyv = Vec::with_capacity((width * height * 2) as usize);

    for y in 0..height {
        for x in (0..width).step_by(2) {
            let pixel1 = rgb_image.get_pixel(x, y);
            let pixel2 = if x + 1 < width {
                rgb_image.get_pixel(x + 1, y)
            } else {
                pixel1
            };

            // Convert RGB to YUV
            let (y1, u1, v1) = rgb_to_yuv(pixel1[0], pixel1[1], pixel1[2]);
            let (y2, u2, v2) = rgb_to_yuv(pixel2[0], pixel2[1], pixel2[2]);

            // Average U and V for the pair
            let u = ((u1 as u16 + u2 as u16) / 2) as u8;
            let v = ((v1 as u16 + v2 as u16) / 2) as u8;

            // YUYV format: Y0 U Y1 V
            yuyv.push(y1);
            yuyv.push(u);
            yuyv.push(y2);
            yuyv.push(v);
        }
    }

    yuyv
}

fn rgb_to_yuv(r: u8, g: u8, b: u8) -> (u8, u8, u8) {
    let r = r as f32;
    let g = g as f32;
    let b = b as f32;

    let y = (0.299 * r + 0.587 * g + 0.114 * b).clamp(0.0, 255.0) as u8;
    let u = ((-0.147 * r - 0.289 * g + 0.436 * b) + 128.0).clamp(0.0, 255.0) as u8;
    let v = ((0.615 * r - 0.515 * g - 0.100 * b) + 128.0).clamp(0.0, 255.0) as u8;

    (y, u, v)
}
```

**Key Points:**
- v4l2loopback accepts raw frame data written to the device file
- YUYV is the most common format (4:2:2 chroma subsampling)
- Process pixels in pairs for U/V averaging
- Use proper color space conversion formulas

## Common Dependencies

| Crate | Purpose | Notes |
|-------|---------|-------|
| `anyhow` | Application error handling | Use in main.rs, CLI code |
| `thiserror` | Library error types | Use in reusable modules |
| `clap` | CLI argument parsing | Use derive feature |
| `tracing` | Structured logging | Better than `log` crate |
| `tracing-subscriber` | Log output formatting | Required with tracing |
| `image` | Image manipulation | RGB/RGBA operations, resize |
| `nokhwa` | Webcam capture | Cross-platform camera access |
| `v4l` | Linux video devices | v4l2 bindings |
| `ndarray` | N-dimensional arrays | For ML tensor operations |
| `ort` | ONNX Runtime | GPU-accelerated inference |

## Best Practices

### Module Organization

```rust
// src/capture/mod.rs - Public API
mod v4l_capture;
mod nokhwa_capture;

pub use v4l_capture::V4LCapture;
pub use nokhwa_capture::NokhwaCapture;

pub trait CaptureSource {
    fn capture_frame(&mut self) -> Result<RgbImage>;
}
```

### Avoid Allocations in Hot Loops

```rust
// Bad: allocates every frame
loop {
    let mut buffer = vec![0u8; width * height * 3];
    capture.read_into(&mut buffer)?;
}

// Good: reuse buffer
let mut buffer = vec![0u8; width * height * 3];
loop {
    capture.read_into(&mut buffer)?;
}
```

### Use `?` for Error Propagation

```rust
// Good
fn process() -> Result<Output> {
    let data = load_data()?;
    let processed = transform(data)?;
    Ok(processed)
}

// Avoid
fn process() -> Result<Output> {
    match load_data() {
        Ok(data) => match transform(data) {
            Ok(processed) => Ok(processed),
            Err(e) => Err(e),
        },
        Err(e) => Err(e),
    }
}
```

### Use Type Aliases for Clarity

```rust
type Frame = RgbImage;
type Matte = Vec<f32>;
type Resolution = (u32, u32);

fn process_frame(frame: Frame) -> Result<Matte> {
    // ...
}
```

## Defensive Programming

These patterns leverage Rust's type system and compiler to prevent bugs at compile time rather than relying on runtime checks or comments like "this should never happen."

### Pattern Matching Over Indexing

**Problem:** Direct indexing can panic if assumptions about vector length are wrong.

```rust
// Wrong: coupling length check with indexing
fn get_first_device(devices: &[Device]) -> Option<&Device> {
    if !devices.is_empty() {
        Some(&devices[0])  // Can still panic if someone modifies the code wrong
    } else {
        None
    }
}

// Wrong: unchecked indexing with comment
fn process_pixels(data: &[u8]) -> u8 {
    // Assuming data always has at least 3 elements
    data[0]  // Panic if assumption is violated
}
```

**Solution:** Use pattern matching - compiler enforces safety across all code paths.

```rust
// Right: pattern matching guarantees safety
fn get_first_device(devices: &[Device]) -> Option<&Device> {
    match devices {
        [first, ..] => Some(first),
        [] => None,
    }
}

// Right: destructure in match
fn process_rgb_pixel(data: &[u8]) -> Result<(u8, u8, u8)> {
    match data {
        [r, g, b, ..] => Ok((*r, *g, *b)),
        _ => Err(anyhow!("Expected at least 3 bytes for RGB")),
    }
}

// Right: use iterator methods
fn get_first_device(devices: &[Device]) -> Option<&Device> {
    devices.first()
}
```

**Benefit:** Compiler enforces that all cases are handled. No hidden panic paths.

### Explicit Struct Construction

**Problem:** Using `..Default::default()` means you'll silently miss new fields added during refactoring.

```rust
#[derive(Default)]
struct CaptureConfig {
    width: u32,
    height: u32,
    fps: u32,
}

// Wrong: if someone adds a new field, this code won't know
fn create_config() -> CaptureConfig {
    CaptureConfig {
        width: 1920,
        height: 1080,
        ..Default::default()  // Silently uses defaults for any new fields
    }
}
```

**Solution:** Explicitly set all fields - compiler will error when fields are added.

```rust
// Right: compiler forces you to handle new fields
fn create_config() -> CaptureConfig {
    CaptureConfig {
        width: 1920,
        height: 1080,
        fps: 30,  // Must explicitly set every field
    }
}

// If someone adds a field later:
struct CaptureConfig {
    width: u32,
    height: u32,
    fps: u32,
    format: PixelFormat,  // New field added
}

// The compiler will error on create_config() above, forcing you to decide
// what value this field should have in this context
```

**Benefit:** Struct evolution causes compile errors where decisions are needed, not silent bugs.

### Exhaustive Destructuring in Trait Implementations

**Problem:** When implementing traits like `PartialEq`, referencing fields by name misses new fields.

```rust
struct Resolution {
    width: u32,
    height: u32,
}

// Wrong: if someone adds a field, this comparison is silently wrong
impl PartialEq for Resolution {
    fn eq(&self, other: &Self) -> bool {
        self.width == other.width && self.height == other.height
        // If someone adds `refresh_rate`, this won't compare it
    }
}
```

**Solution:** Destructure all fields explicitly - compiler catches new fields.

```rust
// Right: destructure forces handling of all fields
impl PartialEq for Resolution {
    fn eq(&self, other: &Self) -> bool {
        let Resolution { width, height } = self;
        let Resolution { width: other_width, height: other_height } = other;
        width == other_width && height == other_height
    }
}

// When someone adds a field:
struct Resolution {
    width: u32,
    height: u32,
    refresh_rate: u32,  // New field
}

// The destructuring above will fail to compile, forcing you to decide
// if refresh_rate should be compared
```

**Benefit:** Cannot accidentally skip fields in comparisons or other trait implementations.

### TryFrom Over From

**Problem:** The `From` trait is meant to be infallible, but sometimes conversions can fail.

```rust
// Wrong: From should never panic, but this one does
impl From<String> for Resolution {
    fn from(s: String) -> Self {
        let parts: Vec<&str> = s.split('x').collect();
        Resolution {
            width: parts[0].parse().unwrap(),   // Panics on invalid input
            height: parts[1].parse().unwrap(),  // Panics on invalid input
        }
    }
}

// Usage looks infallible but isn't
let res = Resolution::from("1920x1080".to_string());  // Works
let res = Resolution::from("invalid".to_string());    // PANIC!
```

**Solution:** Use `TryFrom` for fallible conversions.

```rust
// Right: TryFrom signals that conversion can fail
impl TryFrom<String> for Resolution {
    type Error = anyhow::Error;

    fn try_from(s: String) -> Result<Self> {
        let parts: Vec<&str> = s.split('x').collect();
        if parts.len() != 2 {
            anyhow::bail!("Expected format: WIDTHxHEIGHT");
        }

        let width = parts[0].parse()
            .context("Invalid width")?;
        let height = parts[1].parse()
            .context("Invalid height")?;

        Ok(Resolution { width, height })
    }
}

// Usage makes error handling explicit
let res = Resolution::try_from("1920x1080".to_string())?;
let res = Resolution::try_from("invalid".to_string())
    .context("Failed to parse resolution")?;
```

**Benefit:** Type system communicates whether operations can fail. No hidden panics.

### Exhaustive Pattern Matching

**Problem:** Catch-all patterns (`_`) hide when new enum variants are added.

```rust
enum DeviceState {
    Idle,
    Capturing,
    Processing,
}

// Wrong: if someone adds a new state, this code won't handle it
fn handle_state(state: DeviceState) {
    match state {
        DeviceState::Idle => start_capture(),
        _ => {}  // Silently ignores Capturing and Processing
                 // Will also silently ignore any new states added later
    }
}
```

**Solution:** Match all variants explicitly - compiler warns about new variants.

```rust
// Right: exhaustive matching
fn handle_state(state: DeviceState) {
    match state {
        DeviceState::Idle => start_capture(),
        DeviceState::Capturing => continue_capture(),
        DeviceState::Processing => wait_for_processing(),
    }
}

// When someone adds a variant:
enum DeviceState {
    Idle,
    Capturing,
    Processing,
    Error { message: String },  // New variant
}

// The compiler will error on handle_state() above:
// "non-exhaustive patterns: `Error { .. }` not covered"
```

**Alternative:** If you really want to handle some cases the same way, be explicit:

```rust
// Right: explicitly group cases, but compiler still checks exhaustiveness
fn should_display_indicator(state: &DeviceState) -> bool {
    match state {
        DeviceState::Idle => false,
        DeviceState::Capturing | DeviceState::Processing => true,
        DeviceState::Error { .. } => false,
    }
}
```

**Benefit:** Compiler forces you to consider new variants when they're added.

**Clippy Lint:** Enable `clippy::wildcard_enum_match_arm` to catch this automatically.

### Enums Over Boolean Parameters

**Problem:** Boolean parameters don't document their meaning at call sites.

```rust
// Wrong: what does 'true' mean here?
start_capture(device, true);
start_capture(device, false);

// Wrong: unclear function signature
fn start_capture(device: Device, wait: bool) {
    // ...
}
```

**Solution:** Use descriptive enums instead.

```rust
// Right: self-documenting
enum CaptureMode {
    Blocking,
    NonBlocking,
}

fn start_capture(device: Device, mode: CaptureMode) {
    match mode {
        CaptureMode::Blocking => {
            // Wait for first frame
        }
        CaptureMode::NonBlocking => {
            // Return immediately
        }
    }
}

// Usage is clear
start_capture(device, CaptureMode::Blocking);
start_capture(device, CaptureMode::NonBlocking);
```

**More Examples:**

```rust
// Wrong
fn resize_image(img: &Image, width: u32, height: u32, high_quality: bool);

// Right
enum ResizeQuality {
    Fast,
    HighQuality,
}
fn resize_image(img: &Image, width: u32, height: u32, quality: ResizeQuality);

// Wrong
fn connect(addr: &str, encrypted: bool, verify: bool);

// Right
enum Encryption { Enabled, Disabled }
enum CertificateVerification { Strict, Permissive }
fn connect(addr: &str, encryption: Encryption, verification: CertificateVerification);
```

**Benefit:** Code is self-documenting. Adding new modes is a breaking change (good!), not a silent behavior change.

### Temporary Mutability with Shadowing

**Problem:** Variables that should become immutable after initialization stay mutable.

```rust
// Wrong: data stays mutable even after initialization
fn process_config() -> Result<Config> {
    let mut config = Config::default();
    config.load_from_file("config.toml")?;
    config.apply_defaults();

    // config is still mutable here, but shouldn't be modified
    process_with_config(&config);  // Could accidentally modify
    Ok(config)
}
```

**Solution:** Shadow with immutable binding after initialization.

```rust
// Right: explicitly transition to immutable
fn process_config() -> Result<Config> {
    let mut config = Config::default();
    config.load_from_file("config.toml")?;
    config.apply_defaults();

    let config = config;  // Shadow with immutable binding

    // Compiler prevents accidental modification
    // config.field = value;  // ERROR: cannot assign to immutable variable
    process_with_config(&config);
    Ok(config)
}
```

**Benefit:** Makes mutation windows explicit and minimal. Prevents accidental modification.

### Must-Use Annotations

**Problem:** Important return values get accidentally ignored.

```rust
// Wrong: Result can be silently ignored
fn validate_config(config: &Config) -> Result<()> {
    // Validation logic
    Ok(())
}

// Oops, forgot to check the result
validate_config(&config);  // No warning if Result is ignored
start_capture();  // Proceeds even if validation failed
```

**Solution:** Use `#[must_use]` attribute to force handling.

```rust
// Right: compiler warns if Result is ignored
#[must_use = "validation must be checked before proceeding"]
fn validate_config(config: &Config) -> Result<()> {
    // Validation logic
    Ok(())
}

// Now this produces a compiler warning:
validate_config(&config);  // warning: unused `Result` that must be used

// Must explicitly handle
validate_config(&config)?;  // Right
let _ = validate_config(&config);  // Explicitly ignored (if intended)
```

**Common Uses:**

```rust
#[must_use = "frame must be written or dropped explicitly"]
fn capture_frame(&mut self) -> Result<Frame> {
    // ...
}

#[must_use = "lock must be held or explicitly dropped"]
fn lock(&self) -> MutexGuard<'_, T> {
    // ...
}

#[must_use]
struct FrameBuffer {
    // RAII resource that should not be created and dropped immediately
}
```

**Note:** `Result` and `Option` are already `#[must_use]` by default in Rust.

**Benefit:** Compiler prevents accidentally ignoring important values.

### Constructor Enforcement with Private Fields

**Problem:** Public fields allow invalid states to be constructed.

```rust
// Wrong: can create invalid resolution
pub struct Resolution {
    pub width: u32,
    pub height: u32,
}

// Can create 0x0 resolution, which makes no sense
let invalid = Resolution { width: 0, height: 0 };
```

**Solution:** Use private fields and validated constructor.

```rust
// Right: enforce validation through constructor
pub struct Resolution {
    width: u32,   // Private
    height: u32,  // Private
}

impl Resolution {
    pub fn new(width: u32, height: u32) -> Result<Self> {
        if width == 0 || height == 0 {
            anyhow::bail!("Resolution dimensions must be non-zero");
        }
        if width > 8192 || height > 8192 {
            anyhow::bail!("Resolution dimensions too large");
        }
        Ok(Self { width, height })
    }

    pub fn width(&self) -> u32 { self.width }
    pub fn height(&self) -> u32 { self.height }
}

// Can only create valid resolutions
let res = Resolution::new(1920, 1080)?;  // OK
let res = Resolution::new(0, 0)?;        // Error
```

**Benefit:** Invalid states become unrepresentable. Validation happens once at construction.

## Defensive Programming Tooling

### Clippy Lints for Defensive Patterns

Enable these in your `Cargo.toml` or `.clippy.toml`:

```toml
# Deny direct indexing
clippy::indexing_slicing = "deny"

# Warn on wildcard matches for enums
clippy::wildcard_enum_match_arm = "warn"

# Catch From impls that can panic
clippy::fallible_impl_from = "deny"

# Warn on wildcard imports
clippy::wildcard_imports = "warn"
```

Or use in specific files:

```rust
#![deny(clippy::indexing_slicing)]
#![deny(clippy::fallible_impl_from)]
#![warn(clippy::wildcard_enum_match_arm)]
```

### Running Clippy with Strict Lints

```bash
# Check with extra lints
cargo clippy -- -W clippy::pedantic -W clippy::nursery

# Fix automatically where possible
cargo clippy --fix -- -W clippy::pedantic

# Deny all warnings (useful in CI)
cargo clippy -- -D warnings
```

## Common Patterns

### Builder Pattern

```rust
pub struct PipelineBuilder {
    capture_device: u32,
    output_device: String,
    target_fps: u32,
}

impl PipelineBuilder {
    pub fn new() -> Self {
        Self {
            capture_device: 0,
            output_device: "/dev/video10".to_string(),
            target_fps: 30,
        }
    }

    pub fn capture_device(mut self, device: u32) -> Self {
        self.capture_device = device;
        self
    }

    pub fn target_fps(mut self, fps: u32) -> Self {
        self.target_fps = fps;
        self
    }

    pub fn build(self) -> Result<Pipeline> {
        Pipeline::new(self.capture_device, &self.output_device, self.target_fps)
    }
}

// Usage
let pipeline = PipelineBuilder::new()
    .capture_device(1)
    .target_fps(60)
    .build()?;
```

### State Machine with Enums

```rust
enum PipelineState {
    Idle,
    Running { frame_count: u64 },
    Paused { at_frame: u64 },
    Error { message: String },
}

impl Pipeline {
    fn process_frame(&mut self) -> Result<()> {
        match &mut self.state {
            PipelineState::Running { frame_count } => {
                // Process frame
                *frame_count += 1;
                Ok(())
            }
            PipelineState::Paused { .. } => {
                // Skip processing
                Ok(())
            }
            _ => Err(anyhow!("Cannot process frame in current state")),
        }
    }
}
```

## Performance Tips

1. **Profile before optimizing**: Use `cargo flamegraph` or `perf`
2. **Avoid clones in hot loops**: Use references or move semantics
3. **Prefer stack allocation**: Use arrays over Vec when size is known
4. **Use release builds for benchmarking**: `cargo build --release`
5. **Consider rayon for parallelism**: Easy data parallelism with iterators

## Testing Patterns

```rust
#[cfg(test)]
mod tests {
    use super::*;

    struct MockCapture {
        width: u32,
        height: u32,
    }

    impl CaptureSource for MockCapture {
        fn capture_frame(&mut self) -> Result<RgbImage> {
            Ok(RgbImage::new(self.width, self.height))
        }

        fn resolution(&self) -> (u32, u32) {
            (self.width, self.height)
        }
    }

    #[test]
    fn test_pipeline_with_mock() {
        let mut capture = MockCapture { width: 640, height: 480 };
        let frame = capture.capture_frame().unwrap();
        assert_eq!(frame.dimensions(), (640, 480));
    }
}
```

## Common Pitfalls

### Forgetting to Handle Errors

```rust
// Wrong
let frame = capture.capture_frame().unwrap();

// Right
let frame = capture.capture_frame()
    .context("Failed to capture frame")?;
```

### Not Using Result for Fallible Operations

```rust
// Wrong
fn load_config() -> Config {
    // What if file doesn't exist?
}

// Right
fn load_config() -> Result<Config> {
    let contents = std::fs::read_to_string("config.toml")
        .context("Failed to read config file")?;
    // ...
}
```

### Blocking in Async Context (and vice versa)

```rust
// If your pipeline is sync, stay sync
// If it's async, use async all the way through
// Don't mix unless you know what you're doing
```

## Resources

- [The Rust Book](https://doc.rust-lang.org/book/)
- [Rust by Example](https://doc.rust-lang.org/rust-by-example/)
- [Cargo Book](https://doc.rust-lang.org/cargo/)
- [docs.rs](https://docs.rs/) - Crate documentation
