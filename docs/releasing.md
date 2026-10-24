# v0.1.2 GitHub Release 发布流程

本版改为复用当前会话 workspace 创建辅助 Agent，生成后只归档辅助 Agent 和服务会话。插件版本为 `0.1.2`，标签为 `v0.1.2`，Release 正文为 [v0.1.2.md](releases/v0.1.2.md)。要求 Paseo `>=0.12.0`，没有新增生产依赖或安装包。

GitHub 上的 v0.1.1 已是正式 Release；本版继续正式发布并设为 Latest。此前文档中的 Pre-release 描述不再适用于当前发布流程。

## 验证最终代码

在 Node.js 22 或更新版本下执行：

    npm run typecheck
    npm test
    npm run test:e2e
    npm run verify:install
    npm run verify:live
    npm pack --dry-run --ignore-scripts
    git diff --check

`verify:install` 使用独立临时 daemon，不调用模型。通过 `HELP_ANSWER_PASEO_CLI` 指向 Paseo 0.12.0 CLI，再验证最低兼容版本。

`verify:live` 使用本机元数据模型和脚本内置测试对话，会产生模型用量。检查辅助 Agent 的 workspace 与源会话相同、辅助 Agent 已归档、源 Agent 与 workspace 保留、可见性不变，以及普通会话有完成通知、辅助任务没有完成通知。验证脚本只清理自己创建的资源。

README、双语 OVERVIEW 和 Release 说明必须说明：不再创建固定的 `generator` 项目；辅助 Agent 沿用当前 workspace 的可见性和项目环境；升级不删除旧项目及历史。实际结果记录在 [verification.md](verification.md) 和 [live-smoke.json](../artifacts/live-smoke.json)。

## 提交与标签

确认 package.json 和 package-lock.json 版本均为 `0.1.2`，远端不存在同名标签。检查最终 diff 后提交、推送 main，在同一提交上创建附注标签：

    git push origin main
    git tag -a v0.1.2 -m "Paseo 回复建议 v0.1.2"
    git push origin refs/tags/v0.1.2
    git rev-parse 'v0.1.2^{commit}'
    git ls-remote origin refs/tags/v0.1.2 'refs/tags/v0.1.2^{}'

已发布标签不覆盖。通过 GitHub 固定标签分别验证当前 CLI 和 0.12.0 CLI 的安装：

    npm run verify:install -- --ref v0.1.2

结果应为 `passed: true`、`source: git`、`ref: v0.1.2`、`status: running`。本地源码安装不能替代固定标签安装检查。

## 发布 Release

用户已授权本次公开发布。先创建草稿、核对内容与标签，再公开：

    gh release create v0.1.2 --repo MinLeeV5/paseo-help-answer-plugins --verify-tag --title "v0.1.2 — 复用当前会话工作区" --notes-file docs/releases/v0.1.2.md --draft
    gh release view v0.1.2 --repo MinLeeV5/paseo-help-answer-plugins --json tagName,isDraft,isPrerelease,body,url
    gh release edit v0.1.2 --repo MinLeeV5/paseo-help-answer-plugins --verify-tag --draft=false --latest
    gh release view v0.1.2 --repo MinLeeV5/paseo-help-answer-plugins --json tagName,isDraft,isPrerelease,url

最终状态为 `isDraft: false`、`isPrerelease: false`，公开地址为 [v0.1.2 Release](https://github.com/MinLeeV5/paseo-help-answer-plugins/releases/tag/v0.1.2)。

## 更新 Paseo 插件目录

在 `getpaseo/plugins` 的最新 main 上创建更新分支，仅修改 `plugins/minleev5/help-answer-plugins.json`：

- `artifact.commit` 和 `repository.commit` 指向 `v0.1.2` 的完整提交 SHA，`artifact.tag` 为 `v0.1.2`。
- `listing.media` 的截图链接固定到同一新提交。
- 保留身份、分类、翻译与已有提交/发布日期。审核日期由上游审核流程维护，本 PR 不自行宣称已通过新版审核。

提交后执行注册表的在线变更验证，向 `getpaseo/plugins:main` 提交 PR。PR 中说明 workspace 行为变化、Agent 归档与通知策略，链接 Release 并列出实际验证结果。提交 PR 不代表上游已合并或用户已通过插件目录收到新版本。
