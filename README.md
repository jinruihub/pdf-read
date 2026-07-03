# PDF Read

Chrome 扩展 — PDF 阅读与标注工具，功能 的 PDF 编辑器。

## 功能

- 打开本地 PDF（文件选择 / 拖拽）
- 右键 PDF 链接 →「用 PDF Read 打开」
- 工具：拖拽/选文字、自由画、直线、波浪线、双横线、文字、矩形、圆形、选择、撤销
- 缩放（按钮 / Ctrl+滚轮 / 双指捏合）、适应宽度、页码跳转
- 滚动 / 翻页两种预览模式
- 浅色 / 深色文档主题
- 标注颜色与粗细调节
- 保存（合并标注到 PDF）与导出

## 安装开发

```bash
npm install
npm run icons   # 生成扩展图标
npm run build   # 构建到 dist/
```

## 加载扩展

1. 打开 Chrome → `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择项目的 `dist` 目录

## 使用

- 点击工具栏上的 PDF Read 图标打开阅读器
- 在 PDF 链接上右键选择「用 PDF Read 打开」
- 将 PDF 文件拖入阅读区域

## 技术栈

- [pdf.js](https://mozilla.github.io/pdf.js/) — PDF 渲染
- [Fabric.js](https://fabricjs.com/) — 画布标注
- [pdf-lib](https://pdf-lib.js.org/) — PDF 导出合并
- Vite — 构建打包
