# 4.4.0 定制改造评审

分析日期：2026-09-26 · 基线：upstream 4.4.0（commit 03d194b）· 分支：`custom/english`

本文档只记录经源码核实的问题。子代理提出的两条论断经复核后推翻，见文末「已排除」。

---

## 一、功能全景

插件是「阅读 → 提问 → 存笔记 → 回原文」的闭环，六个子系统：

| 子系统 | 核心文件 | 职责 |
|---|---|---|
| 阅读引擎 | `reader-engine.js` | EPUB/MOBI/AZW3/FB2/CBZ，基于 foliate-js，CFI 定位 |
| PDF 渲染 | `pdf-page-mode.js`、`pdf-zoom.js` | 保留原页三层架构（图/文字层/操作层），独立缩放 |
| 批注笔记 | `reading-note.js`、`highlight-navigation.js` | 划线落 JSON，汇总进 Markdown 阅读笔记 |
| 书库 | `main.js` LibraryModal、`book-cover.js` | 书籍发现、封面缓存、Calibre 导入 |
| AI 伴读 | `ai-*.js`（11 个模块） | 17 个服务商，SSE 流式 + CLI/ACP + 外部 Agent |
| 设置与外壳 | `main.js`、`i18n-*.js`、`locales/` | 6 个标签页，9 种界面语言，1351 个翻译键 |

**值得肯定的设计**（改造时不要破坏）：

- **单一传输漏斗**：`aiExplain()` 一个入口，HTTP / CLI / 外部 Agent 三种后端可换
- **结构化上下文**：附带的原文是结构化对象，只在 `aiContextMessage()` 一处转为模型文本，并明确标注「不是指令」
- **引文核验**：`verifiedQuotes()` 只保留在真实来源中逐字出现的引文，杜撰的引文不提供跳转
- **标题本地提取**：保存回答不额外请求模型
- **CLI 加固**：拒绝自身工具权限、隔离 HOME、强制只读/plan 模式

---

## 二、必修问题（数据安全）

### 2.1 划线写入无校验 —— 最高优先级

进度与划线的写入保护**不对称**：

| 存储 | 写入方式 | 读回校验 | 损坏保护 |
|---|---|---|---|
| `reading-progress.json` | `writeVerifiedJsonRecord`（`storage.js:35`） | 有 | 写前快照 + 隔离坏文件 |
| `reading-highlights.json` | 裸 `adapter.write`（`main.js:2699`） | **无** | 仅读失败时上锁 |

`writeVerifiedJsonRecord` 写入后会把文件读回来做逐字节比对，不一致就抛错。划线走的是普通写入，且 `_writeHighlightStore` 用裸 `catch` 返回 `false`（`main.js:2768`），失败被吞掉。同步客户端若在读写之间截断文件，该书全部划线丢失。

**改法**：把 `main.js:2699` 换成 `writeVerifiedJsonRecord`，约两行。改动小、收益大，且让 `_blockedStores` 从「只读上锁」变成真正双向。

### 2.2 删除的划线会复活

`_mergeLocalHighlights`（`main.js:2789`）按 id 求并集，**只增不减**，没有删除墓碑。设备 A 删除划线后，设备 B 内存里仍有旧行，合并时又加回去。

**改法**：给记录加 `deleted` 墓碑字段和 schema 版本号，合并时尊重墓碑；顺带让 `_readHighlightStore` 能拒绝未来格式，而不是把 `{}` 当合法数据。

### 2.3 笔记被整段重建

`replaceManagedReadingHighlights`（`reading-note.js:31`）靠本地化标题（「划线与批注」/「Quotes」/「Цитаты」）定位并整段替换。用户改了标题、或用第四种语言写，就会**追加一个重复章节**。已有 `untrackedExcerptBlocks` 做启发式保护，但手写引文若恰好与受管格式同构就会丢失。

---

## 三、必修问题（用户可见）

### 3.1 更新日志语言错乱

`WHATS_NEW`（`main.js:9272`）的约 90 条文案在**模块加载时**就调用 `qiaomuReaderTranslate` 求值，而界面语言要到 `loadAll()` 才从设置读出。非中文用户升级时看到的更新日志永远是中文（或英文回退），且不会重绘。

同文件里的 `ONBOARD_SLIDES`（`main.js:9255`）是正确写法——存 key，渲染时翻译。照它改即可。

### 3.2 e-ink 模式被静默关闭

```js
function setReaderTheme(settings, id) {
  settings.einkMode = false;   // main.js:203
  settings.theme = migrateReaderTheme(id);
}
```

选任何主题都会关掉电子墨水模式，而 `READER_THEME_CHOICES`（`reader-themes.js:67`）又不把 `eink` 列进选择器。结果是：进了电子墨水模式后，从主题行**没有任何途径回去**，也没有任何提示。

### 3.3 移动端 AI 对话不落盘

`_persistSession`（`main.js:6450`）只定义在 `AiChatView` 上。`AiExplainModal`（移动端，`main.js:5819`）靠 `typeof this._persistSession === "function"` 可选调用，所以移动端对话**关闭即丢失**——而草稿反而是保存的，行为不一致。

### 3.4 `aiQuickPrompts` 是死设置

`settings.aiQuickPrompts` 默认为 `null`（`main.js:165`），**从未被读取**；`aiQuickPrompts()`（`main.js:3445`）总是返回内置的六条。更麻烦的是有个测试（`tests/core-config.test.mjs:733`）把这个死行为固化了。

二选一：接上设置编辑器，或删掉设置和测试。

### 3.5 中文书名排序错误

书库排序硬编码俄语 collator（`main.js:10872/10877/10888/10936/11109`）：

```
按 ru 排序: Alice | Jekyll | Meditations | 世说新语 | 唐诗三百首 | 道德经
按 zh 排序: 道德经 | 世说新语 | 唐诗三百首 | Alice | Jekyll | Meditations
```

`qiaomuReaderLocale()`（`main.js:80`）已经存在，换成 `Intl.Collator(qiaomuReaderLocale(), {numeric:true})` 即可。

---

## 四、性能

### 4.1 体积预算濒临上限

| 文件 | 当前 | 预算 | 余量 |
|---|---|---|---|
| `main.js` | 5,227,082 | 5,300,000 | **72,918（1.4%）** |
| `styles.css` | 3,664,484 | 5,300,000 | 1,635,516 |

`src/pdf-cmaps-data.js` 单独占 374 KB，是主包的 **7.2%**，且被静态 import（`main.js:36`）。它是给中日韩 PDF 用的 CMap，绝大多数用户永远用不到。改成按需加载是最大的单点减重。

另外 `decodeBase64`（`pdf-cmaps.js:3`）每次请求都重新解码且无缓存，加个一元的 `Map` 缓存即可。

**注意**：任何新增功能前先确认预算余量，否则 `npm run build` 会在 5.3 MB 处直接失败。

### 4.2 书库网格无防抖、无虚拟化

`redraw()` 每次按键都重新过滤 + 全量渲染（`main.js:11000-11011`），每张卡约 10 个 DOM 节点 + 4 个监听器 + 封面调色板计算。千本书的仓库，每输入一个字符就是一千次 `renderCard`。

逐项还有：`getFiles()` 反复全库扫描（搜索、命令注册、目标目录、下载查重各来一遍）；`getProgress`/`getHighlights`/笔记解析每卡每次读取；封面生成串行排队（第 200 本封面要等前面 199 次整书解析）。

**改法**：加 ~120ms 防抖 + 结果上限；用 IntersectionObserver 惰性建卡；把书单缓存起来靠已有的 vault 事件刷新；封面生成放开到 2-3 并发。

### 4.3 封面缓存无上限

`thumb-cache.json` 每次防抖刷新都整体序列化（`main.js:2192`）。500 本书按每封面 30 KB 算就是 15 MB JSON 反复重写。且 `dropBookState`（`main.js:8820`）清理进度/划线/封面适配时**不含 `thumbCache`**——删书后封面缓存永久残留。

### 4.4 PDF 全页串行提取

`extractPdf`（`main.js:6808`）逐页串行 `getPage` + `getTextContent`。600 页 PDF 要等 600 次串行往返才出第一页。`main.js:6670` 已有 abort 检查，开 4-8 并发是安全的。

---

## 五、架构债

### 5.1 ReaderView / ReaderModal 成对重复

`_mountEngine`、`_engineAppearanceCss`、`_engineTocItems`、`_engineSelectionCheck` 在两个类里近乎逐字重复：

- `ReaderView`：`main.js:10032` / `10131` / `10075` / `10091`
- `ReaderModal`：`main.js:12098` / `12148` / `12136` / `12153`

每个引擎修复都要改两遍。抽一个共享 controller 能消掉一整类未来 bug。

### 5.2 设置搜索找不到任何单项

`getSettingDefinitions()`（`main.js:12716`）只返回**一个**占位定义，整个设置界面是命令式手绘 DOM。后果是 Obsidian 设置搜索只能匹配到容器标题，用户搜「行距」「字体」「同步」都找不到。全文件有 66 处 `new Setting(`。

同时 `_tabData` 把「阅读数据文件夹」——决定进度写到哪的关键设置——藏在「选项」折叠里。

### 5.3 ACP 会话从不关闭

`CliAcpManager` 的 `sessions`/`streams` 只增不减，`forgetSession`（`ai-cli.js:936`）只删本地条目。长时间阅读会按 `newAiSessionKey()` 累积服务端会话。应在 dispose 时发 `session/close`。

### 5.4 死代码

`ACP_AUTO_INSTALL_ENABLED = false`（`ai-acp-manual.js:3`）让 `installCliAcp` 整条 npm 安装路径（约 120 行：`acpNpmInstallArgs`、`managedAcpEntrypoint`、`pluginAcpInstallRoot`）不可达，但设置界面仍会渲染安装命令和版本号。

---

## 六、已排除（经复核不成立）

- **`saveAll` 未等待存储**：实际 `main.js:2155-2157` 两行都 `await` 了，无问题。
- **滚轮缩放缺修饰键门禁**：实际 `main.js:4199` 有 `!event.ctrlKey && !event.metaKey` 提前 return，无问题。
- **`aiChatHistory` 体积**：确实存在 `data.json` 里（`main.js:168`），会随 Obsidian Sync 同步。但这在蓝图内算设计选择而非缺陷，仅建议评估移出。

---

## 七、建议的改造顺序

按「风险 × 收益 ÷ 成本」排序：

**第一批（改动小、防数据丢失）**
1. 划线写入改走 `writeVerifiedJsonRecord`（2.1）
2. 划线记录加墓碑 + schema 版本（2.2）
3. 修 `WHATS_NEW` 翻译时机（3.1）
4. e-ink 模式加回入口或提示（3.2）

**第二批（用户可感知）**
5. 移动端对话落盘（3.3）
6. 书库排序改用界面语言（3.5）
7. `aiQuickPrompts` 二选一处理（3.4）
8. 封面缓存加清理和上限（4.3）

**第三批（性能与结构）**
9. cmaps 按需加载，换回 374 KB 预算（4.1）
10. 书库网格防抖 + 虚拟化（4.2）
11. PDF 提取并发化（4.4）
12. 抽共享 reader controller（5.1）

**可选（长期）**
13. 设置项声明化，恢复搜索能力（5.2）
14. ACP 会话回收（5.3）
15. 清理死代码（5.4）
