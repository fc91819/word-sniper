# 单词狙击手 · 当前交接

## 运行
- Mac 上双击 index.html 可本地游玩；本地文件模式不注册 service worker。
- PWA 安装与离线运行需要通过 HTTPS 访问；首次联网打开后添加到 iPad 主屏幕。
- 可在地址后加 ?today=2026-11-05 模拟训练日期。

## 文件职责
- index.html：首页、训练页、结算页和备份/恢复界面。
- style.css：战术视觉、响应式布局、安全区和减少动态效果适配。
- game.js：训练流程、发音、军衔、service worker 注册与备份交互。
- backup.js：备份码编码、版本检查、校验位和恢复数据验证。
- srs.js：复习调度、日期模拟、打卡和 localStorage 进度。
- words.js：200 个分话题词条，挂载到全局变量 WORDS。
- manifest.webmanifest、service-worker.js、icons/：PWA 安装信息、离线资源缓存和应用图标。
- tools/draw-icons.py：用 Python 标准库绘制应用图标。
- tools/check-words.mjs：自动校验词库字段、干扰词和例句。
- README.md：运行、数据说明和待执行的 GitHub Pages 发布步骤。
- DECISIONS.md：追加式决策台账。

## 进度
- 第一阶段及 D-003 修复已通过总监验收；词库自动校验为 0 问题。
- D-005 的 PWA、离线缓存和进度备份码已准备，GitHub Pages 尚未发布，等待家长账号并由总监继续安排。
- 2026-10-26 总监浏览器实测通过：service worker 激活并缓存 11 个文件，断开服务后页面仍能打开；备份→清空→恢复，数据完全一致。待发布后在 iPad 上实机验收：添加到主屏幕、离线启动、系统键盘遮挡、状态栏留白。
- ill 的中文释义已改为“生病的”。
