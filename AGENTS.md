# Repository Guidelines

## 项目结构与模块组织
本仓库以配置文件为核心，提交应尽量小而清晰，便于回溯。

- `config/config.json`：sing-box 主配置，包含 `dns`、`outbounds`、`route`、`inbounds`、`experimental`、`log`。
- `README.md`：项目说明；当使用方式或约束变化时同步更新。

如果后续拆分配置文件，请将最终产物仍放在 `config/`，并在 `README.md` 说明合并流程。

## 构建、测试与开发命令
本项目无编译步骤，重点是配置校验与变更审查。

- `sing-box check -c config/config.json`：校验配置语法与引用是否有效。
- `jq . config/config.json > /tmp/config.pretty.json`：格式化检查 JSON 结构。
- `git diff -- config/config.json`：提交前审查路由、标签和规则集改动。

仅在需要本地冒烟验证时运行：`sing-box run -c config/config.json`。

## 代码风格与命名规范
- JSON 使用 2 空格缩进，保持稳定格式，避免无意义重排。
- 顶层字段顺序建议固定：`dns`、`outbounds`、`route`、`inbounds`、`experimental`、`log`。
- 将 selector 与 rule 的 `tag` 视为唯一 ID；`outbounds`、`route.rules`、`route.rule_set` 中名称必须严格一致。
- 除非是一次性命名治理，不要随意改动现有 emoji/中文标签风格。

## 测试指南
- 所有配置修改必须通过 `sing-box check -c config/config.json`。
- 涉及路由规则时，至少验证一个受影响域名或 IP，确认命中预期 outbound。
- 更新远程规则集时，检查 URL 可访问性，并确认 `download_detour` 符合预期。

## 提交与合并请求规范
当前历史较少（仅 `first commit`），建议采用 Conventional Commits：

- `feat(config): add geoip rule for ...`
- `fix(route): correct outbound tag reference`

PR 至少包含：
- 改动内容与原因（1-3 条）。
- 风险说明（流量走向、回退路径、DNS 影响）。
- 校验证据（`sing-box check` 结果摘要，必要时附本地运行说明）。

## 安全与配置提示
- 禁止提交密钥或环境敏感信息（如 `experimental.clash_api.secret`）。
- 新增或修改远程规则集 URL 时，优先可信来源，并显式说明 detour 策略。

## 沟通偏好
- 回复内容默认使用中文。
