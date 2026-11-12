@AGENTS.md

<!-- The rules for every agent live in AGENTS.md. This file adds only what's specific to Claude Code. -->

## Claude Code

- Codebase questions: `graphify query "<question>"` first when `graphify-out/graph.json` exists, then `codegraph explore <query>` for code paths. `graphify-out/GRAPH_REPORT.md` is for broad architecture reviews only.
- After code changes, run `graphify update .` and `codegraph sync`. Neither uses an LLM.
- Before a non-trivial plan, check it against `CONTEXT.md` (glossary) and `docs/adr/`.
- Writing a PR: give it a conventional-commit title, add the Unreleased What's new lines (English and Persian) or say it needs `no-notes`, and run `npm test` before you call it done.
