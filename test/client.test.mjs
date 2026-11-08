/**
 * Client 半的静态自检。
 *
 * 渲染测试证明不了好看，但能钉住几件真出过问题的事：
 *  - zh / en 字典键必须一一对应（漏一个就是界面上冒出英文键名）；
 *  - CSS 里那几条踩过的坑（遮罩被内容列规则收窄、输入框在白色卡上用半透明白）；
 *  - 动画常量与 CSS 时长一致，否则入场动画会被半途掐断。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const here = import.meta.dirname
const source = await readFile(join(here, '..', 'client.js'), 'utf8')

/** 从源码里取出 DICT 对象：client.js 是模块加载器格式，不能直接 import。 */
function extractDict() {
  const start = source.indexOf('const DICT = {')
  assert.ok(start > 0, 'DICT not found')
  const end = source.indexOf('\n    }\n', start)
  assert.ok(end > start, 'DICT end not found')
  const literal = source.slice(start + 'const DICT = '.length, end + 6)
  // 用 Function 求值这段纯字面量，避免引入解析依赖。
  return Function(`"use strict";return (${literal})`)()
}

const DICT = extractDict()

test('zh / en 字典键一一对应', () => {
  const zh = Object.keys(DICT.zh).sort()
  const en = Object.keys(DICT.en).sort()
  assert.deepEqual(zh, en, `missing in one locale: ${zh.filter((k) => !en.includes(k)).join(',')} | ${en.filter((k) => !zh.includes(k)).join(',')}`)
})

test('字典里没有空字符串，占位符成对出现', () => {
  for (const [locale, dict] of Object.entries(DICT)) {
    for (const [key, value] of Object.entries(dict)) {
      assert.ok(value.length > 0, `${locale}.${key} is empty`)
      const opens = (value.match(/\{/g) || []).length
      const closes = (value.match(/\}/g) || []).length
      assert.equal(opens, closes, `${locale}.${key} has unbalanced placeholders`)
    }
  }
})

test('面板 id 与 main 的 key 一致，侧栏图标排在既有条目之后', () => {
  const panelId = /const PANEL_ID = '([^']+)'/.exec(source)
  assert.ok(panelId, 'PANEL_ID missing')
  assert.equal(panelId[1], 'skill-manager')
  // sidebar 的 id 与 main 的 key 必须是同一个值，否则点图标打不开页面。
  assert.match(source, /ctx\.slots\.register\(\{\s*name: 'main',\s*key: PANEL_ID/)
  assert.match(source, /ctx\.slots\.register\(\{\s*name: 'sidebar\.panellist',\s*id: PANEL_ID/)
  // 既有条目是 0/10/20/30/40，新面板必须排在它们之后。
  assert.match(source, /order: 50/)
})

test('遮罩与 toast 被排除在内容列规则之外', () => {
  // .sm-page>* 会把 position:fixed 的遮罩收成一条居中窄带 —— 只压暗页面中间。
  assert.ok(source.includes('.sm-page>*:not(.sm-scrim):not(.sm-toast)'), 'content-column rule must exclude overlay and toast')
  assert.match(source, /\.sm-scrim\{position:fixed;top:var\(--dsh-frame-top-clearance,0px\)/)
  // 遮罩自己要把宽度钉回来，否则继承来的 max-width 仍然生效。
  assert.match(source, /\.sm-scrim\{[^}]*max-width:none/)
  assert.match(source, /\.sm-page>\.sm-toast\{width:fit-content/)
})

test('白色输入卡上的输入框用主题层色，不用半透明白', () => {
  const inputRule = /\.sm-input\{([^}]*)\}/.exec(source)
  assert.ok(inputRule, '.sm-input rule missing')
  assert.ok(inputRule[1].includes('--dsw-alias-bg-layer-2'), 'input must use a theme layer token')
  assert.ok(!inputRule[1].includes('rgba(255,255,255'), 'semi-transparent white is invisible on the white composer card')
})

test('主按钮在两个主题下都是黑底白字', () => {
  assert.match(source, /--sm-accent-fill:#1c1c1c;--sm-accent-ink:#ffffff/)
  assert.match(source, /\[data-scheme=dark\][^}]*--sm-accent-fill:#000000;--sm-accent-ink:#ffffff/)
})

test('动画常量与 CSS 时长一致', () => {
  const land = Number(/const LAND_MS = (\d+)/.exec(source)[1])
  const sheen = Number(/const SHEEN_MS = (\d+)/.exec(source)[1])
  const delay = Number(/const SHEEN_DELAY_MS = (\d+)/.exec(source)[1])
  assert.equal(land, 1100)
  assert.equal(sheen, 1000)
  assert.equal(delay, 240)

  // 从 CSS 里把秒数读回来，和常量比数字 —— 拼字符串会因为 `.24s` / `0.24s`
  // 这种写法差异误报。
  const seconds = (value) => Number(String(value).replace(/s$/, '')) * 1000
  const landRule = /animation:sm-card-land ([\d.]+)s linear backwards/.exec(source)
  const sheenRule = /animation:sm-card-sheen ([\d.]+)s linear ([\d.]+)s both/.exec(source)
  assert.ok(landRule, 'sm-card-land animation missing')
  assert.ok(sheenRule, 'sm-card-sheen animation missing')
  assert.equal(seconds(landRule[1]), land)
  assert.equal(seconds(sheenRule[1]), sheen)
  assert.equal(seconds(sheenRule[2]), delay)

  // 摘类时刻必须晚于两条动画都结束，否则入场动画会被半途掐断。
  const landing = Number(/const LANDING_MS = Math\.max\(LAND_MS, SHEEN_MS \+ SHEEN_DELAY_MS\) \+ (\d+)/.exec(source)[1])
  assert.ok(landing > 0)
  assert.ok(Math.max(land, sheen + delay) + landing > sheen + delay)
})

test('卡片整行等高：网格 stretch，卡片撑满，占位卡跟随', () => {
  // 真出过的问题：align-items:start 让每张卡只按自身内容撑高，
  // 描述两行和三行的卡高低不一，整面墙参差不齐。
  const grid = /\.sm-grid\{([^}]*)\}/.exec(source)
  assert.ok(grid, '.sm-grid rule missing')
  assert.ok(grid[1].includes('align-items:stretch'), 'grid must stretch rows, not start')
  assert.ok(!grid[1].includes('align-items:start'), 'align-items:start makes cards uneven')

  // 卡片自己也要 height:100%，否则内容仍贴顶、下半截空着。
  const card = /\.sm-card\{([^}]*)\}/.exec(source)
  assert.ok(card, '.sm-card rule missing')
  assert.ok(card[1].includes('height:100%'), 'card must fill the stretched row')

  // 占位卡跟随行高，补位的那几格才和真卡一样高。
  const ghost = /\.sm-card\.ghost\{([^}]*)\}/.exec(source)
  assert.ok(ghost, '.sm-card.ghost rule missing')
  assert.ok(ghost[1].includes('height:100%'), 'ghost cards must match row height')

  // 底部行高固定：文字按钮与图标按钮混排时不撑歪卡片。
  const foot = /\.sm-card-foot\{([^}]*)\}/.exec(source)
  assert.ok(foot, '.sm-card-foot rule missing')
  assert.ok(/height:22px/.test(foot[1]), 'card footer needs a fixed height')
  assert.ok(foot[1].includes('flex:none'), 'card footer must not grow')
})

test('面板语言钉死为中文，不跟随运行时 locale 快照', () => {
  // 真出过的问题：按 locale.getLocale().active 切中英，首屏宿主偏好还没解析
  // 完先渲染 en、随后刷成 zh —— 界面在两种语言之间跳一下。
  assert.match(source, /const PANEL_LOCALE = 'zh'/, 'panel locale must be pinned')
  // 渲染路径不能再读 locale 快照来决定语言。注释里提到旧写法不算 —— 先剥注释。
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/getLocale\(\)/.test(code), 'must not read the locale snapshot to pick a language')
  assert.ok(!/\^zh\/i\.test/.test(code), 'must not branch on a zh regex')
  // 但中英两套字典仍要注册，宿主需要时仍能读到 en。
  assert.match(source, /locale\.register\(NS, \{\s*zh: DICT\.zh,\s*'zh-CN': DICT\.zh,\s*en: DICT\.en,/, 'both zh and en dictionaries must still be registered')
  // 翻译器先查钉死的字典，查不到才问宿主。
  const translator = source.slice(source.indexOf('function makeTranslator('))
  assert.match(translator, /const pinned = DICT\[PANEL_LOCALE\]\[key\]/)
  assert.ok(translator.indexOf('const pinned') < translator.indexOf('bound(key)'), 'pinned dictionary must win over the bound one')
})

test('分段控件用整宽行容器包裹，胶囊自然收缩', () => {
  // 按 note-wall-ui-style「分段控件的位置」一节：
  // 内容列规则给直系子元素 width:100%，胶囊必须包一层整宽行容器，
  // 成为行内 flex 子项后宽度才自然收缩、左缘与标题对齐。
  const row = /\.sm-segments-row\{([^}]*)\}/.exec(source)
  assert.ok(row, '.sm-segments-row rule missing')
  assert.ok(row[1].includes('display:flex'), 'row must be a flex container')
  assert.ok(row[1].includes('justify-content:flex-start'), 'pill must sit at the column start line')

  const segments = /\.sm-segments\{([^}]*)\}/.exec(source)
  assert.ok(segments, '.sm-segments rule missing')
  assert.ok(segments[1].includes('max-width:100%'), 'segments must not overflow on narrow screens')
  assert.ok(!/(^|[;{])width:100%/.test(segments[1]), 'segments must not be stretched to full width')
  // 不允许用 margin-inline:0 去「修正」位置——那会把胶囊贴到页面最左边。
  assert.ok(!segments[1].includes('margin-inline'), 'do not reposition with margin-inline')

  // 页面里必须真的包在行容器里。
  assert.match(source, /className: 'sm-segments-row'[\s\S]{0,120}className: 'sm-segments'/, 'segments must be wrapped by the row container')

  // 内容列规则保持原样，不靠 :not(.sm-segments) 排除。
  const columnRules = source.match(/\.sm-page>\*:not\(\.sm-scrim\):not\(\.sm-toast\)[^{]*\{/g) || []
  assert.equal(columnRules.length, 2, 'both content-column rules should be present')
  for (const rule of columnRules) {
    assert.ok(!rule.includes(':not(.sm-segments)'), `content-column rule must stay simple: ${rule}`)
  }
})

test('设置页密度：字段说明进 placeholder，不堆小字', () => {
  // note-wall-ui-style「设置页：密度要克制」：每个字段下面再压一行灰色说明，
  // 会把弹窗堆成一堵小字墙。说明应进 placeholder。
  assert.ok(!/sm-field-hint/.test(source), 'field hints must not be a permanent row')
  const hints = (source.match(/placeholder: translate\('(descHint|contentHint)'\)/g) || [])
  assert.equal(hints.length, 2, 'both field hints should move into placeholders')
  // 单行字段不要用 space-between 把值推到最右边。
  const field = /\.sm-field\{([^}]*)\}/.exec(source)
  if (field) {
    assert.ok(!field[1].includes('space-between'), 'single-row fields must not use space-between')
  }
})

test('不用 window.confirm / alert，不写 DOM 到 slot 之外', () => {
  assert.ok(!/window\.confirm|window\.alert/.test(source), 'use inline confirm instead of blocking dialogs')
  assert.ok(!/createPortal/.test(source), 'overlay must live inside the page tree')
  assert.ok(!/document\.body\.append/.test(source), 'never append to body')
})

test('所有面向用户的文案都走翻译函数', () => {
  // 中文直接写进 JSX 文本节点的写法会绕过 locale，这里不该出现。
  const cjkInMarkup = /h\('(?:h1|h2|h3|p|span|button|dt|dd)'[^)]*?'[\u4e00-\u9fff]/
  assert.ok(!cjkInMarkup.test(source), 'user-facing text must go through t()')
})

test('侧栏钢笔图标是加粗描边，不是细线 emoji', () => {
  assert.match(source, /function PanelIcon\(\{ size = 20 \}\)/)
  assert.match(source, /strokeWidth: 2\.4/, 'pen lines must be visibly bold')
  const panelIcon = source.slice(source.indexOf('function PanelIcon('), source.indexOf('function makeUi('))
  assert.ok(!panelIcon.includes('\u{1F58A}'), 'PanelIcon must not fall back to a thin monochrome emoji glyph')
})

test('导入浮层同时接收散装 Markdown 与整个技能文件夹', () => {
  // 选择文件夹：原生 webkitdirectory 输入。
  assert.match(source, /webkitdirectory: ''/, 'folder picker input missing')
  // 拖放文件夹：DataTransferItem 递归读目录，且要反复 readEntries 直到空。
  assert.match(source, /webkitGetAsEntry/, 'folder drop must traverse DataTransfer entries')
  assert.match(source, /reader\.readEntries\(/, 'directory reader must drain all batches')
  assert.match(source, /function splitSkillFolders\(/, 'folders must be split by SKILL.md')
  // 混排条目一次提交，报告顺序与队列一一对应。
  assert.match(source, /importItems: \(items, target, cwd\) => postJson\('\/skill\/import', \{ items, target, cwd \}\)/)
  assert.match(source, /payload: \{ type: 'folder'/, 'folder payload missing')
  assert.match(source, /payload: \{ type: 'file'/, 'loose file payload missing')
  // 失败原因要翻译成中文，不能只丢错误码。
  assert.match(source, /function importErrorText\(/)
  assert.ok(DICT.zh.importPickFolder && DICT.en.importPickFolder, 'folder picker label must be localized')
  assert.ok(DICT.zh.importErrNoSkillMd && DICT.en.importErrNoSkillMd, 'missing SKILL.md error must be localized')
})
