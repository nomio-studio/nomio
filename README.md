# nomio

Vite + TypeScript + Three.js 模板，内置完整的 Git 与代码质量基建。

## 技术栈

- **Runtime**: Three.js `0.186.0`
- **Build**: Vite `8.3.0`
- **Language**: TypeScript `7.0.2` (strict)
- **Lint**: ESLint `10.10.0` + typescript-eslint `8.70.0` (flat config) + eslint-config-prettier
- **Format**: Prettier `3.9.6`
- **Git Hooks**: Husky `9.1.7` + lint-staged `17.5.1` + Commitlint `21.2.2` (Conventional Commits)

> **注意**: TypeScript 7.0 为最新主版本，`typescript-eslint` 8.x 官方 peer 仍限制 `<6.1`，本项目通过 `--legacy-peer-deps` 安装并在 ESLint 中关闭 `projectService` 类型检查，类型检查由 `tsc -b` 负责。如 `typescript-eslint` 后续发布支持 TS7，可直接升级去掉 legacy 标记。

## 快速开始

```bash
npm install
npm run dev      # 启动开发服务器 http://localhost:5173
npm run build    # 类型检查 + 生产构建
npm run preview  # 预览构建产物
```

## 脚本

| 脚本                      | 说明                   |
| ------------------------- | ---------------------- |
| `dev`                     | Vite dev server        |
| `build`                   | `tsc -b && vite build` |
| `preview`                 | 预览 dist              |
| `typecheck`               | `tsc -b --noEmit`      |
| `lint` / `lint:fix`       | ESLint 检查 / 自动修复 |
| `format` / `format:check` | Prettier 格式化 / 检查 |

## 代码质量

- **ESLint**: `eslint.config.js` (flat config) — `eslint .`
- **Prettier**: `.prettierrc.json` + `.prettierignore`
- **EditorConfig**: `.editorconfig` 统一缩进/换行
- **Husky**: `prepare` 钩子自动安装
  - `pre-commit`: `npx lint-staged` 自动对暂存区 `*.{ts,js,css,json,md,html}` 执行 `eslint --fix` + `prettier --write`
  - `commit-msg`: `commitlint --edit $1` 强制 Conventional Commits (`feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert`)
- **lint-staged**: 配置在 `package.json#lint-staged`
- **Commitlint**: `commitlint.config.js`

```bash
# 手动验证
npm run lint
npm run format:check
npx commitlint --from HEAD~1 --to HEAD --verbose
```

## 项目结构

```
nomio/
├── src/
│   ├── main.ts       # Three.js 旋转立方体示例
│   ├── style.css
│   └── vite-env.d.ts
├── public/           # 静态资源 (按需创建)
├── index.html
├── vite.config.ts    # alias @ -> src
├── tsconfig.json / tsconfig.node.json
├── eslint.config.js
├── .prettierrc.json
├── .editorconfig
├── commitlint.config.js
├── .husky/
│   ├── pre-commit
│   └── commit-msg
└── .vscode/
```

## Git

主分支 `main`，已初始化本地仓库：

```bash
git status
git log --oneline
git commit -m "feat: initial scaffold"
```

如需关联远程：

```bash
git remote add origin <url>
git push -u origin main
```
