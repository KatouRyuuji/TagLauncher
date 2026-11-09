// e2e 安全启动目标：只在自身旁写 <stem>.marker（工作目录与参数），然后退出。
#![windows_subsystem = "windows"]
use std::io::Write;

fn main() {
    let exe = std::env::current_exe().expect("current_exe");
    let marker = exe.with_extension("marker");
    let cwd = std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default();
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Ok(mut f) = std::fs::File::create(marker) {
        let _ = writeln!(f, "ran {}", exe.display());
        let _ = writeln!(f, "cwd={}", cwd);
        let _ = writeln!(f, "args={:?}", args);
    }
}
