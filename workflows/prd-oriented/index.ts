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
    "PRD → TDD → structure outline → implement-outline. Research and detailed plan are optional. Outline/implement use Luna medium with fresh bounded passes.",
  inputs: {
    task: Type.String({
      description: "Task description or path to the task context.",
    }),
    include_research: Type.Boolean({
      default: false,
      description:
        "When true, run create-research-questions + create-research before the PRD. Default false (skip for small tasks).",
    }),
    detailed_plan: Type.Boolean({
      default: false,
      description:
        "When true, after the outline run create-plan + implement-plan (big features). Default false uses implement-outline.",
    }),
  },
  outputs: {
    status: Type.Union([Type.Literal("completed"), Type.Literal("blocked")]),
    completed_stages: Type.Array(Type.String()),
  },
  run: async (ctx) => {
    const host = createHost(ctx);

    await maybeRunResearch(host);

    await runSkillOnce(
      host,
      "create-prd",
      "product requirements document",
      host.includeResearch
        ? "Create the product requirements document from the task and current research. Stay in product space: define the problem, success measure, user-visible behavior, and approved solution while leaving technical implementation for the TDD."
        : "Research was skipped for this run. Create the product requirements document from the task text (and any named inputs). Stay in product space: define the problem, success measure, user-visible behavior, and approved solution while leaving technical implementation for the TDD. Do not invent a research document.",
    );

    await runSkillOnce(
      host,
      "create-technical-design",
      "technical design",
      "Create the technical design in its two guided phases: System Design and Program Design. Resolve and obtain user approval for both phases before treating the design as ready for outlining.",
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
      "Create an approved vertical implementation outline from the PRD and technical design (and research if present). Include per-phase files, tests, checks, and explicit test modes. Do not implement code. Default next path is implement-outline unless detailed_plan was requested.",
      { model: LUNA_MEDIUM },
    );

    await runPostOutlineDelivery(host, "PRD-Oriented");

    return {
      status: "completed" as const,
      completed_stages: host.completedStages,
    };
  },
});
