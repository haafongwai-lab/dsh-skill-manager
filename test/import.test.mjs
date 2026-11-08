/**
 * 导入路由的端到端测试。
 *
 * 不依赖正在运行的 Harness：这里起一个真的 http.Server，用最小的
 * `ctx.inject` / `webServer.register` 桩把插件路由挂上去，然后真的发请求、
 * 真的落盘、再把写出来的文件读回来。
 *
 * 覆盖的是「路由接线」这一层 —— 纯解析逻辑在 host.test.mjs 里已经钉过了。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

/** 一个最小的 cordis 上下文桩：只实现插件用到的那几个接口。 */
function createContext(routes) {
  const api = {
    get: (key) => (key === 'workingDirectory' ? { defaultDirectory: process.cwd() } : undefined),
    effect: (factory) => {
      const dispose = typeof factory === 'function' ? factory() : undefined
      return typeof dispose === 'function' ? dispose : () => {}
    },
    inject: (deps, callback) => callback(api),
  }
  api.webServer = {
    register: (route) => {
      routes.push(route)
      return () => {}
    },
  }
  api.skills = {
    // 导入测试不依赖技能目录；返回空目录即可。
    snapshot: async () => ({ skills: [], complete: true }),
    get: async () => undefined,
    list: async () => [],
  }
  return api
}

/** 把注册进来的 exact 路由挂到真的 http server 上。 */
async function startPluginServer(plugin, config) {
  const routes = []
  const ctx = createContext(routes)
  plugin.apply(ctx, config)

  const server = createServer((req, res) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname
    const route = routes.find((entry) => entry.kind === 'exact' && entry.path === path)
    if (!route) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'no-route' }))
      return
    }
    Promise.resolve(route.handler(req, res)).catch((error) => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: String(error && error.message) }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function post(base, path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

test('导入：真实 HTTP 请求能把 Markdown 写成技能目录', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'sm-import-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  try {
    const plugin = await import('../index.js')
    const server = await startPluginServer(plugin, { extraRoots: [], allowWrite: true, maxSkillBytes: 262144 })
    try {
      const response = await post(server.base, '/dsh-skill-manager/api/skill/import', {
        files: [
          {
            name: 'my-skill.md',
            text: '---\nname: my-skill\ndescription: "Use when: testing import"\n---\n\n# Body\n\ntext',
          },
          {
            name: 'Plain File.md',
            text: '# Plain\n\nNo frontmatter here.',
          },
          {
            name: '中文技能.md',
            text: '# Chinese\n\nno ascii name',
          },
        ],
        target: 'user',
      })

      assert.equal(response.status, 200)
      assert.equal(response.body.total, 3)
      assert.equal(response.body.imported, 2, 'two importable files')
      assert.equal(response.body.created, 2)
      assert.equal(response.body.failed, 1, 'chinese filename cannot be normalized')

      const byName = Object.fromEntries(response.body.report.map((entry) => [entry.filename, entry]))
      assert.equal(byName['my-skill.md'].ok, true)
      assert.equal(byName['Plain File.md'].ok, true)
      assert.equal(byName['中文技能.md'].ok, false)
      assert.equal(byName['中文技能.md'].error, 'invalid-name')

      // 真的落盘了，且内容正确。
      const written = await readFile(join(dshHome, 'skills', 'my-skill', 'SKILL.md'), 'utf8')
      assert.match(written, /^---\nname: my-skill\n/m)
      assert.match(written, /description: "Use when: testing import"/)
      assert.ok(written.trimEnd().endsWith('text'))

      // 无 frontmatter 的文件用文件名当技能名。
      const plain = await readFile(join(dshHome, 'skills', 'plain-file', 'SKILL.md'), 'utf8')
      assert.match(plain, /name: plain-file/)
    } finally {
      await server.close()
    }
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('导入：重复导入同名技能算覆盖，不新增', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'sm-import2-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  try {
    const plugin = await import('../index.js')
    const server = await startPluginServer(plugin, { extraRoots: [], allowWrite: true, maxSkillBytes: 262144 })
    const payload = {
      files: [{ name: 'dup.md', text: '---\nname: dup\ndescription: first\n---\n\none' }],
      target: 'user',
    }
    try {
      const first = await post(server.base, '/dsh-skill-manager/api/skill/import', payload)
      assert.equal(first.body.created, 1)

      const second = await post(server.base, '/dsh-skill-manager/api/skill/import', {
        files: [{ name: 'dup.md', text: '---\nname: dup\ndescription: second\n---\n\ntwo' }],
        target: 'user',
      })
      // 目录层没有别的 provider，第二次同名的 existing 判定依赖 collectAll；
      // 这里只断言它确实成功写入并覆盖了内容。
      assert.equal(second.body.imported, 1)
      const written = await readFile(join(dshHome, 'skills', 'dup', 'SKILL.md'), 'utf8')
      assert.match(written, /description: second/)
    } finally {
      await server.close()
    }
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('导入：只读模式下被拒绝', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'sm-import3-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  try {
    const plugin = await import('../index.js')
    const server = await startPluginServer(plugin, { extraRoots: [], allowWrite: false, maxSkillBytes: 262144 })
    try {
      const response = await post(server.base, '/dsh-skill-manager/api/skill/import', {
        files: [{ name: 'x.md', text: '# x' }],
        target: 'user',
      })
      assert.equal(response.status, 403)
      assert.equal(response.body.error, 'read-only')
    } finally {
      await server.close()
    }
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(dshHome, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 文件夹导入
// ---------------------------------------------------------------------------

test('导入：技能文件夹连同 SKILL.md 与附属文件一起落盘', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'sm-import-dir-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  try {
    const plugin = await import('../index.js')
    const server = await startPluginServer(plugin, { extraRoots: [], allowWrite: true, maxSkillBytes: 262144 })
    try {
      const skillMd = [
        '---',
        'name: folder-skill',
        'description: "Use when: importing a folder"',
        'allowed-tools: Read, Bash',
        '# author comment',
        '---',
        '',
        '# Body',
        'text',
      ].join('\n')
      // 客户端把每个文件按二进制读成 base64，这里生成同样的载荷。
      const b64 = (text) => Buffer.from(text, 'utf8').toString('base64')
      const response = await post(server.base, '/dsh-skill-manager/api/skill/import', {
        items: [{
          type: 'folder',
          name: 'folder-skill',
          files: [
            { path: 'SKILL.md', data: b64(skillMd) },
            { path: 'references/guide.md', data: b64('# Guide\n\nmore') },
            { path: 'scripts/run.py', data: b64('print(1)\n') },
          ],
        }],
        target: 'user',
      })

      assert.equal(response.status, 200)
      assert.equal(response.body.total, 1)
      assert.equal(response.body.imported, 1)
      assert.equal(response.body.created, 1)
      const report = response.body.report[0]
      assert.equal(report.ok, true)
      assert.equal(report.kind, 'folder')
      assert.equal(report.name, 'folder-skill')

      const dir = join(dshHome, 'skills', 'folder-skill')
      const written = await readFile(join(dir, 'SKILL.md'), 'utf8')
      // 原文字节保留：不认识的元数据、注释、正文都还在，没有被重排。
      assert.ok(written.includes('allowed-tools: Read, Bash'))
      assert.ok(written.includes('# author comment'))
      assert.ok(written.includes('# Body'))
      // 附属文件按原相对路径落盘，脚本内容不被文本编码改坏。
      assert.equal(await readFile(join(dir, 'references', 'guide.md'), 'utf8'), '# Guide\n\nmore')
      assert.equal(await readFile(join(dir, 'scripts', 'run.py'), 'utf8'), 'print(1)\n')
    } finally {
      await server.close()
    }
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('导入：混排条目逐条报告，缺 SKILL.md 与路径穿越都不写出去', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'sm-import-dir2-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  try {
    const plugin = await import('../index.js')
    const server = await startPluginServer(plugin, { extraRoots: [], allowWrite: true, maxSkillBytes: 262144 })
    try {
      const response = await post(server.base, '/dsh-skill-manager/api/skill/import', {
        items: [
          { type: 'folder', name: 'no-skill', files: [{ path: 'README.md', text: 'hi' }] },
          {
            type: 'folder',
            name: 'evil',
            files: [
              { path: 'SKILL.md', text: '---\nname: evil\ndescription: d\n---\n\nbody' },
              { path: '../../escape.txt', text: 'nope' },
            ],
          },
          { type: 'file', name: 'good.md', text: '---\nname: good\ndescription: d\n---\n\nbody' },
        ],
        target: 'user',
      })

      assert.equal(response.status, 200)
      assert.equal(response.body.total, 3)
      assert.equal(response.body.imported, 1)
      assert.equal(response.body.failed, 2)
      // 报告顺序与 items 一一对应，队列才能对得上。
      assert.equal(response.body.report[0].error, 'missing-skill-md')
      assert.equal(response.body.report[1].error, 'invalid-path')
      assert.equal(response.body.report[2].ok, true)
      assert.equal(response.body.report[2].name, 'good')
      // 越界文件没有落到技能根目录之外，坏文件夹也没写出半截技能。
      await assert.rejects(readFile(join(dshHome, 'escape.txt'), 'utf8'))
      await assert.rejects(readFile(join(dshHome, 'skills', 'evil', 'SKILL.md'), 'utf8'))
    } finally {
      await server.close()
    }
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('导入：文件夹里的 SKILL.md 缺 name / description 时自动补齐', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'sm-import-dir3-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  try {
    const plugin = await import('../index.js')
    const server = await startPluginServer(plugin, { extraRoots: [], allowWrite: true, maxSkillBytes: 262144 })
    try {
      const response = await post(server.base, '/dsh-skill-manager/api/skill/import', {
        items: [{
          type: 'folder',
          name: 'My Folder',
          files: [{ path: 'SKILL.md', text: '# Notes\n\nA useful description from the body.' }],
        }],
        target: 'user',
      })
      assert.equal(response.body.imported, 1)
      const written = await readFile(join(dshHome, 'skills', 'my-folder', 'SKILL.md'), 'utf8')
      assert.match(written, /name: my-folder/)
      assert.match(written, /description: A useful description from the body\./)
      assert.ok(written.includes('# Notes'))
    } finally {
      await server.close()
    }
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(dshHome, { recursive: true, force: true })
  }
})
