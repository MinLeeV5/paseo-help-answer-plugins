# 首个 GitHub Release 发布流程

## 发布计划

| 项目 | 首发设置 |
| --- | --- |
| 仓库 | `MinLeeV5/paseo-help-answer-plugins` |
| 插件 ID | `help-answer` |
| 插件版本 | `0.1.0`，与 package.json、package-lock.json 保持一致 |
| Git 标签 | `v0.1.0` |
| Release 标题 | `v0.1.0 — Paseo 回复建议` |
| 发布类型 | 建议勾选 **Pre-release**，不设为 Latest |
| Release 正文 | [v0.1.0.md](releases/v0.1.0.md) |
| 分发方式 | Git 仓库与固定标签安装 |

建议先作为预发布版本收集桌面端反馈：当前已验证的宿主为 Paseo 0.13.0-beta.1，输入区依赖 DOM 适配，原生窗口逐项点击验收尚未完成。GitHub 的 Pre-release 标识与 package.json 版本独立，本次可保留 `0.1.0` 配合 `v0.1.0` 标签。

当前没有构建脚本或额外生产依赖，本次无需上传单独的安装包。GitHub 会按标签自动提供源码 ZIP 和 tarball，用户可直接通过 Paseo CLI 从 Git 安装。[GitHub Release 说明](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

以下为待执行的发布步骤。整理这些文档本身不会创建标签或 Release。

## 1. 核对代码与验收记录

以下命令在仓库根目录执行，需要 Git、已登录且有仓库写权限的 GitHub CLI，以及 Node.js 22 或更新版本。先确认工作区干净，再同步 main：

    git status --short
    git switch main
    git pull --ff-only origin main
    git fetch origin --tags
    gh auth status
    gh release list --repo MinLeeV5/paseo-help-answer-plugins

核对 package.json 与 package-lock.json 的插件版本均为 `0.1.0`，paseo-plugin.json 的 ID 为 `help-answer`，宿主版本要求为 `>=0.13.0-beta.1 <0.14.0`。

在最终发布代码上执行：

    npm ci
    npm run typecheck
    npm test
    npx playwright install chromium
    npm run test:e2e
    npm run verify:install

`verify:install` 在独立临时 daemon 中安装无 node_modules 的源码副本，验证用户无需开发依赖也能加载插件，并在完成后清理。它不调用模型。

当前验收基线为类型检查、29 项单元测试、29 项 Chromium 模拟输入区测试通过。已有真实主机生成记录见[验收记录](verification.md)。生成链路发生变化时，再运行 `npm run verify:live` 补充验证；该命令使用脚本内置对话，会调用模型并产生用量。

在 Paseo 原生窗口复核以下交互，并将尚未验证的部分保留在 Release 已知限制中：

- 候选为短按钮；无候选和生成期间没有入口。
- 点击候选填入完整内容，已有草稿保留，不自动发送。
- 普通发送、候选发送后旧建议收起，发送失败时草稿保留。
- 中英文界面切换、只读默认提示词和附加生成要求可用。
- 当前用户 Agent 下没有辅助子任务，辅助生成没有额外完成提醒。

## 2. 准备并提交发布内容

检查 [Release 正文](releases/v0.1.0.md) 与最终行为一致。正文中的 `blob/v0.1.0` 链接会在标签推送后生效。

准备发布时，将 README 主安装命令中的 `--ref main` 改为 `--ref v0.1.0`，明确这是固定预发布版本；如保留 main 安装方式，将其标为开发版本。

有发布文档修改时，提交并推送：

    git diff --check
    git add README.md docs/releasing.md docs/releases/v0.1.0.md
    git commit -m "docs: prepare v0.1.0 release"
    git push origin main

如果上述内容已经提交并同步，无需重复创建提交。确认工作区干净、本地与远端 main 一致，并记录最终发布提交：

    git status --short
    git fetch origin main
    git rev-parse HEAD
    git rev-parse origin/main

两条 SHA 应相同；若不同，先核对并同步，再重新检查最终发布内容。

## 3. 创建并推送固定标签

在已确认的最终提交上创建附注标签：

    release_commit=$(git rev-parse HEAD)
    git tag -a v0.1.0 "$release_commit" -m "Paseo 回复建议 v0.1.0"
    git push origin refs/tags/v0.1.0
    git rev-parse 'v0.1.0^{commit}'
    git ls-remote origin refs/tags/v0.1.0 'refs/tags/v0.1.0^{}'

远端 `refs/tags/v0.1.0^{}` 的 SHA 应与发布提交相同。标签已存在时先检查指向，不覆盖已经分发的版本；后续修复使用新版本标签。

## 4. 创建 Release 草稿并预览

    gh release create v0.1.0 \
      --repo MinLeeV5/paseo-help-answer-plugins \
      --verify-tag \
      --title "v0.1.0 — Paseo 回复建议" \
      --notes-file docs/releases/v0.1.0.md \
      --prerelease \
      --latest=false \
      --draft

`--verify-tag` 要求远端已有标签，`--notes-file` 使用准备好的 Markdown，`--draft` 保留为待发布草稿。[GitHub CLI 创建 Release 文档](https://cli.github.com/manual/gh_release_create)

打开草稿，核对标题、预发布标记、安装命令、截图说明、文档链接和已知限制：

    gh release view v0.1.0 --repo MinLeeV5/paseo-help-answer-plugins --web

草稿正文需要修改时：

    gh release edit v0.1.0 \
      --repo MinLeeV5/paseo-help-answer-plugins \
      --notes-file docs/releases/v0.1.0.md

## 5. 发布并检查

草稿核对完成后，执行以下命令公开发布：

    gh release edit v0.1.0 \
      --repo MinLeeV5/paseo-help-answer-plugins \
      --verify-tag \
      --draft=false \
      --prerelease \
      --latest=false

将 `--draft` 设为 false 会发布已有草稿；本次保留 Pre-release 标记。[GitHub CLI 编辑 Release 文档](https://cli.github.com/manual/gh_release_edit)

检查发布结果：

    gh release view v0.1.0 \
      --repo MinLeeV5/paseo-help-answer-plugins \
      --json tagName,isDraft,isPrerelease,url

应返回 `tagName: v0.1.0`、`isDraft: false`、`isPrerelease: true`。公开地址为 [v0.1.0 Release](https://github.com/MinLeeV5/paseo-help-answer-plugins/releases/tag/v0.1.0)。

通过隔离主机检查固定标签安装，命令结束后会停止并清理该临时主机：

    npm run verify:install -- --ref v0.1.0

用户在实际主机安装本次版本：

    paseo plugin install https://github.com/MinLeeV5/paseo-help-answer-plugins.git --ref v0.1.0
    paseo plugin ls help-answer

已从同一 GitHub 仓库安装时，可使用 `paseo plugin update help-answer --ref v0.1.0`。确认插件启用且为 `running`，再验证一次生成、填入与发送后的收起行为。

## 使用 GitHub 网页发布

完成代码检查和标签推送后，也可以用网页替代第 4、5 步：

1. 打开仓库 [Releases 页面](https://github.com/MinLeeV5/paseo-help-answer-plugins/releases)，选择 **Draft a new release**。
2. 选择已经推送的 `v0.1.0` 标签，填写上方 Release 标题。
3. 将 [Release 正文](releases/v0.1.0.md) 的原始 Markdown 粘贴到描述框。
4. 勾选 **This is a pre-release**，不设为 Latest；保存草稿并预览。
5. 核对后点击 **Publish release**，继续完成第 5 步的发布结果和安装检查。

网页操作说明见 [GitHub 管理 Release 文档](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。
