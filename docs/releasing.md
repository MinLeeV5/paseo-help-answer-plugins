# v0.1.1 GitHub Release 发布流程

## 发布计划

| 项目 | 本次设置 |
| --- | --- |
| 仓库 | `MinLeeV5/paseo-help-answer-plugins` |
| 插件 ID | `help-answer` |
| 插件版本 | `0.1.1`，与 package.json、package-lock.json 保持一致 |
| Git 标签 | `v0.1.1` |
| Release 标题 | `v0.1.1 — Tab 隔离修复与 Paseo 0.12 兼容` |
| 发布类型 | **Pre-release**，不设为 Latest |
| Release 正文 | [v0.1.1.md](releases/v0.1.1.md) |
| 主要变更 | Tab 离开后旧候选失效、迟到结果过滤、分屏与草稿保留、Paseo 0.12 兼容、双语 OVERVIEW |
| 分发方式 | Git 仓库与固定标签安装 |

本流程覆盖 v0.1.1 从发布准备到公开发布的步骤。整理并提交版本与文档不会创建标签或 Release；上一版本为 [v0.1.0](https://github.com/MinLeeV5/paseo-help-answer-plugins/releases/tag/v0.1.0)。

本次延续 Pre-release：支持 Paseo 0.12.0 及以上版本，已验证 0.12.0 与 0.13.0-beta.1 的隔离安装，输入区依赖 DOM 适配。实际桌面已验证 Tab 切换流程，其他原生窗口交互尚未逐项验收。没有构建脚本或额外生产依赖，无需单独上传安装包；通过 Git 标签安装。

## 1. 核对版本、代码与验收记录

以下命令在仓库根目录执行，需要 Git、已登录且有仓库写权限的 GitHub CLI，以及 Node.js 22 或更新版本。确认工作区干净后同步 main：

    git status --short
    git switch main
    git pull --ff-only origin main
    git fetch origin --tags
    gh auth status
    gh release list --repo MinLeeV5/paseo-help-answer-plugins

核对 package.json 与 package-lock.json 的插件版本均为 `0.1.1`，paseo-plugin.json 的 ID 为 `help-answer`，宿主版本要求为 `>=0.12.0`。本次发布需包含 Tab 隔离修复提交 `287c0a2`，以及英文默认页 OVERVIEW.md 和中文译文 OVERVIEW.zh-CN.md；两份介绍应说明相同的 Tab 行为、数据范围与模型用量。

代码验收基线为类型检查、39 项单元测试、40 项 Chromium 模拟输入区测试、隔离源码安装和实际桌面 Tab 切换通过，见[验收记录](verification.md)。发布前若代码或依赖发生变化，在最终代码上重新执行以下检查；仅版本与文档修改时，可沿用已有功能验收并复核版本、文档和打包内容：

    npm ci
    npm run typecheck
    npm test
    npx playwright install chromium
    npm run test:e2e
    npm run verify:install

`verify:install` 在独立临时 daemon 中安装无 node_modules 的源码副本，确认状态为 `running`，完成后停止并清理。它不调用模型。生成链路发生变化时再运行 `npm run verify:live`；该命令使用内置验收对话，会产生模型用量。

最低版本验证可先通过 `npm exec --yes --package=@getpaseo/cli@0.12.0 -- paseo --version` 准备 0.12.0 CLI；运行安装脚本时用 `HELP_ANSWER_PASEO_CLI=/absolute/path/to/0.12.0/paseo` 指定其可执行文件。报告中的 `paseoVersion` 应为 `0.12.0`。同时检查当前宿主版本，避免误用系统中的其他 CLI。

核对版本、依赖及文档链接后，检查打包清单包含 OVERVIEW.md、OVERVIEW.zh-CN.md 和插件入口文件：

    npm pack --dry-run --ignore-scripts

复核本次修复时，先在 Agent A 生成候选，再切换到另一个 Agent 或 Diff Tab，确认旧建议消失且切回不恢复。检查草稿保留、新回复或手动生成后恢复新候选，以及仍可见的分屏各自独立。区分真实桌面验收与模拟 Composer 测试，未完成的原生交互继续保留在已知限制中。

## 2. 提交发布内容并切换 README 安装版本

发布准备提交包括：

- package.json、package-lock.json 的 `0.1.1` 版本。
- OVERVIEW.md 英文默认页及新增的 OVERVIEW.zh-CN.md。
- README.md、验收记录、本流程及 [Release 正文](releases/v0.1.1.md)。

实际发布时，确认 README 的“当前预发布版本”链接及主要安装、更新命令统一为 `v0.1.1`，移除“v0.1.1 正在准备发布”和“待发布”标记；main 安装方式仍标为开发版本。正文中的 `blob/v0.1.1` 和版本比较链接会在标签推送后生效。

确认最终文案后提交并推送。已提交的准备内容无需重复提交：

    git diff --check
    git add package.json package-lock.json paseo-plugin.json client/i18n.ts client/legacy-locale.ts client/manager.tsx scripts/clean-install-smoke.mjs tests/core.test.ts OVERVIEW.md OVERVIEW.zh-CN.md README.md docs/verification.md docs/releasing.md docs/releases/v0.1.1.md
    git commit -m "chore: prepare v0.1.1 release"
    git push origin main

确认工作区干净，本地与远端 main 一致，并记录最终发布提交：

    git status --short
    git fetch origin main
    git rev-parse HEAD
    git rev-parse origin/main

两条 SHA 应相同。README 的最终版本切换也必须提交后再创建标签，使标签中的文档与发布状态一致。已发布的 v0.1.0 标签与 Release 保持原样。

## 3. 创建标签并验证固定版本安装

在确认的最终提交上创建附注标签：

    release_commit=$(git rev-parse HEAD)
    git tag -a v0.1.1 "$release_commit" -m "Paseo 回复建议 v0.1.1"
    git push origin refs/tags/v0.1.1
    git rev-parse 'v0.1.1^{commit}'
    git ls-remote origin refs/tags/v0.1.1 'refs/tags/v0.1.1^{}'

远端 `refs/tags/v0.1.1^{}` 的 SHA 应与发布提交相同。标签若已存在，先检查指向；不覆盖已分发的版本，后续修复使用新版本号。

通过隔离主机验证 GitHub 固定标签安装：

    npm run verify:install -- --ref v0.1.1

确认输出 `passed: true`、`source: git`、`ref: v0.1.1`、`status: running`。检查结束后脚本会停止并清理临时主机。通过后再公开 Release；本地源码安装通过不能替代固定标签安装检查。

## 4. 创建 Release 草稿并预览

    gh release create v0.1.1 \
      --repo MinLeeV5/paseo-help-answer-plugins \
      --verify-tag \
      --title "v0.1.1 — Tab 隔离修复与 Paseo 0.12 兼容" \
      --notes-file docs/releases/v0.1.1.md \
      --prerelease \
      --latest=false \
      --draft

`--verify-tag` 要求远端已有标签，`--notes-file` 使用准备好的 Markdown，`--draft` 保存为草稿。[GitHub CLI 创建 Release 文档](https://cli.github.com/manual/gh_release_create)

打开草稿，核对版本、预发布标记、安装命令、双语 OVERVIEW 链接、已知限制及完整变更链接：

    gh release view v0.1.1 --repo MinLeeV5/paseo-help-answer-plugins --web

草稿正文需要修改时：

    gh release edit v0.1.1 \
      --repo MinLeeV5/paseo-help-answer-plugins \
      --notes-file docs/releases/v0.1.1.md

## 5. 公开发布并检查

草稿核对完成后执行：

    gh release edit v0.1.1 \
      --repo MinLeeV5/paseo-help-answer-plugins \
      --verify-tag \
      --draft=false \
      --prerelease \
      --latest=false

`--draft=false` 会公开已有草稿，本次保留 Pre-release 标记且不设为 Latest。[GitHub CLI 编辑 Release 文档](https://cli.github.com/manual/gh_release_edit)

检查结果：

    gh release view v0.1.1 \
      --repo MinLeeV5/paseo-help-answer-plugins \
      --json tagName,isDraft,isPrerelease,url

应返回 `tagName: v0.1.1`、`isDraft: false`、`isPrerelease: true`。公开地址为 [v0.1.1 Release](https://github.com/MinLeeV5/paseo-help-answer-plugins/releases/tag/v0.1.1)。检查 README 的准备阶段标记已按实际发布状态更新。

用户在实际主机首次安装：

    paseo plugin install https://github.com/MinLeeV5/paseo-help-answer-plugins.git --ref v0.1.1
    paseo plugin ls help-answer

已从同一 GitHub 仓库安装时，使用 `paseo plugin update help-answer --ref v0.1.1`。确认插件启用且为 `running`，再检查生成、填入与 Tab 切换行为。

## 使用 GitHub 网页发布

完成前 3 步后，可用网页替代第 4、5 步：

1. 打开仓库 [Releases 页面](https://github.com/MinLeeV5/paseo-help-answer-plugins/releases)，选择 **Draft a new release**。
2. 选择已推送的 `v0.1.1` 标签，填写上述标题。
3. 将 [Release 正文](releases/v0.1.1.md)的原始 Markdown 粘贴到描述框。
4. 勾选 **This is a pre-release**，不设为 Latest；保存草稿并预览。
5. 核对后点击 **Publish release**，继续检查发布状态和实际主机安装。
