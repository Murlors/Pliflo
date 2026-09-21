// Release builds are desktop applications; keep the console for debug builds.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

fn main() {
    pliflo_lib::run();
}
