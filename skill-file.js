/**
 * SKILL.md 的纯文本处理。
 *
 * 单独成文件的原因：这几段逻辑是「保存技能」最容易出错的地方（YAML 引号、
 * frontmatter 边界、只改一行），而它们完全不需要 cordis 上下文就能测。
 * 插件入口只负责路由与 IO，这里只负责字符串。
 */

/** 与 @deepseek-ai/dsh-skill 的 SKILL_NAME 保持一致。 */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 单行 YAML 标量：能用裸标量就用裸标量，需要时退到双引号并转义。
 *
 * 描述里出现 `: ` 或 `#` 时裸写会被 YAML 解析成别的东西，那是「保存成功但
 * 技能消失」的经典来源，所以这里宁可多加引号。
 */
export function quoteYaml(value) {
  const text = String(value)
  if (/^[A-Za-z0-9\u4e00-\u9fff][^:#\n"'\\]*$/.test(text) && !/\s$/.test(text)) return text
  return JSON.stringify(text)
}

/**
 * 把一条技能渲染成 SKILL.md。
 *
 * frontmatter 只写平台真正认识的键：name / description / whenToUse /
 * disable-model-invocation。别的键写进去会被当元数据收走，但用户改不动、
 * 面板也解释不了，所以这里不生成。
 */
export function renderSkillFile({ name, description, content, whenToUse, modelInvocable }) {
  const lines = ['---', `name: ${quoteYaml(name)}`, `description: ${quoteYaml(description)}`]
  if (whenToUse && whenToUse.trim().length > 0) lines.push(`whenToUse: ${quoteYaml(whenToUse.trim())}`)
  if (modelInvocable === false) lines.push('disable-model-invocation: true')
  lines.push('---', '', String(content || '').replace(/\r\n/g, '\n').trim(), '')
  return lines.join('\n')
}

/** 从 SKILL.md 原文里切出 frontmatter 文本与正文，供面板做「原文」视图。 */
export function splitFrontmatter(raw) {
  const text = String(raw).replace(/^\uFEFF/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return { frontmatter: '', body: text.trim() }
  return { frontmatter: match[1], body: text.slice(match[0].length).trim() }
}

/**
 * 从 Markdown 原文里读出一个技能。
 *
 * 导入功能的关键：用户手上的 .md 可能来自任何地方 —— 有的是本插件导出的、
 * 有的手写的、有的来自别的工具。这里只认真正影响技能的四个键，其余字段
 * 当作正文保留，不做「猜格式」。
 *
 * 返回值里的 `name` 可能是空串（文件没写 name），由调用方用文件名兜底；
 * `description` 缺失时退到正文第一段非空行，因为技能没有描述就无法被模型
 * 发现，这比直接拒绝导入更有用。
 */
export function parseSkillMarkdown(raw, fallbackName) {
  const text = String(raw).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  const frontmatter = match ? match[1] : ''
  const body = (match ? text.slice(match[0].length) : text).trim()

  const data = {}
  if (frontmatter) {
    for (const line of frontmatter.split('\n')) {
      const field = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line)
      if (!field) continue
      const key = field[1]
      let value = field[2].trim()
      // 双引号 / 单引号包裹的标量：去掉引号并还原转义。
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        try {
          value = JSON.parse(value)
        } catch {
          value = value.slice(1, -1)
        }
      } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1).replace(/''/g, "'")
      }
      data[key] = value
    }
  }

  const declaredName = typeof data.name === 'string' ? data.name.trim() : ''
  const description = typeof data.description === 'string' ? data.description.trim() : ''
  const whenToUse = typeof data.whenToUse === 'string'
    ? data.whenToUse.trim()
    : (typeof data['when-to-use'] === 'string' ? data['when-to-use'].trim() : '')

  // 描述兜底：正文第一段非空、非标题的行。
  const firstProse = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'))

  // `disable-model-invocation: true` 表示「不可被模型调用」，所以这里要取反。
  // 写反过一次：直接把 true 赋给 modelInvocable，导入的停用技能反而变成启用。
  const disableValue = data['disable-model-invocation']
  const disabled = disableValue === true
    || disableValue === 'true'
    || disableValue === 'yes'
    || disableValue === 1
    || disableValue === '1'

  return {
    name: declaredName || normalizeName(fallbackName || ''),
    description: description || firstProse || '',
    whenToUse,
    content: body,
    // 导入时尊重文件里已经写好的停用标记。
    modelInvocable: !disabled,
    hasFrontmatter: Boolean(frontmatter),
  }
}

/**
 * 把任意字符串收敛成合法的技能名。
 *
 * 文件名常带空格、大写、下划线、中文 —— 直接拿去当目录名会让
 * `SKILL_NAME` 校验失败。这里统一成小写连字符，并压掉连续与首尾的连字符。
 * 中文没有可用的 ASCII 映射，全部剥离后若为空，由调用方要求用户手填。
 */
export function normalizeName(input) {
  return String(input)
    .replace(/\.(md|markdown|txt)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/**
 * 补齐导入技能的 frontmatter，但尽量保留原文字节。
 *
 * 文件夹导入最怕「导入完技能变样」：别的工具生成的 SKILL.md 常带平台不认识
 * 的元数据（allowed-tools、license…），整份重写会把它们连同用户写的注释一起
 * 冲掉。这里只在 name / description 缺失或为空时补行，其余 frontmatter 与
 * 正文原样保留；连 whenToUse / disable-model-invocation 也只是按需补，不覆盖。
 */
export function ensureSkillFrontmatter(raw, { name, description, whenToUse, modelInvocable }) {
  const text = String(raw).replace(/^\uFEFF/, '')

  function patch(lines, key, value) {
    const pattern = new RegExp(`^\\s*${key}\\s*:`, 'i')
    const index = lines.findIndex((line) => pattern.test(line))
    if (index >= 0) {
      const current = lines[index].slice(lines[index].indexOf(':') + 1).trim()
      if (current.length === 0) lines[index] = `${key}: ${quoteYaml(value)}`
      return
    }
    lines.push(`${key}: ${quoteYaml(value)}`)
  }

  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (match) {
    const head = match[1].split(/\r?\n/)
    patch(head, 'name', name)
    patch(head, 'description', description)
    const hasWhen = head.some((line) => /^\s*(whenToUse|when-to-use)\s*:/i.test(line))
    if (whenToUse && !hasWhen) head.push(`whenToUse: ${quoteYaml(whenToUse)}`)
    const hasDisable = head.some((line) => /^\s*disable-model-invocation\s*:/i.test(line))
    if (modelInvocable === false && !hasDisable) head.push('disable-model-invocation: true')
    return `---\n${head.join('\n')}\n---${text.slice(match[0].length)}`
  }

  // 没有 frontmatter：补一段最小头，正文一个字都不动。
  const head = [`name: ${quoteYaml(name)}`, `description: ${quoteYaml(description)}`]
  if (whenToUse) head.push(`whenToUse: ${quoteYaml(whenToUse)}`)
  if (modelInvocable === false) head.push('disable-model-invocation: true')
  return `---\n${head.join('\n')}\n---\n\n${text}`
}

/**
 * 只改 `disable-model-invocation` 这一行，其余字节原样保留。
 *
 * 整份重写会把用户手写的排版、注释、其它元数据全部冲掉 —— 一次「停用」
 * 就把技能文件改成插件生成的样子，是没人能接受的副作用。
 */
export function withModelInvocation(raw, enabled) {
  const text = String(raw).replace(/^\uFEFF/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return raw
  const head = match[1]
  const body = text.slice(match[0].length)
  const kept = head.split(/\r?\n/).filter((line) => !/^\s*disable-model-invocation\s*:/i.test(line))
  if (!enabled) {
    // 放在 frontmatter 末尾，尽量贴近用户原本的顺序习惯。
    while (kept.length > 0 && kept[kept.length - 1].trim().length === 0) kept.pop()
    kept.push('disable-model-invocation: true')
  }
  return `---\n${kept.join('\n')}\n---${body}`
}
