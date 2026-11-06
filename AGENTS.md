# 仓库协作指南

## 项目与入口

本仓库维护 sing-box 配置、RealIP 分流模板和配套规则集。日常工作是编辑 JSON、通过 Sub-Store 生成可部署配置，以及校验配置和流量走向。

- `config/template-realip-{linux,macos,openwrt,windows}.json` 是当前维护的四个平台模板。模板包含 DNS、入站、出站分组、分流和规则集，订阅节点由 Sub-Store 注入。
- `config/config.json` 是仓库主配置。`config/bll-config.json` 是独立配置，`config/template-realip_backup.json` 是历史备份。按任务选定目标文件，避免把平台模板的改动一并套用到其他配置。
- `script/template.js` 在 Sub-Store 中执行，读取订阅或组合，根据 `outbound` 参数向匹配的分组注入节点，并按可选的 `detour` 参数设置节点链路。匹配到的分组仍为空时，脚本会插入 `COMPATIBLE` 直连出站。参数示例见 `README.md`。
- `geosite/` 存放自维护的域名和 IP 规则集。仓库跟踪编译后的 `.srs`，同目录下的 `.json` 规则源文件默认由 `.gitignore` 忽略。`direct-ip.srs` 用于四个平台模板的指定 IP 直连。
- `README.md` 面向使用者，记录配置生成、迁移和部署。使用方式、版本要求或部署命令变化时同步更新。若拆分配置，合并产物仍放在 `config/`，并在 README 记录合并步骤。

## 平台模板

四个平台模板以 sing-box 1.14 系列为校验基线，使用 `http_clients` 和 DNS 的 `evaluate`、`respond`、`match_response`。

| 模板 | 平台相关配置 |
| --- | --- |
| Linux | 本机 TUN 使用 `auto_redirect` 和 `dns_mode: hijack`，并配置官方 API 和控制台。 |
| macOS | 提供 DNS、mixed 和 TUN 入站，DNS 和 mixed 端口监听回环地址。 |
| OpenWrt | 面向软路由，保留 `redirect`、`tproxy` 和 TUN 入站，以及 Momo 使用的路径。 |
| Windows | TUN 使用 `strict_route` 和 `dns_mode: hijack`，另有 `route_exclude_address` 和独立的 DNS 兜底策略。 |

## 修改约定

- 修改任何 sing-box 配置前，必须仔细阅读相关字段的官方文档，并按目标 sing-box 版本确认字段含义、默认行为和平台限制。涉及版本升级或弃用字段时，同时核对更新日志和迁移指南。[官方配置文档](https://sing-box.sagernet.org/zh/configuration/) · [更新日志](https://sing-box.sagernet.org/zh/changelog/) · [迁移指南](https://sing-box.sagernet.org/zh/migration/)
- JSON 使用 2 空格缩进。四个平台模板的顶层顺序统一为 `log` → `dns` → `http_clients` → `inbounds` → `outbounds` → `route` → `services`（如有）→ `experimental`。
- DNS 规则和路由规则的数组顺序有语义。改动时检查规则是否被前面的终止规则覆盖，以及 `sniff`、`resolve` 对后续域名或 IP 匹配的影响。共用策略改动要核对四个平台，保留各平台的入站、DNS 兜底和排除路由差异。
- 同一命名空间内的 `tag` 应唯一。新增、删除或重命名时同时检查 DNS、入站、出站、规则集、下载客户端及 `detour` 的引用。selector 的 `default` 必须在其成员列表中。保留现有 emoji 和中文标签风格。
- 四个平台的 `route.default_http_client` 统一指向 `resource-download`，通过 `🚀 默认代理` 下载。远程规则集继承默认客户端，有独立下载路径时才设置自己的 `http_client`。Linux 的 `services[].dashboard.http_client` 也引用该标签。旧配置使用 `download_detour` 时，按旧配置的出站标签核对下载路径。
- 单个 IPv4 地址可在 `ip_cidr` 中写成 `/32`，整个 `x.x.x.*` 网段写成对应的 `/24`。修改 `.srs` 时从对应规则源重新编译，确认目标地址和邻近地址的匹配结果。

## 校验与交付

以下命令从仓库根目录执行。

1. **配置检查**。对改动的 JSON 运行 `jq -e 'type == "object"' 文件路径`，用 `git diff --check` 和 `git diff -- config/` 检查格式、标签引用和规则顺序。每次配置改动都运行 `sing-box check -c config/config.json`。主配置当前含空 selector，可能报 `missing tags`，遇到失败时记录实际结果并区分基线问题和本次回归。
2. **模板检查**。模板的空 selector 或 urltest 分组用于订阅注入。用 Sub-Store 导出，或在临时副本注入模拟节点，再运行 `sing-box check -c /path/to/generated.json`。Linux 的 `auto_redirect` 在 Linux 上验证。如果在 macOS 上做结构检查，可在临时副本关闭该选项，并记录平台限制。改动生成脚本时覆盖有匹配节点和空分组回退两种情况。
3. **规则验证**。涉及分流时，至少验证一个受影响的域名或 IP 是否走预期出口。新增或更新远程规则集时，验证 URL 可访问、返回内容可加载，并确认实际下载客户端和出站。发布自维护规则时，确保 `.srs` 已出现在模板 URL 对应的分支上。`sing-box check` 主要校验配置，下载和启动行为需在合适的环境中另行验证。

编译并匹配直连 IP 规则集前，将 `test_ip` 设为待验证的地址。若本地只有 `.srs`，可先用 `sing-box rule-set decompile` 导出 JSON 规则源。

```bash
sing-box rule-set compile --output geosite/direct-ip.srs geosite/direct-ip.json
sing-box rule-set match --format binary geosite/direct-ip.srs "$test_ip"
```

## 提交与沟通

- 将改动限制在相关配置、规则产物和文档。提交信息沿用 Conventional Commits，例如 `feat(config): add direct IP rule set` 或 `fix(route): correct outbound tag reference`。
- PR 说明改动原因、可能影响的流量或 DNS 路径、回退方式及校验结果。存在基线错误或平台验证缺口时，在交付说明中注明。
- 提交前检查订阅 URL、节点凭据、证书私钥和控制台密钥，尤其是 `services[].secret` 与 `experimental.clash_api.secret`。提交内容使用空值或占位符，实际密钥在部署环境注入。
- 默认使用中文沟通。
