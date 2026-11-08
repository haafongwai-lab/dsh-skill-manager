/**
 * 渲染冒烟测试。
 *
 * 用一个极小的 hook 运行时把页面渲染到稳定态，断言：
 *  - 不抛错（slot entry 抛错会整块空白，控制台只留一行 slot entry crashed）；
 *  - 结构与文案对：标题、计数、卡片、分段控件、来源徽章；
 *  - 不该出现的东西确实不存在（诊断小字、未翻译的键名）。
 *
 * 它**不证明好看**，只证明结构对、不崩。观感必须在运行中的页面里看。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const here = import.meta.dirname
const source = await readFile(join(here, '..', 'client.js'), 'utf8')

// ---------------------------------------------------------------------------
// 极小 React 替身：只实现 client.js 用到的那几个 hook 与 createElement
// ---------------------------------------------------------------------------

function createHarness() {
  let hookIndex = 0
  let hooks = []
  let effects = []
  // 状态变了要重渲染 —— 真实的 React 会这么做，这里用 dirty 标记模拟。
  let dirty = false

  const React = {
    createElement(type, props, ...children) {
      return {
        type,
        props: props || {},
        children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
      }
    },
    Fragment: Symbol('Fragment'),
    useState(initial) {
      const index = hookIndex++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        const value = typeof next === 'function' ? next(hooks[index]) : next
        if (!Object.is(value, hooks[index])) {
          hooks[index] = value
          dirty = true
        }
      }
      return [hooks[index], set]
    },
    useRef(initial) {
      const index = hookIndex++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
    useMemo(factory) {
      const index = hookIndex++
      if (!(index in hooks)) hooks[index] = factory()
      return hooks[index]
    },
    useCallback(fn) {
      const index = hookIndex++
      if (!(index in hooks)) hooks[index] = fn
      return hooks[index]
    },
    useEffect(fn) {
      effects.push(fn)
    },
  }

  return {
    React,
    beginRender() {
      hookIndex = 0
      effects = []
      dirty = false
    },
    takeEffects() {
      const pending = effects
      effects = []
      return pending
    },
    get dirty() {
      return dirty
    },
  }
}

/** 深度优先遍历虚拟树，收集节点。 */
function walk(node, visit) {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node !== 'object') {
    visit(node)
    return
  }
  if (typeof node.type === 'function') {
    // 组件节点：用同一个 hook 槽位渲染它的输出。
    walk(node.type({ ...node.props, children: node.children }), visit)
    return
  }
  visit(node)
  for (const child of node.children) walk(child, visit)
}

function textOf(node) {
  const parts = []
  walk(node, (value) => {
    if (typeof value === 'string' || typeof value === 'number') parts.push(String(value))
  })
  return parts.join(' ')
}

function classesOf(node) {
  const found = new Set()
  walk(node, (value) => {
    if (value && typeof value === 'object' && value.props && typeof value.props.className === 'string') {
      for (const name of value.props.className.split(/\s+/)) if (name) found.add(name)
    }
  })
  return found
}

// ---------------------------------------------------------------------------

/** 从源码里取出 DICT、helpers、api 与 makeUi，装进一个最小模块环境。 */
function loadClient(env) {
  const slice = (startMarker, endMarker) => {
    const start = source.indexOf(startMarker)
    assert.ok(start >= 0, `missing ${startMarker}`)
    const end = source.indexOf(endMarker, start)
    assert.ok(end > start, `missing end marker for ${startMarker}`)
    return source.slice(start, end)
  }

  const dictStart = source.indexOf('const DICT = {')
  const dictEnd = source.indexOf('\n    }\n', dictStart)
  assert.ok(dictStart > 0 && dictEnd > dictStart, 'DICT not found')
  const dictLiteral = source.slice(dictStart + 'const DICT = '.length, dictEnd + 6)

  // API 常量在 DICT 之前，单独读，否则切片会把 DICT 一起切进来。
  const apiPath = /const API = '([^']+)'/.exec(source)
  assert.ok(apiPath, 'API constant missing')

  // helpers：从 PANEL_LOCALE（翻译器依赖它）到 makeUi 之前。
  const helpersSource = slice('const PANEL_LOCALE = ', 'function makeUi(')
  const makeUiSource = slice('function makeUi(', '// -----------------------------------------------------------------------\n    // Styles')

  // 源码顶部的常量组（COLORS / LAND_MS / TOAST_MS 等）在 DICT 之前，单独取。
  const constsStart = source.indexOf('const COLORS = ')
  const constsEnd = source.indexOf('// -----------------------------------------------------------------------\n    // Locale')
  assert.ok(constsStart > 0 && constsEnd > constsStart, 'top-level constants not found')
  const constsSource = source.slice(constsStart, constsEnd)

  const React = env.harness.React
  const factory = new Function('React', 'h', 'window', 'document', 'navigator', 'fetch', 'console',
    `"use strict";
     const API = ${JSON.stringify(apiPath[1])};
     ${constsSource}
     const DICT = ${dictLiteral};
     ${helpersSource}
     ${makeUiSource}
     return { makeUi, DICT };`)
  return factory(React, React.createElement, env.window, env.document, env.navigator, env.fetch, console)
}

function makeTranslate(DICT) {
  return (key, params) => {
    let text = DICT.zh[key] ?? DICT.en[key] ?? key
    if (params) for (const name of Object.keys(params)) text = text.split(`{${name}}`).join(String(params[name]))
    return text
  }
}

/** 反复渲染 + 执行 effect，直到没有新的状态变化（或次数用尽）。 */
async function settle(ui, env, maxRounds = 10) {
  const harness = env.harness
  let tree = null
  for (let round = 0; round < maxRounds; round += 1) {
    harness.beginRender()
    tree = ui.SkillPage({})
    const pending = harness.takeEffects()
    for (const effect of pending) {
      const cleanup = effect()
      if (typeof cleanup === 'function') cleanup()
    }
    // 让 fetch 的 promise 链落地，再判断要不要继续渲染。
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (!harness.dirty && pending.length === 0) {
      harness.beginRender()
      tree = ui.SkillPage({})
      return tree
    }
  }
  harness.beginRender()
  return ui.SkillPage({})
}

const baseWindow = {
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
}

const baseDocument = {
  createElement: () => ({ dataset: {}, append() {}, remove() {} }),
  head: { append() {} },
}

test('页面能渲染到稳定态，且结构对', async () => {
  const skills = [
    { name: 'note-wall-ui-style', description: 'Use when building a Web UI plugin page.', whenToUse: '', source: 'user-dsh', provider: 'filesystem', modelInvocable: true, userInvocable: true, disabledByManager: false, writable: true, target: 'user' },
    { name: 'cordis-plugin-development', description: 'Use when designing a plugin.', whenToUse: '', source: 'bundled', provider: 'filesystem', modelInvocable: true, userInvocable: true, disabledByManager: false, writable: false },
    { name: 'agent-experience', description: 'Use when writing tool definitions.', whenToUse: '', source: 'bundled', provider: 'filesystem', modelInvocable: false, userInvocable: true, disabledByManager: true, writable: false },
  ]

  const env = {
    window: baseWindow,
    document: baseDocument,
    navigator: { platform: 'Win32', userAgent: 'test' },
    harness: createHarness(),
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        complete: true,
        allowWrite: true,
        roots: [{ id: 'user', label: 'user', dir: 'C:/u/.dsh/skills' }],
        skills,
      }),
    }),
  }

  const { makeUi, DICT } = loadClient(env)
  const translate = makeTranslate(DICT)
  const ui = makeUi(translate, undefined, undefined, () => () => {})
  assert.ok(typeof ui.PanelIcon === 'function')
  assert.ok(typeof ui.SkillPage === 'function')

  // 侧栏图标：必须画得出来，且不依赖插件 CSS 类。
  const icon = ui.PanelIcon({ size: 20 })
  assert.equal(classesOf(icon).size, 0, 'sidebar icon should not depend on plugin CSS classes')
  // 钢笔图标是粗描边 SVG：线条明确加粗，且不依赖 emoji 字形的系统渲染。
  assert.equal(icon.type, 'svg', 'sidebar icon is a stroke-based pen')
  assert.ok(Number(icon.props.strokeWidth) >= 2, 'pen lines must be visibly bold')
  assert.equal(icon.props.stroke, 'currentColor', 'pen follows the sidebar color')
  assert.equal(textOf(icon).trim(), '', 'line-art icon carries no text glyph')
  assert.equal(icon.props['aria-hidden'], 'true', 'icon is decorative for assistive tech')
  assert.equal(icon.props.width, 20, 'icon follows the owner supplied size')
  assert.equal(icon.props.height, 20, 'icon follows the owner supplied size')

  // 首帧（loading）必须渲染出标题与工具栏，不能抛错。
  env.harness.beginRender()
  const first = ui.SkillPage({})
  const firstText = textOf(first)
  assert.ok(firstText.includes(DICT.zh.pageTitle), 'page title rendered')
  assert.ok(firstText.includes(DICT.zh.loading), 'loading state rendered')
  const firstClasses = classesOf(first)
  for (const required of ['sm-page', 'sm-head', 'sm-title', 'sm-toolbar', 'sm-search-input', 'sm-composer', 'sm-grid']) {
    assert.ok(firstClasses.has(required), `missing class ${required}`)
  }

  // 渲染到稳定态（effect 拉完数据后）。
  const settled = await settle(ui, env)
  const text = textOf(settled)
  const classes = classesOf(settled)

  // 三张卡片都渲染出来，且名字可见。
  for (const skill of skills) {
    assert.ok(text.includes(skill.name), `card for ${skill.name} rendered`)
  }
  assert.ok(text.includes('3'), 'count rendered')
  assert.ok(classes.has('sm-card'), 'cards rendered')
  assert.ok(classes.has('sm-card-title'), 'card titles rendered')
  assert.ok(classes.has('sm-card-source'), 'source badges rendered')

  // 分段控件：全部 / 用户 / 内置。
  assert.ok(classes.has('sm-segments'), 'segments rendered')
  assert.ok(text.includes(DICT.zh.all), 'all segment')
  assert.ok(text.includes(DICT.zh.srcUser), 'user segment')
  assert.ok(text.includes(DICT.zh.srcBundled), 'bundled segment')

  // 不该出现的东西：原始键名漏到界面上。
  for (const key of ['pageTitle', 'countLabel', 'srcUser', 'emptyHint']) {
    assert.ok(!new RegExp(`\\b${key}\\b`).test(text), `untranslated key leaked: ${key}`)
  }
  // 卡片上不放诊断小字（路径、provider 原文）。
  assert.ok(!text.includes('filesystem'), 'provider detail belongs in the dialog, not on the card')
  assert.ok(!text.includes('C:/u/.dsh/skills'), 'paths belong in the dialog, not on the card')
})

test('只读模式下不渲染输入卡，并给出提示', async () => {
  const env = {
    window: baseWindow,
    document: baseDocument,
    navigator: { platform: 'Win32', userAgent: 'test' },
    harness: createHarness(),
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, complete: true, allowWrite: false, roots: [], skills: [] }),
    }),
  }
  const { makeUi, DICT } = loadClient(env)
  const ui = makeUi(makeTranslate(DICT), undefined, undefined, () => () => {})
  const settled = await settle(ui, env)
  const classes = classesOf(settled)
  const text = textOf(settled)
  assert.ok(!classes.has('sm-composer'), 'read-only mode hides the composer')
  assert.ok(text.includes(DICT.zh.readOnlyBanner), 'read-only banner shown')
})

test('目录不完整时给出提示，而不是谎报全量', async () => {
  const env = {
    window: baseWindow,
    document: baseDocument,
    navigator: { platform: 'Win32', userAgent: 'test' },
    harness: createHarness(),
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, complete: false, allowWrite: true, roots: [], skills: [] }),
    }),
  }
  const { makeUi, DICT } = loadClient(env)
  const ui = makeUi(makeTranslate(DICT), undefined, undefined, () => () => {})
  const settled = await settle(ui, env)
  assert.ok(textOf(settled).includes(DICT.zh.incomplete), 'incomplete catalog is reported')
})
