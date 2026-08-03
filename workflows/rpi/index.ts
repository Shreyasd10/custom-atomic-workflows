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
  name: "RPI",
  description:
    "Design discussion → structure outline → implement-outline. Research and detailed plan are optional inputs for larger work. Outline/implement use Luna medium with fresh bounded passes.",
  inputs: {
    task: Type.String({
      description: "Task description or path to the task context.",
    }),
    include_research: Type.Boolean({
      default: false,
      description:
        "When true, run create-research-questions + create-research before design. Default false (skip for small tasks).",
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
      "create-design-discussion",
      "design discussion",
      host.includeResearch
        ? "Use the research findings to create the design discussion. Present options and recommendations, but leave design questions open until the user resolves them through the skill's guided conversation."
        : "Research was skipped for this run. Use the task text and light live-codebase checks to create the design discussion. Present options and recommendations, but leave design questions open until the user resolves them through the skill's guided conversation. Do not invent a research document.",
    );

    await checkpoint(
      host,
      host.includeResearch
        ? "RPI checkpoint: review and approve the research and design artifacts before creating the structure outline."
        : "RPI checkpoint: review and approve the design discussion before creating the structure outline.",
    );

    await runSkillOnce(
      host,
      "create-structure-outline",
      "structure outline",
      "Create an approved vertical implementation outline from the resolved design decisions (and research if present). Include per-phase files, tests, checks, and explicit test modes. Do not implement code. Default next path is implement-outline unless detailed_plan was requested.",
      { model: LUNA_MEDIUM },
    );

    await runPostOutlineDelivery(host, "RPI");

    return {
      status: "completed" as const,
      completed_stages: host.completedStages,
    };
  },
});
