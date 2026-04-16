# Hermes Collector — Hermes Agent Profile 备份

> 返回 [features](./README.md) · 相关 [采集器详解](../02-collectors.md) · [采集器增强计划](../07-collector-enhancement-plan.md)

## 背景

Hermes 是一个 AI agent 框架，支持多 profile 管理。每个 profile 包含模型配置、agent persona、持久化记忆、定时任务和技能等。作为 Otter 的第 13 个采集器，HermesCollector 负责备份所有 Hermes profile 的配置文件和元数据。

## Profile 结构

Hermes 支持主 profile 和命名子 profile：

```
~/.hermes/                          ← 主 profile (default)
├── config.yaml                     ← 模型、工具、平台配置
├── SOUL.md                         ← Agent persona 定义
├── memories/
│   ├── MEMORY.md                   ← Agent 持久化记忆
│   └── USER.md                     ← 用户画像
├── cron/
│   └── jobs.json                   ← 定时任务定义
├── skills/                         ← 技能目录（仅采集名称）
│   ├── deploy/
│   │   └── SKILL.md
│   └── search/
│       └── SKILL.md
├── .env                            ← ❌ API keys（不采集）
├── sessions/                       ← ❌ 会话数据库（不采集）
├── state.db                        ← ❌ SQLite 运行时状态（不采集）
└── auth.json                       ← ❌ OAuth tokens（不采集）

~/.hermes/profiles/                 ← 命名子 profiles
├── tomato/
│   ├── config.yaml
│   ├── SOUL.md
│   ├── memories/
│   │   ├── MEMORY.md
│   │   └── USER.md
│   ├── cron/
│   │   └── jobs.json
│   └── skills/
│       └── ...
├── babaco/
│   └── ...
└── taro/
    └── ...
```

## 采集策略

### 采集矩阵

| 文件/目录 | 用途 | 采集方式 | redact |
|-----------|------|---------|--------|
| `config.yaml` | 模型、工具、平台配置 | files | ✅ true |
| `SOUL.md` | Agent persona 定义 | files | ❌ false |
| `memories/MEMORY.md` | Agent 持久化记忆 | files | ❌ false |
| `memories/USER.md` | 用户画像 | files | ❌ false |
| `cron/jobs.json` | 定时任务定义 | files | ✅ true |
| `skills/` | 技能文件夹 | lists only | — |
| `.env` | API keys | ❌ 不采集 | — |
| `sessions/` | 会话数据库 | ❌ 不采集 | — |
| `state.db` | SQLite 状态 | ❌ 不采集 | — |
| `auth.json` | OAuth tokens | ❌ 不采集 | — |

### 虚拟路径约定

为方便辨识不同 profile 的文件，采集时使用虚拟路径前缀：

- 主 profile: `~/.hermes/default/config.yaml`
- 子 profile: `~/.hermes/tomato/config.yaml`

实际文件系统路径通过 `safeReadFile` 读取，存入 `CollectedFile.path` 时替换为虚拟路径。

## 架构设计

### 流水线位置

```
┌─────────────┐    ┌──────────┐    ┌──────────────┐
│  Collectors  │ →  │ Snapshot │ →  │ Store/Upload │
└─────────────┘    └──────────┘    └──────────────┘
       ↑
       │
  ┌────┴────────────────────────────────────┐
  │  shell-config                           │
  │  homebrew                               │
  │  applications                           │
  │  claude-config                          │
  │  opencode-config                        │
  │  vscode                                 │
  │  docker                                 │
  │  dev-toolchain                          │
  │  cloud-cli                              │
  │  fonts                                  │
  │  macos-defaults                         │
  │  launch-agents                          │
  │  hermes            ← NEW               │
  └─────────────────────────────────────────┘
```

### 类定义

```typescript
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { CollectedListItem, CollectorCategory, CollectorResult } from "@otter/core";
import { BaseCollector } from "./base.js";

/** Config files to collect from each Hermes profile */
const PROFILE_FILES: Array<{ relative: string; redact: boolean }> = [
  { relative: "config.yaml", redact: true },
  { relative: "SOUL.md", redact: false },
  { relative: "memories/MEMORY.md", redact: false },
  { relative: "memories/USER.md", redact: false },
  { relative: "cron/jobs.json", redact: true },
];

export class HermesCollector extends BaseCollector {
  readonly id = "hermes";
  readonly label = "Hermes Agent Profiles";
  readonly category: CollectorCategory = "config";

  collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      const hermesDir = join(this.homeDir, ".hermes");

      // 1. Discover profiles
      const profiles = await this.discoverProfiles(hermesDir, result);
      if (profiles.length === 0) {
        result.skipped.push("Hermes not installed (~/.hermes/ not found)");
        return;
      }

      // 2. Collect each profile
      for (const profile of profiles) {
        await this.collectProfile(profile, result);
      }
    });
  }
}
```

### 采集逻辑

#### 1. Profile 发现

```typescript
interface HermesProfile {
  name: string;           // "default" | profile directory name
  type: "main" | "named";
  dir: string;            // actual filesystem path
}

private async discoverProfiles(
  hermesDir: string,
  result: CollectorResult,
): Promise<HermesProfile[]> {
  const profiles: HermesProfile[] = [];

  // Check if ~/.hermes/ exists at all
  try {
    await readdir(hermesDir);
  } catch {
    return []; // Hermes not installed
  }

  // Main profile is ~/.hermes/ itself
  profiles.push({
    name: "default",
    type: "main",
    dir: hermesDir,
  });

  // Named profiles under ~/.hermes/profiles/
  const profilesDir = join(hermesDir, "profiles");
  try {
    const entries = await readdir(profilesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        profiles.push({
          name: entry.name,
          type: "named",
          dir: join(profilesDir, entry.name),
        });
      }
    }
  } catch {
    // No profiles/ dir — only main profile
  }

  return profiles;
}
```

#### 2. Profile 采集

```typescript
private async collectProfile(
  profile: HermesProfile,
  result: CollectorResult,
): Promise<void> {
  // Collect config files with virtual path prefix
  for (const { relative, redact } of PROFILE_FILES) {
    const actualPath = join(profile.dir, relative);
    const file = await this.safeReadFile(actualPath, result, { redact });
    if (file) {
      // Use virtual path for identification
      file.path = join("~/.hermes", profile.name, relative);
      result.files.push(file);
    }
  }

  // Add profile as list item
  const skills = await this.collectSkillNames(profile, result);

  result.lists.push({
    name: `profile:${profile.name}`,
    meta: {
      type: profile.type,
      skillsCount: String(skills.length),
    },
  });

  // Add skills as list items
  result.lists.push(...skills);
}
```

#### 3. Skills 采集

```typescript
private async collectSkillNames(
  profile: HermesProfile,
  result: CollectorResult,
): Promise<CollectedListItem[]> {
  const items: CollectedListItem[] = [];
  const skillsDir = join(profile.dir, "skills");

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Only count directories that contain a SKILL.md file
      try {
        await access(join(skillsDir, entry.name, "SKILL.md"));
      } catch {
        continue; // Not a valid skill directory
      }
      items.push({
        name: `${profile.name}/${entry.name}`,
        meta: {
          profile: profile.name,
          type: "skill",
        },
      });
    }
  } catch {
    // skills/ doesn't exist — not an error
  }

  return items;
}
```

## 错误处理策略

| 场景 | 处理 |
|------|------|
| `~/.hermes/` 不存在 | 返回空结果 + `skipped` 消息 |
| 单个 profile 目录无法读取 | 记录到 `errors[]`，继续其他 profile |
| 单个文件不存在（ENOENT） | 静默跳过（由 `safeReadFile` 处理） |
| 文件权限错误 | 记录到 `errors[]`（由 `safeReadFile` 处理） |
| `skills/` 目录不存在 | 静默跳过，返回空 skills 列表 |
| 文件超过 512KB 限制 | 记录到 `errors[]`（由 `safeReadFile` 处理） |

## 测试策略

遵循现有 filesystem-based collector 测试模式（参考 `opencode-config.test.ts`、`claude-config.test.ts`）。

### 测试用例

| # | 场景 | 验证内容 |
|---|------|---------|
| 1 | Metadata 正确性 | `id === "hermes"`, `label`, `category === "config"` |
| 2 | 正常采集 | 主 profile + 2 个子 profile 的文件和列表 |
| 3 | 空数据 | `~/.hermes/` 不存在时返回空结果 + skipped |
| 4 | 仅主 profile | 无 `profiles/` 子目录 |
| 5 | 部分损坏 | 子 profile 缺少部分文件（应正常采集存在的文件） |
| 6 | Skills 列表 | 正确列出 skill 名称和 meta |
| 7 | Config redaction | `config.yaml` 和 `cron/jobs.json` 应用 redact |
| 8 | 虚拟路径 | 文件路径使用 `~/.hermes/<profile>/` 前缀 |
| 9 | Duration | `durationMs >= 0` |

### 测试结构

```typescript
describe("HermesCollector", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "otter-test-"));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  // ... test cases
});
```

## 需要修改的文件

### 新增文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/collectors/hermes.ts` | HermesCollector 实现 |
| `packages/cli/src/__tests__/collectors/hermes.test.ts` | 测试 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `packages/cli/src/collectors/index.ts` | 添加 export + 注册到 `createDefaultCollectors()` |
| `packages/cli/src/__tests__/collectors/index.test.ts` | 在 expected ID 数组中添加 `"hermes"` |
| `docs/07-collector-enhancement-plan.md` | 更新 collector 列表 |

## 原子化提交计划

```
1. feat(core): add HermesCollector for Hermes Agent profile backup
   - 新增 packages/cli/src/collectors/hermes.ts
   - 注册到 packages/cli/src/collectors/index.ts

2. test(hermes): add comprehensive tests for HermesCollector
   - 新增 packages/cli/src/__tests__/collectors/hermes.test.ts
   - 更新 packages/cli/src/__tests__/collectors/index.test.ts

3. docs: add hermes collector design document and update enhancement plan
   - 新增 docs/features/README.md
   - 新增 docs/features/01-hermes-collector.md
   - 更新 docs/07-collector-enhancement-plan.md
```

## 6DQ 影响评估

| 维度 | 影响 | 说明 |
|------|------|------|
| **Data** | 新增 | 新增 Hermes profile 的配置文件和技能列表数据 |
| **Dependency** | 无 | 仅依赖 `BaseCollector`、`node:fs/promises`、`node:path` |
| **Design** | 遵循 | 完全遵循现有 collector 模式（BaseCollector + timed + safeReadFile） |
| **Development** | 低风险 | 新增文件为主，修改文件仅涉及注册和文档 |
| **Delivery** | 无阻塞 | 不影响现有功能，Hermes 未安装时静默跳过 |
| **Debt** | 无 | 代码结构与现有 collector 一致，无技术债引入 |
