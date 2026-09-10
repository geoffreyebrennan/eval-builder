# Eval Builder

A product management tool for creating, tagging, and running evals for LLM-powered features, without requiring deep ML expertise.

## What's here

Three modules, in the order a PM would use them:

1. **Traces** — review real agent interactions, expand each step (span), and tag failures against a growing taxonomy. Any trace can be sent straight into the eval wizard.
2. **Build Eval** — a step-by-step wizard built around the four-part eval framework (Role, Context, Goal, Labels), with a recommender that helps you choose between a code-based check and an LLM-as-judge rubric, plus scope selection.
3. **Library** — saved evals with expandable rubrics. Code-based evals can be run against all traces with per-trace pass/fail results and a pass-rate bar. Every eval can be exported as JSON or CSV for developers, and a code eval's run results can be exported the same way for wiring into CI.

A collapsible product profile panel supplies default role/context copy across the tool, and a Guide modal in the top bar gives a short glossary of the underlying concepts (trace, span, code-based vs. LLM-as-judge, offline/online, pass rate).

## Running locally

```bash
npm install
npm run dev
```

Then open the local URL Vite prints (typically `http://localhost:5173`).

To build a static production bundle:

```bash
npm run build
npm run preview
```

## On the horizon

Four modules from the original seven-module plan aren't built yet:

- A calibration workbench for LLM-as-judge evals (compare judge verdicts against human review before trusting a judge at scale)
- Online eval integration against live traffic
- A way to evolve the trace taxonomy over time as new failure modes appear
- Connecting eval pass rates to downstream product metrics (retention, conversion, adoption)

## Stack

Single-page React app (Vite), no external UI libraries. All data is seeded in-memory for demonstration; there is no backend yet.
