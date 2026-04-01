---
created: 2026-04-01T14:30
updated: 2026-04-02T00:00
supersedes:
  - Multi-Model Task Routing Coding Agent - v9 - SPEC.md
---

# Multi-Model Task Routing Coding Agent - v9.1 - SPEC

创建时间：2026-04-01  
状态：独立完整规格草案

## 0. 一句话结论

v9.1 的最终目标不再表述为“纯外层 Agent Loop + 纯内层 worker loop”，而是明确为：

**`Session Kernel + Leader Orchestrator + Collaboration Protocol Broker + Teammate Runtimes + Deterministic Runtime Core`**

其中：

- `Session Kernel` 负责长寿命 CLI 会话、上下文管理、resume、事件流与 turn lifecycle
- `Leader Orchestrator` 负责规划、任务拆分、协调 teammate、汇总结果并与用户交互
- `Collaboration Protocol Broker` 负责 agent 间结构化协作协议
- `Teammate Runtimes` 负责不同运行形态的 teammate 执行
- `Deterministic Runtime Core` 负责状态迁移、预算、恢复、验证判定、安全边界

MVP 仍然不实现完整 teammates 系统，但从第一天起就必须为 teammates 终态保留协议、状态和模块边界。

这份文档的核心原则是：

> 用代码管理流程，用协议管理协作，用 Agent 提供判断。

---

## 1. 为什么需要 v9.1

v9 已经解决了两个关键问题：

1. 不再把状态控制交给外层 Agent 自觉维护
2. 明确了强模型规划、中等模型执行/验证、廉价模型做机械步骤的基本方向

但 v9 仍然有三个结构性不足：

1. 它把系统看得过于像“单任务 Runtime”，没有把“长寿命 CLI 会话内核”作为独立一级架构
2. 它把多 agent 理解得过于像“并行 step”，而不是“有明确协议的 teammates 协作系统”
3. 它仍然以“模型强弱”定义角色，而不是以“能力、工具、权限、隔离与运行形态”定义 agent profile

对 `open-claude-code` 的源码分析给出了几个重要启发：

- 真正可用的 CLI coding agent，不是一个简单 loop，而是一个长寿命 `QueryEngine`/session kernel
- 多 agent 不是单一形态，至少会分成 `background agent`、`in-process teammate`、`remote agent`
- agent 分工依赖的不只是模型层级，更依赖工具白名单、只读/可写约束、permission mode、max turns 和 isolation mode
- 长上下文管理不能只靠“摘要一下”，而需要正式的 `ContextManager` 管线
- teammates 的可靠协作不应该依赖隐式共享上下文，而应该依赖 mailbox/task/event 协议

因此，v9.1 的目标不是推翻 v9，而是把 v9 从“单任务半确定性骨架”升级为“面向 teammates 终态的完整系统规格”。

---

## 2. 核心目标

### 2.1 产品目标

构建一个 CLI-first 的多模型、多 agent 协作编码系统，做到：

- 强模型负责规划、重规划、定义正确性边界
- 中等模型负责实现、验证、协调与恢复决策
- 廉价模型负责机械性、低风险、高重复步骤
- leader 可以把任务拆给 teammates
- teammates 可以通过结构化协议协作，而不是依赖混乱共享上下文
- 在明显低于全强模型方案的成本下，完成中高复杂度工程任务

### 2.2 架构目标

- 从一开始就把 teammates 视为终态能力，而不是附加插件
- MVP 不做会被未来 teammates 形态推翻的临时架构
- 将 `Session Kernel` 与 `Task Runtime` 明确分层
- 将“流程状态”“协作协议”“模型判断”三者严格解耦
- 为未来 `chat-to-im`、remote worker 和多任务调度预留统一事件与协议

### 2.3 非目标

本版本不追求：

- MVP 中落地完整 teammates UI
- MVP 中落地 remote teammate 执行环境
- MVP 中落地多 IM 平台接入
- MVP 中落地完整并行 DAG 调度器
- MVP 中落地供应商无差别兼容矩阵

---

## 3. 设计原则

### 3.1 代码管状态，模型做判断

以下职责必须由代码负责：

- 状态迁移
- 重试计数
- 预算扣减与阻断
- baseline / artifact 生命周期
- 协议落盘与恢复
- 结构化结果校验
- 安全策略
- 验证最终判定

### 3.2 协作靠协议，不靠心领神会

agent 间不能依赖：

- 模糊自然语言上下文
- 共享终端输出
- “约定俗成”的文件读写习惯

agent 间必须依赖：

- 明确的消息 envelope
- 明确的 task ownership
- 明确的 artifact 引用
- 明确的 approval / ack 语义

### 3.3 运行形态和能力形态必须拆开

一个 agent 至少有两类维度：

- `RuntimePlacement`
  `in_process` / `local_process` / `remote_process`
- `IsolationMode`
  `shared_workspace` / `worktree` / `remote_workspace`

这两个维度不能混成一个“agent type”。

### 3.4 agent profile 以能力边界定义，不以模型名字定义

真正重要的是：

- 能用哪些工具
- 是否只读
- 是否允许写项目目录
- 是否能发起 teammate
- 是否允许后台执行
- 是否需要 leader 审批

模型层级只是 profile 的一个字段，不是 profile 的全部。

### 3.5 teammates 是终态能力，不是 MVP 细节

MVP 可以不实现具体 teammate runtime，但必须先定义：

- `BrokerPort`
- `TaskRegistry`
- `AgentIdentity`
- `ArtifactRef`
- `ApprovalRequest / ApprovalResponse`

否则后续一定返工。

### 3.6 默认隔离，默认可审计，默认可恢复

终态系统默认应当：

- teammate 在隔离工作区工作
- 所有跨 agent 协作可追踪
- 所有关键状态可落盘恢复

---

## 4. 架构概览

### 4.1 Terminal Architecture

```text
用户 / CLI / IM
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│ Session Kernel                                           │
│ turn lifecycle / session history / resume / compaction   │
│ event stream / task registry projection / status sink    │
└───────────────┬───────────────────────┬──────────────────┘
                │                       │
                ▼                       ▼
┌──────────────────────────┐   ┌──────────────────────────┐
│ Leader Orchestrator      │   │ Deterministic Runtime    │
│ plan / decompose / ask   │   │ state / budget / verify  │
│ assign / summarize       │   │ policy / recovery / ack  │
└───────────────┬──────────┘   └───────────────┬──────────┘
                │                              │
                └──────────────┬───────────────┘
                               ▼
                   ┌──────────────────────────┐
                   │ Collaboration Broker     │
                   │ mailbox / tasks / events │
                   │ artifacts / approvals    │
                   └──────────────┬───────────┘
                                  │
          ┌───────────────────────┼────────────────────────┐
          ▼                       ▼                        ▼
┌──────────────────┐   ┌──────────────────┐    ┌──────────────────┐
│ Teammate Runtime │   │ Teammate Runtime │    │ Teammate Runtime │
│ in-process       │   │ local process    │    │ remote process   │
│ + worktree/shared│   │ + worktree       │    │ + remote workspace│
└──────────────────┘   └──────────────────┘    └──────────────────┘
```

### 4.2 MVP Architecture

```text
用户 / CLI
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│ Session Kernel                                           │
│ single-session / resume / event store / context manager  │
└───────────────┬───────────────────────┬──────────────────┘
                │                       │
                ▼                       ▼
┌──────────────────────────┐   ┌──────────────────────────┐
│ Leader Runtime           │   │ Deterministic Runtime    │
│ planner / replanner      │   │ state / budget / verify  │
│ decision / summarize     │   │ policy / persistence     │
└───────────────┬──────────┘   └───────────────┬──────────┘
                │                              │
                └──────────────┬───────────────┘
                               ▼
                   ┌──────────────────────────┐
                   │ BrokerPort               │
                   │ FS implementation ready  │
                   │ but teammates disabled   │
                   └──────────────────────────┘
```

MVP 中：

- 不实现完整 teammate spawning
- 不实现 peer-to-peer message routing
- 但必须实现 protocol-ready 的 broker、registry、event store 和 state store

---

## 5. 一级模块职责

| 模块 | MVP | 责任 |
| --- | --- | --- |
| `Session Kernel` | 是 | 管理长寿命会话、turn lifecycle、history、resume、context manager、event streaming |
| `Leader Orchestrator` | 是 | 规划、重规划、恢复决策、用户问题生成、进度汇总 |
| `Deterministic Runtime Core` | 是 | 状态推进、预算、验证判定、策略、安全、持久化 |
| `Task Registry` | 是 | 管理 task、step、artifact、owner、projection |
| `Collaboration Broker` | 接口 + 最小 FS 实现 | mailbox、task messages、artifact 发布、approval 流 |
| `Teammate Runtime` | 否 | teammates 的运行与通信 |
| `Status Sink` | 是 | 把事件映射为 CLI 输出 |
| `UserInteractionPort` | 是 | 把用户输入/批准统一抽象为协议事件 |

---

## 6. 关键术语

### 6.1 Session

用户与系统的一次长寿命会话。它可能包含多个 turn、一个或多个 run、后台 task 以及后续 resume。

### 6.2 Run

围绕某个用户目标执行的一次任务运行单元。一个 session 可以承载多个 run。

### 6.3 PlanStep

由 Planner 生成的、用于表达逻辑工作流的步骤。它描述“目标上应该完成什么”。

### 6.4 Collaboration Task

由 Leader 从 `PlanStep` 派生出的可执行协作任务。它描述“谁以什么 profile、在什么隔离环境里完成什么子任务”。

### 6.5 Teammate

可以被 Leader 委派工作的 agent。它不是“强模型 worker”的同义词，而是协议中的协作参与者。

### 6.6 Artifact

协作过程中产出的结构化成果引用，如：

- patch
- commit hash
- test report
- verification log
- plan draft
- generated file set

### 6.7 Broker

负责任务消息、approval、artifact 发布、ack 和 inbox 投递的协议层。文件系统只是 broker 的一种 transport 实现。

### 6.8 AgentIdentity

为了避免 ownership、approval、artifact producer、task assignee 各自维护一套主键，v9.1 要求所有协作参与者统一使用 `AgentIdentity`。

```ts
interface AgentIdentity {
  agent_id: string;
  agent_name: string;
  team_id?: string;
  parent_session_id?: string;
  profile_id: AgentProfile["id"];
  runtime_placement: RuntimePlacement;
}
```

规则：

- `agent_id` 是协议主键，不能使用 display name 代替
- `agent_name` 用于 CLI 和 transcript 展示
- `team_id` 在 MVP 中可为空，但字段必须保留
- `parent_session_id` 用于把 teammate、background task 和 leader session 关联起来

### 6.9 Active Run

一个 session 可以历史上包含多个 run，但同一时刻只能有一个 `active_run_id`。

规则：

- 新建 run 时，必须显式把它 attach 成当前 active run
- resume 时，如果存在未终态 run，Kernel 必须恢复最后一个 active run
- 不允许同一 session 下并发推进多个 active run，除非未来明确引入 multi-run 调度器

---

## 7. 状态模型必须分层

v9 的单一 `TaskStatus` 不足以表达完整系统。v9.1 明确拆成三层状态。

### 7.1 SessionStatus

```ts
type SessionStatus =
  | "Active"
  | "AwaitingUser"
  | "Compacting"
  | "Interrupted"
  | "Resumable"
  | "Closed";
```

### 7.2 RunStatus

```ts
type RunStatus =
  | "Draft"
  | "Planned"
  | "AwaitingApproval"
  | "Ready"
  | "Executing"
  | "Recovering"
  | "AwaitingUser"
  | "Completed"
  | "Failed"
  | "Cancelled";
```

### 7.3 StepStatus

```ts
type StepStatus =
  | "Pending"
  | "Ready"
  | "Executing"
  | "Verifying"
  | "Passed"
  | "Failed"
  | "Blocked"
  | "Skipped"
  | "Cancelled";
```

### 7.4 CollaborationTaskStatus

```ts
type CollaborationTaskStatus =
  | "Pending"
  | "Claimed"
  | "Running"
  | "AwaitingApproval"
  | "Reporting"
  | "Completed"
  | "Failed"
  | "Cancelled";
```

原则：

- `SessionStatus` 管会话壳
- `RunStatus` 管当前目标运行
- `StepStatus` 管逻辑步骤
- `CollaborationTaskStatus` 管协作任务

任何实现都不得再把这些层级重新压成一个 enum。

---

## 8. Agent Profile 模型

### 8.1 为什么需要 AgentProfile

`open-claude-code` 最值得借鉴的一点，是 built-in agents 并不是靠“强中弱模型”区分，而是靠：

- read-only / writable
- tool allowlist / disallowed tools
- permission mode
- background default
- max turns
- isolation mode

因此 v9.1 不再只定义 `planner_strong`、`executor_medium` 这样的 profile，而要定义正式的 `AgentProfile`。

### 8.2 数据结构

```ts
type RuntimePlacement = "in_process" | "local_process" | "remote_process";

type IsolationMode =
  | "shared_workspace"
  | "worktree"
  | "remote_workspace";

type PermissionMode =
  | "default"
  | "plan_required"
  | "ask"
  | "auto"
  | "bypass";

type FilesystemWriteScope =
  | "none"
  | "temp_only"
  | "project";

type ToolPolicy = {
  allow: string[];
  deny: string[];
  read_only: boolean;
  concurrency_class: "read_only" | "mixed" | "side_effecting";
};

interface AgentProfile {
  id: string;
  display_name: string;
  role:
    | "leader"
    | "planner"
    | "explorer"
    | "executor"
    | "verifier"
    | "summarizer"
    | "general_purpose";
  model_profile: "strong" | "medium" | "cheap";
  reasoning_effort?: "low" | "medium" | "high";
  tool_policy: ToolPolicy;
  permission_mode: PermissionMode;
  runtime_placement: RuntimePlacement;
  default_isolation: IsolationMode;
  filesystem_write_scope: FilesystemWriteScope;
  allowed_temp_roots?: string[];
  max_turns: number;
  background_default: boolean;
  can_spawn_teammates: boolean;
  memory_scope: "session" | "project" | "local" | "none";
}
```

### 8.3 内建 profile

终态至少需要以下内建 profile：

- `leader`
  全局协调与用户交互
- `planner`
  强模型，只读，`filesystem_write_scope = "none"`
- `explorer`
  快速只读，偏廉价或中等模型，`filesystem_write_scope = "none"`
- `executor`
  可写，可运行工具，`filesystem_write_scope = "project"`
- `verifier`
  默认只读项目目录，但允许写临时验证工件目录，`filesystem_write_scope = "temp_only"`
- `general_purpose`
  通用 profile，用于尚未专门化的子任务

这里直接对齐 `open-claude-code` 的经验：

- `planner` / `explorer` 通过 `disallowedTools` 保持只读
- `verifier` 虽然禁止写项目目录，但允许写临时目录做验证脚本与临时产物
- profile 的核心不是模型强弱，而是 `tool_policy + permission_mode + isolation + write scope`

---

## 9. 规划模型

### 9.1 TaskGraph

```ts
interface TaskGraph {
  goal: string;
  assumptions: string[];
  steps: PlanStep[];
  verification_specs: VerificationSpec[];
  budget_policy: BudgetPolicy;
}
```

### 9.2 PlanStep

```ts
interface PlanStep {
  id: string;
  title: string;
  type: "implement" | "test" | "refactor" | "config" | "research";
  action: string;
  dependencies: string[];
  preferred_profile: AgentProfile["id"];
  execution_mode: "inline" | "delegated";
  verification_spec_id: string;
  done_when: DoneWhen;
  max_retries: number;
}

interface DoneWhen {
  files_exist?: string[];
  files_contain?: Array<{
    path: string;
    substring: string;
  }>;
  command_success?: {
    command: string;
    cwd?: string;
  };
}
```

### 9.3 PlanRevision

v9.1 正式引入 `PlanRevision`，解决 v9 中 `replan_remaining` 语义不完整的问题。

```ts
interface PlanRevision {
  revision_id: string;
  base_plan_version: number;
  new_plan_version: number;
  reason: string;
  changed_step_ids: string[];
  change_summary: {
    goal_changed: boolean;
    budget_changed: boolean;
    verification_changed: boolean;
    dependency_changed: boolean;
    step_count_changed: boolean;
  };
  approval_required: boolean;
}
```

规则：

- 任何影响目标、预算、步骤数量、依赖关系、验收标准的变更，必须重新批准
- 只有局部修复式 revision 可以自动继续
- Runtime 以 `plan_version` 管理执行，不允许继续跑旧 DAG 快照

---

## 10. Collaboration Task 模型

`PlanStep` 解决“逻辑计划”，`CollaborationTask` 解决“可被委派的协作任务”。

```ts
interface CollaborationTask {
  id: string;
  run_id: string;
  source_step_ids: string[];
  title: string;
  objective: string;
  required_profile: AgentProfile["id"];
  owner_policy: "leader_only" | "assignable" | "fixed_agent";
  assigned_agent_id?: string;
  runtime_placement: RuntimePlacement;
  isolation_mode: IsolationMode;
  dependencies: string[];
  input_artifacts: ArtifactRef[];
  acceptance_ref: {
    verification_spec_ids: string[];
    done_when: DoneWhen;
  };
  status: CollaborationTaskStatus;
}
```

原则：

- `PlanStep` 不直接等于 teammate work item
- Leader 可以把多个 step 折叠成一个 `CollaborationTask`
- 也可以把一个复杂 step 拆成多个 `CollaborationTask`

### 10.1 Materialization 规则

并不是每个 `PlanStep` 都必须落成 `CollaborationTask`。

规则：

- `execution_mode = "inline"` 的 step 默认不进入 `Task Registry` 的协作任务视图，只在 run state 中推进
- `execution_mode = "delegated"` 的 step 必须 materialize 成至少一个 `CollaborationTask`
- 多个相邻、由同一 profile 执行、且共享同一 acceptance context 的 step 可以折叠成一个 `CollaborationTask`
- 如果一个 delegated step 被拆成多个 `CollaborationTask`，Runtime 必须保留 `source_step_ids` 到 task id 的映射
- 只有真正进入 task system 的实体才拥有独立 `CollaborationTaskStatus`

---

## 11. Verification 模型

### 11.1 VerificationSpec

```ts
interface VerificationSpec {
  id: string;
  related_step_ids: string[];
  description: string;
  invariants: string[];
  test_scenarios: TestScenario[];
  verification_approach: string;
  acceptance_criteria: string[];
  setup_instructions?: string;
  run_command?: string;
}

interface TestScenario {
  name: string;
  given: string;
  when: string;
  then: string;
  priority: "must" | "should";
}
```

### 11.2 Verifier 只返回观察，不返回最终 verdict

这点与 v9 不同。v9.1 明确规定：

- `Planner` 定义“验证什么”
- `Verifier` 负责“如何执行验证并产出观察结果”
- `Runtime` 负责根据规则做最终 `pass/fail` 判定

```ts
interface VerifyObservation {
  verification_spec_id: string;
  commands_run: Array<{
    command: string;
    cwd?: string;
    exit_code: number;
    output_ref?: string;
  }>;
  scenario_results: Array<{
    scenario: string;
    priority: "must" | "should";
    status: "passed" | "failed" | "not_run";
    evidence?: string;
  }>;
  generated_artifacts: ArtifactRef[];
  summary: string;
}

interface VerifyDecision {
  status: "pass" | "fail";
  must_passed: number;
  must_total: number;
  should_passed: number;
  should_total: number;
  reasons: string[];
}
```

### 11.3 verification artifacts 生命周期

v9.1 明确区分：

- `execution diff`
  产品实现的一部分
- `verification artifacts`
  验证阶段生成的测试脚本、日志、截图、临时 harness

策略：

- 默认写入 `.harness/runs/<run_id>/verification/`
- 默认不直接进入产品成果
- 只有被明确 promote 的验证工件才允许进入最终提交物

### 11.4 verifier 的写入例外必须显式建模

参考 `open-claude-code` 的 verification agent，v9.1 明确规定：

- verifier 不得写项目目录
- verifier 可以写 `allowed_temp_roots` 指定的临时目录
- verifier 产出的临时脚本、日志、截图必须通过 `ArtifactRef` 回传
- 任何需要进入最终成果的验证产物，都必须经过 `promote` 流程

因此 verifier 不是“绝对只读 agent”，而是“对项目目录只读、对临时验证目录有限可写”的 agent。

---

## 12. Session Kernel

### 12.1 Session Kernel 的定位

`Session Kernel` 是系统的第一等公民，不是 Runtime 的一个 helper。

它负责：

- 长寿命消息历史
- turn lifecycle
- 当前 run 绑定
- 后台 task 可见性
- 上下文组装与裁剪
- session resume
- event streaming
- CLI 和未来 IM 的统一宿主边界

### 12.2 Kernel 类型

```ts
interface UserTurnInput {
  session_id: string;
  text: string;
  attachments?: ArtifactRef[];
  target_run_id?: string;
}

interface KernelTurnResult {
  session_status: SessionStatus;
  active_run_id?: string;
  emitted_event_ids: string[];
  user_interaction_request?: UserInteractionRequest;
}

interface ResumeResult {
  session_status: SessionStatus;
  restored_run_ids: string[];
  active_run_id?: string;
  pending_user_interactions: UserInteractionRequest[];
}

interface StatusSink {
  onEvent(event: RuntimeEvent): Promise<void>;
  flush(): Promise<void>;
}
```

### 12.3 Kernel Port

```ts
interface SessionKernelPort {
  submitUserInput(input: UserTurnInput): Promise<KernelTurnResult>;
  attachRun(run_id: string): Promise<void>;
  interruptCurrentTurn(reason: string): Promise<void>;
  resumeSession(session_id: string): Promise<ResumeResult>;
  closeSession(): Promise<void>;
}
```

### 12.4 active run 语义

`Session Kernel` 必须维护 `active_run_id`，并满足以下规则：

- `attachRun(run_id)` 会把指定 run 设置为当前 active run
- 如果当前 active run 进入终态，Kernel 可以把 `active_run_id` 清空
- `submitUserInput()` 如果未指定 `target_run_id`，默认路由到当前 active run
- 如果 session 中不存在 active run，Leader 可以在新 turn 中创建新的 run 并 attach

这个约束是故意比 `open-claude-code` 更保守的。后者基本是一条 conversation 对一个长寿命 `QueryEngine`；v9.1 虽然允许一个 session 挂多个历史 run，但不允许同时存在多个并发 active run。

### 12.5 与 Task Runtime 的关系

- `Session Kernel` 负责“会话壳”
- `Task Runtime` 负责“任务流”

不允许：

- 由 `Task Runtime` 直接持有完整 session history
- 由 `Session Kernel` 决定 step 状态迁移

---

## 13. Deterministic Runtime Core

### 13.1 职责

`Deterministic Runtime Core` 负责：

- 执行 `TaskGraph`
- 维护 `plan_version`
- 选择下一个可执行 step
- 跟踪 step attempts
- 管理预算、baseline、artifact、approval gate
- 做 verify judgment
- 落盘 state store

### 13.2 主循环

```ts
async function runTask(runId: string): Promise<RunResult> {
  while (!isTerminal(run.status)) {
    const next = selectNextExecutableStep(run);

    if (!next) {
      if (allRequiredStepsPassed(run)) return completeRun(run);
      return failRun(run, "No executable step remains");
    }

    executeStep(next);
    observeVerification(next);
    judgeVerification(next);
    applyRecoveryOrRevision(next);
  }
}
```

关键变化：

- 不再使用“预先展开整个 DAG 的 `for ... of`”
- 每次都根据最新 `plan_version` 和 `step state` 选择下一步

### 13.3 RecoveryAction

```ts
type RecoveryAction =
  | { type: "retry_step"; reason: string; retry_prompt: string }
  | { type: "replan_remaining"; reason: string; replan_context: string }
  | { type: "ask_user"; reason: string; question: string; options?: string[] }
  | { type: "delegate_to_teammate"; reason: string; profile: string }
  | { type: "fail_task"; reason: string };
```

规则：

- `Runtime` 只接受结构化动作
- `delegate_to_teammate` 在 MVP 中不可执行，但字段必须保留
- `replan_remaining` 必须产生 `PlanRevision`

### 13.4 delegated task 回流规则

一旦未来启用 `delegate_to_teammate`，Runtime 必须按以下顺序处理：

- 创建 `CollaborationTask`
- 发布 `task_assignment`
- 等待 `task_result` 或失败事件
- 把返回的 `ArtifactRef` 绑定回 `source_step_ids`
- 再进入 verification 与最终 judgment

这意味着 delegated task 的完成，不等于 source step 自动通过。真正的 `StepStatus` 仍然只能由 Runtime 推进。

---

## 14. Collaboration Protocol

### 14.1 协议原则

agent 间协作必须满足：

- 可落盘
- 可恢复
- 可 ack
- 可审计
- 与 transport 无关

### 14.2 BrokerPort

```ts
type BrokerEvent = BrokerMessage | RuntimeEvent;

interface BrokerPort {
  publish(event: BrokerEvent): Promise<{ seq: number }>;
  deliver(message_id: string): Promise<void>;
  pollInbox(agent_id: string, after_seq?: number): Promise<BrokerMessage[]>;
  ack(agent_id: string, upto_seq: number): Promise<void>;
  replay(after_seq?: number): AsyncIterable<BrokerEvent>;
}
```

语义必须明确：

- `publish()` 负责把 event append 到 canonical event log，并分配唯一 `seq`
- `deliver()` 不产生新的 canonical event，它只把已经存在的 `BrokerMessage` materialize 到目标 inbox projection
- `pollInbox()` 读取的是投递视图，不直接扫描全量 event log
- `ack()` 记录“某 agent 已消费到哪个 seq”，而不是回写原消息内容
- `replay()` 用于 resume、projection rebuild 和审计

### 14.3 Message Envelope

```ts
interface BrokerEnvelope {
  message_id: string;
  seq: number;
  session_id: string;
  run_id: string;
  from_agent_id: string;
  to_agent_id?: string;
  correlation_id?: string;
  created_at: string;
}
```

补充约束：

- `message_id` 用于幂等投递与去重
- `seq` 只由 broker 分配，外部 actor 不得伪造
- `correlation_id` 必须贯穿 request/response、approval escalation、task result 路径
- `to_agent_id` 为空表示广播给 session 级默认消费者，MVP 中通常是 leader

### 14.4 消息类型

```ts
type BrokerMessage =
  | (BrokerEnvelope & { type: "task_assignment"; task: CollaborationTask })
  | (BrokerEnvelope & { type: "task_claim"; task_id: string })
  | (BrokerEnvelope & { type: "task_result"; task_id: string; artifact_refs: ArtifactRef[]; summary: string })
  | (BrokerEnvelope & { type: "status_update"; status: string; detail?: string })
  | (BrokerEnvelope & { type: "artifact_published"; artifact: ArtifactRef })
  | (BrokerEnvelope & { type: "approval_request"; request: ApprovalRequest })
  | (BrokerEnvelope & { type: "approval_response"; response: ApprovalResponse })
  | (BrokerEnvelope & { type: "shutdown_request"; reason?: string })
  | (BrokerEnvelope & { type: "shutdown_ack" });
```

### 14.5 Approval 模型

```ts
type ApprovalRequest = {
  id: string;
  kind: "plan" | "plan_revision" | "budget" | "task_result" | "permission";
  question: string;
  context?: string;
  requester_agent_id: string;
  target: "leader" | "user";
  related_run_id: string;
  correlation_id: string;
};

type ApprovalResponse = {
  request_id: string;
  approved: boolean;
  answer?: string;
  approver_agent_id: string;
  answered_at: string;
  correlation_id: string;
};
```

规则：

- teammate 不能自行批准关键变更
- Leader 是默认审批者
- 用户是最终审批者
- `ApprovalRequest.target = "leader"` 时，Leader 可以本地处理，也可以升级为用户交互
- 如果升级到用户，必须保留同一个 `correlation_id`

### 14.6 幂等性与恢复

协议实现必须假设以下情况会发生：

- 同一条消息被重复 deliver
- inbox projection 丢失，需要从 event log 重建
- agent 在收到消息后、ack 前崩溃
- approval response 晚到，但 request 已经超时或被替代

因此必须满足：

- `message_id` 全局唯一
- `deliver(message_id)` 是幂等操作
- `ack(agent_id, upto_seq)` 只能前进，不能回退
- rebuild projection 时只能以 canonical `events.ndjson` 为真相

---

## 15. FileSystemBroker 设计

### 15.1 关键判断

v9.1 明确反对“让 subagents 直接通过文件系统随意共享通信”。

正确做法是：

- 文件系统只是 transport
- mailbox / event / artifact / task projection 才是协议实体

### 15.2 目录结构

```text
.harness/
  sessions/<session_id>/
    session.json
    runs/<run_id>/
      run.json
      events/events.ndjson
      projections/
        tasks.json
        artifacts.json
      agents/
        <agent_id>/
          state.json
          inbox.ndjson
          ack.json
      verification/
      traces/
```

### 15.3 存储规则

- `events.ndjson` 是 append-only source of truth
- `projections/*.json` 是可重建的 materialized view
- `inbox.ndjson` 是投递缓存，不是唯一真相
- 所有更新必须通过 append 或 atomic rename 完成
- 不允许多个 agent 直接原地改同一个共享 JSON 文件

补充说明：

- `publish()` 只写 `events.ndjson`
- `deliver()` 从 canonical event log 读取指定 `message_id`，再写目标 `inbox.ndjson`
- `tasks.json` / `artifacts.json` / 未来的 `approvals.json` 都必须可由 event replay 重建
- 如果 projection 与 event log 冲突，以 event log 为准

### 15.4 最小并发语义

- append event 时使用 file lock
- 投递 inbox 时写临时文件再 rename
- ack 只记录“最后已确认 seq”，不回写原消息

### 15.5 最小恢复语义

- 进程恢复时先读取 `ack.json`
- 再根据 `events.ndjson` 重建 `tasks.json`、`artifacts.json` 等 projection
- 最后根据 `ack.upto_seq` 重新生成未消费 inbox 视图
- 任何时候都不得把 `inbox.ndjson` 视为唯一真相来源

---

## 16. Artifact 模型

```ts
interface ArtifactRef {
  id: string;
  kind:
    | "patch"
    | "commit"
    | "verification_report"
    | "test_log"
    | "plan_draft"
    | "summary"
    | "file_bundle";
  producer_agent_id: string;
  produced_at: string;
  path?: string;
  commit_ref?: string;
  worktree_ref?: string;
  base_commit?: string;
  source_plan_version?: number;
  source_step_ids?: string[];
  applies_cleanly_to?: {
    isolation_mode: IsolationMode;
    workspace_ref?: string;
  };
  summary: string;
}
```

原则：

- teammate 的交付物应以 `ArtifactRef` 形式返回
- 终态默认通过 `patch`、`commit_ref`、`verification_report` 协作
- 不通过“我在主工作区改了一些文件你自己看”协作

补充说明：

- `base_commit` 用于判断 patch / commit 是否仍然可安全应用
- `source_plan_version` 用于防止旧计划产物被误并入新计划
- `source_step_ids` 用于把 artifact 绑定回具体的逻辑步骤
- `applies_cleanly_to` 用于描述该产物是面向 shared workspace、某个 worktree，还是远端 workspace 生成的

---

## 17. Isolation 与工作区策略

### 17.1 运行位置和隔离不是一回事

```ts
type RuntimePlacement = "in_process" | "local_process" | "remote_process";
type IsolationMode = "shared_workspace" | "worktree" | "remote_workspace";
```

例如：

- 一个 agent 可以是 `in_process + shared_workspace`
- 也可以是 `local_process + worktree`
- 也可以是 `remote_process + remote_workspace`

### 17.2 默认策略

- `leader`
  默认 `shared_workspace`
- `teammate`
  终态默认 `worktree`
- `remote teammate`
  默认 `remote_workspace`

### 17.3 约束

- 默认不允许 teammate 直接修改 leader 的工作区
- teammate 产物通过 `ArtifactRef` 或 commit ref 回交
- 只有被 Leader 明确接受的变更才进入主线成果

### 17.4 baseline 在不同隔离模式下的语义

v9.1 保留 `baseline`，但它不再是一个含糊的“初始状态”概念，而是 merge/apply 的锚点。

```ts
interface BaselineRef {
  id: string;
  isolation_mode: IsolationMode;
  workspace_ref: string;
  commit_ref?: string;
  captured_at: string;
}
```

规则：

- `shared_workspace` 下，baseline 表示 leader 当前工作区的基线快照或 HEAD commit
- `worktree` 下，baseline 表示该 worktree 创建时的父 commit / workspace anchor
- `remote_workspace` 下，baseline 表示远端工作区的快照引用
- baseline 的主要用途是 artifact apply、冲突检测、resume 后的安全校验
### 17.5 强约束例外

v9.1 保留一个极窄异常口：

```ts
type ExceptionalAction = {
  type: "escalate_step_execution_to_strong";
  reason: string;
  approved_by_budget_engine: boolean;
  audit_note: string;
};
```

这不是默认路径，只是为了防止极端复杂步骤卡死在无限重规划里。

---

## 18. Tool Execution 策略

从 `open-claude-code` 可借鉴的关键机制之一，是把工具调用分成：

- 可并发的只读类
- 必须串行的副作用类

v9.1 正式规定：

### 18.1 并发策略

- `read_only` 工具调用允许并发批量执行
- `mixed` 和 `side_effecting` 工具调用必须串行
- 任何会修改工作区、task 状态、artifact 状态的工具，不得并发执行

### 18.2 结果预算

- 单条 tool result 必须有大小上限
- 超出上限的内容写入 trace 或 artifact，不直接塞回 prompt
- `ContextManager` 可以对 tool result 做 budget trimming

### 18.3 工具分类

```ts
type ToolConcurrencyClass = "read_only" | "mixed" | "side_effecting";
```

Shell 类工具必须被 policy engine 进一步细分：

- 只读 shell
- 写文件 shell
- 危险 shell

---

## 19. ContextManager

### 19.1 问题定义

真实 CLI coding agent 不会一直安全地维护无限历史。  
因此 v9.1 把 `ContextManager` 升格为正式模块。

### 19.2 目标

在不破坏关键上下文的前提下，限制喂给模型的 prompt 长度，并保留可恢复性与可审计性。

### 19.3 管线

终态推荐管线：

```text
raw session history
  -> protected tail
  -> tool result budget trim
  -> snip / redact low-value history
  -> microcompact
  -> structured collapse / summary
  -> prompt assembly
```

### 19.4 MVP 最小实现

MVP 至少要做：

- worker 原始输出写 trace
- 返回给后续模型前先做结构化摘要
- 单次摘要长度上限
- 保留最近未压缩 tail
- 在 session store 中记录 compact boundary

### 19.5 上下文管理必须属于 Session Kernel

不允许把上下文裁剪逻辑散落在各 worker 内部。

---

## 20. Task Registry

`TaskRegistry` 是 teammates 终态的地基。

### 20.1 职责

- 存储 `PlanStep`
- 存储 `CollaborationTask`
- 存储 `ArtifactRef`
- 维护 owner / claim / status projection
- 生成 CLI 可视化数据

### 20.2 数据结构

```ts
interface TaskRegistrySnapshot {
  run_id: string;
  plan_version: number;
  steps: Record<string, StepRuntimeState>;
  collab_tasks: Record<string, CollaborationTask>;
  artifacts: Record<string, ArtifactRef>;
  task_claims: Record<string, TaskClaimState>;
}

interface StepRuntimeState {
  step_id: string;
  status: StepStatus;
  attempt: number;
  last_error?: string;
  produced_artifacts: string[];
}

interface TaskClaimState {
  task_id: string;
  owner_agent_id?: string;
  claimed_at?: string;
  last_result_artifact_ids: string[];
}
```

规则：

- `inline` step 不一定进入 `collab_tasks`
- 只有 materialized 的 delegated work 才进入 `task_claims`
- `TaskRegistrySnapshot` 是 projection，不是唯一真相；真相仍然来自事件流

---

## 21. 用户交互与审批模型

### 21.1 用户交互协议

```ts
type UserInteractionRequest = {
  id: string;
  kind:
    | "approval"
    | "clarification"
    | "scope_change"
    | "budget_gate"
    | "plan_revision";
  question: string;
  options?: string[];
  context?: string;
  timeout_policy: "wait" | "default_after_timeout";
  default_option?: string;
  source_approval_request_id?: string;
  correlation_id: string;
};

type UserInteractionResponse = {
  request_id: string;
  answer: string;
  answered_at: string;
  correlation_id: string;
};
```

### 21.2 审批闸门

以下场景必须进入审批：

- 初始计划批准
- `PlanRevision.approval_required === true`
- 预算跨越 `approval_threshold`
- 例外的强模型 step escalation
- teammate 结果要求合并入主工作区

### 21.3 teammate 内部审批

终态中：

- teammate 向 Leader 发 `approval_request`
- Leader 再决定是否向用户升级
- 用户不直接与所有 teammate 交互

### 21.4 approval 与用户交互的映射规则

v9.1 明确要求这两层协议闭环：

- `ApprovalRequest` 是 agent-to-agent 协议
- `UserInteractionRequest` 是 system-to-user 协议
- 当 Leader 需要把 teammate 请求升级给用户时，必须生成 `UserInteractionRequest`
- 升级后的 `UserInteractionRequest.source_approval_request_id` 必须指向原 `ApprovalRequest.id`
- 用户回复后，Leader 必须把结果翻译回 `ApprovalResponse`，并保留原 `correlation_id`

这意味着：

- user 不直接参与 broker mailbox
- teammate 也不直接等待用户 UI
- 整个审批链条必须可审计、可回放、可恢复

---

## 22. Budget 模型

### 22.1 BudgetPolicy

```ts
interface BudgetPolicy {
  task_budget_usd: number;
  step_budget_cap_usd: number;
  replan_budget_cap_usd: number;
  teammate_budget_cap_usd: number;
  approval_threshold_usd: number;
  hard_stop_threshold_usd: number;
}
```

### 22.2 规则

- 每次模型调用后扣减预算
- 每次 remote teammate 启动前预留预算
- 触及 `approval_threshold_usd` 时请求批准
- 触及 `hard_stop_threshold_usd` 时强制阻断

补充定义：

- `task_budget_usd` 是整个 run 的总预算上限
- `step_budget_cap_usd` 是单个 step 可归因的总花费上限
- `replan_budget_cap_usd` 是所有 planning / replanning 的累计上限
- `teammate_budget_cap_usd` 是单个 delegated `CollaborationTask` 子树的上限，不是整个 session 的共享池

```ts
interface BudgetLedgerEntry {
  entry_id: string;
  session_id: string;
  run_id: string;
  step_id?: string;
  collab_task_id?: string;
  agent_id?: string;
  kind: "model_call" | "tool_call" | "reservation" | "reservation_release";
  amount_usd: number;
  created_at: string;
}
```

归因规则：

- 所有花费都必须计入 `task_budget_usd`
- inline 执行产生的花费同时计入当前 `step_budget_cap_usd`
- delegated `CollaborationTask` 的花费同时计入父 step cap 与该 task 自己的 `teammate_budget_cap_usd`
- replan 花费除计入总预算外，还必须单独计入 `replan_budget_cap_usd`

### 22.3 预算不是注释，而是机制

Budget engine 必须产生正式事件：

- `budget_debited`
- `budget_threshold_reached`
- `budget_hard_stopped`

---

## 23. State Store 与恢复

### 23.1 最小持久化状态

```ts
interface SessionStateStoreRecord {
  session_id: string;
  session_status: SessionStatus;
  active_run_id?: string;
  run_ids: string[];
  compact_boundary_seq?: number;
  last_user_interaction_id?: string;
}

interface RunStateStoreRecord {
  session_id: string;
  run_id: string;
  run_status: RunStatus;
  plan_version: number;
  current_step_id?: string;
  current_step_attempt?: number;
  pending_user_request?: UserInteractionRequest;
  budget_snapshot: {
    spent_usd: number;
    remaining_usd: number;
  };
  baseline_ref?: BaselineRef["id"];
  active_task_ids: string[];
  last_event_seq: number;
}
```

### 23.2 恢复规则

- 重启后先恢复 `Session Kernel`
- 再恢复当前 `RunState`
- 再从 `events.ndjson` 重建 task/artifact projection
- 未 ack 的 broker message 重新投递
- 如果 `active_run_id` 指向未终态 run，必须优先恢复该 run
- 如果 baseline 校验失败，RunStatus 必须进入 `Recovering`，而不是盲目继续执行

### 23.3 优雅关闭

系统必须支持：

- `SIGINT`
- `SIGTERM`
- 当前 worker 中断
- session state 落盘
- 下次启动时 resume 或 cancel

---

## 24. 事件模型

### 24.1 Event Envelope

```ts
interface RuntimeEventEnvelope {
  event_id: string;
  seq: number;
  session_id: string;
  run_id: string;
  timestamp: string;
  actor: "kernel" | "leader" | "runtime" | "broker" | "teammate";
  plan_version?: number;
  step_id?: string;
  task_id?: string;
  attempt?: number;
  correlation_id?: string;
}
```

### 24.2 Event Payload

```ts
type RuntimeEvent =
  | (RuntimeEventEnvelope & { type: "run_planned"; summary: string })
  | (RuntimeEventEnvelope & { type: "approval_requested"; request: UserInteractionRequest })
  | (RuntimeEventEnvelope & { type: "broker_message_published"; message_id: string; message_type: BrokerMessage["type"] })
  | (RuntimeEventEnvelope & { type: "broker_message_delivered"; message_id: string; to_agent_id: string })
  | (RuntimeEventEnvelope & { type: "broker_message_acked"; agent_id: string; upto_seq: number })
  | (RuntimeEventEnvelope & { type: "budget_debited"; amount_usd: number })
  | (RuntimeEventEnvelope & { type: "budget_threshold_reached"; spent_usd: number })
  | (RuntimeEventEnvelope & { type: "budget_hard_stopped"; spent_usd: number })
  | (RuntimeEventEnvelope & { type: "step_started"; title: string })
  | (RuntimeEventEnvelope & { type: "step_execution_finished"; summary: string })
  | (RuntimeEventEnvelope & { type: "verification_observed"; summary: string })
  | (RuntimeEventEnvelope & { type: "verification_judged"; status: "pass" | "fail" })
  | (RuntimeEventEnvelope & { type: "plan_revised"; revision: PlanRevision })
  | (RuntimeEventEnvelope & { type: "collab_task_created"; task_id: string })
  | (RuntimeEventEnvelope & { type: "artifact_published"; artifact_id: string })
  | (RuntimeEventEnvelope & { type: "run_completed"; summary: string })
  | (RuntimeEventEnvelope & { type: "run_failed"; reason: string });
```

原则：

- 所有 CLI 输出都是事件的视图
- 所有 IM 输出未来也应是事件的视图

---

## 25. CLI 行为

CLI 不是一个临时壳，而是 Session Kernel 的正式前端。

### 25.1 MVP 必须提供

- 明确的计划展示
- 明确的当前 run 状态
- 明确的 step 状态
- 明确的失败原因
- 明确的审批暂停点
- 明确的 resume 能力

### 25.2 终态建议提供

- task panel
- artifact panel
- teammate inbox / approval 摘要
- budget 状态

---

## 26. MVP 范围

### 26.1 必做

- `Session Kernel`
- `Task Runtime`
- `Planner / Replanner / Executor / Verifier / Decision Engine`
- `VerifyObservation -> VerifyDecision` 的确定性判定
- `TaskRegistry`
- `EventStore`
- `RunStateStore`
- `BrokerPort`
- `FileSystemBroker` 最小实现
- `ContextManager` 最小实现
- `BudgetPolicy` 与 budget engine
- `PolicyEngine`
- 优雅关闭与 resume
- CLI 端到端运行
- broker idempotency / replay 测试
- inbox rebuild 测试
- active run resume 测试
- approval correlation 测试

### 26.2 协议预留但可不实现

- teammate spawning
- peer mailbox delivery
- leader-to-teammate approval forwarding
- remote teammate
- worktree orchestration

### 26.3 明确不做

- 完整 teammates UI
- remote execution fabric
- chat-to-im 宿主
- 多任务全局调度器
- 第三方平台完整兼容矩阵

---

## 27. 演进路线

### Phase 1: Leader-Only, Protocol-Ready MVP

交付：

- `Session Kernel`
- `Task Runtime`
- protocol-ready `BrokerPort`
- 单 run 串行执行
- 事件流、resume、budget、verification judgment

### Phase 2: Delegated Workers

交付：

- background agent/task 形态
- worktree isolation
- `CollaborationTask` 派发
- artifact-based 结果回交

### Phase 3: Full Teammates

交付：

- teammate mailbox
- task claim / ownership
- approval request / response
- leader 协调多个 teammate

### Phase 4: Remote and IM

交付：

- remote teammate runtime
- IM transport
- 同一事件与 broker 协议在多前端复用

---

## 28. 从 v9 到 v9.1 的明确变化

### 28.1 保留的内容

- Runtime 掌状态
- 强模型负责规划和正确性边界
- Executor / Verifier 单次调用
- 预算、baseline、安全、trace 必须确定性管理

### 28.2 明确替换的内容

- 把“纯双循环”升级为“Session Kernel + Orchestrator + Broker + Teammates”
- 把单一 `TaskStatus` 拆成分层状态模型
- 把 `Verifier` 的最终 verdict 权收回 Runtime
- 把 `replan_remaining` 升级为正式 `PlanRevision`
- 把“并行 step”升级为“CollaborationTask + BrokerProtocol”

### 28.3 新增但非 MVP 功能

- teammates 终态模型
- FileSystemBroker
- task ownership
- artifact-based collaboration
- mailbox / approval protocol

---

## 29. 开放问题

仍需验证的点：

1. `ContextManager` 的最小有效管线如何设计，才能既便宜又不丢关键上下文
2. `CollaborationTask` 从 `PlanStep` 派生的最佳粒度是什么
3. `FileSystemBroker` 的锁与吞吐策略如何选型，JSON 文件还是 SQLite
4. teammate 的默认隔离是否总是 `worktree`，还是允许受控共享工作区
5. budget 是否需要按模型类别、task 类别和 teammate 三级计费
6. 何时允许 `escalate_step_execution_to_strong`
7. `FileSystemBroker` 的 event log 与 inbox projection 是否需要最终迁移到 SQLite
8. 单 session 多历史 run 的 UX 是否足够清晰，还是应该更接近 Claude Code 的单 conversation 内核

---

## 30. 最终判断

v9.1 的核心主张是：

- **终态必须是 teammates 架构，而不只是双循环**
- **MVP 可以不实现 teammates，但必须先实现 teammates 所需的协议地基**
- **文件系统只能作为 broker transport，不能替代协作协议**
- **Session Kernel 必须是一级模块，不能继续把系统想成单一 Task Runtime**
- **协作结果必须通过 task、artifact、approval 和 event 来表达，而不是靠模糊共享上下文**

如果严格按这五条落地，MVP 就不会是一次性原型，而会是通向 teammate 终态的可靠基础。

---

## 附录 A：来自 Claude Code 的关键启发

以下结论来自对 `open-claude-code` 代码结构的工程性抽象，而不是逐字照搬实现。

1. 长寿命会话内核是第一等模块  
   `QueryEngine` 和 query loop 的存在说明，真正的 CLI agent 不是“做完一个 task 就结束”的短流程。

2. agent 形态至少有三种  
   `LocalAgentTask`、`InProcessTeammateTask`、`RemoteAgentTask` 表明多 agent 不能只抽象成“subagent”一个词。

3. agent profile 的关键是工具和权限边界  
   `Plan`、`Explore`、`verification` 等 built-in agents 的差异主要来自 tool policy 和 mode，不只是模型。

4. tool execution 需要并发分类  
   只读工具并发，副作用工具串行，是 CLI agent 真正可用的重要基础。

5. teammates 依赖 mailbox / task / approval 协议  
   自动消息投递、plan approval、idle 通知都依赖结构化协议，不是靠主 agent 猜。

6. context management 必须模块化  
   自动 compact、tool result budget、snip、collapse 这类设计说明长上下文管理不能随手拼。

7. isolation 是产品能力，不是实现细节  
   worktree 和 remote 都需要提前进入主规格，而不是后期附会。

---

## 附录 B：分析参考

- `https://github.com/xtherk/open-claude-code/blob/master/src/QueryEngine.ts`
- `https://github.com/xtherk/open-claude-code/blob/master/src/query.ts`
- `https://github.com/xtherk/open-claude-code/blob/master/src/services/tools/toolOrchestration.ts`
- `https://github.com/xtherk/open-claude-code/blob/master/src/tools/AgentTool/AgentTool.tsx`
- `https://github.com/xtherk/open-claude-code/blob/master/src/tools/AgentTool/built-in/planAgent.ts`
- `https://github.com/xtherk/open-claude-code/blob/master/src/tools/AgentTool/built-in/verificationAgent.ts`
- `https://github.com/xtherk/open-claude-code/blob/master/src/hooks/useInboxPoller.ts`
- `https://github.com/xtherk/open-claude-code/blob/master/src/tools/TeamCreateTool/prompt.ts`

---

## 附录 C：Review 建议（Claude Opus 4.6, 2026-04-01）

### 结构 / 架构

**C.1 缺少错误分类体系**

`RecoveryAction` 已定义，但规格从未对错误本身做分类。瞬态工具超时、模型拒绝、预算耗尽、git 冲突是本质不同的失败模式。建议增加 `ErrorClassification`（`transient` / `permanent` / `resource` / `conflict` / `model_refusal`），让 Runtime 能确定性地选择恢复策略，而不是每次都让模型来决定。

**C.2 取消传播未定义**

多个枚举中存在 `Cancelled` 状态，但规格从未描述取消如何级联传播。Run 被取消时，其 Step、CollaborationTask、ApprovalRequest 各自如何处理？需要明确一条取消级联规则。

**C.3 `RunStatus` 缺少 `Paused` 状态**

用户若想临时挂起某个 Run（如手动排查问题或切换任务），目前只能滥用 `AwaitingUser`。建议增加 `Paused` 状态，配套 `pause()` / `resume()` 语义，与"等待用户输入"明确分开。

**C.4 无超时 / 截止时间模型**

`PlanStep`、`CollaborationTask`、`ApprovalRequest` 均无超时字段。工具调用卡死或 teammate 无响应会阻塞整个 Run。建议在 `PlanStep` 和 `CollaborationTask` 上增加 `timeout_ms`，在 `ApprovalRequest` 上增加 `deadline`。

**C.5 `PermissionMode.bypass` 语义未定义**

它作为合法枚举值存在，但没有任何关于何时可用、谁能设置、有何防护的说明。要么补充定义，要么从枚举中移除。

### 数据模型

**C.6 `PlanStep.type` 类型偏窄**

缺少实际编码任务中常见的类型：`"deploy"`、`"migrate"`、`"document"`、`"review"`。建议增补，或提供扩展机制。

**C.7 `VerifyDecision` 不处理不稳定 / 不确定结果**

二值 `pass/fail` 和简单计数无法表达测试不稳定（3 次中通过 2 次）或验证器自身出错的情况。建议增加 `"inconclusive"` 状态和 `errors` 字段。

**C.8 `ArtifactRef.kind` 扩展性不足**

固定联合类型每次新增产物类型都需要修改规格。建议考虑增加 `custom` kind 配合 `custom_type: string` 字段。

**C.9 `TaskGraph.steps` 数组顺序语义未定义**

规格使用 `dependencies: string[]` 但未说明 `steps` 数组顺序是否有语义。建议明确：步骤数组顺序无意义，执行顺序完全由依赖图和就绪状态决定。

### 协议 / 恢复

**C.10 审批超时行为定义不完整**

`UserInteractionRequest.timeout_policy` 有 `"default_after_timeout"` 选项，但没有 `timeout_ms` 字段。多长时间后触发默认值？需要明确配置项或具体数值。

**C.11 无协议版本号**

broker 消息格式或事件格式跨版本变化时，回放或 resume 时无法检测不兼容性。建议在 event store 头部加入 `protocol_version` 字段。

**C.12 文件追加并发安全语义模糊**

Section 15.4 提到"使用 file lock"但未指定锁机制（`flock`、lockfile、advisory lock）。Leader 与 inline worker 可能在 `events.ndjson` 上产生竞争，MVP 中需要明确使用何种具体机制。

### 可运维性

**C.13 无可观测性 / 指标接口**

事件模型已经很丰富，但没有提到如何提取运营指标（步骤耗时、模型延迟、预算消耗速率、重试频率）。建议在 `StatusSink` 旁定义一个 `MetricsSink` 端口。

**C.14 无日志 / trace 保留策略**

`.harness/` 目录会随 session 累积无限增长。即便 MVP 只做文档说明，也应定义一条保留或轮转策略。

**C.15 `ContextManager` 管线缺少触发条件**

Section 19.3 列出了管线各阶段，但未定义触发时机：多少 token 触发压缩？如何判定"低价值历史"？MVP 至少需要粗略的启发式规则文档。

### 表述

**C.16 规格与设计理由混写**

Section 1、28、30、附录 A 是动机性 / 历史性内容。建议将其移入独立的"设计理由"附录，让核心规格可以作为纯粹的实现参考文档使用。

**C.17 缺少 Happy Path 时序图**

一张端到端的时序图（用户输入 → Kernel → Leader 规划 → Runtime 执行步骤 → Verification → 完成）会让模块间交互远比静态架构图更直观。

**C.18 开放问题 #8 应升级为决策**

"单 session 多历史 Run"与"单对话内核"是影响 Session Kernel、CLI UX 和 state store 设计的架构分叉。这个问题应在实现前明确决策，而不是继续保留为开放问题。

