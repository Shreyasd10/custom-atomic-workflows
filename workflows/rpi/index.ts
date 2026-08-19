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
    "First-class research/design/outline/implementation workflow with verbatim skill contracts, human review gates, and bounded fresh-session handoffs.",
  inputs: {
    task: Type.String({
      description: "Task description or path to the task context.",
    }),
    include_research: Type.Boolean({
      default: false,
      description: "Run research questions and research before design.",
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
      "create-design-discussion",
      "design discussion",
      host.includeResearch
        ? "Run the complete design discussion from the research findings. Resolve every design question with the human, and produce the final approved design artifact. Present options and recommendations, but leave design questions open until the user resolves them through the skill's guided conversation."
        : "Research was skipped for this run. Run the complete design discussion from the task text and light live-codebase checks. Resolve every design question with the human, and produce the final approved design artifact. Do not invent a research document.",
      { maxTurns: 64 },
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
      "Create and fully resolve the vertical implementation outline from the resolved design decisions (and research if present). Include per-phase files, tests, checks, and explicit test modes. Do not implement code. Default next path is implement-outline unless detailed_plan was requested.",
      { model: LUNA_MEDIUM, maxTurns: 48 },
    );

    await runPostOutlineDelivery(host, "RPI");

    return {
      status: "completed" as const,
      completed_stages: host.completedStages,
    };
  },
});
