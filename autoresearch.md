# Autoresearch: 优化 pre-commit 执行时间

## 目标
在不损害测试和现有逻辑（所有质量门保持通过）的前提下，
缩短 `.husky/pre-commit` 钩子的端到端执行时间。

## 基准测试
模拟 pre-commit 钩子的实际行为：在已 stage 文件的情况下并行运行
- G1 lint-staged (biome)
- L1 vitest + coverage
- tsc 类型检查 (`bun run lint`)
- gitleaks --staged

总时间 ≈ 最慢一个 stage（并行执行）。
基准脚本 `/tmp/bench-precommit.sh`，最多重试 3 次以容忍 builder.test.ts 的
预存在 ~25% mock 竞态（见 autoresearch.ideas.md）。

## 主要指标
- `precommit_s`: pre-commit 钩子总耗时（秒）

## 次要指标
- `lint_s`, `unit_cov_s`, `typecheck_s`, `gitleaks_s`：各 stage 耗时

## 约束
- 所有 vitest 测试通过（547 tests）
- 覆盖率门槛保持 (95/94/95/95)
- biome 0 错误 0 警告
- tsc 严格通过
- gitleaks 0 泄露
- 不删除/弱化测试或质量门
- 不 overfit 基准

## 结果

| 指标 | 基线 | 优化后 | 改善 |
|------|------|--------|------|
| precommit_s | 6.541s | 0.941s | **-85.6%** |
| unit_cov_s | 6.456s | 0.855s | -86.8% |
| typecheck_s | 2.692s | 0.091s | -96.6% |
| lint_s | 0.176s | 0.143s | -18.8% |
| gitleaks_s | 0.057s | 0.045s | -21.1% |

## 应用的优化（按贡献排序）

1. **`d1.test.ts` stub setTimeout** — 真实的 200/400ms retry backoff 在每个错误测
   试中浪费 600ms。在 `beforeEach` 中 `vi.spyOn(globalThis, "setTimeout")` 使
   回调同步触发；`afterEach` `vi.restoreAllMocks()` 还原。生产 retry 逻辑不变。
   **节省 ≈ 4.06s**。
2. **`create-app.test.ts` stub setTimeout** — `/v1/live` 探活通过 D1 client，触发
   同样的 retry backoff（600ms × 2）。同样的 stub 模式。**节省 ≈ 0.73s**。
3. **`tsc -b` 替换 4 个并行 `tsc --noEmit`** — 单次 `tsc --build` 利用所有包
   的 incremental `.tsbuildinfo` 缓存。冷启动 ≈ 0.6s，**热启动 ≈ 130ms**（vs
   原先 ≈ 700ms 并行）。
4. **`incremental: true` + `tsBuildInfoFile`** — 添加到 cli/web/api tsconfig，
   核心前置条件让上面 #3 生效。
5. **vitest `pool: "vmThreads"`** — 用 node:vm context 替代默认 forks pool；
   保留 per-file 隔离（必要——`pool: threads, isolate: false` 会让
   `builder.test.ts` 的 `vi.mock` 跨文件污染）。**节省 ≈ 0.3s**。
6. **typecheck 并行化** — 早期使用并行 `tsc --noEmit`（cli/web/api 在 core
   emit 之后并行），后被 #3 取代。

## 弃用尝试
- 把 `test:coverage` 移到 pre-push（仅省 ~50ms，弱化 L1 闸门）。
- 缩窄 coverage reporter 到 text-summary（无明显收益，损失本地 DX）。
- vitest `pool: "threads", isolate: false`（破坏 `builder.test.ts` 的 mock 隔离）。
- vitest `pool: "vmForks"`（比 vmThreads 慢）。
- 限制 `maxThreads`（拖慢）。

## 当前瓶颈
`unit_cov ≈ 0.85s` 接近 vitest+coverage v8 的实际下限。进一步明显提升需要切换
测试框架（如 `bun:test`）或大改架构，超出本次范围。
