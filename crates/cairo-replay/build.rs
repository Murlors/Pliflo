fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        pkg_config::probe_library("fontconfig").expect("Fontconfig development files are required");
        pkg_config::Config::new()
            .atleast_version("1.56")
            .probe("pangoft2")
            .expect("Pango 1.56+ FreeType support is required");
    }
}
