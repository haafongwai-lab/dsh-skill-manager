/**
 * dsh-skill-manager — Host half.
 *
 * 统一管理 Agent 技能：把 `ctx.skills` 的只读视图原样投影给侧栏面板，同时
 * 提供一套受控的写通道，让用户在页面上新建 / 编辑 / 删除 SKILL.md。
 *
 * 设计要点：
 *  - **磁盘是唯一事实来源。** 读路径完全走 `ctx.skills`（它已做分层合并、
 *    同名覆盖、排序），本插件不自己解析目录 —— 否则页面上的清单会和模型
 *    看到的目录悄悄分叉。
 *  - **启停用平台原生语义。** `skills` 服务没有「禁用某个技能」的 API，但
 *    SKILL.md 的 frontmatter 支持 `disable-model-invocation`，而模型目录
 *    在 `dsh-tool-skill` 里确实按 `isModelInvocable` 过滤。所以启停就是改
 *    这一个字段，不引入影子 provider，也不需要重启。
 *  - **写入是原子的。** 临时文件 + rename，按文件串行化；名字先过
 *    `^[a-z0-9]+(?:-[a-z0-9]+)*$`，路径再做穿越检查。
 *  - **只读来源不给删除。** bundled / 插件运行时注册的技能不落在可写根里，
 *    面板上不提供删除按钮，Host 侧也会再拒一次。
 *
 * HTTP API（同源，前缀 /dsh-skill-manager/api）：
 *   GET  /skills?cwd=     列出全部技能（合并视图 + 可写性 + 覆盖层）
 *   GET  /skill?name=     全文、绝对路径、frontmatter 原文
 *   POST /skill/save      新建或更新（{ name, description, content, whenToUse, target, previousName }）
 *   POST /skill/import    批量导入（{ items: [{ type: 'file' | 'folder', ... }], target }）
 *   POST /skill/delete    删除（{ name }）
 *   POST /skill/toggle    启停模型可见性（{ name, enabled }）
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { SKILL_NAME, ensureSkillFrontmatter, parseSkillMarkdown, renderSkillFile, splitFrontmatter, withModelInvocation } from './skill-file.js'

export const name = 'dsh-skill-manager'
// 文件夹要装得下 references / scripts / assets，请求体得比散装 Markdown 宽裕。
const MAX_BODY_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_SKILL_BYTES = 262144
const MAX_DESCRIPTION = 2000
/** 一次导入的条目数上限（一个文件夹算一条）：再多就该走命令行。 */
const MAX_IMPORT_FILES = 200
/** 单个技能文件夹的文件数与总字节数上限，防止一个请求拖垮磁盘。 */
const MAX_FOLDER_FILES = 100
const MAX_FOLDER_BYTES = 4 * 1024 * 1024

export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-skill-manager',
    validate(value) {
      if (value === undefined || value === null) value = {}
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { issues: [{ message: 'plugin config must be an object' }] }
      }
      const extraRoots = Array.isArray(value.extraRoots)
        ? value.extraRoots.filter((entry) => typeof entry === 'string' && entry.length > 0)
        : []
      const maxSkillBytes = Number(value.maxSkillBytes)
      return {
        value: {
          extraRoots,
          allowWrite: value.allowWrite !== false,
          maxSkillBytes: Number.isFinite(maxSkillBytes) && maxSkillBytes > 0
            ? Math.min(Math.trunc(maxSkillBytes), 4 * 1024 * 1024)
            : DEFAULT_MAX_SKILL_BYTES,
        },
      }
    },
  },
}

const DSH_HOME = () => process.env.DSH_HOME || join(homedir(), '.dsh')

function warn(...args) {
  console.error('[dsh-skill-manager]', ...args)
}

// ---------------------------------------------------------------------------
// 可写根目录
// ---------------------------------------------------------------------------

/**
 * 允许写入的根目录，按优先级排列。
 *
 * 面板上的「保存到」选项直接来自这里：用户/项目两种归属，与
 * `skill-filesystem` 的 user-dsh / project-dsh 两个源一一对应。
 */
function writableRoots({ cwd, extraRoots }) {
  const roots = []
  const projectRoot = typeof cwd === 'string' && cwd.length > 0 ? resolve(cwd) : ''
  if (projectRoot) {
    roots.push({ id: 'project', dir: join(projectRoot, '.dsh', 'skills'), label: 'project' })
  }
  roots.push({ id: 'user', dir: join(DSH_HOME(), 'skills'), label: 'user' })
  for (const extra of extraRoots || []) {
    const dir = isAbsolute(extra) ? extra : resolve(extra)
    if (!roots.some((root) => samePath(root.dir, dir))) {
      roots.push({ id: `custom:${dir}`, dir, label: 'custom' })
    }
  }
  return roots
}

function samePath(a, b) {
  const normalize = (value) => resolve(value).replace(/[\\/]+$/, '').toLowerCase()
  return normalize(a) === normalize(b)
}

/** 目标路径必须落在某个可写根之内 —— 这是防 `../` 穿越的唯一关口。 */
function insideRoot(dir, root) {
  const rel = relative(resolve(root), resolve(dir))
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel) && !rel.includes(`..${sep}`)
}

/**
 * 文件夹里每个文件的相对路径都必须是安全的相对路径。
 *
 * 客户端可能来自任何浏览器，`webkitRelativePath` 也不是可信输入：任何
 * `..`、绝对路径、盘符、空段、Windows 保留字符都直接拒掉，绝不让它们
 * 有机会参与 join()。
 */
function safeRelativePath(value) {
  if (typeof value !== 'string') return undefined
  const path = value.replace(/\\/g, '/').trim()
  if (!path || path.includes('\u0000')) return undefined
  if (path.startsWith('/') || /^[A-Za-z]:\//.test(path)) return undefined
  const parts = path.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..' || /[<>:"|?*]/.test(part))) return undefined
  return parts.join('/')
}

/** 文件夹里的文件按二进制搬运：客户端给 base64（也接受纯文本，便于脚本/测试）。 */
function decodeImportFile(entry) {
  if (!entry || typeof entry !== 'object') return undefined
  if (typeof entry.text === 'string') return Buffer.from(entry.text, 'utf8')
  if (typeof entry.data === 'string') {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(entry.data)) return undefined
    return Buffer.from(entry.data, 'base64')
  }
  return undefined
}

function resolveTarget(roots, targetId, skillName) {
  const root = roots.find((entry) => entry.id === targetId) || roots[roots.length - 1]
  if (!root) return undefined
  const dir = join(root.dir, skillName)
  if (!insideRoot(dir, root.dir)) return undefined
  return { root, dir, file: join(dir, 'SKILL.md') }
}

// ---------------------------------------------------------------------------
// 覆盖层：本插件自己的少量状态
// ---------------------------------------------------------------------------

/**
 * 覆盖层只存「本插件想记住、但磁盘上不该有的东西」。
 *
 * 目前只有一个：哪些技能被本插件停用过。它的用途不是决定启停（启停已经写进
 * frontmatter 了），而是在面板上标出「这是你停的」，与技能作者自己写的
 * `disable-model-invocation` 区分开。
 */
function createOverlay(file) {
  let disabled = new Set()
  let loaded = false
  let writeChain = Promise.resolve()

  async function load() {
    if (loaded) return
    loaded = true
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      const list = parsed && Array.isArray(parsed.disabled) ? parsed.disabled : []
      disabled = new Set(list.filter((entry) => typeof entry === 'string'))
    } catch (error) {
      if (error && error.code !== 'ENOENT') warn(`failed to read ${file}:`, String(error.message || error))
      disabled = new Set()
    }
  }

  function persist() {
    const payload = JSON.stringify({ version: 1, disabled: [...disabled].sort() }, null, 2)
    writeChain = writeChain.then(async () => {
      await mkdir(dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      await writeFile(tmp, payload, 'utf8')
      await rename(tmp, file)
    })
    return writeChain
  }

  return {
    path: file,
    async has(skillName) {
      await load()
      return disabled.has(skillName)
    },
    async set(skillName, on) {
      await load()
      if (on) disabled.add(skillName)
      else disabled.delete(skillName)
      await persist()
    },
    async clear(skillName) {
      await load()
      if (!disabled.has(skillName)) return
      disabled.delete(skillName)
      await persist()
    },
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        rejectBody(new Error('request-body-too-large'))
        return
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolveBody(text ? JSON.parse(text) : {})
      } catch (error) {
        rejectBody(error)
      }
    })
    req.on('error', rejectBody)
  })
}

function queryOf(req) {
  try {
    return new URL(req.url || '/', 'http://localhost').searchParams
  } catch {
    return new URLSearchParams()
  }
}

/**
 * 一条技能的展示记录。
 *
 * `writable` 决定面板给不给编辑/删除按钮；`dir` 是可写根里的绝对目录，
 * 只在可写时才下发 —— 只读来源的路径对面板没有用处。
 */
function describe(skill, roots, disabledOverride) {
  const path = typeof skill.path === 'string' ? skill.path : ''
  const directory = path ? dirname(path) : ''
  const root = directory ? roots.find((entry) => insideRoot(directory, entry.dir)) : undefined
  const modelInvocable = !(skill.invocation && skill.invocation.modelInvocable === false)
  return {
    name: skill.name,
    description: skill.description || '',
    whenToUse: typeof skill.whenToUse === 'string' ? skill.whenToUse : '',
    source: typeof skill.source === 'string' ? skill.source : 'unknown',
    provider: typeof skill.provider === 'string' ? skill.provider : 'unknown',
    modelInvocable,
    userInvocable: !(skill.invocation && skill.invocation.userInvocable === false),
    disabledByManager: disabledOverride === true,
    path: path || undefined,
    writable: Boolean(root),
    target: root ? root.id : undefined,
  }
}

function registerRoutes(sub, deps) {
  const prefix = '/dsh-skill-manager/api'
  const { config, overlay, workspaceCwd, agentsOf } = deps

  const rootsFor = (cwd) => writableRoots({ cwd: cwd || workspaceCwd(), extraRoots: config.extraRoots })

  /**
   * 逐个视图选项去问 `ctx.skills`。
   *
   * 关键：`skills.snapshot()` 不传 `scope` 时**只读全局层**，而 `skill-filesystem`
   * 这类 provider 注册在 agent preset 的 scoped 层里 —— 只传 cwd 会得到一份
   * 「只有内置技能」的清单，而且 `complete` 仍然是 true，面板会理直气壮地
   * 谎报全量。所以要遍历所有活着的 agent，把各自作用域的结果并起来。
   */
  function viewOptions(cwd) {
    const options = [{ cwd }]
    for (const agent of agentsOf()) options.push({ cwd, scope: agent })
    return options
  }

  /** 合并所有作用域的清单：先到的名字胜出（全局层优先）。 */
  async function collectAll(cwd, optionsList) {
    const merged = new Map()
    let complete = true
    for (const options of optionsList) {
      let snapshot
      try {
        snapshot = await sub.skills.snapshot(options)
      } catch (error) {
        // 某个作用域读失败不该让整页空白，但必须诚实地说「不完整」。
        complete = false
        warn('skills.snapshot failed:', String((error && error.message) || error))
        continue
      }
      if (snapshot.complete !== true) complete = false
      for (const skill of snapshot.skills) {
        if (!merged.has(skill.name)) merged.set(skill.name, skill)
      }
    }
    return { skills: [...merged.values()], complete }
  }

  /** 按名字取全文：同样要遍历作用域，否则用户技能永远查不到。 */
  async function getSkill(skillName, cwd) {
    for (const options of viewOptions(cwd)) {
      try {
        const skill = await sub.skills.get(skillName, options)
        if (skill) return skill
      } catch (error) {
        warn(`skills.get("${skillName}") failed:`, String((error && error.message) || error))
      }
    }
    return undefined
  }

  sub.webServer.register({
    kind: 'exact',
    path: `${prefix}/skills`,
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      try {
        const cwd = queryOf(req).get('cwd') || workspaceCwd()
        const roots = rootsFor(cwd)
        const options = viewOptions(cwd)
        const collected = await collectAll(cwd, options)
        const skills = []
        for (const skill of collected.skills) {
          const disabledByManager = await overlay.has(skill.name)
          skills.push(describe(skill, roots, disabledByManager))
        }
        return sendJson(res, 200, {
          ok: true,
          complete: collected.complete,
          allowWrite: config.allowWrite,
          cwd,
          // 诊断用：实际问过几个作用域。1 = 只有全局层（agent 服务没拿到）。
          scopes: options.length,
          roots: roots.map((root) => ({ id: root.id, label: root.label, dir: root.dir })),
          skills,
        })
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    },
  })

  sub.webServer.register({
    kind: 'exact',
    path: `${prefix}/skill`,
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      try {
        const params = queryOf(req)
        const skillName = params.get('name') || ''
        if (!SKILL_NAME.test(skillName)) return sendJson(res, 400, { ok: false, error: 'invalid-name' })
        const cwd = params.get('cwd') || workspaceCwd()
        const skill = await getSkill(skillName, cwd)
        if (!skill) return sendJson(res, 404, { ok: false, error: 'not-found' })
        const roots = rootsFor(cwd)
        const record = describe(skill, roots, await overlay.has(skillName))
        let raw = ''
        if (record.path) {
          try {
            raw = await readFile(record.path, 'utf8')
          } catch (error) {
            if (!error || error.code !== 'ENOENT') {
              warn(`failed to read ${record.path}:`, String((error && error.message) || error))
            }
          }
        }
        const split = splitFrontmatter(raw)
        return sendJson(res, 200, {
          ok: true,
          skill: { ...record, content: skill.content || '', frontmatter: split.frontmatter },
        })
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    },
  })

  /**
   * 写一个技能到磁盘。保存与导入共用这一条路径 —— 同样的校验、同样的原子写，
   * 导入不能绕过任何约束。
   *
   * @returns {{ ok: true, name, path, target, bytes } | { ok: false, status, error, ... }}
   */
  async function writeSkill(input) {
    const skillName = typeof input.name === 'string' ? input.name.trim() : ''
    if (!SKILL_NAME.test(skillName)) return { ok: false, status: 400, error: 'invalid-name' }

    const description = typeof input.description === 'string' ? input.description.trim() : ''
    if (description.length === 0) return { ok: false, status: 400, error: 'empty-description' }
    if (description.length > MAX_DESCRIPTION) return { ok: false, status: 400, error: 'description-too-long' }

    const content = typeof input.content === 'string' ? input.content : ''
    const whenToUse = typeof input.whenToUse === 'string' ? input.whenToUse : ''
    const modelInvocable = input.modelInvocable !== false

    const cwd = typeof input.cwd === 'string' && input.cwd.length > 0 ? input.cwd : workspaceCwd()
    const roots = rootsFor(cwd)
    const target = resolveTarget(roots, input.target, skillName)
    if (!target) return { ok: false, status: 400, error: 'invalid-target' }

    // 散装 Markdown 由本插件渲染；文件夹导入则原样保留导入的 SKILL.md 字节
    // （上面已补齐必需的 frontmatter），不能把它重排成插件生成的样子。
    const text = typeof input.raw === 'string'
      ? input.raw
      : renderSkillFile({ name: skillName, description, content, whenToUse, modelInvocable })
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > config.maxSkillBytes) {
      return { ok: false, status: 413, error: 'too-large', maxBytes: config.maxSkillBytes }
    }

    // 改名 = 先写新目录再删旧目录。先写保证中途失败不会两头落空。
    const previousName = typeof input.previousName === 'string' ? input.previousName.trim() : ''
    await mkdir(target.dir, { recursive: true })
    const tmp = `${target.file}.${process.pid}.tmp`
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, target.file)

    if (previousName && previousName !== skillName && SKILL_NAME.test(previousName)) {
      const previous = resolveTarget(roots, target.root.id, previousName)
      if (previous && !samePath(previous.dir, target.dir)) {
        try {
          await rm(previous.dir, { recursive: true, force: true })
          await overlay.clear(previousName)
        } catch (error) {
          warn(`failed to remove renamed skill ${previousName}:`, String((error && error.message) || error))
        }
      }
    }

    return { ok: true, name: skillName, path: target.file, target: target.root.id, bytes }
  }

  sub.webServer.register({
    kind: 'exact',
    path: `${prefix}/skill/save`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      if (!config.allowWrite) return sendJson(res, 403, { ok: false, error: 'read-only' })
      try {
        const body = await readJsonBody(req)
        const result = await writeSkill(body)
        if (!result.ok) return sendJson(res, result.status, result)
        return sendJson(res, 200, result)
      } catch (error) {
        if (error && error.message === 'request-body-too-large') {
          return sendJson(res, 413, { ok: false, error: 'body-too-large' })
        }
        return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    },
  })

  /**
   * 导入：把一批 Markdown 原文或整个技能文件夹写成技能。
   *
   * 逐条独立处理并回报每一条的结果 —— 一批里有一个坏文件，不该让其余九个
   * 也进不来。同名技能按「覆盖」处理（这正是重新导入一份配置想做的事），
   * 但会在报告里标出 created / updated，不假装都是新建。
   *
   * 请求体用 `items` 混排两种条目，报告顺序与 items 一一对应：
   *   { type: 'file',   name, text }
   *   { type: 'folder', name, files: [{ path, data(base64) | text }] }
   * 旧版只传 `files` 的请求仍然兼容（散装 Markdown）。
   */
  sub.webServer.register({
    kind: 'exact',
    path: `${prefix}/skill/import`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      if (!config.allowWrite) return sendJson(res, 403, { ok: false, error: 'read-only' })
      try {
        const body = await readJsonBody(req)
        const items = Array.isArray(body.items)
          ? body.items
          : (Array.isArray(body.files)
            ? body.files.map((file) => ({ ...file, type: 'file' }))
            : [])
        if (items.length === 0) return sendJson(res, 400, { ok: false, error: 'empty-import' })
        if (items.length > MAX_IMPORT_FILES) {
          return sendJson(res, 413, { ok: false, error: 'too-many-files', max: MAX_IMPORT_FILES })
        }

        const cwd = typeof body.cwd === 'string' && body.cwd.length > 0 ? body.cwd : workspaceCwd()
        const targetId = typeof body.target === 'string' ? body.target : 'user'

        // 导入前先摸清现有名字，用来区分 created / updated。
        const existing = new Set()
        for (const skill of (await collectAll(cwd, viewOptions(cwd))).skills) existing.add(skill.name)

        /**
         * 写一个技能文件夹：SKILL.md 仍走 writeSkill（同一套校验 + 原子写），
         * 其余文件按相对路径二进制原样落到同一个目录。
         *
         * 与「散装 Markdown」不同，文件夹导入保留 SKILL.md 原文字节（只补齐
         * 必需的 frontmatter），因为这类技能常带平台不认识的元数据、脚本与
         * references —— 重排成插件生成的样子等于把别人的技能改坏了。
         */
        async function writeFolder(item) {
          const label = typeof item.name === 'string' && item.name.length > 0 ? item.name : 'folder'
          const entries = Array.isArray(item.files) ? item.files : []
          if (entries.length === 0) return { ok: false, error: 'empty-folder' }
          if (entries.length > MAX_FOLDER_FILES) {
            return { ok: false, error: 'too-many-folder-files', max: MAX_FOLDER_FILES }
          }

          const decoded = []
          let totalBytes = 0
          for (const entry of entries) {
            const path = safeRelativePath(entry && entry.path)
            if (!path) return { ok: false, error: 'invalid-path' }
            const buffer = decodeImportFile(entry)
            if (!buffer) return { ok: false, error: 'invalid-file' }
            totalBytes += buffer.length
            if (totalBytes > MAX_FOLDER_BYTES) return { ok: false, error: 'folder-too-large' }
            decoded.push({ path, buffer })
          }

          const skillMd = decoded.find((entry) => entry.path.toLowerCase() === 'skill.md')
          if (!skillMd) return { ok: false, error: 'missing-skill-md' }
          const raw = skillMd.buffer.toString('utf8').replace(/^\uFEFF/, '')
          if (raw.trim().length === 0) return { ok: false, error: 'empty-file' }
          if (skillMd.buffer.length > config.maxSkillBytes) {
            return { ok: false, error: 'too-large', maxBytes: config.maxSkillBytes }
          }

          const parsed = parseSkillMarkdown(raw, label)
          if (!SKILL_NAME.test(parsed.name)) return { ok: false, error: 'invalid-name', name: parsed.name }
          if (parsed.description.length === 0) return { ok: false, error: 'empty-description', name: parsed.name }

          const text = ensureSkillFrontmatter(raw, {
            name: parsed.name,
            description: parsed.description,
            whenToUse: parsed.whenToUse,
            modelInvocable: parsed.modelInvocable,
          })
          const written = await writeSkill({
            name: parsed.name,
            description: parsed.description,
            whenToUse: parsed.whenToUse,
            content: parsed.content,
            modelInvocable: parsed.modelInvocable,
            target: targetId,
            cwd,
            raw: text,
          })
          if (!written.ok) return { ok: false, error: written.error, name: parsed.name }

          // 附属文件（references / scripts / assets…）按原路径落到技能目录里。
          const dir = dirname(written.path)
          try {
            for (const entry of decoded) {
              if (entry.path.toLowerCase() === 'skill.md') continue
              const dest = join(dir, entry.path)
              if (!insideRoot(dest, dir)) return { ok: false, error: 'invalid-path', name: written.name }
              await mkdir(dirname(dest), { recursive: true })
              const tmp = `${dest}.${process.pid}.tmp`
              await writeFile(tmp, entry.buffer)
              await rename(tmp, dest)
            }
          } catch (error) {
            warn(`failed to copy skill folder ${label}:`, String((error && error.message) || error))
            return { ok: false, error: 'write-failed', name: written.name }
          }
          return { ok: true, name: written.name, created: !existing.has(written.name), target: written.target }
        }

        const report = []
        for (const item of items) {
          const isFolder = Boolean(item && item.type === 'folder')
          const filename = item && typeof item.name === 'string' ? item.name : ''
          if (!item || typeof item !== 'object') {
            report.push({ ok: false, filename, error: 'invalid-item' })
            continue
          }

          if (isFolder) {
            try {
              const result = await writeFolder(item)
              report.push({ ok: result.ok, filename, kind: 'folder', ...result })
              if (result.ok) existing.add(result.name)
            } catch (error) {
              report.push({ ok: false, filename, kind: 'folder', error: String((error && error.message) || error) })
            }
            continue
          }

          // 散装 Markdown：与旧版完全一样，一个文件就是一条技能。
          const text = typeof item.text === 'string' ? item.text : ''
          if (text.trim().length === 0) {
            report.push({ ok: false, filename, error: 'empty-file' })
            continue
          }
          if (Buffer.byteLength(text, 'utf8') > config.maxSkillBytes) {
            report.push({ ok: false, filename, error: 'too-large', maxBytes: config.maxSkillBytes })
            continue
          }
          const parsed = parseSkillMarkdown(text, filename)
          if (!SKILL_NAME.test(parsed.name)) {
            report.push({ ok: false, filename, error: 'invalid-name', name: parsed.name })
            continue
          }
          if (parsed.description.length === 0) {
            report.push({ ok: false, filename, error: 'empty-description', name: parsed.name })
            continue
          }
          try {
            const written = await writeSkill({
              name: parsed.name,
              description: parsed.description,
              whenToUse: parsed.whenToUse,
              content: parsed.content,
              modelInvocable: parsed.modelInvocable,
              target: targetId,
              cwd,
            })
            if (!written.ok) {
              report.push({ ok: false, filename, error: written.error, name: parsed.name })
              continue
            }
            report.push({
              ok: true,
              filename,
              name: written.name,
              created: !existing.has(written.name),
              target: written.target,
            })
            existing.add(written.name)
          } catch (error) {
            report.push({ ok: false, filename, error: String((error && error.message) || error), name: parsed.name })
          }
        }

        const imported = report.filter((entry) => entry.ok)
        return sendJson(res, 200, {
          ok: true,
          total: report.length,
          imported: imported.length,
          created: imported.filter((entry) => entry.created).length,
          updated: imported.filter((entry) => !entry.created).length,
          failed: report.length - imported.length,
          report,
        })
      } catch (error) {
        if (error && error.message === 'request-body-too-large') {
          return sendJson(res, 413, { ok: false, error: 'body-too-large' })
        }
        return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    },
  })

  sub.webServer.register({
    kind: 'exact',
    path: `${prefix}/skill/delete`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      if (!config.allowWrite) return sendJson(res, 403, { ok: false, error: 'read-only' })
      try {
        const body = await readJsonBody(req)
        const skillName = typeof body.name === 'string' ? body.name.trim() : ''
        if (!SKILL_NAME.test(skillName)) return sendJson(res, 400, { ok: false, error: 'invalid-name' })
        const cwd = typeof body.cwd === 'string' && body.cwd.length > 0 ? body.cwd : workspaceCwd()
        const roots = rootsFor(cwd)
        const target = resolveTarget(roots, body.target, skillName)
        if (!target) return sendJson(res, 400, { ok: false, error: 'invalid-target' })

        // 只删本插件写出来的目录形状（<root>/<name>/SKILL.md），别把整个根删了。
        const info = await stat(target.dir).catch(() => undefined)
        if (!info || !info.isDirectory()) return sendJson(res, 404, { ok: false, error: 'not-found' })
        await rm(target.dir, { recursive: true, force: true })
        await overlay.clear(skillName)
        return sendJson(res, 200, { ok: true, name: skillName })
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    },
  })

  sub.webServer.register({
    kind: 'exact',
    path: `${prefix}/skill/toggle`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      if (!config.allowWrite) return sendJson(res, 403, { ok: false, error: 'read-only' })
      try {
        const body = await readJsonBody(req)
        const skillName = typeof body.name === 'string' ? body.name.trim() : ''
        if (!SKILL_NAME.test(skillName)) return sendJson(res, 400, { ok: false, error: 'invalid-name' })
        const enabled = body.enabled !== false
        const cwd = typeof body.cwd === 'string' && body.cwd.length > 0 ? body.cwd : workspaceCwd()
        const roots = rootsFor(cwd)

        const skill = await getSkill(skillName, cwd)
        if (!skill) return sendJson(res, 404, { ok: false, error: 'not-found' })
        const record = describe(skill, roots, await overlay.has(skillName))
        if (!record.writable || !record.path) return sendJson(res, 403, { ok: false, error: 'read-only-skill' })

        const raw = await readFile(record.path, 'utf8')
        const next = withModelInvocation(raw, enabled)
        if (next === raw) {
          await overlay.set(skillName, !enabled)
          return sendJson(res, 200, { ok: true, name: skillName, enabled, unchanged: true })
        }

        const bytes = Buffer.byteLength(next, 'utf8')
        if (bytes > config.maxSkillBytes) {
          return sendJson(res, 413, { ok: false, error: 'too-large', maxBytes: config.maxSkillBytes })
        }
        const tmp = `${record.path}.${process.pid}.tmp`
        await writeFile(tmp, next, 'utf8')
        await rename(tmp, record.path)
        await overlay.set(skillName, !enabled)
        return sendJson(res, 200, { ok: true, name: skillName, enabled })
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

export function apply(ctx, config) {
  const overlay = createOverlay(join(DSH_HOME(), 'skill-manager', 'overrides.json'))

  // 工作目录：有 workingDirectory 服务时用它的默认值，否则退回进程 cwd。
  const workspaceCwd = () => {
    try {
      const service = ctx.get('workingDirectory')
      if (service && typeof service.defaultDirectory === 'string' && service.defaultDirectory.length > 0) {
        return service.defaultDirectory
      }
    } catch {
      /* fall through */
    }
    return process.cwd()
  }

  /**
   * 当前活着的 agent，用作 `skills.snapshot({ scope })` 的视图键。
   *
   * `skill-filesystem` 挂在 agent preset 的 standing composition 上，它的
   * provider 落在那个作用域的层里。面板要把用户/项目技能列全，就必须按每个
   * agent 的作用域各问一次。`agents` 服务不可用时退回空数组（只剩全局层），
   * 至少内置技能仍然可见。
   */
  const agentsOf = () => {
    try {
      const service = ctx.get('agents')
      if (service && typeof service.list === 'function') return service.list()
    } catch {
      /* fall through */
    }
    return []
  }

  ctx.inject(['skills', 'webServer'], (sub) => {
    registerRoutes(sub, { config, overlay, workspaceCwd, agentsOf })
    console.log('[dsh-skill-manager] routes mounted at /dsh-skill-manager/api')
  })
}
