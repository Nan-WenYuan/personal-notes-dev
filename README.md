# 花笺 · 自用开发版本

本项目参考并基于 [花笺 Floral Notepaper](https://github.com/Achilng/floral-notepaper) 进行二次开发，用于个人本地使用和功能调整。

原项目作者为 **Achilng**，本仓库为独立维护的自用版本。当前技术栈为 Tauri 2、Rust、React 和 TypeScript，提供本地 Markdown 笔记、独立便签窗口及桌面磁贴等功能。

## 便携版

Windows 便携版放在项目根目录的 `交付/花笺` 文件夹中，不生成安装包或压缩包。

双击 `花笺.exe` 即可运行，不需要启动脚本。配置和笔记分别保存在 EXE 旁的 `配置`、`数据` 文件夹；拷走整个便携文件夹即可继续使用，不会跟随旧电脑上的绝对路径。便携版固定使用包内数据目录，设置中不提供独立迁移目录操作。

运行环境需要 Microsoft Edge WebView2 Runtime。

## 笔记与任务

支持所见即所得编辑、Markdown 分栏、代码高亮、网络图片本地化、四象限任务面板及 Agent知识库分类。分类可拖动排序；笔记支持 Ctrl/Shift 多选、批量移动和确认删除。

笔记保存到 `数据/notes/分类/笔记ID_名称.md`。有图片时，在 Markdown 同目录创建 `笔记ID_名称/` 文件夹；改名和移动分类同步图片及链接。旧版图片目录自动迁移。四象限任务保存在 `数据/四象限.json`，分类顺序保存在 `数据/分类排序.json`。迁移到其他电脑时复制整个便携目录。

## 本地开发

安装 Node.js、Rust 和 Windows C++ 构建工具后执行：

```powershell
npm ci
npm run tauri dev
```

构建 Windows Release 便携版：

```powershell
pwsh -NoProfile -File scripts/build-portable.ps1
```

脚本默认将交付目录标记为 `RC`，完成启动及必要功能验证后再标记为 `R`。

## 开源许可与来源

原项目采用 **MIT License**，原版权声明为 `Copyright (c) 2026 Achilng`。本项目保留原作者版权声明和完整 MIT 许可文本，二次开发遵循该协议，详见 [LICENSE](LICENSE)。

分发本项目或其主要部分时，应随附上述版权声明和许可文本。字体等第三方资源遵循各自许可，参见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 `src/assets/fonts` 中的许可文件；便携包将这些文本集中保存在 `许可证` 文件夹中。

## GitHub 更新

源码与便携版发布维护在 [Nan-WenYuan/personal-notes-dev](https://github.com/Nan-WenYuan/personal-notes-dev)，应用仍名为“花笺”。1.4.0 起通过此仓库的公开 Release 检查和下载更新，校验 SHA256 后只替换 EXE，保留配置和笔记。首次从旧版本切换需要更新一次 EXE。

本地打包：`powershell -ExecutionPolicy Bypass -File scripts/build-portable.ps1 -Type R`。发布：`scripts/publish-github-release.ps1 -Executable <路径>`；也可推送与 package.json 一致的 `v主.次.修` 标签由 GitHub Actions 自动发布。
