# custom-atomic-workflows

Installable Atomic workflows for HumanLayer-inspired software delivery.

## Install

Install globally:

```bash
atomic install git:github.com/<OWNER>/custom-atomic-workflows
```

Or install for one project:

```bash
atomic install git:github.com/<OWNER>/custom-atomic-workflows -l
```

After installation, inspect and run the workflows:

```text
/workflow list
/workflow inputs rpi
/workflow rpi task="Implement the requested change"
/workflow rpi task="..." include_research=true
/workflow rpi task="..." detailed_plan=true
/workflow prd-oriented task="Design and implement the requested product change"
/workflow prd-oriented task="..." include_research=true
/workflow rpi task="..." iteration_context=fork
```

## Workflows

### RPI (default)

```text
(optional research questions → research)   # include_research=true
→ create-design-discussion
→ approval checkpoint
→ create-structure-outline                 # Luna medium
→ approval checkpoint
→ implement-outline (per-phase turns)      # Luna medium
```

### PRD-Oriented (default)

```text
(optional research questions → research)   # include_research=true
→ create-prd (guided interview)
→ create-technical-design (System Design gate, then Program Design)
→ approval checkpoint
→ create-structure-outline                 # Luna medium
→ approval checkpoint
→ implement-outline (per-phase turns)      # Luna medium
```

### Optional detailed-plan path (big features)

Set `detailed_plan=true` on either workflow:

```text
… → create-structure-outline
→ create-plan (locate → analyze → write)   # Luna medium
→ implement-plan (per-phase turns)         # Luna medium
```

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `task` | required | Task text or path |
| `include_research` | `false` | Run research questions + research (skip for small tasks) |
| `detailed_plan` | `false` | Use create-plan + implement-plan instead of implement-outline |
| `iteration_context` | `fresh` | `fresh` starts each turn in a clean session. `fork` keeps the matching stage transcript as a rollback |

## Context-bounded passes

Heavy stages use `ctx.task` passes (`context` follows `iteration_context`, default `"fresh"`, `contextWindow: 136000` ≈ half of Luna's 272k window):

- **create-research** (when enabled): locate → analyze → write
- **create-plan** (when `detailed_plan`): locate → analyze → write
- **implement-outline** / **implement-plan**: bootstrap → one fresh turn per phase → finalize

Private `workflow-skills/*/SKILL.md` files are unchanged. Every pass `reads` the full skill and only scopes which skill steps run now. Intermediate handoffs land under `docs/.workflow-passes/`.

## Models

`create-structure-outline`, `create-plan`, `implement-outline`, and `implement-plan` stages pin to `openai-codex/gpt-5.6-luna:medium`. Other stages use the session default model.

## Current-directory policy

Both workflows run in the directory from which they are invoked. They do not declare `git_worktree_dir`, create worktrees or branches, commit, push, create pull requests, or mutate remote state. Git and GitHub actions remain user-owned.

The workflow stages may still ask their own product, technical, and implementation questions. Explicit approval checkpoints pause before outlining and before implementation (and before/after the detailed plan when that path is enabled).
Run these workflows in interactive mode because the approval checkpoints are human-input gates. Inspect a run with `/workflow connect <run-id>` and resume it after each approval.

## Collision-free private skills

The package bundles skill content under `workflow-skills/`, not under `skills/` and not in `atomic.skills`. The original skill directory names and `SKILL.md` frontmatter are unchanged, but Atomic does not register these copies as `/skill:*` commands. Each workflow stage reads the appropriate private `SKILL.md` directly.

Private templates and agent prompts are under `workflow-templates/` and `workflow-agents/`.
