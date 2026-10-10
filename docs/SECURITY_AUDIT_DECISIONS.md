# Security Audit Decisions Log

This is the maintainer log for npm audit and Dependabot advisory decisions.
It records current exceptions, their limits, and changes that resolved earlier alerts.
For the public policy, see [SECURITY.md](../SECURITY.md); for support boundaries, see
[OPERATING_PLAN.md](./OPERATING_PLAN.md).

## 1. Policy and update cadence

CI runs `npm audit --audit-level=high --omit=dev` in [test.yml](../.github/workflows/test.yml).
High and critical findings in the production dependency graph fail CI. Moderate findings and
findings confined to dev dependencies require maintainer review. Installation classification does
not establish request reachability: build tools pulled in by Next.js can appear in the production graph.

[dependabot.yml](../.github/dependabot.yml) schedules npm version updates monthly at 09:00 Asia/Seoul,
with a seven-day cooldown and at most two open version-update PRs. General npm updates are restricted
to patches; `@safe-ugc-ui/*` also allows minor updates. Major toolchain migrations require deliberate
review. This schedule does not guarantee prompt security remediation: run audit when reviewing
dependency changes and assess new advisories when they are reported.

Do not use `npm audit fix --force` to clear the counter. Current suggestions include upgrading
Tailwind CSS to 4.x and downgrading `eslint-config-next` to 14.x; both require compatibility review.

## 2. Review snapshot — 2026-10-10

Reviewed with Node.js 24.18.0 and npm 11.16.0. Counts are vulnerable package entries, including
inherited findings on parent packages, rather than independent exploit paths.

| Audit scope                            | Before this patch       | After this patch      |
| -------------------------------------- | ----------------------- | --------------------- |
| All dependencies                       | 14: 11 high, 3 moderate | 9: 7 high, 2 moderate |
| Production dependencies (`--omit=dev`) | 3 high                  | 0                     |
| Critical findings                      | 0                       | 0                     |

The nine remaining entries come from two underlying advisories. All affected paths are dev
dependencies. They are accepted only for the build/lint usage below; the full audit still reports
them. The CI threshold has not been weakened and no audit suppression was added.

Reproduce the review with:

```bash
npm ci
npm audit --json
npm audit --audit-level=high --omit=dev
npm ls braces postcss-selector-parser --all
```

The full audit currently exits with status 1 because accepted findings remain. The production audit
must exit with status 0. Reconcile changed counts or advisory IDs with this log; this snapshot does
not allow unrelated future findings.

### Validation of this refresh

- Clean `npm ci`, dependency-declaration checks, browser Supabase client boundary checks,
  `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm run build` passed.
- `npm run test -- --coverage`: 240 test files and 2,180 tests passed. The 72 skipped tests
  comprise 70 local Supabase integration cases, one Vault environment-dependent case, and one
  opt-in local LLM smoke case. Those external-service suites were not enabled for this refresh.
- Coverage passed the configured thresholds: statements 86.61%, branches 78.05%, functions 90.70%,
  and lines 86.94%.
- A Linux runtime probe verified `sharp@0.35.5` loads patched librsvg 2.63.2, renders a benign SVG,
  and performs a PNG-to-WebP resize through Next.js `optimizeImage`.
- Build completed with non-blocking warnings about an AI SDK dynamic dependency, Supabase's
  `process.version` reference in the Edge bundle, and Webpack cache serialization performance.
  These are separate from npm audit findings; this refresh does not claim to resolve them.
- npm 11.16.0 also reported install-script review notices for `esbuild` and `unrs-resolver`.
  Tests, lint, and build passed without changing script approval settings.

## 3. Active decisions

### 3.1 GHSA-vfj7-8cjw-p6xm — braces through 3.0.3

- **Status:** Accepted for current build/lint usage, pending an upstream patch or toolchain migration.
- **Severity:** High (CVE-2026-93687).
- **Production trigger surface:** No current application request path identified.
- **Reviewed:** 2026-10-10.
- **Advisory:** [Deeply nested patterns can exhaust the call stack](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

#### Dependency paths and inherited warnings

The single affected instance is `node_modules/braces@3.0.3`. npm deduplicates both
`chokidar@3.6.0` and `micromatch@4.0.8` onto it:

- `tailwindcss@3.4.19` → `chokidar@3.6.0` → `braces@3.0.3`.
- `tailwindcss@3.4.19` → `micromatch@4.0.8` → `braces@3.0.3`.
- `tailwindcss@3.4.19` → `fast-glob@3.3.3` → `micromatch@4.0.8` → `braces@3.0.3`.
- `eslint-config-next@15.5.27` → `@next/eslint-plugin-next@15.5.27` → `fast-glob@3.3.1`
  → `micromatch@4.0.8` → `braces@3.0.3`.

This accounts for seven high package entries: `braces`, `chokidar`, `micromatch`, `fast-glob`,
`tailwindcss`, `@next/eslint-plugin-next`, and `eslint-config-next`. Both `fast-glob` instances
share the affected `micromatch`/`braces` descendants.

#### Reachability and CI policy

The exploit requires an attacker-controlled brace pattern to reach recursive pattern processing.
[tailwind.config.ts](../tailwind.config.ts) supplies repository-controlled source globs, and
[eslint.config.mjs](../eslint.config.mjs) supplies repository-controlled lint configuration.
There are no imports of `braces`, `micromatch`, `fast-glob`, or `chokidar` under `src/` or
`scripts/`. Chat content and uploaded RBX assets are not fed into these tools as glob patterns.

These instances are dev dependencies, absent from the production audit and still visible in the full
audit. This exception does not establish safety for arbitrary patterns or for running untrusted
repository configuration in a privileged build environment.

#### Resolution path and re-evaluation

- As of this review, `3.0.3` is the latest published `braces` and the advisory lists no patched
  version. There is no compatible patched version to force through an override today.
- Recheck when upstream publishes a fix, refresh the lockfile, and run lint, tests, and build.
- If no compatible patch appears, review migration of affected Tailwind and lint tooling separately.
  Monthly patch-only Dependabot updates will not perform a Tailwind 4 migration.
- Reopen immediately if requests, import jobs, or scripts begin accepting user-controlled glob
  patterns, these packages become production dependencies, or the advisory expands beyond the
  reviewed pattern-processing behavior.

### 3.2 GHSA-rj75-hqrm-r3gf — postcss-selector-parser below 7.1.6

- **Status:** Accepted for repository CSS compilation, pending a compatible fix or toolchain migration.
- **Severity:** Moderate (CVE-2026-104844).
- **Production trigger surface:** No current application request path identified.
- **Reviewed:** 2026-10-10.
- **Advisory:** [Flat selector parsing can cause CPU exhaustion](https://github.com/advisories/GHSA-rj75-hqrm-r3gf).

#### Dependency paths and inherited warnings

The affected instance is `node_modules/postcss-selector-parser@6.1.4`, shared by
`tailwindcss@3.4.19` and its `postcss-nested@6.2.0` dependency. Both require the 6.x parser;
npm cannot deduplicate them onto patched 7.1.6 within their declared ranges.

The parser and `postcss-nested` account for two moderate entries. `tailwindcss` also inherits this
advisory, but is already counted as high through `braces`.

#### Reachability and CI policy

[postcss.config.js](../postcss.config.js) configures Tailwind and Autoprefixer for repository CSS
compilation. There are no direct imports of `postcss-selector-parser`, `postcss-nested`, or
`postcss` under `src/` or `scripts/`, and no application flow feeds user-submitted CSS to this
parser. The advisory distinguishes trusted build-time CSS from untrusted selectors parsed
synchronously in request handlers.

These instances are dev dependencies. The moderate finding is outside the production high/critical
CI gate, but remains an explicit exception in the full audit.

#### Resolution path and re-evaluation

- The patched parser is 7.1.6. Forcing it into consumers that declare 6.x bypasses their compatibility
  ranges, so no cross-major override is added for the current trusted-build usage.
- Recheck when a compatible 6.x fix or a Tailwind 3 release using a patched parser appears. Otherwise,
  review a toolchain migration, including generated CSS and UI behavior.
- The current patch-only Dependabot policy will not propose the parser or Tailwind major migration.
- Reopen if a CSS sanitizer, runtime CSS service, import flow, or other request path begins parsing
  user-supplied selectors, or if the advisory's affected behavior changes.

## 4. Resolved findings and existing mitigations

### 4.1 Dependency refresh — 2026-10-10

| Package                          | Previous installed version | Current installed version | Result                                                                     |
| -------------------------------- | -------------------------- | ------------------------- | -------------------------------------------------------------------------- |
| `next`                           | 15.5.25                    | 15.5.27                   | Resolves GHSA-4jqv-mc3x-m676 and GHSA-mcj8-r9mp-w47p                       |
| `sharp`                          | 0.35.4                     | 0.35.5                    | Resolves GHSA-wq5f-xc86-pv6w; direct pin and override updated together     |
| `source-map-js`                  | 1.2.1                      | 1.2.2                     | Resolves GHSA-68fv-2mgg-jv7q, including the PostCSS path                   |
| `undici` through `jsdom`         | 7.29.0                     | 7.30.0                    | Clears the 7.x advisory family fixed in 7.29.1                             |
| `brace-expansion` through ESLint | 1.1.18 and 2.1.4           | 1.1.21 and 2.1.7          | Resolves GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, and GHSA-6j4f-fj2g-mc7p |
| `eslint-config-next`             | 15.5.18                    | 15.5.27                   | Aligns lint configuration with the patched Next.js release                 |

The AI SDK's separate `undici@6.28.1` override is retained. It is not the 7.x `jsdom` instance
that produced these findings. No new overrides were needed for the transitive refresh.

### 4.2 GHSA-qx2v-qp2m-jg93 — PostCSS mitigation

- **Status:** Mitigated via the existing `postcss: 8.5.23` override; no current audit warning.
- **Severity:** Moderate (CVE-2026-41305).
- **First reviewed:** 2026-04-28; rechecked 2026-10-10.
- **Production trigger surface:** No application request path identified; repository CSS compilation.

The earlier entry accepted nested `node_modules/next/node_modules/postcss@8.4.31` while waiting
for an upstream update. That description is obsolete. Next.js still declares PostCSS 8.4.31, but
the existing root override resolves it and other callers to patched `node_modules/postcss@8.5.23`.
There is no remaining nested vulnerable PostCSS instance in the reviewed tree.

Keep the override until parent requirements naturally resolve to a patched version. Before removing
it, check `npm ls postcss --all`, both audits, and the CSS build. Reopen if PostCSS begins processing
user-supplied CSS at runtime or a changed dependency tree reintroduces an affected instance.

## 5. Recording future decisions

For each new exception, record the advisory ID and link, review date, status, severity, exact installed
paths, parent dependencies, request reachability evidence, CI policy alignment, resolution path, and
concrete re-evaluation triggers. Move resolved findings out of the active section and refresh this
snapshot whenever the lockfile or update cadence changes materially.
