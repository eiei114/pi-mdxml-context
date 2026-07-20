# Roadmap

> Living document. Update it as maintenance seeds are completed or re-scoped.
> Source of direction: `oss-maintenance-roadmap-direction-v1` (stabilize first, then speed/token efficiency, then design boundaries, then template compliance, then public quality).

`pi-mdxml-context` is a Pi extension that converts Markdown context into an
XML-like structure at model send time while keeping the original Markdown in the
session history. This roadmap keeps that core behavior stable and focuses the
maintenance budget on **stabilization, performance/token efficiency, explicit
design boundaries, template compliance, and public-release quality** — not on
broadening the feature surface.

## Guiding principles

- **Stabilize before extending.** Existing commands, tools, hooks, and output
  shape are treated as a compatibility surface. Changes are limited to
  compatibility fixes, byte-identical refactors, or guarded, opt-in behavior.
- **Speed and token efficiency are features.** Conversion adds tokens (XML is
  larger than Markdown); the Expansion Guard exists to bound that cost.
  Performance work must preserve output bytes unless a seed explicitly decides
  otherwise.
- **Make design boundaries explicit.** The exported symbols and the runtime-hook
  contract should be documented as a stable surface so consumers and future
  maintenance know what is load-bearing.
- **Stay template-compliant.** Track `pi-extension-template` conventions (the
  `scripts/check-version-bump.mjs` publishable-path list is the in-repo source
  of truth today) and close gaps deliberately.
- **Keep the release pipeline honest.** README, CHANGELOG, SECURITY, CI,
  `npm pack`, and release handoff must all reflect what is actually published.
- **Human-owned actions stay human-owned.** Secrets, publishing, permissions,
  and production actions are not automated by maintenance seeds.

## Current state snapshot

| Area | State |
| --- | --- |
| Version (`package.json`) | `0.1.12` |
| Latest published on npm | `0.1.12` (matches `package.json`; Trusted Publishing via `publish.yml`) |
| Public source surface | `index.ts` (single file); exports `convertMarkdown`, `normalizePreviewArg`, `MAX_COMPLETIONS`, `MAX_RECENT`, `MAX_TOOL_META`, and types `ConversionResult`, `GuardEvent`, `Provenance`, `SkipCategory` |
| Runtime hooks | `session_start`, `before_agent_start`, `tool_result`, `context` |
| Commands | `mdxml:on`, `mdxml:off`, `mdxml:status`, `mdxml:preview` |
| CI | `ci.yml` (check/test/pack/`version:check`), `auto-release.yml`, `publish.yml` |
| Expansion Guard | `MAX_OUTPUT_CHARS = 50_000`, `MAX_EXPANSION_RATIO = 2.0` (hardcoded) |
| Tests | golden converter harness + expansion-guard observability + runtime-hook safety + preview/recent-store |

## Phased goals

### Phase 1 — Stabilization & public-quality baseline (Month 1)

Lock the current behavior with tests, document the public surface, and close the
obvious public-quality gaps.

- Add `SECURITY.md` (supported-versions table + coordinated-disclosure policy).
- Document the exported API surface and the npm install path in the README.
- Review package metadata / `npm pack` completeness (`files`, `sideEffects`,
  `exports`).
- Capture current converter behavior as golden tests for edge cases that lack
  coverage today (documents without headings, nested callouts, table alignment,
  unknown mdast-node fallback).

**Exit criteria:** public surface documented, `SECURITY.md` present, edge-case
golden tests green, no regression in existing golden/output bytes.

### Phase 2 — Performance & token efficiency (Month 2)

Reduce per-request cost without changing output bytes.

- Optimize the `before_agent_start` system-prompt replacement
  (`includes()` + `split().join()` per context file) to a single pass, guarded
  by golden tests so output stays byte-identical.
- Characterize conversion token overhead and make the Expansion Guard thresholds
  configurable (opt-in; defaults unchanged). This is a behavior-adjacent change
  and requires a human product decision (HITL).

**Exit criteria:** documented before/after cost, byte-identical output for
unchanged settings, configurability behind default-preserving options.

### Phase 3 — Hardening & compliance closure (Month 3)

Close remaining edge-case and template-compliance loops.

- ~~Resolve the npm publish gap (0.1.3–0.1.5)~~ **Done** — 0.1.3–0.1.12 are on npm; keep monitoring the release pipeline publishes what CI validates.
- Run a template-compliance audit against `pi-extension-template` and file
  focused follow-ups for any remaining gaps.
- Decide handling for nodes the converter currently passes through as generic
  `<node type="…">` (e.g. math, footnotes, raw HTML comments) — capture intent
  before changing output.

**Exit criteria:** registry matches `package.json`, template checklist closed or
triaged, unknown-node behavior documented.

## Template-compliance checklist

`scripts/check-version-bump.mjs` defines the in-repo publishable-path contract
(template defaults + `package.json` `files` + `pi.extensions`). Track each item:

- [x] `package.json` declares `pi.extensions`, `files`, keywords, repo/homepage.
- [x] `README.md` documents features, commands, output shape, development.
- [x] `CHANGELOG.md` follows Keep a Changelog and is updated with publishable changes.
- [ ] `SECURITY.md` present (template default; **missing today — seed `01`**).
- [ ] Public API / hook-contract boundary documented (**seed `02`**).
- [ ] `npm pack` contents reviewed for completeness (**seed `03`**).
- [ ] Release pipeline publishes every validated version (**seed `07`**).
- [ ] Diff against `pi-extension-template` oss-rules recorded (**seed `07`**).

## Candidate maintenance seeds

Each seed is sized to 30–90 minutes, independently verifiable, and classified
with a version-bump decision. The frontmatter block under each seed is ready to
drop into `4_Project/OSS/pi-mdxml-context/Issues/<slug>.md` for the Local Issue
Import Seeder. Seeds marked `ready_for_multica: false` need a human decision and
must not be auto-implemented.

### 01 — Add SECURITY.md (template compliance / public quality)

```markdown
---
ready_for_multica: true
status: todo
project_key: pi-mdxml-context
issue_type: template-compliance
source_roadmap: pi-mdxml-context/ROADMAP.md
sequence_index: 1
sequence_total: 7
blocked_by: []
unblocks: []
pr_required: true
pr_allowed: true
release_allowed: false
production_allowed: false
version_bump_required: true
version_bump_type: patch
version_bump_reason: "SECURITY.md is a template-default publishable path per scripts/check-version-bump.mjs"
package_publish_expected: true
work_owner: ai
---
Add a SECURITY.md with a supported-versions table (track latest `0.1.x`) and a
coordinated-disclosure policy (report via GitHub Security Advisories / private
contact, no public issue for vulnerabilities). Acceptance: file exists,
README optionally links it, `npm run version:check` passes (patch bump +
CHANGELOG entry).
```

### 02 — Document public API surface and npm install path (design boundary / public quality)

```markdown
---
ready_for_multica: true
status: todo
project_key: pi-mdxml-context
issue_type: docs
source_roadmap: pi-mdxml-context/ROADMAP.md
sequence_index: 2
sequence_total: 7
blocked_by: []
unblocks: []
pr_required: true
pr_allowed: true
release_allowed: false
production_allowed: false
version_bump_required: true
version_bump_type: patch
version_bump_reason: "README.md is a publishable path; this folds in the backlog README-alignment intent"
package_publish_expected: true
work_owner: ai
---
Add a README section documenting the stable exported surface
(convertMarkdown, normalizePreviewArg, MAX_* constants, exported types) and the
runtime-hook contract, marking internals as not-public. Also add the
`npm i pi-mdxml-context` install path alongside the existing clone/copy path.
No behavior change. Acceptance: README updated, `npm run version:check` passes.
```

### 03 — Package metadata and npm-pack completeness review (public quality)

```markdown
---
ready_for_multica: true
status: todo
project_key: pi-mdxml-context
issue_type: public-quality
source_roadmap: pi-mdxml-context/ROADMAP.md
sequence_index: 3
sequence_total: 7
blocked_by: []
unblocks: []
pr_required: true
pr_allowed: true
release_allowed: false
production_allowed: false
version_bump_required: true
version_bump_type: patch
version_bump_reason: "package.json changes; decide whether CHANGELOG ships via files"
package_publish_expected: true
work_owner: ai
---
Review npm package contents: confirm `files` includes everything consumers need,
add `sideEffects: false` if accurate, add an `exports` map if helpful, and decide
whether CHANGELOG.md should ship. Verify with `npm pack --dry-run`. Acceptance:
pack contents reviewed, metadata tightened, `npm run version:check` passes.
```

### 04 — Converter edge-case golden tests (stabilization)

```markdown
---
ready_for_multica: true
status: todo
project_key: pi-mdxml-context
issue_type: stabilization
source_roadmap: pi-mdxml-context/ROADMAP.md
sequence_index: 4
sequence_total: 7
blocked_by: []
unblocks: ["05"]
pr_required: true
pr_allowed: true
release_allowed: false
production_allowed: false
version_bump_required: false
version_bump_type: none
version_bump_reason: "tests/ is not a publishable path; no version bump required"
package_publish_expected: false
work_owner: ai
---
Add golden fixtures capturing current behavior for: a document with no headings
(sectionize at root), nested Obsidian callouts, GFM table column alignment,
deeply nested lists, and the generic `<node type="…">` fallback for unknown
mdast nodes. This locks current output so later refactors are byte-verifiable.
Acceptance: new fixtures + expected XML checked in, `npm test` green.
```

### 05 — Single-pass before_agent_start system-prompt replacement (performance)

```markdown
---
ready_for_multica: true
status: todo
project_key: pi-mdxml-context
issue_type: performance
source_roadmap: pi-mdxml-context/ROADMAP.md
sequence_index: 5
sequence_total: 7
blocked_by: ["04"]
unblocks: ["06"]
pr_required: true
pr_allowed: true
release_allowed: false
production_allowed: false
version_bump_required: true
version_bump_type: patch
version_bump_reason: "index.ts is a publishable path; output stays byte-identical"
package_publish_expected: true
work_owner: ai
---
Replace the per-context-file `systemPrompt.includes()` + `split().join()` scans
with a single pass over the prompt. Output must stay byte-identical (prove with
the seed-04 golden tests plus a new test with multiple context files).
Acceptance: equivalent output, no regression, `npm run version:check` passes.
```

### 06 — Configurable Expansion Guard thresholds + overhead characterization (token efficiency)

```markdown
---
ready_for_multica: false
status: backlog
project_key: pi-mdxml-context
issue_type: token-efficiency
source_roadmap: pi-mdxml-context/ROADMAP.md
sequence_index: 6
sequence_total: 7
blocked_by: ["05"]
unblocks: []
pr_required: true
pr_allowed: true
release_allowed: false
production_allowed: false
version_bump_required: true
version_bump_type: minor
version_bump_reason: "adds opt-in configuration; defaults unchanged"
package_publish_expected: true
work_owner: human
---
HITL reason: changes the conversion-cost contract and needs a product decision
on the configuration surface (settings key name, per-session vs global, UX in
/mdxml:status). Plan: measure token overhead of current conversion on sample
docs, then make MAX_OUTPUT_CHARS and MAX_EXPANSION_RATIO configurable with the
current values as defaults. Do not change default behavior without sign-off.
```

### 07 — Template-compliance audit and npm publish-gap investigation (template compliance / release handoff)

```markdown
---
ready_for_multica: false
status: backlog
project_key: pi-mdxml-context
issue_type: release-handoff
source_roadmap: pi-mdxml-context/ROADMAP.md
sequence_index: 7
sequence_total: 7
blocked_by: []
unblocks: []
pr_required: false
pr_allowed: true
release_allowed: false
production_allowed: false
version_bump_required: false
version_bump_type: none
version_bump_reason: "investigation/audit only; no publishable code change"
package_publish_expected: false
work_owner: human
---
HITL reason: needs the pi-extension-template reference (not available to the
agent) and npm publish credentials/secrets, which are human-owned. Two parts:
(1) diff this repo against pi-extension-template/Docs/pi-extension-oss-rules.md
and file focused follow-ups for any gaps; (2) investigate why npm registry latest
is 0.1.2 while package.json is 0.1.5 — confirm publish.yml ran for 0.1.3–0.1.5
and either publish the gap or document the blockage. Acceptance: checklist
updated, publish state explained.
```

## Backlog integration

The pre-existing README-alignment backlog intent is folded into Phase 1 / seed
`02` (document public surface + install path). No separate README task is
needed once seed `02` lands. If a concrete README-alignment item predates this
roadmap, it should be closed in favor of seed `02`.

## Non-goals

- Broadening the Markdown feature set (math, footnotes, etc.) is out of scope
  unless a seed explicitly captures the decision first.
- Rewriting the single-file `index.ts` layout or splitting into `lib/`/`src/`
  without a template-compliance mandate.
- Changing the default conversion behavior or output schema.
- Automating secrets, publishing permissions, or production actions.
