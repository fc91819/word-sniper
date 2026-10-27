# 单词狙击手 · 当前交接

## 运行
- 双击 `index.html` 可本地游玩；Service Worker 和离线安装需通过 HTTPS 访问。
- 已部署地址：https://fc91819.github.io/word-sniper/ 。修改后推送 `main`，等待 Pages 更新。
- 可用 `?today=2026-11-05` 模拟训练日期。

## 文件职责
- `index.html`：首页、训练、结算、备份与恢复页面结构。
- `style.css`：视觉样式、响应式布局、安全区和无障碍动效适配。
- `game.js`：训练流程、题目切换、结算、进度交互及 Service Worker 注册。
- `service-worker.js`：版本隔离缓存、离线导航和新版自动接管。
- `audio.js`：本机语音选择、统一发音播放、有道回退和播放卡死恢复。
- `srs.js`：复习调度、模拟日期、连续打卡和 localStorage 进度。
- `words.js`：200 个分话题词库，挂载到全局变量 `WORDS`。
- `backup.js`：进度备份码、校验和恢复数据验证。
- `version.js`：应用和 Service Worker 共用的版本常量。
- `error-capture.js`：首页版本显示和全局错误提示。
- `manifest.webmanifest`、`icons/`：PWA 安装信息和图标。
- `tools/check-words.mjs`、`tools/check-voice-pick.mjs`、`tools/check-audio-player.mjs`、`tools/check-next-question.mjs`、`tools/check-sw.mjs`：词库、选声、播放器、切题和 Service Worker 模拟检查。
- `README.md`：玩法、运行、数据和 Pages 发布说明。
- `DECISIONS.md`：追加式决策台账；D-008 由总监提供。

## 进度
- D-008：只选择本机英文语音，排除 Google/Online 语音；异常时页面显示错误信息；播放器卡死检测和切题异常保护已实现并上线。
- D-009：Service Worker 只查当前版本缓存；导航固定用当前缓存首页；新版自动接管，训练或结算中延迟到回首页再刷新。实现和模拟检查已完成并推送；Pages 返回 HTTP 200，线上 `version.js` 为 v6。iPad 实机验收由家长和总监完成。
