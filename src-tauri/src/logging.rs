use std::time::{SystemTime, UNIX_EPOCH};

struct RusshLogBridge;

static RUSSH_LOGGER: RusshLogBridge = RusshLogBridge;

pub fn init() {
    if log::set_logger(&RUSSH_LOGGER).is_ok() {
        log::set_max_level(log::LevelFilter::Trace);
    }
}

fn format_time() -> String {
    let now = SystemTime::now();
    let duration = now.duration_since(UNIX_EPOCH).unwrap_or_default();

    // UTC+8 (北京时间) 偏移：8 小时 = 28800 秒
    let beijing_secs = duration.as_secs() + 8 * 3600;
    let millis = duration.subsec_millis();

    // 计算从 1970-01-01 到现在有多少天（北京时间）
    let days_since_epoch = beijing_secs / 86400;
    let secs_today = beijing_secs % 86400;

    // 计算年份（从 1970 开始）
    let mut year = 1970;
    let mut remaining_days = days_since_epoch;

    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year as u64 {
            break;
        }
        remaining_days -= days_in_year as u64;
        year += 1;
    }

    let (month, day) = day_of_year_to_month_day(remaining_days as usize + 1, is_leap_year(year));

    let hours = secs_today / 3600;
    let minutes = (secs_today % 3600) / 60;
    let seconds = secs_today % 60;

    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
        year, month, day, hours, minutes, seconds, millis
    )
}

fn is_leap_year(year: u32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

fn day_of_year_to_month_day(day_of_year: usize, is_leap: bool) -> (u32, u32) {
    let days_in_month = if is_leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut day = day_of_year;
    for (i, &days) in days_in_month.iter().enumerate() {
        if day <= days as usize {
            return ((i + 1) as u32, day as u32);
        }
        day -= days as usize;
    }

    (12, 31)
}

fn emit(level: &str, scope: &str, message: &str) {
    let line = format!("[{}][{}][{}] {}", format_time(), level, scope, message);
    match level {
        "WARN" | "ERROR" => eprintln!("{line}"),
        _ => println!("{line}"),
    }
}

pub fn info(scope: &str, message: impl AsRef<str>) {
    emit("INFO", scope, message.as_ref());
}

pub fn warn(scope: &str, message: impl AsRef<str>) {
    emit("WARN", scope, message.as_ref());
}

pub fn error(scope: &str, message: impl AsRef<str>) {
    emit("ERROR", scope, message.as_ref());
}

impl log::Log for RusshLogBridge {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.target().starts_with("russh::client") && metadata.level() <= log::Level::Trace
    }

    fn log(&self, record: &log::Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let message = record.args().to_string();
        if !is_relevant_russh_log(&message) {
            return;
        }

        let level = match record.level() {
            log::Level::Error => "ERROR",
            log::Level::Warn => "WARN",
            log::Level::Info => "INFO",
            log::Level::Debug | log::Level::Trace => "INFO",
        };
        let scope = format!("RUSSH/{}", record.target());
        emit(level, &scope, &message);
    }

    fn flush(&self) {}
}

fn is_relevant_russh_log(message: &str) -> bool {
    message.contains("keep alive")
        || message.contains("keepalive")
        || message.contains("global request")
        || message.contains("Global Request")
        || message.contains("channel_close")
        || message.contains("channel_eof")
        || message.contains("disconnected")
        || message.contains("Timeout, server not responding")
}
