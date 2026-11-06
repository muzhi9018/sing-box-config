# sing-box-config

本仓库提供 Linux、macOS、OpenWrt 和 Windows 的 sing-box RealIP 分流模板、自维护规则集，以及用于注入订阅节点的 Sub-Store 脚本。模板的 DNS 返回真实 IP 地址，路由可按域名或目标 IP 分流。

## 选择模板

四份模板以 **sing-box 1.14 系列**为校验基线，使用从 1.14.0 开始提供的 `http_clients` 和 DNS 响应匹配。用 `sing-box version` 检查目标设备上的版本。[官方安装说明](https://sing-box.sagernet.org/zh/installation/package-manager/) · [DNS 规则动作](https://sing-box.sagernet.org/zh/configuration/dns/rule_action/) · [规则集配置](https://sing-box.sagernet.org/zh/configuration/rule-set/)

| 平台 | 模板 | 平台配置 |
| --- | --- | --- |
| Linux | [template-realip-linux.json](config/template-realip-linux.json) | 本机 TUN 使用 `auto_redirect` 和 `dns_mode: hijack`，附带 sing-box 官方 API 和控制台。 |
| macOS | [template-realip-macos.json](config/template-realip-macos.json) | 提供 DNS、mixed 和 TUN 入站，DNS 和 mixed 端口监听本机。 |
| OpenWrt | [template-realip-openwrt.json](config/template-realip-openwrt.json) | 保留 `redirect`、`tproxy` 和 TUN 入站，使用 Momo 的接口名和运行路径。 |
| Windows | [template-realip-windows.json](config/template-realip-windows.json) | TUN 启用 `strict_route` 和 `dns_mode: hijack`，并配置排除路由。 |

## 用 Sub-Store 生成配置

1. 选取对应平台的 JSON 作为模板，在 Sub-Store 中用 [script/template.js](script/template.js) 处理文件。
2. 用 `name` 指定订阅名称。使用组合订阅时加上 `type=组合订阅`。设置 `outbound` 为节点分组规则，按需设置 `detour`。[参数示例](#sub-store-参数示例)
3. 导出为 `sing-box-generated.json`，在目标平台校验后交给 sing-box 服务或客户端加载。

```bash
sing-box check -c sing-box-generated.json
```

模板中的空出站分组用于接收订阅节点。若生成结果报 `missing tags`，检查 `outbound` 是否覆盖所有空分组。脚本会为已匹配但没有可用节点的分组插入 `COMPATIBLE` 直连出站。

## 规则集

四份模板默认通过 `resource-download` 下载远程规则集，该客户端使用 `🚀 默认代理`。首次启动前，确认该分组选择的节点可以访问规则集地址。

[`geosite/`](geosite/) 保存自维护的 `.srs` 文件。本地 JSON 规则源由 `.gitignore` 忽略。四份模板的 `direct-ip` 规则集把匹配到的目标 IP 分流到 `🎯 全球直连`。修改本地 `geosite/direct-ip.json` 后，在仓库根目录重新编译，并把 `test_ip` 设为要验证的地址。

```bash
sing-box rule-set compile --output geosite/direct-ip.srs geosite/direct-ip.json
sing-box rule-set match --format binary geosite/direct-ip.srs "$test_ip"
```

只有 `.srs` 时，可先用 `sing-box rule-set decompile` 导出规则源。若通过远程 URL 加载，先把更新后的 `.srs` 发布到该 URL 对应的分支。[规则集源文件格式](https://sing-box.sagernet.org/zh/configuration/rule-set/source-format/)

## Linux 部署示例（Debian）

Linux 模板面向本机透明代理，使用 `auto_route`、`auto_redirect` 和 `dns_mode: hijack`，需要系统支持 TUN 和 nftables。让局域网设备通过这台机器上网时，还需配置网关、转发和防火墙。[官方 TUN 文档](https://sing-box.sagernet.org/zh/configuration/inbound/tun/)

可直接用 Linux 模板生成配置，部署前用 `openssl rand -hex 32` 生成密钥，并填入 `dashboard-api` 服务的 `secret`。以下部署示例使用 `~/sing-box-debian.json` 作为生成文件。

<details>
<summary>从现有 OpenWrt 导出迁移</summary>

将用本项目 OpenWrt 模板生成的配置保存为 `~/openwrt-generated.json`，在仓库根目录执行以下命令。它会保留节点、分组、DNS 和分流，更新下载客户端的标签，换用 Linux 入站和控制台，并生成新的密钥。

```bash
(
  set -e
  umask 077
  set -C
  dashboard_secret=$(openssl rand -hex 32)
  jq --slurpfile linux config/template-realip-linux.json \
    --arg secret "$dashboard_secret" '
      .route.default_http_client as $old_client
      | $linux[0].route.default_http_client as $client
      | ((.http_clients[].tag, .route.default_http_client, .route.rule_set[].http_client)
        | select(. != null and . == $old_client)) = $client
      | .inbounds = $linux[0].inbounds
      | .experimental = $linux[0].experimental
      | .services = $linux[0].services
      | (.services[] | select(.tag == "dashboard-api")).secret = $secret
    ' "$HOME/openwrt-generated.json" > "$HOME/sing-box-debian.json"
)
```

</details>

先用 `systemctl cat sing-box` 确认服务用户和配置路径。以下命令适用于以 `sing-box` 用户运行、从 `/etc/sing-box` 加载配置的服务。备份放在配置目录之外，首次启用 TUN 时可从本机或管理控制台操作，便于回退。

```bash
(
  set -e
  sudo sing-box check -c "$HOME/sing-box-debian.json"
  sudo install -d -m 0700 /root/sing-box-backups
  if sudo test -f /etc/sing-box/config.json; then
    sudo cp -a /etc/sing-box/config.json "/root/sing-box-backups/config.json.$(date +%Y%m%d-%H%M%S)"
  fi
  sudo install -o root -g sing-box -m 0640 "$HOME/sing-box-debian.json" /etc/sing-box/config.json
  sudo sing-box check -C /etc/sing-box
  sudo systemctl restart sing-box
  sudo systemctl enable sing-box
  sudo journalctl -u sing-box -n 80 --no-pager
)
```

需要回退时，将备份恢复到 `/etc/sing-box/config.json`，再重启服务。

Linux 的官方控制台也通过 `resource-download` 下载。启动后在本机访问控制台，使用 `dashboard-api` 中设置的密钥。[本机控制台](http://localhost:9095/dashboard/) · [官方 API 配置](https://sing-box.sagernet.org/zh/configuration/service/api/)

可通过 mixed 入站发起请求，在控制台连接记录或服务日志中确认规则模式下命中 `📹 YouTube`。

```bash
curl -x http://localhost:5330 -I --max-time 15 https://www.youtube.com/
```

## Sub-Store 参数示例

### `outbound`

每行以 `🕳` 开始，`🏷` 左边匹配分组标签，右边匹配订阅节点名称。`ℹ️` 表示忽略大小写。

```text
🕳ℹ️🐸 手动选择|♻️ 自动选择🏷ℹ️^(?!.*(?:官网|剩余|流量|套餐|免费|订阅|到期时间|全球直连|GB|Expire|Expire Date|Traffic|ExpireDate)).*
🕳ℹ️🌍 DNS🏷ℹ️^.*(自建|高级|家宽|HiNet).*
🕳ℹ️🌍 运营-DNS🏷ℹ️^.*(高级|家宽|HiNet).*
🕳ℹ️🇭🇰 香港手动🏷ℹ️^(?!.*(?:us)).*(🇭🇰|HK|hk|香港|港|HongKong)
🕳ℹ️🇯🇵 日本手动🏷ℹ️^(?!.*(?:us)).*(🇯🇵|JP|jp|日本|日|Japan)
🕳ℹ️🇸🇬 狮城手动🏷ℹ️^(?!.*(?:us)).*(新加坡|坡|狮城|SG|Singapore)
🕳ℹ️🇺🇲 美国手动🏷ℹ️^(?!.*(?:AUS|RUS)).*(🇺🇸|US|us|美国|美|United States)
🕳ℹ️✈️ 高级🏷ℹ️^.*(高级|家宽).*
🕳ℹ️🇺🇲 美国高级🏷ℹ️^(?!.*(?:AUS|RUS)).*(🇺🇸|US|us|美国|美|United States).*(高级|家宽).*
🕳ℹ️🎵 TikTok🏷ℹ️^.*(高级|家宽|HiNet).*
🕳ℹ️🧪 实验性🏷ℹ️^.*(实验).*
🕳ℹ️⬇️ 低倍率🏷ℹ️^.*(实验|0\.).*
🕳ℹ️🏗️ 自建节点🏷ℹ️^.*(自建).*
🕳ℹ️💬 Line🏷ℹ️^.*(高级|家宽|HiNet).*
🕳ℹ️🧠 AI🏷ℹ️^.*(高级|家宽).*
🕳ℹ️🧠 OpenAi🏷ℹ️^.*(高级|家宽).*
🕳ℹ️📲 Telegram🏷ℹ️^.*(高级|家宽).*
🕳ℹ️📖 Facebook🏷ℹ️^.*(高级|家宽|HiNet).*
🕳ℹ️🎑 Instagram🏷ℹ️^.*(高级|家宽|HiNet).*
🕳ℹ️💵 运营专线🏷ℹ️^.*(高级|家宽|HiNet).*
🕳ℹ️💶 PayPal🏷ℹ️^.*(高级|家宽).*
🕳ℹ️🎥 墨云阁🏷ℹ️^.*(自建|实验).*
🕳ℹ️🎥 OkEmby🏷ℹ️^.*(自建|实验).*
🕳ℹ️📹 YouTube🏷ℹ️^.*(自建|实验).*
```

### `detour`（可选）

例如让名为 `链式节点` 的节点通过 `🏗️ 自建节点` 分组拨号。该分组中的节点应能独立建立连接。

```text
^链式节点$🏷🏗️ 自建节点
```
