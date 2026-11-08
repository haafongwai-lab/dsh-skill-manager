/**
 * dsh-skill-manager — Client half (browser).
 *
 * Web 客户端只接受 Module Loader 格式：脚本顶层调用
 * `window.__ModuleLoader__.load({ id, factory })`，factory 返回插件导出。
 *
 * 界面范式与同仓的 dsh-note-wall / dsh-mcp-manager 一致（「便签墙」是这套
 * 设计的基准）：
 *   - 侧边栏 `sidebar.panellist` 一个技能图标，主区 `main` 一页技能墙；
 *   - 顶部标题 + 副标题，右侧胶囊搜索框、刷新与计数；
 *   - 一张白色「新建技能」输入卡：柔和底色、左下保存位置分段控件、
 *     右下 ⌘/Ctrl+Enter 与深色主按钮；
 *   - 下方技能网格：马卡龙底色卡片，状态点 + 技能名 + 来源徽章，
 *     描述两行截断，底部更新时间与操作按钮；
 *   - 浮层：详情（全文）与编辑器；骨架只用 Harness 的主题 token，
 *     卡片底色是「作品」色彩，按 `data-scheme` 提供深色版。
 *
 * 数据全部来自 Host 半的 /dsh-skill-manager/api，客户端不持有任何真相。
 */
window.__ModuleLoader__.load({
  id: 'dsh-skill-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-skill-manager'
    const PANEL_ID = 'skill-manager'
    const API = '/dsh-skill-manager/api'

    /** 卡片配色：与便签墙同一组马卡龙色。 */
    const COLORS = ['butter', 'rose', 'sky', 'mint', 'lilac', 'cream']

    /**
     * 落地动画的时长与清理时机。
     *
     * `sm-card-land` 是 1.1s，`sm-card-sheen` 是 1s + 0.24s 延迟 = 1.24s，
     * 摘掉 `sm-card-enter` 必须晚于两者，否则动画会在半途被掐断。
     */
    const LAND_MS = 1100
    const SHEEN_MS = 1000
    const SHEEN_DELAY_MS = 240
    const LANDING_MS = Math.max(LAND_MS, SHEEN_MS + SHEEN_DELAY_MS) + 150

    const TOAST_MS = 5200
    const CONFIRM_MS = 6000

    // -----------------------------------------------------------------------
    // Locale
    // -----------------------------------------------------------------------

    const DICT = {
      zh: {
        panelTitle: '技能管理',
        pageTitle: '技能',
        pageIntro: '每个能力，都从这里交给他。',
        searchPlaceholder: '搜索技能',
        countLabel: '{n} 个技能',
        clearSearch: '清除搜索',
        filtered: '没有匹配的技能',
        empty: '还没有任何技能。',
        emptyHint: '在上面写一个名字，它就会出现在这里。',
        loading: '正在读取技能目录…',
        loadFailed: '读取失败',
        incomplete: '目录尚未完整：部分来源未能列出，已保留上次结果。',
        retry: '重试',
        refresh: '刷新',
        all: '全部',
        srcUser: '用户',
        srcProject: '项目',
        srcBundled: '内置',
        srcRuntime: '运行时',
        srcOther: '其它',
        namePlaceholder: '技能名，比如 my-skill',
        nameLabel: '技能名',
        nameHint: '只能包含小写字母、数字与连字符，最长 64 字符。',
        descLabel: '描述',
        descHint: '一句话说明它做什么。模型靠这句话判断要不要加载它。',
        whenLabel: '何时使用（可选）',
        contentLabel: '正文',
        contentHint: 'Markdown。技能被调用时，这段内容会原样交给模型。',
        targetLabel: '保存到',
        targetUser: '用户',
        targetProject: '项目',
        add: '新建技能',
        save: '保存修改',
        cancel: '取消',
        editingHint: '正在编辑这个技能',
        submitHint: '{key} + Enter',
        view: '查看',
        edit: '编辑',
        remove: '删除',
        enable: '启用',
        disable: '停用',
        enabled: '已启用',
        disabled: '已停用',
        confirmDelete: '删除这个技能？',
        confirmYes: '删除',
        confirmNo: '取消',
        saved: '已保存',
        deleted: '已删除一个技能',
        toggled: '已更新模型可见性',
        readOnlySkill: '这个技能来自只读来源，不能在这里修改。',
        detailTitle: '技能详情',
        detailClose: '关闭',
        detailPath: '文件',
        detailSource: '来源',
        detailProvider: '提供者',
        detailFrontmatter: 'frontmatter',
        detailBody: '正文',
        detailCopyPath: '复制路径',
        copied: '已复制',
        detailInvocation: '调用策略',
        invModel: '模型可调用',
        invUser: '用户可调用',
        invNo: '否',
        invYes: '是',
        errName: '名字只能是小写字母、数字和连字符。',
        errDesc: '先写一句描述吧。',
        errGeneric: '操作失败，请重试。',
        errReadOnly: '当前是只读模式。',
        errTooLarge: '技能文件太大了。',
        errNotFound: '这个技能已经不在了。',
        readOnlyBanner: '只读模式：可以查看，不能修改。',
        importTitle: '导入技能',
        importHint: '把 .md 文件或技能文件夹拖进来，也可以用下面的按钮选择。同名技能会被覆盖。',
        importDropHint: '文件夹需含 SKILL.md，其余文件会一并导入',
        importPick: '选择文件',
        importPickFolder: '选择文件夹',
        importDrop: '拖到这里',
        importQueue: '{n} 项待导入',
        importRun: '开始导入',
        importClose: '关闭',
        importEmpty: '还没有选择文件或文件夹。',
        importTarget: '导入到',
        importDone: '导入完成：新增 {created} 个，覆盖 {updated} 个',
        importPartial: '导入 {n} 个，{failed} 个失败',
        importFailed: '全部导入失败',
        importTooMany: '一次最多导入 200 项。',
        importReportCreated: '新增',
        importReportUpdated: '覆盖',
        importReportFailed: '失败',
        importFolderCount: '{name}（{n} 个文件）',
        importErrNoSkillMd: '缺少 SKILL.md',
        importErrInvalidPath: '文件路径不合法',
        importErrTooManyFiles: '文件夹里文件太多',
        importErrTooLarge: '文件夹太大',
        importClear: '清空',
      },
      en: {
        panelTitle: 'Skills',
        pageTitle: 'Skills',
        pageIntro: 'Every capability, handed over from here.',
        searchPlaceholder: 'Search skills',
        countLabel: '{n} skills',
        clearSearch: 'Clear search',
        filtered: 'No matching skills',
        empty: 'No skills yet.',
        emptyHint: 'Write a name above and it shows up here.',
        loading: 'Reading the skill catalog…',
        loadFailed: 'Could not load the catalog',
        incomplete: 'The catalog is incomplete: some sources could not be listed. Last result kept.',
        retry: 'Retry',
        refresh: 'Refresh',
        all: 'All',
        srcUser: 'User',
        srcProject: 'Project',
        srcBundled: 'Bundled',
        srcRuntime: 'Runtime',
        srcOther: 'Other',
        namePlaceholder: 'Skill name, e.g. my-skill',
        nameLabel: 'Name',
        nameHint: 'Lowercase letters, digits and hyphens, up to 64 characters.',
        descLabel: 'Description',
        descHint: 'One line on what it does. The model decides from this line.',
        whenLabel: 'When to use (optional)',
        contentLabel: 'Body',
        contentHint: 'Markdown. Handed to the model verbatim when the skill runs.',
        targetLabel: 'Save to',
        targetUser: 'User',
        targetProject: 'Project',
        add: 'Create skill',
        save: 'Save changes',
        cancel: 'Cancel',
        editingHint: 'Editing this skill',
        submitHint: '{key} + Enter',
        view: 'View',
        edit: 'Edit',
        remove: 'Delete',
        enable: 'Enable',
        disable: 'Disable',
        enabled: 'Enabled',
        disabled: 'Disabled',
        confirmDelete: 'Delete this skill?',
        confirmYes: 'Delete',
        confirmNo: 'Cancel',
        saved: 'Saved',
        deleted: 'Skill deleted',
        toggled: 'Model visibility updated',
        readOnlySkill: 'This skill comes from a read-only source and cannot be changed here.',
        detailTitle: 'Skill',
        detailClose: 'Close',
        detailPath: 'File',
        detailSource: 'Source',
        detailProvider: 'Provider',
        detailFrontmatter: 'frontmatter',
        detailBody: 'Body',
        detailCopyPath: 'Copy path',
        copied: 'Copied',
        detailInvocation: 'Invocation',
        invModel: 'Model invocable',
        invUser: 'User invocable',
        invNo: 'No',
        invYes: 'Yes',
        errName: 'Use lowercase letters, digits and hyphens only.',
        errDesc: 'Write a description first.',
        errGeneric: 'That did not work. Try again.',
        errReadOnly: 'This panel is read-only.',
        errTooLarge: 'That skill file is too large.',
        errNotFound: 'That skill is gone already.',
        readOnlyBanner: 'Read-only mode: browse allowed, edits are not.',
        importTitle: 'Import skills',
        importHint: 'Drop .md files or whole skill folders here, or pick them below. Same-name skills are overwritten.',
        importDropHint: 'A folder needs SKILL.md; its other files come along',
        importPick: 'Choose files',
        importPickFolder: 'Choose folder',
        importDrop: 'Drop here',
        importQueue: '{n} item(s) ready',
        importRun: 'Import',
        importClose: 'Close',
        importEmpty: 'No files or folders selected yet.',
        importTarget: 'Import to',
        importDone: 'Imported: {created} new, {updated} overwritten',
        importPartial: 'Imported {n}, {failed} failed',
        importFailed: 'Nothing was imported',
        importTooMany: 'At most 200 items per import.',
        importReportCreated: 'new',
        importReportUpdated: 'overwritten',
        importReportFailed: 'failed',
        importFolderCount: '{name} ({n} files)',
        importErrNoSkillMd: 'Missing SKILL.md',
        importErrInvalidPath: 'Invalid file path',
        importErrTooManyFiles: 'Too many files in the folder',
        importErrTooLarge: 'That folder is too large',
        importClear: 'Clear',
      },
    }

    /**
     * 这个面板固定说中文。
     *
     * 以前这里按 `locale.getLocale().active` 切中英，结果是：首屏渲染时宿主
     * 偏好还没解析完，先回退到 en，等 locale 快照到了再刷成 zh —— 用户看到
     * 的就是界面在两种语言之间跳一下。同一个原因是三个插件共有的（这段代码
     * 从便签墙复制而来）。
     *
     * 现在把语言钉成 zh：`locale.register` 仍然照常注册中英两套字典，宿主
     * 需要时也能读到 en，但本面板的显示语言不再跟随运行时的瞬时状态。
     */
    const PANEL_LOCALE = 'zh'

    function makeTranslator(locale) {
      let bound = null
      if (locale && typeof locale.bind === 'function') {
        try {
          bound = locale.bind(NS)
        } catch {
          bound = null
        }
      }
      return function translate(key, params) {
        let text
        // 先查自己钉死的字典，查不到才问宿主 —— 顺序反过来就会在字典注册完成
        // 前后拿到不同的结果，那正是界面跳变的来源。
        const pinned = DICT[PANEL_LOCALE][key]
        if (typeof pinned === 'string') text = pinned
        if (text === undefined && bound) {
          try {
            const value = bound(key)
            if (typeof value === 'string' && value !== key) text = value
          } catch {
            /* fall through to the embedded dictionary */
          }
        }
        if (text === undefined) text = DICT[PANEL_LOCALE][key] || DICT.en[key] || key
        if (params) {
          for (const name of Object.keys(params)) {
            text = text.split(`{${name}}`).join(String(params[name]))
          }
        }
        return text
      }
    }

    // -----------------------------------------------------------------------
    // API
    // -----------------------------------------------------------------------

    const ERROR_KEY = {
      'invalid-name': 'errName',
      'empty-description': 'errDesc',
      'read-only': 'errReadOnly',
      'read-only-skill': 'readOnlySkill',
      'too-large': 'errTooLarge',
      'not-found': 'errNotFound',
      // 文件夹导入的失败原因：逐条显示在队列里，别只丢一个英文错误码。
      'missing-skill-md': 'importErrNoSkillMd',
      'empty-folder': 'importErrNoSkillMd',
      'invalid-path': 'importErrInvalidPath',
      'too-many-folder-files': 'importErrTooManyFiles',
      'folder-too-large': 'importErrTooLarge',
    }

    async function apiJson(path, options = {}) {
      const res = await fetch(API + path, {
        credentials: 'same-origin',
        ...options,
        headers: { ...(options.headers || {}) },
      })
      const text = await res.text()
      let body = null
      if (text) {
        try {
          body = JSON.parse(text)
        } catch {
          body = null
        }
      }
      if (!res.ok) {
        const error = new Error((body && (body.error || body.message)) || `HTTP ${res.status}`)
        error.code = body && body.error
        throw error
      }
      return body || {}
    }

    const postJson = (path, payload) => apiJson(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const api = {
      list: (cwd) => apiJson(`/skills${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),
      get: (name, cwd) => apiJson(`/skill?name=${encodeURIComponent(name)}${cwd ? `&cwd=${encodeURIComponent(cwd)}` : ''}`),
      save: (payload) => postJson('/skill/save', payload),
      // items 是「散装文件 / 文件夹」混排，顺序即报告顺序。
      importItems: (items, target, cwd) => postJson('/skill/import', { items, target, cwd }),
      remove: (name, cwd, target) => postJson('/skill/delete', { name, cwd, target }),
      toggle: (name, enabled, cwd) => postJson('/skill/toggle', { name, enabled, cwd }),
    }

    // -----------------------------------------------------------------------
    // Small helpers
    // -----------------------------------------------------------------------

    function errorText(error, t) {
      const key = error && error.code ? ERROR_KEY[error.code] : undefined
      return key ? t(key) : t('errGeneric')
    }

    /** 导入报告里的错误码：认识的说人话，不认识的保留原文便于排查。 */
    function importErrorText(code, t) {
      const key = ERROR_KEY[code]
      return key ? t(key) : (code || t('errGeneric'))
    }

    function isMac() {
      try {
        return /mac/i.test(navigator.platform || navigator.userAgent || '')
      } catch {
        return false
      }
    }

    /** 按名字稳定取色：刷新、搜索、改状态都不该让卡片跳色。 */
    function colorOf(name) {
      let hash = 0
      const text = String(name || '')
      for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0
      return COLORS[hash % COLORS.length]
    }

    /** 把 source 归到面板上的五个分组之一。 */
    function groupOf(source) {
      const value = String(source || '')
      if (value === 'user-dsh' || value === 'user-agents') return 'user'
      if (value === 'project-dsh' || value === 'project-agents') return 'project'
      if (value === 'bundled') return 'bundled'
      if (value === 'runtime') return 'runtime'
      if (value === 'custom') return 'user'
      return 'other'
    }

    const GROUP_KEY = {
      user: 'srcUser',
      project: 'srcProject',
      bundled: 'srcBundled',
      runtime: 'srcRuntime',
      other: 'srcOther',
    }

    function relativeTime(ts, t) {
      const time = typeof ts === 'number' ? ts : Date.parse(ts)
      if (!Number.isFinite(time)) return ''
      const diff = Date.now() - time
      if (diff < 0 || diff < 60e3) return t('justNow') || '—'
      if (diff < 3600e3) return t('minutesAgo', { n: Math.floor(diff / 60e3) })
      if (diff < 86400e3) return t('hoursAgo', { n: Math.floor(diff / 3600e3) })
      if (diff < 7 * 86400e3) return t('daysAgo', { n: Math.floor(diff / 86400e3) })
      const d = new Date(time)
      return `${d.getMonth() + 1}/${d.getDate()}`
    }

    // -----------------------------------------------------------------------
    // Icons
    // -----------------------------------------------------------------------

    function strokeProps(size) {
      return {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        style: { display: 'inline-block', verticalAlign: 'middle' },
      }
    }

    function SearchIcon({ size = 15 }) {
      return h('svg', strokeProps(size),
        h('circle', { cx: 10.5, cy: 10.5, r: 6.2 }),
        h('path', { d: 'M15.1 15.1 20 20' }))
    }

    function PlusIcon({ size = 14 }) {
      return h('svg', strokeProps(size), h('path', { d: 'M12 5.5v13M5.5 12h13' }))
    }

    function RefreshIcon({ size = 14 }) {
      return h('svg', strokeProps(size),
        h('path', { d: 'M19.2 12a7.2 7.2 0 1 1-2.1-5.1' }),
        h('path', { d: 'M19.4 4.4v4.2h-4.2' }))
    }

    function PencilIcon({ size = 13 }) {
      return h('svg', strokeProps(size),
        h('path', { d: 'M4.6 19.4h3.2l9.3-9.3-3.2-3.2-9.3 9.3z' }),
        h('path', { d: 'M14.4 6.4 16.6 4.2a1.5 1.5 0 0 1 2.1 0l1.1 1.1a1.5 1.5 0 0 1 0 2.1l-2.2 2.2' }))
    }

    function TrashIcon({ size = 13 }) {
      return h('svg', strokeProps(size),
        h('path', { d: 'M4.8 6.9h14.4' }),
        h('path', { d: 'M9.4 6.9V5.2a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1v1.7' }),
        h('path', { d: 'M6.6 6.9 7.5 19a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9l.9-12.1' }))
    }

    function EyeIcon({ size = 13 }) {
      return h('svg', strokeProps(size),
        h('path', { d: 'M2.8 12S6.2 6.4 12 6.4 21.2 12 21.2 12 17.8 17.6 12 17.6 2.8 12 2.8 12z' }),
        h('circle', { cx: 12, cy: 12, r: 2.6 }))
    }

    function CloseIcon({ size = 12 }) {
      return h('svg', strokeProps(size), h('path', { d: 'M6 6l12 12M18 6 6 18' }))
    }

    /** 导入：一个向下的箭头落进托盘。 */
    function ImportIcon({ size = 14 }) {
      return h('svg', strokeProps(size),
        h('path', { d: 'M12 3.6v10.2' }),
        h('path', { d: 'M8.1 10.2 12 14.1l3.9-3.9' }),
        h('path', { d: 'M4.6 16.4v2.2a1.4 1.4 0 0 0 1.4 1.4h12a1.4 1.4 0 0 0 1.4-1.4v-2.2' }))
    }

    function FileIcon({ size = 13 }) {
      return h('svg', strokeProps(size),
        h('path', { d: 'M6.4 3.6h7.1l4.1 4.1v12.7a1.4 1.4 0 0 1-1.4 1.4H6.4A1.4 1.4 0 0 1 5 20.4V5a1.4 1.4 0 0 1 1.4-1.4z' }),
        h('path', { d: 'M13.4 3.8v4h4' }))
    }

    /** 导入队列里的文件夹条目。 */
    function FolderIcon({ size = 13 }) {
      return h('svg', strokeProps(size),
        h('path', { d: 'M3.8 6.6a1.4 1.4 0 0 1 1.4-1.4h3.3l1.9 2.1h7.8a1.4 1.4 0 0 1 1.4 1.4v9.5a1.4 1.4 0 0 1-1.4 1.4H5.2a1.4 1.4 0 0 1-1.4-1.4z' }))
    }

    /**
     * 侧边栏图标：一支粗线条的钢笔。
     *
     * 之前用 emoji 的 U+1F58A 字符：它默认是文本呈现字符，不少系统会拿单色字形
     * 渲染，20px 下只剩几条细线，看着比旁边所有图标都轻 —— 用户要的就是把
     * 线条加粗。现在改回 SVG 描边，但把 stroke 明确钉到 2.4（24 视框，
     * 20px 下约 2px），笔杆与笔尖留足留白，小尺寸才不会糊成一团读成箭头。
     *
     * 保留 `size` 参数：sidebar.panellist 的 owner 会传 20（或侧栏收窄时的
     * 其它尺寸），宽高跟着它走，才能和旁边几个图标对齐。
     */
    function PanelIcon({ size = 20 }) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        style: { display: 'inline-block', verticalAlign: 'middle' },
      },
        // 笔身：右上 → 左下的斜置钢笔，末端收成笔尖。
        h('path', { d: 'M16.4 3.6a2.2 2.2 0 0 1 3.1 3.1L9.9 16.3 4.3 19.6l3.3-5.6z' }),
        // 笔帽接缝：一条粗线把笔杆和笔尖分开。
        h('path', { d: 'M14.6 5.4 18.6 9.4' }))
    }

    // -----------------------------------------------------------------------
    // Page
    // -----------------------------------------------------------------------

    function makeUi(t, locale, theme, subscribeTheme) {
      function useTranslate() {
        const [, setRevision] = React.useState(0)
        React.useEffect(() => {
          if (!locale || typeof locale.subscribe !== 'function') return undefined
          return locale.subscribe(() => setRevision((n) => n + 1))
        }, [])
        return t
      }

      function readScheme() {
        try {
          const snapshot = theme && theme.getTheme && theme.getTheme()
          const scheme = snapshot && snapshot.active && snapshot.active.colorScheme
          if (scheme === 'dark' || scheme === 'light') return scheme
        } catch {
          /* fall through to the media query */
        }
        try {
          return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        } catch {
          return 'light'
        }
      }

      function useScheme() {
        const [scheme, setScheme] = React.useState(readScheme)
        React.useEffect(() => {
          if (typeof subscribeTheme !== 'function') return undefined
          const off = subscribeTheme(() => setScheme(readScheme()))
          return typeof off === 'function' ? off : undefined
        }, [])
        return scheme
      }

      /**
       * 技能格数量：窄窗 3 列 = 6 格，宽窗（≥1120px）4 列 = 8 格。
       * 列数由 CSS 断点决定，这里只读同一个断点来算要补几张占位卡。
       */
      const WIDE_QUERY = '(min-width:1120px)'

      function readWide() {
        try {
          return window.matchMedia(WIDE_QUERY).matches
        } catch {
          return false
        }
      }

      function useSlots() {
        const [wide, setWide] = React.useState(readWide)
        React.useEffect(() => {
          let query
          try {
            query = window.matchMedia(WIDE_QUERY)
          } catch {
            return undefined
          }
          const onChange = () => setWide(query.matches)
          if (typeof query.addEventListener === 'function') {
            query.addEventListener('change', onChange)
            return () => query.removeEventListener('change', onChange)
          }
          if (typeof query.addListener === 'function') {
            query.addListener(onChange)
            return () => query.removeListener(onChange)
          }
          return undefined
        }, [])
        return wide ? 8 : 6
      }

      /** 详情浮层：Esc 关闭、点遮罩关闭、打开时把焦点移进对话框。 */
      function useDialog(onClose, open) {
        const ref = React.useRef(null)
        React.useEffect(() => {
          if (!open) return undefined
          const onKey = (event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              onClose()
            }
          }
          window.addEventListener('keydown', onKey, true)
          const node = ref.current
          if (node && typeof node.focus === 'function') node.focus()
          return () => window.removeEventListener('keydown', onKey, true)
        }, [open, onClose])
        return ref
      }

      function SkillPage() {
        const translate = useTranslate()
        const scheme = useScheme()
        const slotCount = useSlots()

        const [loading, setLoading] = React.useState(true)
        const [loadError, setLoadError] = React.useState(null)
        const [complete, setComplete] = React.useState(true)
        const [allowWrite, setAllowWrite] = React.useState(true)
        const [roots, setRoots] = React.useState([])
        const [skills, setSkills] = React.useState([])
        const [query, setQuery] = React.useState('')
        const [group, setGroup] = React.useState('all')
        const [toast, setToast] = React.useState(null)
        const [detail, setDetail] = React.useState(null)
        const [editor, setEditor] = React.useState(null)
        const [importer, setImporter] = React.useState(null)
        const [confirming, setConfirming] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [landing, setLanding] = React.useState(() => new Set())

        const toastTimer = React.useRef(0)
        const toastSeq = React.useRef(0)
        const confirmTimer = React.useRef(0)
        const landingTimers = React.useRef(new Map())

        const refresh = React.useCallback(async () => {
          try {
            const body = await api.list()
            setSkills(Array.isArray(body.skills) ? body.skills : [])
            setComplete(body.complete !== false)
            setAllowWrite(body.allowWrite !== false)
            setRoots(Array.isArray(body.roots) ? body.roots : [])
            setLoadError(null)
          } catch (error) {
            setLoadError(error)
          } finally {
            setLoading(false)
          }
        }, [])

        React.useEffect(() => {
          void refresh()
        }, [refresh])

        React.useEffect(() => () => {
          if (toastTimer.current) clearTimeout(toastTimer.current)
          if (confirmTimer.current) clearTimeout(confirmTimer.current)
          for (const timer of landingTimers.current.values()) clearTimeout(timer)
          landingTimers.current.clear()
        }, [])

        function notify(message, action) {
          toastSeq.current += 1
          const seq = toastSeq.current
          setToast({ message, action, seq })
          if (toastTimer.current) clearTimeout(toastTimer.current)
          toastTimer.current = setTimeout(() => {
            setToast((current) => (current && current.seq === seq ? null : current))
          }, TOAST_MS)
        }

        function markLanding(id) {
          if (!id) return
          setLanding((current) => {
            if (current.has(id)) return current
            const next = new Set(current)
            next.add(id)
            return next
          })
          const existing = landingTimers.current.get(id)
          if (existing) clearTimeout(existing)
          landingTimers.current.set(id, setTimeout(() => {
            landingTimers.current.delete(id)
            setLanding((current) => {
              if (!current.has(id)) return current
              const next = new Set(current)
              next.delete(id)
              return next
            })
          }, LANDING_MS))
        }

        function askConfirm(id) {
          setConfirming(id)
          if (confirmTimer.current) clearTimeout(confirmTimer.current)
          // 内联确认 6 秒自动收起，避免误点后卡片一直卡在确认态。
          confirmTimer.current = setTimeout(() => setConfirming(null), CONFIRM_MS)
        }

        async function toggleSkill(skill) {
          if (busy) return
          setBusy(true)
          try {
            await api.toggle(skill.name, !skill.modelInvocable)
            setSkills((current) => current.map((entry) => (
              entry.name === skill.name ? { ...entry, modelInvocable: !entry.modelInvocable } : entry
            )))
            notify(translate('toggled'))
          } catch (error) {
            notify(errorText(error, translate))
          } finally {
            setBusy(false)
          }
        }

        async function removeSkill(skill) {
          setConfirming(null)
          if (busy) return
          setBusy(true)
          try {
            await api.remove(skill.name, undefined, skill.target)
            setSkills((current) => current.filter((entry) => entry.name !== skill.name))
            notify(translate('deleted'))
          } catch (error) {
            notify(errorText(error, translate))
          } finally {
            setBusy(false)
          }
        }

        async function openDetail(skill) {
          setDetail({ loading: true, skill })
          try {
            const body = await api.get(skill.name)
            setDetail({ loading: false, skill: body.skill })
          } catch (error) {
            setDetail(null)
            notify(errorText(error, translate))
          }
        }

        function startCreate() {
          const target = roots.find((root) => root.id === 'user') || roots[0]
          setEditor({
            mode: 'create',
            name: '',
            description: '',
            whenToUse: '',
            content: '',
            modelInvocable: true,
            target: target ? target.id : 'user',
            previousName: '',
          })
        }

        function startEdit(skill) {
          setEditor({
            mode: 'edit',
            loading: true,
            name: skill.name,
            description: skill.description,
            whenToUse: skill.whenToUse || '',
            content: '',
            modelInvocable: skill.modelInvocable,
            target: skill.target || 'user',
            previousName: skill.name,
          })
          api.get(skill.name).then((body) => {
            setEditor((current) => (current && current.name === skill.name
              ? {
                ...current,
                loading: false,
                content: body.skill.content || '',
                description: body.skill.description || current.description,
                whenToUse: body.skill.whenToUse || '',
                modelInvocable: body.skill.modelInvocable,
              }
              : current))
          }).catch((error) => {
            setEditor(null)
            notify(errorText(error, translate))
          })
        }

        async function runImport(items, target) {
          if (!items || items.length === 0) return
          setImporter((current) => (current ? { ...current, busy: true, result: null } : current))
          try {
            const body = await api.importItems(items.map((item) => item.payload), target)
            setImporter((current) => (current ? { ...current, busy: false, result: body } : current))
            if (body.imported > 0) {
              for (const entry of body.report || []) if (entry.ok) markLanding(entry.name)
              await refresh()
            }
            // 有失败就留在浮层里逐条展示，别把失败悄悄吞掉。
            if (body.failed === 0) {
              notify(translate('importDone', { created: body.created, updated: body.updated }))
            } else if (body.imported > 0) {
              notify(translate('importPartial', { n: body.imported, failed: body.failed }))
            } else {
              notify(translate('importFailed'))
            }
          } catch (error) {
            setImporter((current) => (current ? { ...current, busy: false } : current))
            notify(errorText(error, translate))
          }
        }

        async function submitEditor() {
          if (!editor || busy) return
          const name = editor.name.trim()
          if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
            notify(translate('errName'))
            return
          }
          if (editor.description.trim().length === 0) {
            notify(translate('errDesc'))
            return
          }
          setBusy(true)
          try {
            await api.save({
              name,
              description: editor.description,
              whenToUse: editor.whenToUse,
              content: editor.content,
              modelInvocable: editor.modelInvocable,
              target: editor.target,
              previousName: editor.previousName,
            })
            setEditor(null)
            markLanding(name)
            await refresh()
            notify(translate('saved'))
          } catch (error) {
            notify(errorText(error, translate))
          } finally {
            setBusy(false)
          }
        }

        const visible = skills.filter((skill) => {
          if (group !== 'all' && groupOf(skill.source) !== group) return false
          if (query.trim().length === 0) return true
          const needle = query.trim().toLowerCase()
          return skill.name.toLowerCase().includes(needle)
            || skill.description.toLowerCase().includes(needle)
            || String(skill.source).toLowerCase().includes(needle)
        })

        const groups = React.useMemo(() => {
          const seen = new Set(['all'])
          for (const skill of skills) seen.add(groupOf(skill.source))
          return ['all', 'user', 'project', 'bundled', 'runtime'].filter((key) => seen.has(key))
        }, [skills])

        const ghosts = Math.max(0, slotCount - visible.length)

        return h('div', { className: 'sm-page', 'data-scheme': scheme },
          h('div', { className: 'sm-head' },
            h('div', { className: 'sm-heading' },
              h('h1', { className: 'sm-title' }, translate('pageTitle')),
              h('p', { className: 'sm-intro' }, translate('pageIntro'))),
            h('div', { className: 'sm-toolbar' },
              h('label', { className: 'sm-search' },
                h('span', { className: 'sm-search-icon' }, h(SearchIcon, null)),
                h('input', {
                  className: 'sm-search-input',
                  type: 'search',
                  value: query,
                  placeholder: translate('searchPlaceholder'),
                  'aria-label': translate('searchPlaceholder'),
                  onChange: (event) => setQuery(event.target.value),
                }),
                query.length > 0
                  ? h('button', {
                    className: 'sm-search-clear',
                    type: 'button',
                    title: translate('clearSearch'),
                    'aria-label': translate('clearSearch'),
                    onClick: () => setQuery(''),
                  }, h(CloseIcon, { size: 11 }))
                  : null),
              allowWrite
                ? h('button', {
                  className: 'sm-icon-btn',
                  type: 'button',
                  title: translate('importTitle'),
                  'aria-label': translate('importTitle'),
                  onClick: () => setImporter({ items: [], target: (roots.find((root) => root.id === 'user') || roots[0] || {}).id || 'user', result: null, busy: false }),
                }, h(ImportIcon, null))
                : null,
              h('button', {
                className: 'sm-icon-btn',
                type: 'button',
                title: translate('refresh'),
                'aria-label': translate('refresh'),
                onClick: () => { void refresh() },
              }, h(RefreshIcon, null)),
              h('span', { className: 'sm-count' }, translate('countLabel', { n: visible.length })))),

          // 只读模式下把「不能改」说在明面上，别让用户点进去才发现。
          allowWrite ? null : h('p', { className: 'sm-banner' }, translate('readOnlyBanner')),
          !complete && !loading
            ? h('p', { className: 'sm-banner warn' }, translate('incomplete'))
            : null,

          allowWrite ? h('div', { className: 'sm-composer' },
            h('div', { className: 'sm-composer-head' },
              h('input', {
                className: 'sm-composer-name',
                value: editor && editor.mode === 'create' ? editor.name : '',
                placeholder: translate('namePlaceholder'),
                'aria-label': translate('nameLabel'),
                onChange: (event) => {
                  const value = event.target.value
                  setEditor((current) => (current && current.mode === 'create'
                    ? { ...current, name: value }
                    : {
                      mode: 'create',
                      name: value,
                      description: '',
                      whenToUse: '',
                      content: '',
                      modelInvocable: true,
                      target: (roots[0] && roots[0].id) || 'user',
                      previousName: '',
                    }))
                },
              }),
              h('button', {
                className: 'sm-submit',
                type: 'button',
                disabled: busy || !editor || editor.mode !== 'create' || editor.name.trim().length === 0,
                onClick: () => {
                  if (!editor || editor.mode !== 'create') return
                  // 输入卡只负责名字：点「新建技能」把它带进编辑器补全其余字段。
                  startCreate()
                  setEditor((current) => (current ? { ...current, name: editor.name } : current))
                },
              }, h(PlusIcon, null), translate('add'))),
            h('div', { className: 'sm-composer-foot' },
              h('span', { className: 'sm-hint' }, translate('submitHint', { key: isMac() ? '⌘' : 'Ctrl' })),
              h('span', { className: 'sm-hint' }, translate('nameHint'))))
            : null,

          // 分段控件：外层整宽行属于内容列，胶囊作为行内 flex 子项自然收缩，
          // 左缘与标题、卡片墙对齐。详见 note-wall-ui-style「分段控件的位置」。
          h('div', { className: 'sm-segments-row' },
            h('div', { className: 'sm-segments', role: 'tablist' },
              groups.map((key) => h('button', {
                key,
                className: 'sm-segment',
                type: 'button',
                role: 'tab',
                'aria-selected': group === key,
                'data-selected': group === key,
                onClick: () => setGroup(key),
              }, key === 'all' ? translate('all') : translate(GROUP_KEY[key] || 'srcOther'))))),

          loading
            ? h('p', { className: 'sm-status' }, h('span', { className: 'sm-spinner' }), translate('loading'))
            : loadError
              ? h('p', { className: 'sm-status bad' },
                translate('loadFailed'),
                h('button', { className: 'sm-link', type: 'button', onClick: () => { void refresh() } }, translate('retry')))
              : null,

          h('div', { className: 'sm-grid' },
            visible.map((skill) => {
              const confirm = confirming === skill.name
              return h('article', {
                key: skill.name,
                className: `sm-card${landing.has(skill.name) ? ' sm-card-enter' : ''}`,
                'data-color': colorOf(skill.name),
                'data-disabled': skill.modelInvocable ? 'false' : 'true',
                tabIndex: 0,
                onClick: () => { void openDetail(skill) },
                onKeyDown: (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    void openDetail(skill)
                  }
                },
              },
              h('header', { className: 'sm-card-head' },
                h('span', { className: 'sm-dot', 'aria-hidden': 'true' }),
                h('h2', { className: 'sm-card-title', title: skill.name }, skill.name),
                h('span', { className: 'sm-card-source' }, translate(GROUP_KEY[groupOf(skill.source)] || 'srcOther'))),
              h('p', { className: 'sm-card-desc' }, skill.description || '—'),
              h('footer', { className: 'sm-card-foot' },
                h('span', { className: 'sm-card-state' },
                  skill.modelInvocable ? translate('enabled') : translate('disabled')),
                confirm
                  ? h('span', { className: 'sm-confirm' },
                    h('span', { className: 'sm-confirm-text' }, translate('confirmDelete')),
                    h('button', {
                      className: 'sm-card-action danger',
                      type: 'button',
                      onClick: (event) => {
                        event.stopPropagation()
                        void removeSkill(skill)
                      },
                    }, translate('confirmYes')),
                    h('button', {
                      className: 'sm-card-action',
                      type: 'button',
                      onClick: (event) => {
                        event.stopPropagation()
                        setConfirming(null)
                      },
                    }, translate('confirmNo')))
                  : h('span', { className: 'sm-card-actions' },
                    skill.writable
                      ? h('button', {
                        className: 'sm-card-action',
                        type: 'button',
                        title: skill.modelInvocable ? translate('disable') : translate('enable'),
                        'aria-label': skill.modelInvocable ? translate('disable') : translate('enable'),
                        disabled: busy,
                        onClick: (event) => {
                          event.stopPropagation()
                          void toggleSkill(skill)
                        },
                      }, skill.modelInvocable ? translate('disable') : translate('enable'))
                      : null,
                    skill.writable
                      ? h('button', {
                        className: 'sm-card-action',
                        type: 'button',
                        title: translate('edit'),
                        'aria-label': translate('edit'),
                        onClick: (event) => {
                          event.stopPropagation()
                          startEdit(skill)
                        },
                      }, h(PencilIcon, null))
                      : null,
                    skill.writable
                      ? h('button', {
                        className: 'sm-card-action danger',
                        type: 'button',
                        title: translate('remove'),
                        'aria-label': translate('remove'),
                        onClick: (event) => {
                          event.stopPropagation()
                          askConfirm(skill.name)
                        },
                      }, h(TrashIcon, null))
                      : h('button', {
                        className: 'sm-card-action',
                        type: 'button',
                        title: translate('view'),
                        'aria-label': translate('view'),
                        onClick: (event) => {
                          event.stopPropagation()
                          void openDetail(skill)
                        },
                      }, h(EyeIcon, null)))))
            }),
            Array.from({ length: ghosts }, (_, index) => h('div', {
              key: `ghost-${index}`,
              className: 'sm-card ghost',
              'aria-hidden': 'true',
            }))),

          visible.length === 0 && !loading && !loadError
            ? h('p', { className: 'sm-status' }, skills.length === 0 ? translate('emptyHint') : translate('filtered'))
            : null,

          detail ? h(DetailDialog, {
            state: detail,
            translate,
            onClose: () => setDetail(null),
            onEdit: (skill) => {
              setDetail(null)
              startEdit(skill)
            },
          }) : null,

          editor ? h(EditorDialog, {
            state: editor,
            roots,
            translate,
            busy,
            onChange: (patch) => setEditor((current) => (current ? { ...current, ...patch } : current)),
            onSubmit: () => { void submitEditor() },
            onClose: () => setEditor(null),
          }) : null,

          importer ? h(ImportDialog, {
            state: importer,
            roots,
            translate,
            onChange: (patch) => setImporter((current) => (current ? { ...current, ...patch } : current)),
            onRun: (items, target) => { void runImport(items, target) },
            onClose: () => setImporter(null),
          }) : null,

          toast ? h('div', { className: 'sm-toast', role: 'status' },
            h('span', { className: 'sm-toast-text' }, toast.message),
            toast.action
              ? h('button', {
                className: 'sm-toast-action',
                type: 'button',
                onClick: toast.action.onClick,
              }, toast.action.label)
              : null) : null)
      }

      function DetailDialog({ state, translate, onClose, onEdit }) {
        const ref = useDialog(onClose, true)
        const skill = state.skill || {}
        const body = state.loading ? '' : (skill.content || '')
        return h('div', {
          className: 'sm-scrim',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h('div', {
          className: 'sm-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': translate('detailTitle'),
          ref,
          tabIndex: -1,
        },
        h('header', { className: 'sm-dialog-head' },
          h('span', { className: 'sm-dialog-dot', 'data-tone': skill.modelInvocable === false ? 'off' : 'on' }),
          h('div', { className: 'sm-dialog-heading' },
            h('h2', { className: 'sm-dialog-title' }, skill.name || ''),
            h('p', { className: 'sm-dialog-sub' }, skill.description || '')),
          h('button', {
            className: 'sm-dialog-close',
            type: 'button',
            title: translate('detailClose'),
            'aria-label': translate('detailClose'),
            onClick: onClose,
          }, h(CloseIcon, null))),
        h('div', { className: 'sm-dialog-body' },
          state.loading
            ? h('p', { className: 'sm-status' }, h('span', { className: 'sm-spinner' }), translate('loading'))
            : h(React.Fragment, null,
              h('dl', { className: 'sm-meta' },
                h('dt', null, translate('detailSource')),
                h('dd', null, `${skill.source || '—'} · ${skill.provider || '—'}`),
                skill.path ? h('dt', null, translate('detailPath')) : null,
                skill.path ? h('dd', { className: 'sm-meta-path' }, skill.path) : null,
                h('dt', null, translate('detailInvocation')),
                h('dd', null, [
                  `${translate('invModel')}: ${skill.modelInvocable ? translate('invYes') : translate('invNo')}`,
                  `${translate('invUser')}: ${skill.userInvocable ? translate('invYes') : translate('invNo')}`,
                ].join(' · '))),
              h('section', { className: 'sm-detail-block' },
                h('h3', { className: 'sm-detail-label' }, translate('detailBody')),
                h('pre', { className: 'sm-detail-body' }, body || '—')))),
        h('footer', { className: 'sm-dialog-foot' },
          h('span', { className: 'sm-dialog-stamp' },
            skill.writable ? translate('detailPath') : translate('readOnlySkill')),
          h('div', { className: 'sm-dialog-actions' },
            skill.writable
              ? h('button', {
                className: 'sm-dialog-btn primary',
                type: 'button',
                onClick: () => onEdit(skill),
              }, translate('edit'))
              : null,
            h('button', {
              className: 'sm-dialog-btn',
              type: 'button',
              onClick: onClose,
            }, translate('detailClose'))))))
      }

      // ---------------------------------------------------------------------
      // 文件夹导入：浏览器里把整棵目录读成 base64，再按 SKILL.md 切成技能。
      // 前端只负责「搬运」，frontmatter 解析与落盘仍全在 Host，避免两套规则。
      // ---------------------------------------------------------------------

      /** 散装 Markdown 读成 UTF-8 文本。 */
      function readTextFile(file) {
        return new Promise((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve({ name: file.name, text: String(reader.result || '') })
          reader.onerror = () => resolve({ name: file.name, text: '' })
          reader.readAsText(file, 'utf-8')
        })
      }

      /** 文件夹里的文件一律按二进制读，脚本 / 图片才不会被文本编码改坏。 */
      function readBase64File(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(new Error('read-failed'))
          reader.onload = () => {
            const bytes = new Uint8Array(reader.result || new ArrayBuffer(0))
            let binary = ''
            const chunk = 0x8000
            for (let i = 0; i < bytes.length; i += chunk) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
            }
            resolve(btoa(binary))
          }
          reader.readAsArrayBuffer(file)
        })
      }

      /**
       * 递归读一个 DataTransfer 目录项。
       * Chrome 的 readEntries 每次最多回 100 条，必须反复读到空数组为止。
       */
      function readEntry(entry, prefix, out) {
        return new Promise((resolve) => {
          if (entry.isFile) {
            entry.file((file) => {
              out.push({ path: prefix + entry.name, file })
              resolve()
            }, () => resolve())
            return
          }
          if (!entry.isDirectory) {
            resolve()
            return
          }
          const reader = entry.createReader()
          const children = []
          const readBatch = () => reader.readEntries((batch) => {
            if (!batch || batch.length === 0) {
              Promise.all(children.map((child) => readEntry(child, `${prefix}${entry.name}/`, out))).then(resolve, resolve)
              return
            }
            children.push(...batch)
            readBatch()
          }, () => resolve())
          readBatch()
        })
      }

      /** 凡直接含 SKILL.md 的目录算一个技能；一个父文件夹可切出多个技能。 */
      function splitSkillFolders(entries, label) {
        const markers = entries.filter((entry) => /(^|\/)SKILL\.md$/i.test(entry.path))
        if (markers.length === 0) return { bundles: [], missing: label }
        const bundles = markers.map((marker) => {
          const root = marker.path.replace(/\/?SKILL\.md$/i, '')
          const prefix = root ? `${root}/` : ''
          const name = root ? root.split('/').filter(Boolean).pop() : (label || 'skill')
          const files = entries
            .filter((entry) => entry.path.startsWith(prefix))
            .map((entry) => ({ path: entry.path.slice(prefix.length), file: entry.file }))
            .filter((entry) => entry.path.length > 0)
          return { name, files }
        })
        return { bundles: bundles.filter((bundle) => bundle.files.length > 0), missing: null }
      }

      /**
       * 导入浮层：选文件 / 选文件夹 → 预览队列 → 导入 → 逐条报告。
       *
       * 队列里混排两种条目：`file`（一个 .md 一条技能）与 `folder`（一个含
       * SKILL.md 的目录一条技能）。两者都只在这里读成数据，解析落盘交给 Host。
       */
      function ImportDialog({ state, roots, translate, onChange, onRun, onClose }) {
        const ref = useDialog(onClose, true)
        const fileInputRef = React.useRef(null)
        const folderInputRef = React.useRef(null)
        const keyRef = React.useRef(0)
        const [dragging, setDragging] = React.useState(false)

        const items = state.items || []
        const result = state.result

        function nextKey() {
          keyRef.current += 1
          return `item-${keyRef.current}`
        }

        function addItems(newItems) {
          if (newItems.length === 0) return
          onChange({ items: [...items, ...newItems].slice(0, 200), result: null })
        }

        /** 一组散装文件 → 队列条目。 */
        function textItems(list) {
          const picked = Array.from(list || []).filter((file) => /\.(md|markdown|txt)$/i.test(file.name))
          if (picked.length === 0) return Promise.resolve([])
          return Promise.all(picked.map(readTextFile)).then((entries) => entries.map((entry) => ({
            key: nextKey(),
            kind: 'file',
            name: entry.name,
            count: 1,
            payload: { type: 'file', name: entry.name, text: entry.text },
          })))
        }

        /** 一组 { path, file } → 队列条目（按 SKILL.md 切成多个技能）。 */
        function folderItems(entries, label) {
          const split = splitSkillFolders(entries, label)
          if (split.missing) {
            // 没找到 SKILL.md 也要在队列里给个说法，不能静默丢掉。
            return Promise.resolve([{
              key: nextKey(),
              kind: 'folder',
              name: split.missing,
              count: 0,
              invalid: true,
              payload: { type: 'folder', name: split.missing, files: [] },
            }])
          }
          return Promise.all(split.bundles.map(async (bundle) => {
            const files = []
            for (const entry of bundle.files) {
              try {
                files.push({ path: entry.path, data: await readBase64File(entry.file) })
              } catch {
                /* 单个文件读失败：整包交给 Host 按缺失报错 */
              }
            }
            return {
              key: nextKey(),
              kind: 'folder',
              name: bundle.name,
              count: files.length,
              payload: { type: 'folder', name: bundle.name, files },
            }
          }))
        }

        function takeFiles(list) {
          textItems(list).then(addItems)
        }

        /** <input webkitdirectory>：webkitRelativePath 带根文件夹名。 */
        function takeFolderInput(list) {
          const incoming = Array.from(list || [])
          if (incoming.length === 0) return
          const first = incoming[0].webkitRelativePath || incoming[0].name || ''
          const label = first.split('/')[0] || 'skill'
          const entries = incoming.map((file) => ({ path: file.webkitRelativePath || file.name, file }))
          folderItems(entries, label).then(addItems)
        }

        function onDrop(event) {
          event.preventDefault()
          setDragging(false)
          const dt = event.dataTransfer
          if (!dt) return
          const list = dt.items ? Array.from(dt.items) : []
          const entries = list
            .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
            .filter(Boolean)
          if (!entries.some((entry) => entry.isDirectory)) {
            takeFiles(dt.files)
            return
          }
          const out = []
          Promise.all(entries.map((entry) => readEntry(entry, '', out))).then(async () => {
            const label = (entries.find((entry) => entry.isDirectory) || {}).name || 'skill'
            const loose = out.filter((entry) => !entry.path.includes('/')).map((entry) => entry.file)
            // 一次 addItems：两条异步路径合并，避免互相覆盖队列。
            const [files, folders] = await Promise.all([textItems(loose), folderItems(out, label)])
            addItems([...files, ...folders])
          })
        }

        return h('div', {
          className: 'sm-scrim',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h('div', {
          className: 'sm-dialog sm-dialog-wide',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': translate('importTitle'),
          ref,
          tabIndex: -1,
        },
        h('header', { className: 'sm-dialog-head' },
          h('span', { className: 'sm-dialog-dot' }),
          h('div', { className: 'sm-dialog-heading' },
            h('h2', { className: 'sm-dialog-title' }, translate('importTitle')),
            h('p', { className: 'sm-dialog-sub' }, translate('importHint'))),
          h('button', {
            className: 'sm-dialog-close',
            type: 'button',
            title: translate('importClose'),
            'aria-label': translate('importClose'),
            onClick: onClose,
          }, h(CloseIcon, null))),
        h('div', { className: 'sm-dialog-body' },
          // 拖放区：文件与整个文件夹都能拖进来。
          h('div', {
            className: `sm-drop${dragging ? ' is-over' : ''}`,
            onDragOver: (event) => {
              event.preventDefault()
              setDragging(true)
            },
            onDragLeave: () => setDragging(false),
            onDrop,
          },
          h('span', { className: 'sm-drop-icon' }, h(ImportIcon, { size: 20 })),
          h('span', { className: 'sm-drop-text' }, translate('importDrop')),
          h('span', { className: 'sm-drop-hint' }, translate('importDropHint')),
          h('div', { className: 'sm-drop-actions' },
            h('button', {
              className: 'sm-drop-btn',
              type: 'button',
              onClick: () => {
                const node = fileInputRef.current
                if (node && typeof node.click === 'function') node.click()
              },
            }, translate('importPick')),
            h('button', {
              className: 'sm-drop-btn',
              type: 'button',
              onClick: () => {
                const node = folderInputRef.current
                if (node && typeof node.click === 'function') node.click()
              },
            }, translate('importPickFolder'))),
          h('input', {
            ref: fileInputRef,
            type: 'file',
            accept: '.md,.markdown,.txt,text/markdown',
            multiple: true,
            className: 'sm-file-input',
            onChange: (event) => {
              takeFiles(event.target.files)
              // 清空，让同一个文件能再选一次。
              event.target.value = ''
            },
          }),
          h('input', {
            ref: folderInputRef,
            type: 'file',
            webkitdirectory: '',
            directory: '',
            multiple: true,
            className: 'sm-file-input',
            onChange: (event) => {
              takeFolderInput(event.target.files)
              event.target.value = ''
            },
          })),

          items.length > 0
            ? h('div', { className: 'sm-import-queue' },
              h('div', { className: 'sm-import-queue-head' },
                h('span', null, translate('importQueue', { n: items.length })),
                h('button', {
                  className: 'sm-link',
                  type: 'button',
                  onClick: () => onChange({ items: [], result: null }),
                }, translate('importClear'))),
              h('ul', { className: 'sm-file-list' },
                items.map((item, index) => {
                  const entry = result && result.report ? result.report[index] : null
                  const label = item.kind === 'folder'
                    ? translate('importFolderCount', { name: item.name, n: item.count })
                    : item.name
                  return h('li', {
                    key: item.key || `${item.name}-${index}`,
                    className: 'sm-file-row',
                    'data-state': entry ? (entry.ok ? (entry.created ? 'new' : 'updated') : 'failed') : 'pending',
                  },
                  h('span', { className: 'sm-file-icon' }, h(item.kind === 'folder' ? FolderIcon : FileIcon, null)),
                  h('span', { className: 'sm-file-name', title: label }, label),
                  h('span', { className: 'sm-file-status' },
                    entry
                      ? (entry.ok
                        ? translate(entry.created ? 'importReportCreated' : 'importReportUpdated')
                        : `${translate('importReportFailed')} · ${importErrorText(entry.error, translate)}`)
                      : ''))
                })))
            : h('p', { className: 'sm-status' }, translate('importEmpty')),

          roots.length > 1
            ? h('div', { className: 'sm-field' },
              h('span', { className: 'sm-field-label' }, translate('importTarget')),
              h('div', { className: 'sm-segments' },
                roots.map((root) => h('button', {
                  key: root.id,
                  className: 'sm-segment',
                  type: 'button',
                  'data-selected': state.target === root.id,
                  disabled: Boolean(result),
                  onClick: () => onChange({ target: root.id }),
                }, root.id === 'project' ? translate('targetProject') : translate('targetUser')))))
            : null),
        h('footer', { className: 'sm-dialog-foot' },
          h('span', { className: 'sm-dialog-stamp' },
            result
              ? translate('importDone', { created: result.created, updated: result.updated })
              : translate('importQueue', { n: items.length })),
          h('div', { className: 'sm-dialog-actions' },
            h('button', {
              className: 'sm-dialog-btn',
              type: 'button',
              onClick: onClose,
            }, translate('importClose')),
            h('button', {
              className: 'sm-dialog-btn primary',
              type: 'button',
              disabled: state.busy || items.length === 0,
              onClick: () => onRun(items, state.target),
            }, state.busy ? translate('loading') : translate('importRun'))))))
      }

      function EditorDialog({ state, roots, translate, busy, onChange, onSubmit, onClose }) {
        const ref = useDialog(onClose, true)
        const isEdit = state.mode === 'edit'
        return h('div', {
          className: 'sm-scrim',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h('div', {
          className: 'sm-dialog sm-dialog-wide',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': isEdit ? translate('editingHint') : translate('add'),
          ref,
          tabIndex: -1,
          onKeyDown: (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              onSubmit()
            }
          },
        },
        h('header', { className: 'sm-dialog-head' },
          h('span', { className: 'sm-dialog-dot', 'data-tone': state.modelInvocable ? 'on' : 'off' }),
          h('div', { className: 'sm-dialog-heading' },
            h('h2', { className: 'sm-dialog-title' }, isEdit ? translate('editingHint') : translate('add')),
            h('p', { className: 'sm-dialog-sub' }, isEdit ? state.previousName : translate('nameHint'))),
          h('button', {
            className: 'sm-dialog-close',
            type: 'button',
            title: translate('cancel'),
            'aria-label': translate('cancel'),
            onClick: onClose,
          }, h(CloseIcon, null))),
        h('div', { className: 'sm-dialog-body' },
          state.loading
            ? h('p', { className: 'sm-status' }, h('span', { className: 'sm-spinner' }), translate('loading'))
            : h(React.Fragment, null,
              h('label', { className: 'sm-field' },
                h('span', { className: 'sm-field-label' }, translate('nameLabel')),
                h('input', {
                  className: 'sm-input',
                  value: state.name,
                  onChange: (event) => onChange({ name: event.target.value }),
                })),
              h('label', { className: 'sm-field' },
                h('span', { className: 'sm-field-label' }, translate('descLabel')),
                // 说明进 placeholder（note-wall-ui-style「设置页：密度要克制」）：
                // 这类提示每字段一行会把弹窗堆成小字墙。
                h('textarea', {
                  className: 'sm-input sm-textarea',
                  rows: 2,
                  value: state.description,
                  placeholder: translate('descHint'),
                  onChange: (event) => onChange({ description: event.target.value }),
                })),
              h('label', { className: 'sm-field' },
                h('span', { className: 'sm-field-label' }, translate('whenLabel')),
                h('input', {
                  className: 'sm-input',
                  value: state.whenToUse,
                  onChange: (event) => onChange({ whenToUse: event.target.value }),
                })),
              h('label', { className: 'sm-field' },
                h('span', { className: 'sm-field-label' }, translate('contentLabel')),
                h('textarea', {
                  className: 'sm-input sm-textarea sm-textarea-body',
                  rows: 12,
                  value: state.content,
                  placeholder: translate('contentHint'),
                  onChange: (event) => onChange({ content: event.target.value }),
                })),
              roots.length > 1
                ? h('div', { className: 'sm-field' },
                  h('span', { className: 'sm-field-label' }, translate('targetLabel')),
                  h('div', { className: 'sm-segments' },
                    roots.map((root) => h('button', {
                      key: root.id,
                      className: 'sm-segment',
                      type: 'button',
                      'data-selected': state.target === root.id,
                      disabled: isEdit,
                      onClick: () => onChange({ target: root.id }),
                    }, root.id === 'project' ? translate('targetProject') : translate('targetUser')))))
                : null)),
        h('footer', { className: 'sm-dialog-foot' },
          h('span', { className: 'sm-dialog-stamp' }, translate('submitHint', { key: isMac() ? '⌘' : 'Ctrl' })),
          h('div', { className: 'sm-dialog-actions' },
            h('button', {
              className: 'sm-dialog-btn',
              type: 'button',
              onClick: onClose,
            }, translate('cancel')),
            h('button', {
              className: 'sm-dialog-btn primary',
              type: 'button',
              disabled: busy || state.loading,
              onClick: onSubmit,
            }, isEdit ? translate('save') : translate('add'))))))
      }

      return { PanelIcon, SkillPage }
    }

    // -----------------------------------------------------------------------
    // Styles
    // -----------------------------------------------------------------------

    const CSS = `
.sm-page{box-sizing:border-box;height:100%;overflow:auto;display:flex;flex-direction:column;gap:20px;padding:0 clamp(24px,4vw,48px) 40px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.sm-page *{box-sizing:border-box}
/* 内容列收成一条居中栏。必须排除浮层与 toast：遮罩是 position:fixed，
   被这条规则加上 max-width + margin:auto 后会变成一条居中窄带，只压暗页面中间。 */
/* 内容列收成一条居中栏。排除浮层与 toast：它们是 position:fixed / sticky，
   被收窄会变成一条居中窄带，只压暗页面中间。 */
.sm-page>*:not(.sm-scrim):not(.sm-toast){width:100%;max-width:960px;margin-inline:auto}
.sm-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:16px;padding-top:28px}
[data-platform=darwin] .sm-head{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.sm-heading{min-width:0}
.sm-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.sm-intro{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.sm-toolbar{display:flex;align-items:center;gap:12px;flex:none;padding-top:4px}
.sm-search{position:relative;display:flex;align-items:center;width:208px}
.sm-search-input{width:100%;height:30px;padding:0 28px 0 30px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px;outline:none}
.sm-search-input::placeholder{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.sm-search-input:focus-visible{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}
.sm-search-input::-webkit-search-cancel-button{display:none}
.sm-search-icon{position:absolute;left:10px;display:inline-flex;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));pointer-events:none}
.sm-search-clear{position:absolute;right:6px;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:pointer}
.sm-search-clear:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-border-l1));color:var(--dsw-alias-label-primary)}
.sm-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.sm-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-border-l1));color:var(--dsw-alias-label-primary)}
.sm-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sm-count{flex:none;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.sm-banner{margin:0;padding:8px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.sm-banner.warn{color:var(--dsw-alias-state-warn-primary)}
/* 白色输入卡：底色是 --sm-card-plain，输入框必须用主题层色而不是半透明白，
   否则在纯白卡上会看不见（深色主题也要跟着走）。 */
.sm-composer{display:flex;flex-direction:column;gap:12px;padding:18px 20px 16px;border-radius:16px;background:var(--sm-card-plain);color:var(--sm-ink);border:.5px solid var(--dsw-alias-border-l1);box-shadow:0 1px 2px rgba(0,0,0,.03)}
.sm-composer-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.sm-composer-name{flex:1;min-width:200px;height:32px;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:15.5px;line-height:24px;font-weight:500;outline:none}
.sm-composer-name::placeholder{color:currentColor;opacity:.42}
.sm-composer-foot{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.sm-hint{color:inherit;font-size:11.5px;line-height:16px;opacity:.55}
.sm-submit{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 14px;border:0;border-radius:999px;background:var(--sm-accent-fill);color:var(--sm-accent-ink);font:inherit;font-size:12.5px;line-height:18px;font-weight:500;white-space:nowrap;cursor:pointer;transition:opacity .12s ease,transform .12s ease}
.sm-submit:hover:not(:disabled){opacity:.9}
.sm-submit:active:not(:disabled){transform:translateY(.5px)}
.sm-submit:disabled{opacity:.4;cursor:not-allowed}
.sm-submit:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.sm-link{padding:0 0 0 6px;border:0;background:none;color:inherit;font:inherit;font-size:12px;line-height:18px;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
/* 分段控件：外层整宽行属于内容列（由上面的规则给 width:100%），
   胶囊是行内的 flex 子项，宽度自然收缩到内容宽度，左缘与标题对齐。
   不要给胶囊本身写 width:100%，也不要用 margin-inline:0 去「修正」位置。 */
.sm-segments-row{display:flex;align-items:center;justify-content:flex-start;min-width:0}
.sm-segments{display:inline-flex;align-items:center;gap:3px;padding:3px;border-radius:999px;background:rgba(0,0,0,.06);max-width:100%;min-width:0;align-self:flex-start}
.sm-segment{height:24px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;line-height:16px;opacity:.62;white-space:nowrap;cursor:pointer;transition:background .12s ease,opacity .12s ease}
.sm-segment:hover{opacity:.9}
.sm-segment[data-selected=true]{background:rgba(255,255,255,.78);opacity:1;box-shadow:0 1px 2px rgba(0,0,0,.07)}
.sm-segment:disabled{opacity:.35;cursor:not-allowed}
.sm-segment:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
/* stretch 而不是 start：同一行的卡片按最高那张对齐，整面墙才是齐的。
   以前写 start，每张卡只按自己的内容撑高，描述两行和三行的卡高低不一。 */
.sm-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:stretch}
.sm-card{position:relative;display:flex;flex-direction:column;gap:9px;height:100%;min-height:132px;padding:16px 16px 11px;border-radius:13px;background:var(--sm-card-cream);color:var(--sm-ink);cursor:pointer;transition:transform .12s ease,box-shadow .12s ease}
.sm-card[data-color=butter]{background:var(--sm-card-butter);color:var(--sm-ink-butter)}
.sm-card[data-color=rose]{background:var(--sm-card-rose);color:var(--sm-ink)}
.sm-card[data-color=sky]{background:var(--sm-card-sky);color:var(--sm-ink)}
.sm-card[data-color=mint]{background:var(--sm-card-mint);color:var(--sm-ink)}
.sm-card[data-color=lilac]{background:var(--sm-card-lilac);color:var(--sm-ink)}
.sm-card[data-color=cream]{background:var(--sm-card-cream);color:var(--sm-ink)}
.sm-card:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(0,0,0,.06)}
.sm-card:focus-visible{outline:2px solid currentColor;outline-offset:1px}
/* 停用的技能只是「不交给模型」，不是坏掉：压低不透明度即可，别做成错误色。 */
.sm-card[data-disabled=true]{opacity:.66}
/* 占位卡跟随行高，补满整格；它没有内容，但仍要撑到和真卡一样高。 */
.sm-card.ghost{cursor:default;opacity:.55;height:100%}
.sm-card.ghost:hover{transform:none;box-shadow:none}
.sm-card-head{display:flex;align-items:center;gap:7px;min-width:0}
.sm-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary)}
.sm-card[data-disabled=true] .sm-dot{background:var(--dsw-alias-state-idle-primary)}
.sm-card-title{flex:1;min-width:0;margin:0;font-size:15.5px;font-weight:500;line-height:24px;letter-spacing:.1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-card-source{flex:none;font-size:11px;line-height:16px;opacity:.62}
/* 描述区固定占位：不随行数伸缩，卡片高度才由网格统一决定。
   截断到 4 行，短描述下方留白，而不是把卡片压矮。 */
.sm-card-desc{flex:1;margin:0;font-size:13px;line-height:20px;opacity:.86;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
/* 底部固定 22px：操作区里有的卡是文字按钮、有的是图标，行高不一致会把卡片撑歪。 */
.sm-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;height:22px;margin-top:auto;flex:none}
.sm-card-state{font-size:11px;line-height:16px;opacity:.55;font-variant-numeric:tabular-nums}
.sm-card-actions{display:flex;align-items:center;gap:2px;opacity:.62;transition:opacity .12s ease}
.sm-card:hover .sm-card-actions,.sm-card:focus-within .sm-card-actions{opacity:1}
.sm-card-action{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 4px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:11px;line-height:16px;opacity:.75;cursor:pointer}
.sm-card-action:hover:not(:disabled){background:rgba(0,0,0,.07);opacity:1}
.sm-card-action.danger:hover:not(:disabled){background:rgba(190,60,60,.14);color:#9c3535}
.sm-card-action:disabled{opacity:.35;cursor:not-allowed}
.sm-card-action:focus-visible{outline:2px solid currentColor;outline-offset:1px;opacity:1}
.sm-confirm{display:flex;align-items:center;gap:4px}
.sm-confirm-text{font-size:11px;line-height:16px;opacity:.8}
.sm-status{display:flex;align-items:center;gap:8px;margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.sm-status.bad{color:var(--dsw-alias-state-error-primary)}
.sm-spinner{width:14px;height:14px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:sm-spin .8s linear infinite;flex:none}
@keyframes sm-spin{to{transform:rotate(360deg)}}
.sm-scrim{position:fixed;top:var(--dsh-frame-top-clearance,0px);right:0;bottom:0;left:0;width:auto;max-width:none;margin:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(20,18,14,.32);backdrop-filter:blur(2px);animation:sm-fade .14s ease-out}
.sm-dialog{display:flex;flex-direction:column;width:min(560px,100%);max-height:min(78vh,640px);border-radius:16px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);box-shadow:0 18px 48px rgba(0,0,0,.24);animation:sm-pop .18s cubic-bezier(.2,.9,.3,1);outline:none}
.sm-dialog-wide{width:min(680px,100%);max-height:min(84vh,720px)}
.sm-dialog-head{display:flex;align-items:flex-start;gap:10px;padding:16px 16px 12px 18px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.sm-dialog-dot{width:8px;height:8px;margin-top:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary)}
.sm-dialog-dot[data-tone=off]{background:var(--dsw-alias-state-idle-primary)}
.sm-dialog-heading{flex:1;min-width:0}
.sm-dialog-title{margin:0;font-size:14.5px;font-weight:500;line-height:21px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-dialog-sub{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-dialog-close{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}
.sm-dialog-close:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-border-l1));color:var(--dsw-alias-label-primary)}
.sm-dialog-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sm-dialog-body{display:flex;flex-direction:column;gap:12px;padding:14px 18px;overflow:auto;min-height:0}
.sm-dialog-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 16px 13px 18px;border-top:.5px solid var(--dsw-alias-border-l1);flex-wrap:wrap}
.sm-dialog-stamp{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-dialog-actions{display:flex;align-items:center;gap:8px;margin-left:auto}
.sm-dialog-btn{height:28px;padding:0 13px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:background .12s ease,opacity .12s ease}
.sm-dialog-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-border-l1))}
.sm-dialog-btn:disabled{opacity:.45;cursor:not-allowed}
.sm-dialog-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.sm-dialog-btn.primary{border-color:transparent;background:var(--sm-accent-fill);color:var(--sm-accent-ink);font-weight:500}
.sm-dialog-btn.primary:hover:not(:disabled){opacity:.9;background:var(--sm-accent-fill)}
@keyframes sm-fade{from{opacity:0}to{opacity:1}}
@keyframes sm-pop{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
.sm-meta{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0;font-size:12px;line-height:18px}
.sm-meta dt{color:var(--dsw-alias-label-secondary)}
.sm-meta dd{margin:0;min-width:0;overflow-wrap:anywhere}
.sm-meta-path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:17px}
.sm-detail-block{display:flex;flex-direction:column;gap:6px;min-width:0}
.sm-detail-label{margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-weight:400}
.sm-detail-body{margin:0;padding:12px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:46vh;overflow:auto}
.sm-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.sm-field-label{font-size:11.5px;line-height:16px;opacity:.72}
/* 输入框用主题层色：白色卡上的半透明白会直接消失。 */
.sm-input{width:100%;padding:7px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:19px;outline:none}
.sm-input:focus-visible{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}
.sm-textarea{resize:vertical;font-family:inherit}
.sm-textarea-body{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:18px}
.sm-toast{position:sticky;bottom:16px;z-index:5;display:flex;align-items:center;gap:12px;align-self:center;width:fit-content;max-width:100%;margin:0 auto;padding:8px 10px 8px 14px;border-radius:999px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);box-shadow:0 8px 24px rgba(0,0,0,.14);font-size:12.5px;line-height:18px;animation:sm-rise .16s ease-out}
.sm-page>.sm-toast{width:fit-content;max-width:min(100%,720px)}
/* 导入拖放区：虚线框 + 悬停时的高亮，是「可以往里放东西」的唯一提示。 */
.sm-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:22px 16px;border:1.5px dashed var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);transition:border-color .12s ease,background .12s ease}
.sm-drop:hover,.sm-drop.is-over{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.sm-drop:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.sm-drop-icon{display:inline-flex;opacity:.6}
.sm-drop-text{font-size:13px;line-height:20px}
.sm-drop-hint{font-size:11.5px;line-height:16px;opacity:.62;text-align:center}
/* 文件 / 文件夹两个选择按钮：拖放区本身不再是可点元素，避免嵌套交互。 */
.sm-drop-actions{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:5px}
.sm-drop-btn{height:26px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;line-height:16px;cursor:pointer}
.sm-drop-btn:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-border-l1))}
.sm-drop-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
/* 原生 file input 隐藏起来，由上面的按钮代它接受点击。 */
.sm-file-input{display:none}
.sm-import-queue{display:flex;flex-direction:column;gap:6px;min-width:0}
.sm-import-queue-head{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.sm-file-list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;max-height:220px;overflow:auto}
.sm-file-row{display:flex;align-items:center;gap:8px;min-width:0;padding:5px 8px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);font-size:11.5px;line-height:16px}
.sm-file-icon{display:inline-flex;flex:none;opacity:.55}
.sm-file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.sm-file-status{flex:none;font-size:10.5px;line-height:15px;opacity:.72;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-file-row[data-state=new] .sm-file-status{color:var(--dsw-alias-state-success-primary)}
.sm-file-row[data-state=updated] .sm-file-status{color:var(--dsw-alias-state-warn-primary)}
.sm-file-row[data-state=failed] .sm-file-status{color:var(--dsw-alias-state-error-primary)}
.sm-toast-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-toast-action{flex:none;padding:2px 10px;border:0;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-border-l1));color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px;cursor:pointer}
.sm-toast-action:hover{background:var(--dsw-alias-border-l1)}
@keyframes sm-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
/* 卡片「贴」上墙：阻尼弹簧的密集采样 + linear。
   animation-timing-function 是逐段生效的，一条 ease 曲线配多个关键帧会让
   速度在每个关键帧归零再重启 —— 那正是「一格一格跳」的来源。这里把曲线
   烘焙进采样点，速度天然连续；弹簧参数取 d(1)=0（cos 2.5π = 0），落点静止。 */
@keyframes sm-card-land{
  0%{opacity:0;transform:translateY(-22px) scale(.9) rotate(-1.8deg);box-shadow:0 12px 26px rgba(0,0,0,.12)}
  5%{opacity:.097;transform:translateY(-15.67px) scale(.9288) rotate(-1.28deg);box-shadow:0 8.5px 18.5px rgba(0,0,0,.085)}
  10%{opacity:.33;transform:translateY(-9.25px) scale(.958) rotate(-.76deg);box-shadow:0 5px 10.9px rgba(0,0,0,.05)}
  15%{opacity:.614;transform:translateY(-3.86px) scale(.9825) rotate(-.32deg);box-shadow:0 2.1px 4.6px rgba(0,0,0,.021)}
  20%{opacity:.865;transform:translateY(0) scale(1) rotate(0deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  25%{opacity:.996;transform:translateY(2.29px) scale(1.0104) rotate(.19deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  30%{opacity:1;transform:translateY(3.27px) scale(1.0149) rotate(.27deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  35%{opacity:1;transform:translateY(3.29px) scale(1.015) rotate(.27deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  40%{opacity:1;transform:translateY(2.75px) scale(1.0125) rotate(.22deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  45%{opacity:1;transform:translateY(1.96px) scale(1.0089) rotate(.16deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  50%{opacity:1;transform:translateY(1.16px) scale(1.0053) rotate(.09deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  55%{opacity:1;transform:translateY(.48px) scale(1.0022) rotate(.04deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  60%{opacity:1;transform:translateY(0) scale(1) rotate(0deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  65%{opacity:1;transform:translateY(-.29px) scale(.9987) rotate(-.02deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  70%{opacity:1;transform:translateY(-.41px) scale(.9981) rotate(-.03deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  75%{opacity:1;transform:translateY(-.41px) scale(.9981) rotate(-.03deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  80%{opacity:1;transform:translateY(-.34px) scale(.9984) rotate(-.03deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  85%{opacity:1;transform:translateY(-.24px) scale(.9989) rotate(-.02deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  90%{opacity:1;transform:translateY(-.14px) scale(.9993) rotate(-.01deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  95%{opacity:1;transform:translateY(-.06px) scale(.9997) rotate(0deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  100%{opacity:1;transform:translateY(0) scale(1) rotate(0deg);box-shadow:0 0 0 rgba(0,0,0,0)}
}
@keyframes sm-card-sheen{
  0%{opacity:0;transform:translateX(-58%)}
  22%{opacity:.72}
  100%{opacity:0;transform:translateX(66%)}
}
/* backwards 而不是 both：动画一结束就交还普通样式，hover 抬升立刻恢复。 */
.sm-card-enter{animation:sm-card-land 1.1s linear backwards;overflow:hidden}
.sm-card-enter::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(112deg,transparent 34%,rgba(255,255,255,.62) 48%,transparent 62%);animation:sm-card-sheen 1s linear .24s both}
@media (prefers-reduced-motion:reduce){
  .sm-spinner,.sm-toast{animation:none}
  .sm-card,.sm-segment,.sm-submit,.sm-card-actions,.sm-dialog-btn{transition:none}
  .sm-card-enter{animation:none}
  .sm-card-enter::after{display:none}
}
@media (min-width:1120px){
  .sm-page>*:not(.sm-scrim):not(.sm-toast){max-width:1120px}
  .sm-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
}
@media (max-width:640px){
  .sm-page{padding:0 16px 32px}
  .sm-head{padding-top:20px}
  .sm-search{width:100%}
  .sm-toolbar{width:100%}
  .sm-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
}
`

    /**
     * 卡片配色。
     *
     * 卡片底色是「作品」而非界面：马卡龙色必须原样保留，因此用插件自己的
     * 变量，并按主题给出深色版；界面骨架仍只用 --dsw-alias-* token。
     */
    const COLOR_CSS = `
.sm-page{--sm-ink:#3b3a36;--sm-ink-butter:#5b4c1f;--sm-card-butter:#fbe8a6;--sm-card-rose:#fcf0f7;--sm-card-sky:#f5f9fc;--sm-card-mint:#f6fbf9;--sm-card-lilac:#f7f6fd;--sm-card-cream:#fcfaf6;--sm-card-plain:#ffffff;--sm-accent-fill:#1c1c1c;--sm-accent-ink:#ffffff}
/* 深色主题下主按钮保持黑色：黑底白字在深色卡片上依然最清晰。 */
.sm-page[data-scheme=dark]{--sm-ink:#e9e7e1;--sm-ink-butter:#f4e6b4;--sm-card-butter:#4a3f1c;--sm-card-rose:#3a2b32;--sm-card-sky:#25313a;--sm-card-mint:#24322d;--sm-card-lilac:#2c2939;--sm-card-cream:#302d26;--sm-card-plain:#232323;--sm-accent-fill:#000000;--sm-accent-ink:#ffffff}
.sm-page[data-scheme=dark] .sm-segments{background:rgba(255,255,255,.09)}
.sm-page[data-scheme=dark] .sm-segment[data-selected=true]{background:rgba(255,255,255,.18)}
.sm-page[data-scheme=dark] .sm-card-action:hover:not(:disabled){background:rgba(255,255,255,.1)}
.sm-page[data-scheme=dark] .sm-card-action.danger:hover:not(:disabled){background:rgba(220,90,90,.2);color:#ff9d9d}
.sm-page[data-scheme=dark] .sm-scrim{background:rgba(0,0,0,.55)}
`

    // -----------------------------------------------------------------------
    // Plugin export
    // -----------------------------------------------------------------------

    function installStyles(ctx) {
      if (typeof document === 'undefined') return
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshSkillManager = 'styles'
        style.textContent = CSS + COLOR_CSS
        document.head.append(style)
        return () => style.remove()
      })
    }

    return {
      name: NS,
      inject: ['slots'],
      apply(ctx) {
        const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
        if (locale && typeof locale.register === 'function') {
          try {
            ctx.effect(() => locale.register(NS, {
              zh: DICT.zh,
              'zh-CN': DICT.zh,
              en: DICT.en,
            }))
          } catch {
            /* 热重载时同名命名空间已存在，不能让整页空白 */
          }
        }

        const theme = typeof ctx.get === 'function' ? ctx.get('theme') : undefined
        // 主题订阅只挂一次：`theme/change` 是 emit 事件，页面组件只是订阅者。
        const schemeListeners = new Set()
        if (theme && typeof ctx.on === 'function') {
          ctx.effect(() => ctx.on('theme/change', () => {
            for (const listener of [...schemeListeners]) {
              try {
                listener()
              } catch {
                /* one broken subscriber must not stop the others */
              }
            }
          }))
        }
        const subscribeTheme = (listener) => {
          schemeListeners.add(listener)
          return () => {
            schemeListeners.delete(listener)
          }
        }

        const t = makeTranslator(locale)
        const { PanelIcon, SkillPage } = makeUi(t, locale, theme, subscribeTheme)
        installStyles(ctx)

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 50,
          label: () => t('panelTitle'),
        }, PanelIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, SkillPage))
      },
    }
  },
})
