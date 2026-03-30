# 测试规范

> 返回 [README](../README.md) · 上一篇 [开发指南](./03-development.md)

## 测试框架

项目使用 **Vitest** 作为测试框架，配置文件为根目录 `vitest.config.ts`。

## 覆盖率目标

| 指标 | 当前配置阈值 |
|------|-------------|
| Statements | **90%** |
| Branches | **90%** |
| Functions | **90%** |
| Lines | **90%** |

> 覆盖率阈值已从 80% 提升至 90%，CI 构建中低于此阈值将失败。

## 覆盖率配置

```typescript
// vitest.config.ts
coverage: {
  provider: "v8",
  reporter: ["text", "json", "html"],
  include: ["packages/*/src/**/*.ts"],
  exclude: [
    "**/*.test.ts",    // 测试文件本身
    "**/*.d.ts",       // 类型声明
    "**/index.ts",     // 纯导出文件
    "**/bin.ts",       // CLI 入口
    "**/cli.ts",       // CLI 注册
    "**/types.ts",     // 类型定义
  ],
}
```

## 测试目录结构

测试文件镜像源码结构，CLI 单元 / 集成测试统一放在 `packages/cli/src/__tests__/` 下：

```
__tests__/
├── collectors/
│   ├── applications.test.ts
│   ├── base.test.ts
│   ├── claude-config.test.ts
│   ├── cloud-cli.test.ts
│   ├── dev-toolchain.test.ts
│   ├── docker.test.ts
│   ├── fonts.test.ts
│   ├── homebrew.test.ts
│   ├── index.test.ts
│   ├── launch-agents.test.ts
│   ├── macos-defaults.test.ts
│   ├── opencode-config.test.ts
│   ├── shell-config.test.ts
│   └── vscode.test.ts
├── commands/
│   ├── config.test.ts
│   ├── scan-rich.e2e.test.ts
│   ├── scan.test.ts
│   └── snapshot.test.ts
├── config/
│   └── manager.test.ts
├── snapshot/
│   └── builder.test.ts
├── storage/
│   └── local.test.ts
├── uploader/
│   └── webhook.test.ts
└── utils/
    ├── icons.test.ts
    └── redact.test.ts
```

## 测试命令

```bash
# 运行全部测试
bun run test

# 监听模式
bun run test:watch

# 生成覆盖率报告
bun run test:coverage

# 运行单个测试文件
npx vitest run packages/cli/src/__tests__/collectors/claude-config.test.ts
```

## 测试编写规范

### 1. 文件系统隔离

所有涉及文件操作的测试必须使用临时目录，不依赖真实用户文件系统：

```typescript
let tempHome: string;

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "otter-test-"));
});

afterEach(async () => {
  await rm(tempHome, { recursive: true, force: true });
});
```

### 2. 命令注入

依赖外部命令的采集器（如 HomebrewCollector）通过可替换的执行函数进行测试：

```typescript
const collector = new HomebrewCollector(tempHome);
collector._execCommand = async (cmd: string) => "package1\npackage2\n";
```

### 3. 必测场景

每个采集器测试必须覆盖以下场景：

| 场景 | 说明 |
|------|------|
| 元数据正确性 | `id`, `label`, `category` 符合预期 |
| 正常采集 | 文件/列表项数量和内容正确 |
| 空数据 | 目标目录不存在时返回空结果 |
| 权限错误 | 目录不可读时优雅降级，记录 `errors` |
| 文件大小 | `sizeBytes` 计算正确 |
| 耗时记录 | `durationMs` 有合理值 |
| 命令降级 | 外部命令不可用时优雅降级或回退 |
| 元数据完整性 | `version` / `meta` / 虚拟路径等增强字段正确 |

## 四层测试执行

| 层 | 命令 | 目标 |
|---|---|---|
| L1 | `bun run test` | Collector、CLI、Web 单元测试与轻量集成测试 |
| L2 | `bun run lint` | core / cli / web 全量类型检查 |
| L3 | `bun run test:e2e` | Web API E2E，验证 webhook → D1/R2 → snapshots API |
| L4 | `bun run test:e2e:ui` | Playwright BDD，验证 dashboard 主干流程与 rich metadata 展示 |

### L3 / L4 约定

- L3 使用独立 dev server，端口默认 `17019`
- L4 使用独立 dev server，端口默认 `27019`
- 两层都通过 `E2E_SKIP_AUTH=true` 绕过真实登录
- L4 新增 rich snapshot fixture，验证 collector `meta` 在 dashboard 中可视化

### 4. 脱敏测试

凭据脱敏工具的测试必须验证：

- JSON 中敏感键值被替换为 `[REDACTED]`
- Shell 脚本中 `export KEY=value` 模式被正确脱敏
- JSONL 中的值级凭据（JWT、API Key、Bearer Token 等）被扫描替换
- 无敏感数据时保持原文不变
- 注释行（`#` 开头）不被脱敏
- 非 JSON 格式的行级脱敏正确工作
- 无效 JSON 返回原文

## 当前测试统计

| 指标 | 数值 |
|------|------|
| 测试文件 | 34 |
| 测试用例 | 338 |
| 通过率 | 100% |

## 相关文档

- [开发指南](./03-development.md)
- [安全机制](./05-security.md)
