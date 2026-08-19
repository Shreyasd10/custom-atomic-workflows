import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkflowRunContext, WorkflowTaskOptions, WorkflowTaskResult } from "@bastani/workflows";
import { Type, type Static, type TSchema } from "typebox";

/** Luna context window is 272k; keep each pass under ~50%. */
export const STAGE_CONTEXT_WINDOW = 136_000;

/** Outline + implementation stages pin to Luna medium. */
export const LUNA_MEDIUM = "openai-codex/gpt-5.6-luna:medium";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const skillPath = (name: string) => resolve(packageRoot, "workflow-skills", name, "SKILL.md");
export const agentPath = (name: string) => resolve(packageRoot, "workflow-agents", name);
export const templateRoot = resolve(packageRoot, "workflow-templates");
export const agentRoot = resolve(packageRoot, "workflow-agents");

const passDir = (cwd: string) => resolve(cwd, "docs", ".workflow-passes");

const SPEED_CONTEXT_POLICY = [
  "Workflow speed/context policy for this pass (does not replace or weaken the skill):",
  "- Prefer at most 2 concurrent subagents in this pass.",
  "- Prefer targeted reads over exhaustive dumps once this pass's step range is satisfied.",
  "- Persist durable progress only to the assigned output path(s), then stop.",
  "- Do not start later skill steps reserved for subsequent passes.",
].join("\n");

export type WorkflowOutputs = {
  status: "completed" | "blocked";
  completed_stages: string[];
  reason?: string;
};

export type IterationContextMode = "fresh" | "fork";

export type WorkflowInputs = {
  task: string;
  include_research?: boolean;
  detailed_plan?: boolean;
  iteration_context?: IterationContextMode;
};

export type SkillPassHost = {
  cwd: string;
  task: string;
  includeResearch: boolean;
  detailedPlan: boolean;
  iterationContext: IterationContextMode;
  completedStages: string[];
  ctx: WorkflowRunContext<WorkflowInputs, WorkflowOutputs>;
};

export function createHost(
  ctx: WorkflowRunContext<WorkflowInputs, WorkflowOutputs>,
): SkillPassHost {
  return {
    cwd: ctx.cwd ?? process.cwd(),
    task: String(ctx.inputs.task),
    includeResearch: ctx.inputs.include_research === true,
    detailedPlan: ctx.inputs.detailed_plan === true,
    iterationContext: ctx.inputs.iteration_context === "fork" ? "fork" : "fresh",
    completedStages: [],
    ctx,
  };
}

const INTERVIEW_SKILLS = new Set(["create-prd", "create-technical-design"]);

function interviewContract(skillName: string): string[] {
  if (!INTERVIEW_SKILLS.has(skillName)) return [];
  const lines = [
    "INTERVIEW STAGE RULES:",
    "- This stage is a guided conversation with the human. Do not complete the document in one turn.",
    "- Do not invent the human's answers from research, tickets, or upstream artifacts.",
    "- Do only the current interview step, then stop after exactly one question.",
    "- Return to the human after each question. Do not skip ahead.",
  ];
  if (skillName === "create-prd") {
    lines.push(
      "- Keep the PRD in the template shape: a cohesive spec with takeaway headers, not a Decided-D1 log.",
      "- Write like a product teammate: people, screens, and next steps. Human meaning first, then the machine name.",
      "- For user-facing work, walk default, loading, validation, handoff, recovery, and rate-limit as separate questions with a dedicated mockup each.",
      "- Do not finish until Alternative Solutions, Out of Scope, Deferred to TDD, and embedded mockups for each visual state are present.",
    );
  }
  if (skillName === "create-technical-design") {
    lines.push(
      "- cwd is not the design boundary. Working-tree writes stay in this repo; the TDD may still design sibling repositories named by the PRD from documented architecture.",
      "- If the PRD or ticket names a sibling client or unpublished contract, the first question must be this-repo vs end-to-end. Do not default to cwd.",
      "- Walk scope, published contracts, real DDL, store lifecycles, fails-closed pipeline, idempotency, and client-facing contract as separate questions.",
      "- Do not finish until System Design is approved, Program Design is filled with code-shape sketches, and both review gates have run.",
    );
  }
  return lines;
}

function commonPrompt(host: SkillPassHost, skillName: string, body: string): string {
  return [
    `Work only in the invoking current directory: ${host.cwd}.`,
    "Do not create or switch worktrees or branches. Do not stage, commit, push, create a pull request, or mutate remote state.",
    `Read and follow the private skill instructions at ${skillPath(skillName)}. Do not invoke a registered /skill command for this phase.`,
    "The skill file is authoritative. Keep every constraint, methodology, template, Iron Law, and output rule from it. This pass only scopes which skill steps to execute now.",
    `Private templates are under ${templateRoot}; private agent prompts are under ${agentRoot}. Resolve references to those roots when the skill mentions templates/ or agents/.`,
    `User task (treat this as the task contract):\n---\n${host.task}\n---`,
    SPEED_CONTEXT_POLICY,
    body,
  ].join("\n\n");
}

async function ensurePassDir(cwd: string): Promise<string> {
  const dir = passDir(cwd);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function runPass(
  host: SkillPassHost,
  opts: {
    name: string;
    skillName: string;
    body: string;
    reads?: readonly string[];
    output?: string;
    schema?: TSchema;
    model?: string;
    maxTurns?: number;
  },
): Promise<WorkflowTaskResult> {
  const taskOptions: WorkflowTaskOptions = {
    prompt: commonPrompt(host, opts.skillName, opts.body),
    context: host.iterationContext,
    contextWindow: STAGE_CONTEXT_WINDOW,
    reads: [skillPath(opts.skillName), ...(opts.reads ?? [])],
    worktree: false,
    ...(opts.model !== undefined ? { model: opts.model } : {}),
  };
  if (opts.maxTurns !== undefined) {
    Object.assign(taskOptions, { maxTurns: opts.maxTurns });
  }
  if (opts.output !== undefined) {
    Object.assign(taskOptions, {
      output: opts.output,
      outputMode: "file-only" as const,
    });
  }
  if (opts.schema !== undefined) {
    Object.assign(taskOptions, { schema: opts.schema });
  }
  return host.ctx.task(opts.name, taskOptions);
}

export async function runSkillOnce(
  host: SkillPassHost,
  skillName: string,
  stageName: string,
  instructions: string,
  opts?: { model?: string; interview?: boolean; maxTurns?: number },
): Promise<void> {
  const interview = opts?.interview === true || INTERVIEW_SKILLS.has(skillName);
  await runPass(host, {
    name: stageName,
    skillName,
    model: opts?.model,
    maxTurns: opts?.maxTurns,
    body: [
      instructions,
      ...(interview ? interviewContract(skillName) : []),
      interview
        ? "Stay in this phase until the human has settled the interview and the skill's review gate is ready. Inspect artifacts already present in the current directory, write the phase artifacts required by the skill, and report the paths and validation performed."
        : "Complete this phase only. Inspect artifacts already present in the current directory, write the phase artifacts required by the skill, and report the paths and validation performed.",
    ].join("\n\n"),
  });
  host.completedStages.push(skillName);
}

export async function checkpoint(
  host: SkillPassHost,
  message: string,
): Promise<void> {
  if (!(await host.ctx.ui.confirm(message))) {
    return host.ctx.exit({
      status: "blocked",
      reason: message,
      outputs: {
        status: "blocked",
        completed_stages: host.completedStages,
        reason: message,
      },
    });
  }
}

/** Optional research path: questions then locate→analyze→write research. */
export async function maybeRunResearch(host: SkillPassHost): Promise<void> {
  if (!host.includeResearch) return;

  await runSkillOnce(
    host,
    "create-research-questions",
    "create research questions",
    "Turn the task into focused questions about how the current codebase works. If the task is not a file path, use the supplied task text directly as the source request. Keep this phase descriptive, not normative.",
  );
  await runResearchPasses(host);
}

/** create-research: locate → analyze → write (full skill kept via reads). */
export async function runResearchPasses(host: SkillPassHost): Promise<void> {
  const dir = await ensurePassDir(host.cwd);
  const locatePath = resolve(dir, "research-locate.md");
  const analyzePath = resolve(dir, "research-analyze.md");

  await runPass(host, {
    name: "research:locate",
    skillName: "create-research",
    output: locatePath,
    body: [
      "Answer the research-questions artifact using the live codebase and tests. Document current behavior and evidence only; do not propose implementation changes.",
      "Pass scope — execute ONLY these skill sections now:",
      "- Initial Setup (find and read research-questions; do not wait interactively if the artifact already exists — proceed).",
      "- Steps 1–2 (read mentioned files; analyze and decompose).",
      "- Step 3 locator portion only: spawn codebase-locator (and related locate-style agents) to find WHERE relevant files/components live.",
      "Do NOT run analyzer/pattern/web deep dives, do NOT write the final docs/research/*.md document, and do NOT run the final-answer template yet.",
      `Write a durable locate artifact to ${locatePath} covering: research questions summary, research plan/subtasks, locator findings with concrete paths, and what analyze should dig into next.`,
    ].join("\n"),
  });

  await runPass(host, {
    name: "research:analyze",
    skillName: "create-research",
    reads: [locatePath],
    output: analyzePath,
    body: [
      "Continue the create-research skill without redoing completed locate work.",
      "Pass scope — execute ONLY:",
      "- Step 3 analyzer / pattern-finder / web-or-library research portions against the locate findings.",
      "- Step 4 synthesis of sub-agent findings into a durable analysis artifact (not the final research doc yet).",
      `Read ${locatePath} first and treat it as the prior pass handoff.`,
      `Write synthesis to ${analyzePath}: how things work, file:line evidence, cross-component connections, unanswered questions for the write pass.`,
      "Do NOT write the final docs/research/*.md document or final-answer template yet.",
    ].join("\n"),
  });

  await runPass(host, {
    name: "research:write",
    skillName: "create-research",
    reads: [locatePath, analyzePath],
    body: [
      "Continue the create-research skill and finish the research document.",
      "Pass scope — execute skill steps 5–9 (metadata, generate research document from template, attempt open questions with at most one extra subagent pass, respond via final-answer template).",
      `Read ${locatePath} and ${analyzePath} as prior-pass evidence. Prefer them over re-deriving locate/analyze from scratch; re-verify in the live codebase only when needed for accuracy.`,
      "Write the final research document under docs/research/ per the skill. Update open questions in place as the skill requires.",
      "Follow-up interactive questions (skill step 10) are out of scope for this workflow pass unless the user is actively answering in-session.",
    ].join("\n"),
  });

  host.completedStages.push("create-research");
}

/** create-plan: locate → analyze → write (full skill kept via reads). Luna medium. */
export async function runCreatePlanPasses(host: SkillPassHost): Promise<void> {
  const dir = await ensurePassDir(host.cwd);
  const locatePath = resolve(dir, "plan-locate.md");
  const analyzePath = resolve(dir, "plan-analyze.md");

  await runPass(host, {
    name: "plan:locate",
    skillName: "create-plan",
    model: LUNA_MEDIUM,
    maxTurns: 48,
    output: locatePath,
    body: [
      "Convert the approved structure outline into exact code-level implementation steps. Do not implement code yet.",
      "Pass scope — execute ONLY skill step 1 (read all input files fully; inventory related docs under docs/plans/ and task artifacts; exclude research-questions).",
      `Write a locate handoff to ${locatePath}: list of files read, outline/design/research paths, phase inventory from the structure outline, and conflicts/precedence notes.`,
      "Do NOT read large source trees yet beyond what step 1 requires. Do NOT write the final plan document yet.",
    ].join("\n"),
  });

  await runPass(host, {
    name: "plan:analyze",
    skillName: "create-plan",
    model: LUNA_MEDIUM,
    maxTurns: 48,
    reads: [locatePath],
    output: analyzePath,
    body: [
      "Continue create-plan without redoing step 1.",
      "Pass scope — execute ONLY skill step 2 (read relevant source files mentioned in research/design/structure; build context for concrete code examples).",
      `Read ${locatePath} first.`,
      `Write analysis notes to ${analyzePath}: key APIs/types/tests to touch, snippet targets per outline phase, testing patterns to follow, Iron Law test-mode hints observed.`,
      "Do NOT write the final docs/plans/* plan document yet.",
    ].join("\n"),
  });

  await runPass(host, {
    name: "plan:write",
    skillName: "create-plan",
    model: LUNA_MEDIUM,
    maxTurns: 48,
    reads: [locatePath, analyzePath],
    body: [
      "Finish create-plan.",
      "Pass scope — execute skill steps 3–4 and Output/Iron Law/Git policy sections: read plan template, write the detailed implementation plan under docs/plans/, apply plan-writing guidelines and validation design, then use the final output template.",
      `Read ${locatePath} and ${analyzePath} as prior-pass context.`,
      "Include RED/GREEN test modes, failure maps, automated checks, and manual checks. Do not implement code.",
    ].join("\n"),
  });

  host.completedStages.push("create-plan");
}

const phaseBootstrapSchema = Type.Object(
  {
    source_path: Type.String({
      description: "Absolute or cwd-relative path to the outline or plan file.",
    }),
    phases: Type.Array(
      Type.Object({
        id: Type.String({ description: "Stable phase id, e.g. phase-1." }),
        title: Type.String({ description: "Phase title from the source artifact." }),
        index: Type.Number({ description: "1-based phase index." }),
      }),
      { minItems: 1 },
    ),
    resume_notes: Type.String({
      description: "Notes about already-checked items or resume point; empty string if starting clean.",
    }),
  },
  { additionalProperties: false },
);

type PhaseBootstrap = Static<typeof phaseBootstrapSchema>;

const implementTurnSchema = Type.Object(
  {
    phase_id: Type.String(),
    status: Type.Union([
      Type.Literal("completed"),
      Type.Literal("blocked"),
      Type.Literal("needs_human"),
    ]),
    summary: Type.String(),
    manual_verification: Type.Array(Type.String()),
    remaining_work: Type.String(),
  },
  { additionalProperties: false },
);

async function runPhasedImplementation(
  host: SkillPassHost,
  opts: {
    skillName: "implement-outline" | "implement-plan";
    stagePrefix: string;
    sourceKind: "outline" | "plan";
    sourceHint: string;
    bootstrapBody: string;
    finalizeBody: string;
    completedLabel: string;
  },
): Promise<void> {
  const dir = await ensurePassDir(host.cwd);
  const ledgerPath = resolve(dir, `${opts.stagePrefix}-ledger.json`);
  const implementer = agentPath("implementer.md");

  const bootstrap = await runPass(host, {
    name: `${opts.stagePrefix}:bootstrap`,
    skillName: opts.skillName,
    model: LUNA_MEDIUM,
    maxTurns: 64,
    output: ledgerPath,
    schema: phaseBootstrapSchema,
    body: [
      opts.bootstrapBody,
      `Use the private implementer contract at ${implementer} when dispatching a specialist; if unavailable, use an available subagent or execute inline. Keep Git/GitHub user-owned.`,
      "Pass scope — discovery only:",
      `- Find the ${opts.sourceKind} path (${opts.sourceHint}).`,
      `- Read it enough to list phases and any already-completed markers.`,
      "- Do NOT launch implementer agents or change code in this pass.",
      `Write structured bootstrap output (schema) and persist the same JSON to ${ledgerPath}.`,
      "phases must cover every implementation phase in order. resume_notes must mention the first incomplete item if resuming.",
      "Set source_path to the discovered outline/plan file path.",
    ].join("\n"),
  });

  const ledger = bootstrap.structured as PhaseBootstrap | undefined;
  if (ledger === undefined || !Array.isArray(ledger.phases) || ledger.phases.length === 0) {
    throw new Error(`${opts.stagePrefix}:bootstrap did not return a valid phase ledger`);
  }

  const sorted = [...ledger.phases].sort((a, b) => a.index - b.index);

  for (const phase of sorted) {
    const receiptPath = resolve(dir, `${opts.stagePrefix}-${phase.id}.md`);

    await runPass(host, {
      name: `${opts.stagePrefix}:${phase.id}`,
      skillName: opts.skillName,
      model: LUNA_MEDIUM,
      maxTurns: 64,
      reads: [ledger.source_path, ledgerPath],
      output: receiptPath,
      schema: implementTurnSchema,
      body: [
        `Continue ${opts.skillName} for a single phase. Source path: ${ledger.source_path}.`,
        `Resume notes from bootstrap: ${ledger.resume_notes || "(none)"}`,
        `Pass scope — execute the skill workflow ONLY for phase "${phase.title}" (${phase.id}, index ${phase.index}):`,
        "- Launch implementer agent (or inline equivalent) for this phase only.",
        "- Review output, run automated checks, prepare the human summary.",
        "- Enforce the TDD Iron Law from the skill.",
        `- Use implementer contract at ${implementer} when dispatching a specialist.`,
        "Do NOT implement later phases in this pass.",
        "Do NOT create or invoke create-plan / implement-plan when running implement-outline.",
        `Write a phase receipt to ${receiptPath} and return structured status via the schema.`,
        "Suggest a user-owned commit boundary; do not run git mutations.",
      ].join("\n"),
    });

    await checkpoint(
      host,
      `Implement checkpoint: review phase "${phase.title}" (${phase.id}). Confirm manual verification passed before the next phase.`,
    );
  }

  await runPass(host, {
    name: `${opts.stagePrefix}:finalize`,
    skillName: opts.skillName,
    model: LUNA_MEDIUM,
    maxTurns: 64,
    reads: [
      ledger.source_path,
      ledgerPath,
      ...sorted.map((p) => resolve(dir, `${opts.stagePrefix}-${p.id}.md`)),
    ],
    body: [
      "All phase turns have completed with human confirmation.",
      opts.finalizeBody,
      `Source path: ${ledger.source_path}. Prior phase receipts are under ${dir}.`,
    ].join("\n"),
  });

  host.completedStages.push(opts.completedLabel);
}

/** Default path: implement from structure outline, phase by phase, Luna medium. */
export async function runImplementOutlineTurns(host: SkillPassHost): Promise<void> {
  await runPhasedImplementation(host, {
    skillName: "implement-outline",
    stagePrefix: "outline-impl",
    sourceKind: "outline",
    sourceHint: "under docs/outlines/, matching *-structure-outline*.md",
    bootstrapBody:
      "Locate the approved structure outline under docs/outlines/ and prepare phased implementation. Never create or call create-plan / implement-plan.",
    finalizeBody: [
      "Pass scope — execute skill After Final Phase Completion (or equivalent final reporting) only:",
      "- Suggest a final user-owned commit boundary (no git mutations).",
      "- Read references/implement_outline_final_answer.md if present and respond following that template; otherwise summarize completion briefly.",
    ].join("\n"),
    completedLabel: "implement-outline",
  });
}

/** Optional big-feature path: implement from detailed plan, Luna medium. */
export async function runImplementPlanTurns(host: SkillPassHost): Promise<void> {
  await runPhasedImplementation(host, {
    skillName: "implement-plan",
    stagePrefix: "plan-impl",
    sourceKind: "plan",
    sourceHint: "under docs/plans/, matching *-plan*.md",
    bootstrapBody:
      "Locate the approved detailed plan under docs/plans/ and prepare phased implementation.",
    finalizeBody: [
      "Pass scope — execute skill section After Final Phase Completion only:",
      "- Suggest a final user-owned commit boundary (no git mutations).",
      "- Read references/implement_plan_final_answer.md and respond following that template exactly.",
    ].join("\n"),
    completedLabel: "implement-plan",
  });
}

/** After outline approval: default implement-outline, or optional detailed-plan path. */
export async function runPostOutlineDelivery(host: SkillPassHost, workflowLabel: string): Promise<void> {
  if (host.detailedPlan) {
    await checkpoint(
      host,
      `${workflowLabel} checkpoint: review and approve the structure outline before creating the detailed implementation plan (big-feature path).`,
    );
    await runCreatePlanPasses(host);
    await checkpoint(
      host,
      `${workflowLabel} checkpoint: review and approve the detailed implementation plan before implementation begins.`,
    );
    await runImplementPlanTurns(host);
    return;
  }

  await checkpoint(
    host,
    `${workflowLabel} checkpoint: review and approve the structure outline before implementation (default implement-outline path).`,
  );
  await runImplementOutlineTurns(host);
}
