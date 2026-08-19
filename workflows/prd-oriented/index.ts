import { workflow } from "@bastani/workflows";
import { Type } from "typebox";
import {
  LUNA_MEDIUM,
  checkpoint,
  createHost,
  maybeRunResearch,
  runPostOutlineDelivery,
  runSkillOnce,
} from "../shared/skill-passes.js";

export default workflow({
  name: "PRD-Oriented",
  description:
    "First-class PRD/technical-design/outline/implementation workflow with verbatim skill contracts, human review gates, and bounded fresh-session handoffs.",
  inputs: {
    task: Type.String({
      description: "Task description or path to the task context.",
    }),
    include_research: Type.Boolean({
      default: false,
      description: "Run research questions and research before the PRD.",
    }),
    detailed_plan: Type.Boolean({
      default: false,
      description: "Use create-plan and implement-plan after the outline.",
    }),
    iteration_context: Type.Optional(
      Type.Union([Type.Literal("fresh"), Type.Literal("fork")], {
        description:
          'Default "fresh" starts each human turn in a clean session grounded by validated bounded handoffs. "fork" preserves the matching logical-stage transcript as a transitional rollback.',
      }),
    ),
  },
  outputs: {
    status: Type.Union([Type.Literal("completed"), Type.Literal("blocked")]),
    completed_stages: Type.Array(Type.String()),
    reason: Type.Optional(Type.String()),
  },
  run: async (ctx) => {
    const host = createHost(ctx);

    await maybeRunResearch(host);

    await runSkillOnce(
      host,
      "create-prd",
      "product requirements",
      host.includeResearch
        ? "Run the complete guided PRD interview from the task and current research. Settle the foundation and solution one decision at a time, and produce the approved PRD artifact. Stay in product space: define the problem, success measure, user-visible behavior, and approved solution while leaving technical implementation for the TDD."
        : "Research was skipped for this run. Run the complete guided PRD interview from the task text (and any named inputs). Settle the foundation and solution one decision at a time, and produce the approved PRD artifact. Do not invent a research document.",
      { interview: true, maxTurns: 64 },
    );

    await runSkillOnce(
      host,
      "create-technical-design",
      "technical design",
      "Run the complete System Design and Program Design interviews. Require an internal human approval gate after System Design before opening Program Design. Resolve and obtain user approval for both phases before treating the design as ready for outlining.",
      { interview: true, maxTurns: 96 },
    );

    await checkpoint(
      host,
      host.includeResearch
        ? "PRD-Oriented checkpoint: review and approve the research, PRD, and technical design artifacts before creating the structure outline."
        : "PRD-Oriented checkpoint: review and approve the PRD and technical design artifacts before creating the structure outline.",
    );

    await runSkillOnce(
      host,
      "create-structure-outline",
      "structure outline",
      "Create and fully resolve the vertical implementation outline from the PRD and technical design (and research if present). Include per-phase files, tests, checks, and explicit test modes. Do not implement code. Default next path is implement-outline unless detailed_plan was requested.",
      { model: LUNA_MEDIUM, maxTurns: 48 },
    );

    await runPostOutlineDelivery(host, "PRD-Oriented");

    return {
      status: "completed" as const,
      completed_stages: host.completedStages,
    };
  },
});
