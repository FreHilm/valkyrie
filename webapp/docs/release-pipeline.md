# Web release pipeline

Covers `T-022`. Replaces, for the web build, what
`.github/workflows/buildAndOptionalRelease.yml` and `workflowScripts/build.ps1`
do for Unity.

## What runs

| Workflow         | Trigger                                       | Does                                                                                                                               |
| ---------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `webPort.yml`    | push/PR touching `webapp/**`                  | typecheck, lint, format, tests with coverage, conformance ledger, size budget, and the eight differential harnesses against the C# |
| `webRelease.yml` | push/PR touching `webapp/**` or `version.txt` | the above, then versions, builds and publishes the site                                                                            |

`webRelease.yml` also takes a `redeploy_run_id` input, which republishes a
previous run's artifact without rebuilding.

## The deploy step is inert, on purpose

There is no `packages/app` yet — that lands with `T-016`. The workflow detects
its absence and emits a notice rather than failing, so the pipeline is in place
and exercised on every push before it is needed, and starts publishing the day
the app package appears.

Saying this plainly matters: **nothing is being deployed today**, and a green
run does not mean a site went live.

## Versioning

`unity/Assets/Resources/version.txt` stays the single source of truth for both
builds, so the in-app version display keeps matching between them.
`parseVersionFile` is the ported reading half of `libraries/SetVersion`, and
`tools/version/print.mjs` is what CI calls.

Verified by executing the real `SetVersion` against a copy of the repo:

| `version.txt`     | real `SetVersion` | the port     |
| ----------------- | ----------------- | ------------ |
| `3.28` + `MAJOR`  | `3.28-major`      | `3.28-major` |
| `3.29` + `BETA`   | `3.29-beta`       | `3.29-beta`  |
| `3.30` + _(none)_ | `3.30`            | `3.30`       |
| `4.0` + `nightly` | `4.0`             | `4.0`        |

An unrecognised channel is dropped rather than appended, by both.

Worth knowing: the committed `ProjectSettings.asset` says `3.0.4` while
`version.txt` says `3.28`. That is not a discrepancy in the port — `SetVersion`
runs in the build pipeline, not on commit, so the checked-in value is simply
stale.

## Bundle size budget

`tools/size/check.mjs` measures the gzipped size of every built `.js` file per
package and fails if a package grows more than 5% past the committed budget in
`tools/size/budget.json`.

Current: `@valkyrie/core` 51.2 kB gzipped, `@valkyrie/platform` 27.7 kB.

An intended increase is a one-line change (`--update`) that shows up in review,
which is the point — size regressions arrive one dependency at a time and are
invisible without a number to fail against.

## A hole this task found in the existing CI

`webPort.yml` failed a build by grepping for `real divergences: [1-9]`. The
three harnesses added since (`multimedia`, `remote`, `ogg`) print the count the
other way round — `0 real divergences` — so **a divergence in any of them would
not have been caught**. Worse, `run.sh` was piped into `tee` without
`pipefail`, so its non-zero exit was swallowed too. Both are fixed: the step
sets `pipefail`, the pattern matches both shapes, and a check asserts the run
actually reached the last harness rather than dying halfway.

The patterns were tested against real output and three synthetic failures
before being committed.

## Security scanning

`CodeAndSecurityValidation.yml` is unchanged and still runs CodeQL. It is not
folded into the web workflows: it covers the C# too, and the Unity build is not
retired yet.

## Rollback

`workflow_dispatch` with `redeploy_run_id` set to a previous successful run
republishes that run's artifact directly to Pages. No rebuild happens, so what
goes back up is exactly what was serving before, not a fresh build of an old
commit — which is the property that matters when rolling back under pressure.
Artifacts are kept 90 days.

## Pull requests get an artifact, not a URL

A PR build is uploaded as a downloadable artifact rather than published to a
preview URL. Publishing a fork's build to the project's own Pages site would
let any contributor serve arbitrary content from the project's origin, where
the app's own OPFS data and any future credentials live. A preview URL is
possible later on a separate origin; it is not worth that risk on this one.

## Repo hygiene done here

The task notes flagged this, and it was done while in the area:

- removed `compile-check.log`, `compile-results.log` and
  `unity/Logs/Packages-Update.log`. All three were committed Unity _licensing
  failure_ logs from someone's local machine, referenced by nothing, and they
  leaked local filesystem paths;
- added the standard Unity ignores.

One trap worth recording: the usual Unity `.gitignore` template has a global
`*.csproj` / `*.sln`. Applied globally here it would have silently excluded all
eight differential-harness project files, breaking the differential suite on a
fresh clone while everything still looked fine locally. Those entries are
scoped to `/unity/`.

## Open decision — retiring the Unity pipeline

Not mine to make, and deliberately not made. The acceptance criterion asks for
a recorded decision on whether and when the Unity build is retired. The honest
position:

- the web port has no UI yet (`T-016`–`T-019`), so it cannot replace the Unity
  build for players;
- the FFG import path is blocked on licensed files (`T-001`, `T-002`, `T-014`),
  so it cannot replace it for content either;
- retiring the Unity pipeline before both are done would leave users with no
  working build.

Recommendation: keep both, and revisit once `T-016`–`T-019` land and the import
path is verified. That belongs in the ADR (`T-003`) alongside the browser
matrix and save-format questions, which are the other decisions waiting on you.
