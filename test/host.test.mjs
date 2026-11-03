/**
 * Host 半的测试。
 *
 * 分两层：
 *  1. skill-file.js 的纯字符串逻辑 —— 保存技能的风险全在这里；
 *  2. index.js 的 Config 收敛与名字语法 —— 入口契约。
 * 不打桩整个 cordis：这里要钉的是「写出来的文件对不对」，不是框架行为。
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { SKILL_NAME, normalizeName, parseSkillMarkdown, quoteYaml, renderSkillFile, splitFrontmatter, withModelInvocation } from '../skill-file.js'

test('Config 收敛默认值与非法输入', async () => {
  process.env.DSH_HOME = join(tmpdir(), 'sm-host-test-home')
  const mod = await import('../index.js')
  const validate = mod.Config['~standard'].validate
  assert.deepEqual(validate(undefined).value, { extraRoots: [], allowWrite: true, maxSkillBytes: 262144 })
  assert.deepEqual(validate({ extraRoots: ['/x', 3, ''], allowWrite: false, maxSkillBytes: 100 }).value, {
    extraRoots: ['/x'],
    allowWrite: false,
    maxSkillBytes: 100,
  })
  // 越界的体积上限要夹回来，而不是原样接受。
  assert.equal(validate({ maxSkillBytes: 99_999_999 }).value.maxSkillBytes, 4 * 1024 * 1024)
  assert.ok(validate('nope').issues)
})

test('YAML 标量：普通描述裸写，带冒号 / 井号 / 引号的退到双引号', () => {
  assert.equal(quoteYaml('demo-skill'), 'demo-skill')
  assert.equal(quoteYaml('中文描述也可以'), '中文描述也可以')
  assert.equal(quoteYaml('Use when: the user asks'), '"Use when: the user asks"')
  assert.equal(quoteYaml('tag #1'), '"tag #1"')
  assert.equal(quoteYaml('he said "hi"'), '"he said \\"hi\\""')
  // 结尾空白会让裸标量在 YAML 里丢掉空格，必须引起来。
  assert.equal(quoteYaml('trailing '), '"trailing "')
})

test('渲染出的 SKILL.md 结构正确，且停用才写 disable-model-invocation', () => {
  const enabled = renderSkillFile({
    name: 'demo-skill',
    description: 'Use when: anything',
    content: '# Body\n\ntext',
    whenToUse: 'on demand',
    modelInvocable: true,
  })
  assert.equal(enabled, [
    '---',
    'name: demo-skill',
    'description: "Use when: anything"',
    'whenToUse: on demand',
    '---',
    '',
    '# Body',
    '',
    'text',
    '',
  ].join('\n'))

  const disabled = renderSkillFile({ name: 'x', description: 'd', content: '', modelInvocable: false })
  assert.match(disabled, /disable-model-invocation: true/)
  // 空正文不该留下多余空行。
  assert.ok(disabled.endsWith('---\n\n\n'))

  const noWhen = renderSkillFile({ name: 'x', description: 'd', content: 'body', whenToUse: '   ' })
  assert.ok(!noWhen.includes('whenToUse'))
})

test('splitFrontmatter 切得准，且无 frontmatter 时正文原样', () => {
  const split = splitFrontmatter('---\nname: a\ndescription: b\n---\n\n# Title\n')
  assert.equal(split.frontmatter, 'name: a\ndescription: b')
  assert.equal(split.body, '# Title')

  const plain = splitFrontmatter('# Just markdown\n')
  assert.equal(plain.frontmatter, '')
  assert.equal(plain.body, '# Just markdown')
})

test('启停只动那一行，其余字节原样保留', () => {
  const original = [
    '---',
    'name: demo',
    'description: keep me',
    '# a comment the user wrote',
    'custom-key: keep',
    '---',
    '',
    '# Body',
    'line',
  ].join('\n')

  const off = withModelInvocation(original, false)
  assert.match(off, /disable-model-invocation: true/)
  // 用户手写的注释、元数据、正文必须一字不差地留下。
  assert.ok(off.includes('# a comment the user wrote'))
  assert.ok(off.includes('custom-key: keep'))
  assert.ok(off.endsWith('\n\n# Body\nline'))

  const on = withModelInvocation(off, true)
  assert.ok(!on.includes('disable-model-invocation'))
  assert.ok(on.includes('custom-key: keep'))

  // 幂等：对已经是停用态的文件再停用一次，不该叠加第二行。
  const twice = withModelInvocation(off, false)
  assert.equal(twice.match(/disable-model-invocation/g).length, 1)

  // 没有 frontmatter 的文件不动，交给上层拒绝。
  assert.equal(withModelInvocation('no frontmatter here', false), 'no frontmatter here')
})

test('原子写入：临时文件 + rename 之后内容完整', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sm-write-'))
  const dir = join(home, 'skills', 'demo-skill')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'SKILL.md')
  const tmp = `${file}.tmp`
  await writeFile(tmp, 'content', 'utf8')
  await rename(tmp, file)
  assert.equal(await readFile(file, 'utf8'), 'content')
  await rm(home, { recursive: true, force: true })
})

test('名字语法与仓库里的 SKILL_NAME 一致', () => {
  for (const ok of ['a', 'demo-skill', 'x1-y2']) assert.ok(SKILL_NAME.test(ok), ok)
  for (const bad of ['Demo', 'demo_skill', '-demo', 'demo-', 'demo--skill', '', '中文']) {
    assert.ok(!SKILL_NAME.test(bad), bad)
  }
})

test('路由必须按 agent 作用域逐个取并集，不能只读全局层', async () => {
  // 这是真出过的 bug：skills.snapshot() 不传 scope 只读全局层，
  // 而 skill-filesystem 注册在 agent preset 的 scoped 层里 —— 用户/项目技能
  // 全被漏掉，complete 却仍是 true，面板理直气壮地谎报全量。
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')

  // 必须存在遍历作用域的视图选项构造。
  assert.match(source, /function viewOptions\(cwd\)/, 'viewOptions helper missing')
  assert.match(source, /scope: agent/, 'viewOptions must pass a scope')
  // snapshot / get 都要走并集路径。
  assert.match(source, /async function collectAll\(/, 'collectAll helper missing')
  assert.match(source, /async function getSkill\(/, 'getSkill helper missing')
  // 不能再出现裸的 { cwd } 直查。
  assert.ok(!/sub\.skills\.snapshot\(\{\s*cwd\s*\}\)/.test(source), 'snapshot must not be called with cwd alone')
  assert.ok(!/sub\.skills\.get\([^)]*\{\s*cwd\s*\}\)/.test(source), 'get must not be called with cwd alone')
  // 读失败要降级成「不完整」，而不是假装完整。
  assert.match(source, /complete = false/, 'incomplete catalog must be reported')
})

test('导入路由存在，且保存与导入共用同一条写入路径', async () => {
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  assert.match(source, /path: `\$\{prefix\}\/skill\/import`/, 'import route missing')
  // 导入必须走 writeSkill()，不能自己再写一遍文件 —— 否则校验会分叉。
  const importBlock = source.slice(source.indexOf("path: `${prefix}/skill/import`"))
  assert.match(importBlock, /await writeSkill\(/, 'import must reuse writeSkill')
  // 保存也必须走同一条路径。
  const saveBlock = source.slice(source.indexOf("path: `${prefix}/skill/save`"), source.indexOf("path: `${prefix}/skill/import`"))
  assert.match(saveBlock, /await writeSkill\(/, 'save must reuse writeSkill')
  // 只读模式下导入要被拒绝。
  assert.match(importBlock, /read-only/, 'import must respect allowWrite')
})

// ---------------------------------------------------------------------------
// Markdown 导入
// ---------------------------------------------------------------------------

test('导入：带完整 frontmatter 的 Markdown 原样解析', () => {
  const md = [
    '---',
    'name: my-imported-skill',
    'description: "Use when: importing a skill"',
    'whenToUse: on demand',
    'disable-model-invocation: true',
    '---',
    '',
    '# Title',
    'Body text.',
  ].join('\n')

  const parsed = parseSkillMarkdown(md, 'whatever.md')
  assert.equal(parsed.name, 'my-imported-skill')
  assert.equal(parsed.description, 'Use when: importing a skill')
  assert.equal(parsed.whenToUse, 'on demand')
  assert.equal(parsed.modelInvocable, false)
  assert.equal(parsed.hasFrontmatter, true)
  assert.ok(parsed.content.startsWith('# Title'))
  // 正文里不该残留 frontmatter。
  assert.ok(!parsed.content.includes('description:'))
})

test('导入：没有 frontmatter 时用文件名兜底，描述取正文第一段', () => {
  const md = '# My Notes\n\nThis skill does the thing.\n\nMore text.'
  const parsed = parseSkillMarkdown(md, 'My Notes.md')
  assert.equal(parsed.name, 'my-notes', 'filename normalized to kebab-case')
  assert.equal(parsed.description, 'This skill does the thing.', 'description falls back to first prose line')
  assert.equal(parsed.hasFrontmatter, false)
  assert.ok(parsed.content.includes('# My Notes'))
})

test('导入：只有 name 没有 description 时仍能拿到描述', () => {
  const md = ['---', 'name: partial', '---', '', 'A description from the body.'].join('\n')
  const parsed = parseSkillMarkdown(md, 'x.md')
  assert.equal(parsed.name, 'partial')
  assert.equal(parsed.description, 'A description from the body.')
})

test('导入：单引号标量要能还原转义', () => {
  const md = ['---', "name: quoted", "description: 'it''s fine'", '---', '', 'body'].join('\n')
  assert.equal(parseSkillMarkdown(md, 'x.md').description, "it's fine")
})

test('导入：自己导出的文件必须能被自己读回（往返一致）', () => {
  const rendered = renderSkillFile({
    name: 'round-trip',
    description: 'Use when: round tripping',
    content: '# Body\n\ntext',
    whenToUse: 'sometimes',
    modelInvocable: false,
  })
  const parsed = parseSkillMarkdown(rendered, 'round-trip.md')
  assert.equal(parsed.name, 'round-trip')
  assert.equal(parsed.description, 'Use when: round tripping')
  assert.equal(parsed.whenToUse, 'sometimes')
  assert.equal(parsed.modelInvocable, false)
  assert.equal(parsed.content, '# Body\n\ntext')
})

test('normalizeName 把任意文件名收敛成合法技能名', () => {
  assert.equal(normalizeName('My Skill.md'), 'my-skill')
  assert.equal(normalizeName('some_thing.MD'), 'some-thing')
  assert.equal(normalizeName('  spaced  name  '), 'spaced-name')
  assert.equal(normalizeName('a---b'), 'a-b')
  assert.equal(normalizeName('UPPER.markdown'), 'upper')
  // 纯中文没有可用的 ASCII 映射：结果为空，由上层要求用户手填。
  assert.equal(normalizeName('中文技能.md'), '')
  // 结果必须能过 SKILL_NAME 校验。
  for (const input of ['My Skill.md', 'some_thing.MD', 'a---b']) {
    assert.ok(SKILL_NAME.test(normalizeName(input)), input)
  }
})

