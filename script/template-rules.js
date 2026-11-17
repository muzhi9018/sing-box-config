// sing-box 模板脚本：从远程 JSON 读取默认节点规则，并允许 URL 参数覆盖。
//
// 参数：
// - rulesUrl：远程规则 JSON URL。省略时读取本仓库的 script/node-rules.json。
// - outbound：用户自定义分组规则，格式与 template.js 相同：
//   `🕳分组标签正则🏷节点名称正则`，多条规则用 🕳 分隔。
// - detour：用户自定义链路规则，格式：`节点名称正则🏷detour 标签`，多条规则用 🕳 分隔。
// - type、name、url、includeUnsupportedProxy：与 template.js 相同。
//
// 优先级：对同一模板分组，outbound 参数规则取代远程规则；对同一订阅节点，
// detour 参数在远程规则之后执行，因而覆盖远程规则设置的 detour。

const DEFAULT_RULES_URL = 'https://raw.githubusercontent.com/muzhi9018/sing-box-config/master/script/node-rules.json'
const COMPATIBLE_OUTBOUND = {
  tag: 'COMPATIBLE',
  type: 'direct',
}

log('🚀 开始')

let {
  type,
  name,
  outbound,
  detour,
  rulesUrl = DEFAULT_RULES_URL,
  includeUnsupportedProxy,
  url,
} = $arguments

log(`传入参数 type: ${type}, name: ${name}, outbound: ${outbound}, detour: ${detour}, rulesUrl: ${rulesUrl}`)

type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
log(`① 使用 ${ProxyUtils.JSON5 ? 'JSON5' : 'JSON'} 解析 sing-box 模板`)
let config
try {
  config = parser.parse($content ?? $files[0])
} catch (error) {
  log(`${error.message ?? error}`)
  throw new Error(`sing-box 模板不是合法的 ${ProxyUtils.JSON5 ? 'JSON5' : 'JSON'} 格式`)
}

log('② 获取订阅')
const artifact = await produceSubscriptionArtifact({
  type,
  name,
  url,
  includeUnsupportedProxy,
})
const subscription = JSON.parse(artifact)
const subscriptionOutbounds = subscription.outbounds ?? []
const endpoints = subscription.endpoints ?? []
const proxies = [...subscriptionOutbounds, ...endpoints]
log(`获取到 ${subscriptionOutbounds.length} 个节点, ${endpoints.length} 个端点`)

log('③ 获取远程节点规则')
const remoteRules = await loadRemoteRules(rulesUrl)
const remoteOutboundRules = parseRemoteOutboundRules(remoteRules.outbound_rules)
const remoteDetourRules = parseRemoteDetourRules(remoteRules.detour_rules)

log('④ 解析用户自定义规则')
const userOutboundRules = parseOutboundRules(outbound)
const userDetourRules = parseDetourRules(detour)

log('⑤ 为订阅节点设置 detour')
applyDetourRules(subscriptionOutbounds, remoteDetourRules, '远程')
applyDetourRules(subscriptionOutbounds, userDetourRules, '用户')

log('⑥ 将节点插入模板分组')
if (!Array.isArray(config.outbounds)) {
  config.outbounds = []
}
const managedOutbounds = applyOutboundRules(
  config.outbounds,
  proxies,
  remoteOutboundRules,
  userOutboundRules,
)

log('⑦ 空分组检查')
ensureCompatibleOutbounds(config.outbounds, managedOutbounds)

config.outbounds.push(...subscriptionOutbounds)
if (!Array.isArray(config.endpoints)) {
  config.endpoints = []
}
config.endpoints.push(...endpoints)

$content = JSON.stringify(config, null, 2)

async function produceSubscriptionArtifact({ type, name, url, includeUnsupportedProxy }) {
  const options = {
    name,
    type,
    platform: 'sing-box',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupportedProxy,
    },
  }

  if (!url) {
    log(`将读取名称为 ${name} 的 ${type === 'collection' ? '组合' : ''}订阅`)
    return produceArtifact(options)
  }

  log(`直接从 URL ${url} 读取订阅`)
  return produceArtifact({
    ...options,
    subscription: {
      name,
      url,
      source: 'remote',
    },
  })
}

async function loadRemoteRules(rulesUrl) {
  if (!rulesUrl) {
    throw new Error('rulesUrl 不能为空')
  }

  let text
  try {
    text = await fetchText(rulesUrl)
  } catch (error) {
    throw new Error(`读取远程节点规则失败: ${error.message ?? error}`)
  }

  try {
    const rules = JSON.parse(text)
    if (!rules || Array.isArray(rules) || typeof rules !== 'object') {
      throw new Error('根节点必须是对象')
    }
    return rules
  } catch (error) {
    throw new Error(`远程节点规则不是合法 JSON: ${error.message ?? error}`)
  }
}

async function fetchText(requestUrl) {
  if (typeof fetch === 'function') {
    const response = await fetch(requestUrl)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return response.text()
  }

  if (typeof $httpClient !== 'undefined') {
    return new Promise((resolve, reject) => {
      $httpClient.get(requestUrl, (error, response, data) => {
        if (error) {
          reject(error)
        } else if (response.status && response.status >= 400) {
          reject(new Error(`HTTP ${response.status}`))
        } else {
          resolve(data)
        }
      })
    })
  }

  throw new Error('当前 Sub-Store 运行环境不支持 HTTP 请求')
}

function parseRemoteOutboundRules(rules) {
  if (rules == null) {
    return []
  }
  if (!Array.isArray(rules)) {
    throw new Error('outbound_rules 必须是数组')
  }

  return rules.map((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`outbound_rules[${index}] 必须是对象`)
    }
    if (!Array.isArray(rule.target_tags) || rule.target_tags.length === 0 || !rule.target_tags.every(isNonEmptyString)) {
      throw new Error(`outbound_rules[${index}].target_tags 必须是非空字符串数组`)
    }
    if (rule.match != null && typeof rule.match !== 'string') {
      throw new Error(`outbound_rules[${index}].match 必须是字符串`)
    }
    if (rule.exclude != null && typeof rule.exclude !== 'string') {
      throw new Error(`outbound_rules[${index}].exclude 必须是字符串`)
    }

    const includeRegex = createRegExp(rule.match || '.*', `outbound_rules[${index}].match`)
    const excludeRegex = rule.exclude ? createRegExp(rule.exclude, `outbound_rules[${index}].exclude`) : undefined
    log(`远程规则 ${index + 1}: 节点匹配 ${includeRegex}${excludeRegex ? `，排除 ${excludeRegex}` : ''}，插入 ${rule.target_tags.join('、')}`)
    return {
      targetTags: new Set(rule.target_tags),
      includeRegex,
      excludeRegex,
    }
  })
}

function parseRemoteDetourRules(rules) {
  if (rules == null) {
    return []
  }
  if (!Array.isArray(rules)) {
    throw new Error('detour_rules 必须是数组')
  }

  return rules.map((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`detour_rules[${index}] 必须是对象`)
    }
    if (!isNonEmptyString(rule.match) || !isNonEmptyString(rule.detour)) {
      throw new Error(`detour_rules[${index}] 需要非空的 match 和 detour`)
    }

    const tagRegex = createRegExp(rule.match, `detour_rules[${index}].match`)
    log(`远程 detour 规则 ${index + 1}: ${tagRegex} -> ${rule.detour}`)
    return { tagRegex, detourTag: rule.detour }
  })
}

function parseOutboundRules(value) {
  if (!value) {
    return []
  }

  return value
    .split('🕳')
    .map(rule => rule.trim())
    .filter(Boolean)
    .map(rule => {
      const [outboundPattern, tagPattern = '.*'] = rule.split('🏷').map(part => part.trim())
      if (!outboundPattern) {
        throw new Error(`outbound 规则格式错误: ${rule}`)
      }
      const outboundRegex = createRegExp(outboundPattern, 'outbound')
      const tagRegex = createRegExp(tagPattern || '.*', 'outbound 节点匹配规则')
      log(`用户 outbound 规则: ${outboundRegex} <- ${tagRegex}`)
      return { outboundRegex, tagRegex }
    })
}

function parseDetourRules(value) {
  if (!value) {
    return []
  }

  return value
    .split('🕳')
    .map(rule => rule.trim())
    .filter(Boolean)
    .map(rule => {
      const [tagPattern, detourTag] = rule.split('🏷').map(part => part.trim())
      if (!tagPattern || !detourTag) {
        throw new Error(`detour 规则格式错误: ${rule}，应为“节点名称匹配规则🏷detour 标签”`)
      }
      const tagRegex = createRegExp(tagPattern, 'detour 节点匹配规则')
      log(`用户 detour 规则: ${tagRegex} -> ${detourTag}`)
      return { tagRegex, detourTag }
    })
}

function applyDetourRules(outbounds, rules, source) {
  rules.forEach(({ tagRegex, detourTag }) => {
    const matched = outbounds.filter(outbound => tagRegex.test(outbound.tag))
    matched.forEach(outbound => {
      outbound.detour = detourTag
    })
    log(`${source} detour 规则匹配 ${matched.length} 个节点，设置 detour 为 ${detourTag}`)
  })
}

function applyOutboundRules(templateOutbounds, proxies, remoteRules, userRules) {
  const managedOutbounds = []

  templateOutbounds.forEach(templateOutbound => {
    const userMatches = userRules.filter(rule => rule.outboundRegex.test(templateOutbound.tag))
    const applicableRules = userMatches.length > 0
      ? userMatches
      : remoteRules.filter(rule => rule.targetTags.has(templateOutbound.tag))

    if (applicableRules.length === 0) {
      return
    }

    managedOutbounds.push(templateOutbound)
    if (!Array.isArray(templateOutbound.outbounds)) {
      templateOutbound.outbounds = []
    }

    applicableRules.forEach(rule => {
      const tags = getTags(proxies, rule)
      templateOutbound.outbounds.push(...tags)
      const source = userMatches.length > 0 ? '用户' : '远程'
      log(`${source}规则匹配分组 ${templateOutbound.tag}，插入 ${tags.length} 个节点`)
    })
  })

  return managedOutbounds
}

function ensureCompatibleOutbounds(templateOutbounds, managedOutbounds) {
  let compatibleAdded = templateOutbounds.some(outbound => outbound.tag === COMPATIBLE_OUTBOUND.tag)

  managedOutbounds.forEach(outbound => {
    if (outbound.outbounds.length > 0) {
      return
    }
    if (!compatibleAdded) {
      templateOutbounds.push(COMPATIBLE_OUTBOUND)
      compatibleAdded = true
    }
    outbound.outbounds.push(COMPATIBLE_OUTBOUND.tag)
    log(`${outbound.tag} 为空，自动插入 COMPATIBLE(direct)`)
  })
}

function getTags(proxies, rule) {
  if (rule.excludeRegex) {
    return proxies
      .filter(proxy => rule.includeRegex.test(proxy.tag) && !rule.excludeRegex.test(proxy.tag))
      .map(proxy => proxy.tag)
  }
  return proxies.filter(proxy => rule.tagRegex?.test(proxy.tag) ?? rule.includeRegex.test(proxy.tag)).map(proxy => proxy.tag)
}

function createRegExp(pattern, field) {
  try {
    return new RegExp(pattern.replace('ℹ️', ''), pattern.includes('ℹ️') ? 'i' : undefined)
  } catch (error) {
    throw new Error(`${field} 不是合法正则: ${error.message ?? error}`)
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function log(value) {
  console.log(`[📦 sing-box 远程规则模板脚本] ${value}`)
}

log('🔚 结束')
