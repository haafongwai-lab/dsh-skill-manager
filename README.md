# dsh-skill-manager

在侧栏管理 DeepSeek Harness 的 Agent 技能：按来源浏览全部技能、搜索、查看全文、
新建与编辑、启停模型可见性 —— 不必手动改 `SKILL.md`。

## 它做什么

- **一面技能墙**：`sidebar.panellist` 一个图标，主区一页按来源分组的卡片墙。
  每个技能一张卡：状态点、名字、来源徽章、描述、启用状态与操作。
- **搜索与过滤**：胶囊搜索框按名字 / 描述 / 来源过滤；分段控件按
  用户 / 项目 / 内置 / 运行时分组。
- **详情浮层**：全文（frontmatter 原文 + 正文）、绝对路径、来源与提供者、
  调用策略。只读来源的技能在这里看得到，但没有编辑按钮。
- **编辑器浮层**：名字、描述、何时使用、正文、保存位置；`⌘/Ctrl + Enter` 保存。
- **导入 Markdown 或文件夹**：把 `.md` 文件拖进浮层，或用「选择文件 /
  选择文件夹」按钮一次选多个；也可以直接拖一个技能文件夹（甚至一个装着多
  个技能文件夹的父目录）。带 frontmatter 的按里面的 `name` / `description`
  建；没有的用文件名 / 文件夹名当名字、正文首段当描述。同名技能覆盖，报告里
  区分「新增 / 覆盖 / 失败」。
  文件夹必须含 `SKILL.md`，其余 `references/` `scripts/` `assets/` 等文件会
  按原相对路径一并写入；`SKILL.md` 保留原文字节（只补缺失的 name /
  description），不会把别人技能里的元数据、注释、脚本重排成插件生成的样子。
- **启停**：写 SKILL.md 的 `disable-model-invocation`，模型目录真的会少一项。

## 设计要点

**面板界面固定中文。** 早先按 `locale.getLocale().active` 切中英，首屏渲染时宿主
偏好还没解析完会先出 en、随后刷成 zh —— 界面在两种语言之间跳一下。便签墙、
MCP 管理、技能管理三个插件共用过这段复制代码，症状一致。现在三者都钉成 `zh`：
`locale.register` 仍注册中英两套字典（宿主需要时读得到 en），但面板显示不再跟随
运行时的瞬时 locale 状态。翻译器**先查钉死的字典，查不到才问宿主** —— 顺序反过来
就会在字典注册完成前后拿到不同结果，那正是跳变的来源。

**磁盘是唯一事实来源。** 读路径完全走 `ctx.skills`（它已做分层合并、同名覆盖、
排序），本插件不自己解析目录 —— 否则页面上的清单会和模型看到的目录悄悄分叉。

**必须按 agent 作用域取并集。** `skills.snapshot()` 不传 `scope` 时**只读全局层**，
而 `skill-filesystem` 这类 provider 注册在 agent preset 的 scoped 层里。只传 `cwd`
会得到一份「只有内置技能」的清单，而且 `complete` 仍然是 `true` —— 面板会理直气壮
地谎报全量。所以 `/skills` 与 `/skill` 都遍历所有活着的 agent，各自作用域问一次
再并起来（先到的名字胜出，全局层优先）；任一次读失败就降级成 `complete: false`，
由页面显示「目录尚未完整」，而不是假装完整。

> 这条是实测踩出来的：修复前 `GET /skills` 返回 8 条 bundled，用户自己的
> `note-wall-ui-style` 完全不见，`complete` 却是 `true`。`test/host.test.mjs`
> 里有对应的回归测试。

**启停用平台原生语义，不发明机制。** `skills` 服务没有「禁用某个技能」的 API，
但 frontmatter 支持 `disable-model-invocation`，而模型目录在 `dsh-tool-skill` 里
确实按 `isModelInvocable` 过滤。所以启停就是改这一个字段：不需要重启，也不需要
影子 provider。

**启停只动那一行。** 用户手写的注释、其它元数据、正文一字不差地保留 —— 一次
「停用」不该把技能文件改成插件生成的样子。

**写入是原子的。** 临时文件 + `rename`，按文件串行化；名字先过
`^[a-z0-9]+(?:-[a-z0-9]+)*$`，路径再做穿越检查，越界的保存一律拒绝。

**文件夹导入按二进制搬运。** 浏览器侧用 `webkitdirectory`（选择）与
`DataTransferItem.webkitGetAsEntry`（拖放）递归读完整个目录，每个文件读成
base64；Host 侧解码后原样写出。路径先过 `safeRelativePath`（拒 `..`、
绝对路径、盘符、Windows 保留字符），再用 `insideRoot` 复核，单个文件夹限
100 个文件 / 4 MiB。`SKILL.md` 仍走 `writeSkill` 的校验与原子写，其余文件
按相对路径落到同一个技能目录 —— 保存与导入不会分叉成两套规则。

**侧栏钢笔是粗描边 SVG。** U+1F58A 默认是文本呈现字符，很多系统会用单色
细线字形渲染，20px 下比旁边图标轻一截。现在用 `strokeWidth: 2.4` 的
线描钢笔代替，`icon.svg` 的轮廓线也一并加粗。

**只读来源不给删除。** bundled 与插件运行时注册的技能不落在可写根里，面板上
不提供删除按钮，Host 侧也会再拒一次。

## HTTP API

同源，前缀 `/dsh-skill-manager/api`：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/skills?cwd=` | 全部技能（合并视图 + 可写性 + 覆盖层） |
| GET | `/skill?name=` | 全文、绝对路径、frontmatter 原文 |
| POST | `/skill/save` | 新建或更新 |
| POST | `/skill/import` | 批量导入（`{ items: [{type:'file',name,text} \| {type:'folder',name,files:[{path,data}]}], target }`；也兼容旧的 `{ files: [{name,text}] }`） |
| POST | `/skill/delete` | 删除 |
| POST | `/skill/toggle` | 启停模型可见性 |

## 配置

`cordis.patch.yml` 里的 `config`：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `extraRoots` | `[]` | 额外允许写入的 skill 根目录 |
| `allowWrite` | `true` | `false` 时整页只读 |
| `maxSkillBytes` | `262144` | 单个 SKILL.md 的体积上限 |

默认可写根：`<DSH_HOME>/skills`（用户）与 `<项目>/.dsh/skills`（项目）。

## 开发

```powershell
node --check index.js; node --check skill-file.js; node --check client.js
node test/host.test.mjs
node test/client.test.mjs
node test/import.test.mjs
node test/render.test.mjs
```

测试用 `node <file>` 直接跑，不要用 `node --test`：后者要 spawn 子进程，在受限
沙箱里会因命名管道不可用而 `EPERM`。

`test/render.test.mjs` 用一个极小的 hook 运行时把页面渲染到稳定态，断言结构、
文案与「不该出现的东西」。它证明不崩、结构对，**不证明好看** —— 观感必须在
运行中的页面里看。

## 安装

```js
plugin_manager({ action: 'install_bundle', target: '<本目录绝对路径>' })
```
