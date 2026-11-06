# RealIP Cloudflare Worker

Worker 按 `/template?platform=<平台>` 返回完整的 RealIP 模板。平台参数可选 `linux`、`macos`、`openwrt` 或 `windows`。

Worker 运行时读取 `muzhi9018/sing-box-config` 的 `master` 分支。每次刷新时，先解析分支的提交 SHA，再从该提交的 GitHub Raw 地址读取公共模板和对应的平台模板。响应头 `X-RealIP-Revision` 标记模板来源的提交。

## 维护模板

[templates/common.json](templates/common.json) 保存公共配置和默认策略，[templates/platforms/](templates/platforms/) 下的四份 JSON 保存各平台差异。`overrides` 逐字段合并对象，数组字段整体替换。`arrays` 按配置路径列出顺序操作，每项用 `match` 中的标签或规则字段定位唯一条目，再用 `merge`、`replace`、`remove`、`insert-before` 或 `move-before` 修改。

在 `worker/` 内用 Node.js 22.12 或更新版本执行以下命令，可以验证本地模板改动。完整模板输出到 `generated/template-realip-<平台>.json`。

```bash
node build-realip.mjs
node build-realip.mjs --check
```

## 预览和部署

首次使用时，把 `worker/templates/` 推送到 GitHub 的 `master`。在 `worker/` 内运行 `npx wrangler dev`，通过 `http://localhost:8787/template?platform=linux` 验证 GitHub 拉取和合并流程。运行以下命令部署到自己的 Cloudflare 账户。[Wrangler 部署文档](https://developers.cloudflare.com/workers/wrangler/commands/#deploy)

```bash
npx wrangler deploy
```

建议给已部署的 Worker 设置 `GITHUB_TOKEN`，让查询分支 SHA 的 GitHub REST 请求使用认证额度。创建 GitHub fine-grained personal access token，仓库访问范围选 `Public repositories`，权限保持默认。该选项提供公开仓库的只读权限。在 `worker/` 内运行以下命令，并在提示时粘贴令牌。GitHub Raw 模板仍按公开地址获取。[GitHub 接口权限](https://docs.github.com/en/rest/git/refs#get-a-reference) · [Cloudflare Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

```bash
npx wrangler secret put GITHUB_TOKEN
```

在 Wrangler 返回的地址后加 `/template?platform=linux`，把完整 URL 填入 Sub-Store 的远程文件地址。模板里的空分组由 Sub-Store 注入节点。控制台密钥由部署环境填入，OpenWrt 的 Clash API 监听 `0.0.0.0:9095`，启用前设置 `experimental.clash_api.secret`。[Clash API 配置](https://sing-box.sagernet.org/zh/configuration/experimental/clash-api/#secret)

以后修改模板 JSON，只需推送到 `master`，Worker 会在缓存刷新时读取新版本。模板按平台缓存 5 分钟，分支查询另有 60 秒缓存。GitHub 读取或合并失败时，Worker 优先返回当前数据中心缓存的上一版模板，并附上 `X-RealIP-Stale: true`。没有可用缓存时返回 HTTP 502。[Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)

如果模板接口返回 `502`，用 `npx wrangler tail` 查看上游错误。GitHub 返回 `403` 或 `429` 时，日志会记录限流响应头。`x-ratelimit-remaining=0` 表示额度已用完，`x-ratelimit-reset` 是额度重置的 Unix 时间戳。[GitHub REST API 限流说明](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

修改 Worker 的运行代码或 Wrangler 配置后需要重新部署。如果已开启 Workers Builds，可将监听路径的 Include 设为 `worker/realip.mjs`、`worker/render.mjs` 和 `worker/wrangler.jsonc`，让模板更新只通过运行时拉取生效。[构建监听路径](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/)
