# Pliflo

[English](README.md) | 简体中文

<p align="center">
  <img src="src-tauri/icons/pliflo.svg" width="112" alt="Pliflo 图标" />
</p>

Pliflo 是一款在本机处理文档的桌面批量打印工具，使用 Tauri 2、React、TypeScript 和 Vite+ 构建。导入多个文件后，可以统一预览、排序、设置打印参数，再将每个文档作为独立任务提交给系统。

目前发布版支持 **macOS**。Windows 11 x64 正在适配，已加入 MSVC 原生库打包、独立字体配置，以及 PDFium/GDI 提交、任务跟踪和取消代码；已完成 Microsoft Print to PDF 的首次提交、状态跟踪及取消验证；物理打印仍未验证，不能视为已支持的发布平台。提供 NSIS 安装包和免安装单 EXE：后者自动释放 DLL、启动应用，并在正常退出后清理，自解压会增加启动时间；仍需要系统 WebView2。构建环境、NSIS、WebView2 联网安装与待验证项目见 [Windows 开发与验证](WINDOWS.md)。文档不上传到服务器，应用不依赖云端转换服务。

下拉选择框使用统一的明暗主题样式，支持键盘导航、输入定位及选中标记。

Windows 开发版会将缺失文件单独标为失败，并对预览占用的临时文件做有限次数清理重试。免安装版采用更快的解压方式，完整第三方声明保存在 `third-party.zip` 中；实测数据及限制见 [Windows 验证记录](WINDOWS.md)。

Windows 转换已去除每份文档重复创建但未使用的原生字体映射，并在每页编码后释放 Canvas 记录资源。Markdown 长段落、引用、代码块和超高表格行支持跨页；无法解析或加密的 PDF 单独标为失败。合成文档回归与连续批次内存实测见 [WINDOWS.md](WINDOWS.md)，WebView2 的瞬时内存峰值仍需继续优化。

Markdown 本地图片支持 Windows 路径分隔符和 URL 编码文件名，段落内的图片也会保留；远程图片仍不加载。

## 下载与安装

在 [GitHub Releases](https://github.com/Murlors/Pliflo/releases) 下载对应平台的文件：

| Mac 类型      | 下载文件                    |
| ------------- | --------------------------- |
| Apple Silicon | 文件名以 `aarch64.dmg` 结尾 |
| Intel         | 文件名以 `x64.dmg` 结尾     |

Windows 11 x64 实验版提供 `x64-setup.exe` 安装器和 `x64-portable.exe` 免安装启动程序，均未签名。缺少 WebView2 时安装器需要联网下载；免安装版要求系统已有 WebView2。物理打印机和纯净系统安装仍待验证，不能视为正式支持。

打开 DMG，将 Pliflo 拖入“应用程序”。使用前先在 macOS 中配置打印机。

v1.3.0 的两种架构发布包均声明最低 macOS 15.0；其他版本请以对应发布说明为准。本地构建可能因原生依赖版本不同而要求更新的系统。未配置正式签名时，构建使用临时签名且未经 Apple 公证，首次打开可能出现 Gatekeeper 提示。

## 主要功能

- 通过文件选择或拖放导入文档，搜索和调整批次顺序。
- 使用统一的可打印 PDF 预览原始 PDF 和转换后的文档。
- 修改整个批次的默认设置，或单独覆盖某个文件。
- 配置份数、页码范围、纸张、方向、单双面、颜色、缩放、每张页数、逆序和奇偶页。
- 仅在打印机报告相应能力时显示纸盒、质量等选项。
- 提交前逐文件核对实际设置；已提交任务的设置保持只读。
- 每个文档对应独立系统任务，分别跟踪排队、提交、打印中、完成、取消和失败状态。
- 从队列移除文件不会删除原文件。失败任务可以批量重新入队，重新入队不自动打印。
- 保存本地历史、查看提交设置与系统原因，并可恢复未完成批次。
- 支持简体中文、英文，以及跟随系统、浅色和深色主题。

## 支持的格式与边界

| 格式                                | 本地处理方式                                         |
| ----------------------------------- | ---------------------------------------------------- |
| PDF                                 | 直接使用原文件                                       |
| DOCX                                | 通过 `@silurus/ooxml` 解析和分页，生成临时 PDF       |
| PPTX                                | 通过 `@silurus/ooxml` 渲染幻灯片，保留幻灯片页面尺寸 |
| XLSX                                | 支持可见工作表选择，以及适应纸宽或 100% 比例分页     |
| Markdown                            | 使用 `marked` 和轻量分页样式渲染                     |
| PNG / JPG / JPEG / WebP / GIF / BMP | 按适应纸张或实际大小生成页面                         |

非 PDF 文件使用以下链路：

```text
源文档 → WebView 排版 → Canvas 指令记录 → Rust Cairo/Pango
       → 临时 PDF → 预览、设置、队列 → macOS/CUPS
```

支持的文字和矢量内容会保留在 PDF 中，不是把整页转成图片。页面与嵌入的 PNG 图片通过二进制 IPC 逐页传输并写入临时目录；文档按顺序准备，过期结果会丢弃，恢复批次时从原文件重新生成临时产物。原生取消在页面之间检查，不支持的 Canvas 操作会明确报错。

XLSX 采用已用区域和缩放模型，支持纵向分页，100% 模式还会按完整列横向分页；单列超过纸宽时明确报错，请改用适应纸宽。此模型**不等同于完整 Excel 打印引擎**，不保证还原打印区域、重复标题及全部页面布局功能。图片缺少可靠物理尺寸信息时，实际大小按 96 DPI 计算。Markdown 不下载远程图片，可以读取本地相对路径图片。

应用不附带字体。缺失字体的回退可能影响中文排版、字重或换行；请检查生成的 PDF，不承诺与 Word、WPS、Excel 像素级一致。

## 打印状态与安全

macOS 打印使用 `lp`、`lpstat`、`lpoptions` 和系统 libcups。提交成功只表示系统接受任务，界面的完成状态依据操作系统报告，不能独立证明纸张已实际输出。

离线状态优先展示；CUPS 可能提供缓存状态或通用缺纸原因。系统未报告具体纸盒时，应用不会推断纸盒编号。开发和自动验证不得提交真实打印任务，实际设备试打需要单独明确授权。

## 本地开发

需要 macOS、Rust 1.92+、Bun 1.4+、Tauri 2 系统开发环境，以及与 CPU 架构匹配的 Cairo/Pango。CI 使用的 Bun 版本见 `package.json` 和发布工作流。

```bash
brew install pkgconf cairo pango
bun install --frozen-lockfile
vp run desktop:dev
```

从仓库根目录安装和运行，共用根目录 `bun.lock` 与 `Cargo.lock`。项目任务统一使用 `vp run <任务名>`，包括桌面打包；如果 PATH 中没有 `vp`，使用 `bun x --no-install vp run <任务名>` 调用已安装的项目版本。Bun 仍负责依赖安装和构建脚本执行。`vp run dev` 只启动前端，不能代替提供文件和打印功能的 Tauri 桌面环境。

常用本地检查：

```bash
vp run check
vp run build
vp run test:protocol
vp run check:native
vp run test:native
vp run fmt:native
git diff --check
```

文档渲染回归使用实际浏览器代码与 Rust 渲染器，但替换 IPC 传输，不会调用打印命令：

```bash
brew install poppler
bunx --no-install playwright-core install chromium
vp run test:rendering /absolute/path/report.docx /absolute/path/slides.pptx /absolute/path/workbook.xlsx
# 可选：将 Chromium CPU 分析结果写入生成 PDF 所在目录
PLIFLO_RENDER_PROFILE=1 vp run test:rendering /absolute/path/workbook.xlsx
# 可选：WebKit 回归；CPU 分析仅支持 Chromium
bunx --no-install playwright-core install webkit
PLIFLO_RENDER_BROWSER=webkit vp run test:rendering /absolute/path/report.docx
```

使用合成或已授权的本地样本，不提交私人文档。测试报告区分总耗时、原生进程耗时和记录数据量；它不能替代打包应用的 WKWebView 验证，也不是原生 Tauri IPC 性能基准。检查文本提取、页数和页面尺寸后，仍应查看实际 PDF。

每个渲染会话在 PDF 旁保存 `report.json`、`pdfinfo.txt`、`extracted.txt` 和 `fonts.txt`（请求字体与原生实际选字），并核对生成 PDF 的实际页数与准备结果。Playwright WebKit 是额外的浏览器检查，不等于打包后的 Tauri WKWebView。

DOCX 内嵌 OpenType 字体在每次转换中仅以二进制传输一次。渲染器使用会话独立的字体映射和 FreeType PDF 文字输出，并保留系统字体回退选择，不会全局安装文档字体。FreeType 无法使用的系统字体保留该次 Canvas 文字调用的原生排版，对应的 PDF 文本提取限制仍然适用。需要带 FreeType/Fontconfig 支持的 Pango 1.56+。字体资源适配测试：`vp test run src/lib/document-fonts.test.ts`。

## 构建与发布

```bash
# 生成 App 和 DMG
vp run desktop:build
# 仅生成本地 App
vp run desktop:build --app-only
```

输出位于 `src-tauri/target/release/bundle/`。脚本会收集实际链接的原生动态库、对构建副本剥离符号、改写库路径并验证完整签名。临时副本在恢复原始可执行文件后清理，原生库清单保存在 `src-tauri/target/native-bundle-manifest.json`。

最低 macOS 版本由可执行文件与动态库共同决定，不设置固定版本门禁。不要通过修改版本声明假装支持旧系统，也不要用裸 `tauri build` 替代带原生库打包步骤的脚本。Bun/Node 是构建工具，不随应用附带。

自动 CI 仅在推送 `v*` 标签时构建发布；普通分支提交和 PR 不触发检查。发布时保留前端检查、协议测试、Release 模式原生测试和签名验证，成功后仅上传两种架构的 DMG。没有 Rust 构建缓存读写或后台预热任务。

`APPLE_SIGNING_IDENTITY` 可指定签名身份，默认临时签名不等于 Developer ID 签名或 Apple 公证。公开发布标题、说明及标签注释使用英文，Commit 使用中文 Conventional Commit。版本发布步骤见 [贡献指南](CONTRIBUTING.md)。

## 结构与依赖归属

| 路径                        | 职责                                                |
| --------------------------- | --------------------------------------------------- |
| `src/`                      | React 界面、文档布局、设置与生命周期                |
| `src-tauri/src/`            | Tauri IPC、PDF 会话、打印机与系统任务               |
| `packages/canvas-recorder/` | 无运行时依赖的 TypeScript Canvas 记录器与 CCP1 协议 |
| `crates/cairo-replay/`      | Rust Cairo/Pango 渲染、字体处理与命令行入口         |
| `compat/ooxml/`             | 经过版本和哈希校验的 XLSX 几何扩展                  |
| `scripts/`                  | 打包、OOXML 构建副本与渲染验证                      |

OOXML 仅由应用负责，记录器和渲染器不重复引入文档解析器。Vite 是 Vite Plus 核心的别名，构建/测试工具不作为 Node 运行时打包进应用。锁文件包数量和本机缓存大小不等于安装包大小。

OOXML 0.87.0 的未使用渲染 Worker 被排除，解析 Worker/WASM 保留；升级时需核对这些别名和 XLSX 扩展。不能直接删掉 Homebrew Cairo 链接的 X11 库来缩小安装包。

## 常见问题

- **找不到 Cairo/Pango**：确认已安装上述 Homebrew 包，PATH 和库的架构匹配。
- **中文排版与原软件不同**：检查字体安装与回退，核对生成的 PDF。
- **文档显示不支持的绘制操作**：保留错误信息，提供不含隐私的最小样本，不要忽略错误继续输出。
- **本地包要求更新的 macOS**：查看原生库清单，发布包与本机包可能使用不同版本的依赖。
- **没有识别纸盒编号**：打印机驱动可能只报告通用缺纸状态，需在设备或系统打印队列中检查。

## 文档与许可证

- [贡献指南](CONTRIBUTING.md)：开发、验证与发布步骤。
- [AGENTS.md](AGENTS.md)：英文维护规则与安全边界。
- [产品说明](PRODUCT.md) / [设计规范](DESIGN.md)：产品范围与界面约定。
- [记录器](packages/canvas-recorder/README.md) / [Rust 渲染器](crates/cairo-replay/README.md)：模块接口与支持范围。
- [OOXML 适配](compat/ooxml/README.md)：工作表宽度计算的版本边界。

Pliflo 自有代码采用 [MIT 许可证](LICENSE)。导入模块保留原版权声明；第三方依赖和原生库仍使用各自许可证，见 [第三方说明](THIRD_PARTY_NOTICES.md)。构建会将项目和相关依赖的声明复制到 App 的 `Contents/Resources/third-party`，但这些材料不代表完整的许可证合规审计。
