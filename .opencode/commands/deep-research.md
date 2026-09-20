---
description: Run premade deep-research workflow on any topic, save cited report
agent: general
subtask: true
---

Run deep research on this topic: $ARGUMENTS

First load the `deep-research` skill via the skill tool. If the skill tool does
not list it, read `.opencode/skills/deep-research/SKILL.md` directly and follow
it exactly: define the question, gather from official docs / GitHub / blogs /
benchmarks / community discussion, cross-reference claims across independent
sources, identify gaps and fill them with further rounds, evaluate tradeoffs.

Rules: cite primary sources, separate fact from opinion, flag uncertainty, and
save the finished report as a markdown file under `scratch/` with sources listed.
