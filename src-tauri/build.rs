fn main() {
    println!("cargo:rerun-if-changed=windows.manifest");
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(
        tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows.manifest")),
    ))
    .expect("Tauri build configuration failed");
}
