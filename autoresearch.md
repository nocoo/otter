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

## 主要指标
- `precommit_s`: pre-commit 钩子总耗时（秒）

## 次要指标
- `lint_s`, `cov_s`, `tsc_s`, `gitleaks_s`：各 stage 耗时
- `tests_count`：测试数量（必须不减少）
- `coverage_lines`：行覆盖率（必须 ≥ 95%）

## 约束
- 所有 vitest 测试通过
- 覆盖率门槛保持 (95/88/95/95)
- biome 0 错误 0 警告
- tsc 严格通过
- gitleaks 0 泄露
- 不删除/弱化测试或质量门
- 不 overfit 基准
