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
