//! Self-contained system font catalogs; no developer-machine fonts.conf dependency.
use anyhow::{ensure, Context, Result};
use pango::glib::translate::ToGlibPtr;
use std::{
    ffi::{c_int, c_void, CString},
    path::Path,
    sync::OnceLock,
};

#[cfg_attr(target_os = "macos", link(name = "fontconfig"))]
unsafe extern "C" {
    fn FcConfigCreate() -> *mut c_void;
    fn FcConfigDestroy(config: *mut c_void);
    fn FcConfigAppFontAddFile(config: *mut c_void, file: *const u8) -> c_int;
    fn FcConfigParseAndLoadFromMemory(
        config: *mut c_void,
        xml: *const u8,
        complain: c_int,
    ) -> c_int;
}
#[cfg(target_os = "macos")]
#[link(name = "CoreText", kind = "framework")]
unsafe extern "C" {
    fn CTFontManagerCopyAvailableFontURLs() -> *const c_void;
}
#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFArrayGetCount(array: *const c_void) -> isize;
    fn CFArrayGetValueAtIndex(array: *const c_void, index: isize) -> *const c_void;
    fn CFURLGetFileSystemRepresentation(
        url: *const c_void,
        resolve: u8,
        buffer: *mut u8,
        size: isize,
    ) -> u8;
    fn CFRelease(value: *const c_void);
}
#[cfg_attr(target_os = "macos", link(name = "pangoft2-1.0"))]
unsafe extern "C" {
    fn pango_fc_font_map_set_config(map: *mut pango::ffi::PangoFontMap, config: *mut c_void);
}

struct Config(std::ptr::NonNull<c_void>);
// 构造完成后只读。Fontconfig 的配置本来就可被多个 Pango map 引用；
// 文档字体只加入 map 的私有覆盖层，不会修改这个共享系统目录。
unsafe impl Send for Config {}
unsafe impl Sync for Config {}
impl Drop for Config {
    fn drop(&mut self) {
        // 句柄由 FcConfigCreate 创建；map 自持一个引用，此处释放调用者引用。
        unsafe { FcConfigDestroy(self.0.as_ptr()) };
    }
}

pub(crate) fn configure(map: &pango::FontMap, cache: &Path) -> Result<()> {
    static SYSTEM_FONTS: OnceLock<Result<Config, String>> = OnceLock::new();
    let config = SYSTEM_FONTS
        .get_or_init(|| system_fonts(cache).map_err(|error| format!("{error:#}")))
        .as_ref()
        .map_err(|error| anyhow::anyhow!(error.clone()))?;
    // Pango 增加引用计数，且不会修改共享配置；每个 map 的文档字体仍然独立。
    unsafe { pango_fc_font_map_set_config(map.to_glib_none().0, config.0.as_ptr()) };
    Ok(())
}

fn system_fonts(cache: &Path) -> Result<Config> {
    let config = Config(
        std::ptr::NonNull::new(unsafe { FcConfigCreate() })
            .context("Cannot create document font configuration")?,
    );
    let cache = cache
        .to_str()
        .context("Invalid font cache path")?
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    // 包含通用的合成样式规则，避免依赖构建机的 90-synthetic.conf。
    #[cfg(target_os = "macos")]
    let aliases = r#"<alias binding="same"><family>emoji</family><prefer><family>Apple Color Emoji</family></prefer></alias>"#;
    #[cfg(target_os = "windows")]
    let aliases = r#"
      <alias><family>sans-serif</family><prefer><family>Segoe UI</family><family>Microsoft YaHei</family></prefer></alias>
      <alias><family>serif</family><prefer><family>Times New Roman</family><family>SimSun</family></prefer></alias>
      <alias><family>monospace</family><prefer><family>Consolas</family><family>Microsoft YaHei</family></prefer></alias>
      <alias binding="same"><family>emoji</family><prefer><family>Segoe UI Emoji</family></prefer></alias>"#;
    let xml = CString::new(format!(
        r#"<fontconfig>
      <cachedir>{cache}</cachedir>
      <!-- Pango 使用 emoji 泛型选择彩色字形，不能回退到系统缺字占位字体。 -->
      {aliases}
      <match target="font">
        <test name="slant"><const>roman</const></test>
        <test target="pattern" name="slant" compare="not_eq"><const>roman</const></test>
        <edit name="matrix" mode="assign"><times><name>matrix</name><matrix><double>1</double><double>0.2</double><double>0</double><double>1</double></matrix></times></edit>
        <edit name="slant" mode="assign"><const>oblique</const></edit>
        <edit name="embeddedbitmap" mode="assign"><bool>false</bool></edit>
      </match>
      <match target="font">
        <test name="weight" compare="less_eq"><const>medium</const></test>
        <test target="pattern" name="weight" compare="more_eq"><const>bold</const></test>
        <edit name="embolden" mode="assign"><bool>true</bool></edit>
        <edit name="weight" mode="assign"><const>bold</const></edit>
      </match>
    </fontconfig>"#
    ))?;
    ensure!(
        unsafe { FcConfigParseAndLoadFromMemory(config.0.as_ptr(), xml.as_ptr().cast(), 1) } != 0,
        "Cannot configure PDF fonts"
    );
    load_system_fonts(&config)?;
    Ok(config)
}

#[cfg(target_os = "macos")]
fn load_system_fonts(config: &Config) -> Result<()> {
    // 由系统提供实际字体路径，覆盖不同 macOS 版本的私有目录和字体资源卷。
    // Copy 返回拥有的 CFArray；其中 URL 借用至数组释放，不修改系统注册状态。
    let urls = unsafe { CTFontManagerCopyAvailableFontURLs() };
    ensure!(!urls.is_null(), "Cannot enumerate system font files");
    let mut loaded = 0;
    for index in 0..unsafe { CFArrayGetCount(urls) } {
        let url = unsafe { CFArrayGetValueAtIndex(urls, index) };
        let mut path = [0_u8; 4096];
        if unsafe {
            CFURLGetFileSystemRepresentation(url, 1, path.as_mut_ptr(), path.len() as isize)
        } != 0
            && unsafe { FcConfigAppFontAddFile(config.0.as_ptr(), path.as_ptr()) } != 0
        {
            loaded += 1;
        }
    }
    unsafe { CFRelease(urls) };
    ensure!(loaded > 0, "Cannot load system font files");
    Ok(())
}

#[cfg(target_os = "windows")]
fn load_system_fonts(config: &Config) -> Result<()> {
    let windows = std::env::var_os("SystemRoot").context("Missing Windows system directory")?;
    let mut directories = vec![std::path::PathBuf::from(windows).join("Fonts")];
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        directories.push(std::path::PathBuf::from(local).join("Microsoft/Windows/Fonts"));
    }
    let mut loaded = 0;
    for directory in directories {
        if !directory.exists() {
            continue;
        }
        for entry in std::fs::read_dir(&directory)? {
            let path = entry?.path();
            if !path.is_file() {
                continue;
            }
            let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
                continue;
            };
            if !["ttf", "ttc", "otf", "otc"]
                .iter()
                .any(|value| extension.eq_ignore_ascii_case(value))
            {
                continue;
            }
            // Fontconfig's Windows API accepts UTF-8, not the ANSI code page.
            let path = CString::new(path.to_str().context("Invalid system font path")?)?;
            if unsafe { FcConfigAppFontAddFile(config.0.as_ptr(), path.as_ptr().cast()) } != 0 {
                loaded += 1;
            }
        }
    }
    ensure!(loaded > 0, "Cannot load Windows system fonts");
    Ok(())
}
