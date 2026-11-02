# 🇰🇷 YesHan · 韩语学习与智能复习

**YesHan** 是一款基于 React、TypeScript 和 FSRS 间隔重复算法开发的韩语学习 Web 应用。

通过词汇、语法和对话练习，结合个人学习进度与复习调度，帮助学习者持续巩固韩语知识。

**当前版本：v0.10.1**

[在线体验 YesHan](https://norris-wang.github.io/yes-han/) · [查看版本更新](https://github.com/Norris-Wang/yes-han/releases)

## ✨ 主要功能

### 📚 韩语知识练习

* **词汇练习**：通过选择题巩固词汇记忆。
* **语法练习**：通过填空题检验语法掌握程度。
* **对话练习**：通过排序题理解对话结构。
* **错题本**：集中管理并重新练习答错的知识点。

### 🧠 智能间隔重复

* 集成 FSRS（Free Spaced Repetition Scheduler）复习算法。
* 支持 Again、Hard、Good、Easy 四级记忆评分。
* 根据复习表现安排后续复习时间。
* 兼容已有的固定间隔（Fixed）复习记录。

### 📊 学习进度管理

* 每日新知识学习与到期复习。
* 学习数量、正确率及历史答题记录统计。
* 自动保存学习进度。
* 支持导出学习数据 JSON 备份。

## 🛠️ 技术栈

| 技术                 | 用途               |
| -------------------- | ------------------ |
| React                | 用户界面           |
| TypeScript           | 类型安全与业务逻辑 |
| Vite                 | 开发与生产构建     |
| Dexie.js / IndexedDB | 本地学习数据持久化 |
| ts-fsrs              | 智能复习调度       |
| GitHub Pages         | 静态网站部署       |

## 🚀 本地运行

需要安装 Node.js 和 npm。

克隆仓库：

```bash
git clone https://github.com/Norris-Wang/yes-han.git
cd yes-han
```

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

代码检查：

```bash
npm run lint
```

## 💾 数据存储与备份

YesHan 目前主要将学习记录保存在浏览器本地：

* **IndexedDB**：学习单元、FSRS 卡片状态、答题日志。
* **localStorage**：每日学习统计及相关本地设置。

应用支持将学习数据导出为 JSON 文件，以便用户保存备份。

**注意：**

* 学习记录尚未实现跨设备自动同步。
* 不同浏览器、设备及网站来源的本地学习记录不会自动合并。
* 当前提供数据导出功能，尚未开放正式的数据导入恢复功能。
* 清理浏览器网站数据可能导致本地学习记录丢失，建议定期备份。

## 📦 版本更新

详细更新记录请查看 [GitHub Releases](https://github.com/Norris-Wang/yes-han/releases)。

**v0.10.1 — 稳定性与数据备份更新**

* 新增 JSON 学习数据导出功能。
* 完善答题保存和重复提交保护。
* 优化每日学习统计与异常处理。
* 加强学习进度重置安全性。
* 保持 Fixed 和 FSRS 学习记录兼容。
