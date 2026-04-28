# Security Audit Decisions Log

This document is a maintainer log for `npm audit` and Dependabot advisory decisions.
It captures decisions for advisories that fall outside the CI auto-block policy and are intentionally left to human judgment.

It is not a public security policy. For the public policy, see [SECURITY.md](../SECURITY.md).
For the operating mode that defines current support boundaries, see [OPERATING_PLAN.md](./OPERATING_PLAN.md).

## 1. Scope

The CI workflow runs `npm audit --audit-level=high --omit=dev` in [test.yml](../.github/workflows/test.yml).
That policy:

- auto-fails the build for high or critical advisories that affect production dependencies
- intentionally leaves moderate-severity advisories and dev/build-only advisories to human judgment
- relies on [dependabot.yml](../.github/dependabot.yml) version-updates to surface upstream patches over time

This log captures the human-judgment decisions for advisories that fall outside the auto-fail policy: why each advisory was accepted as-is, what would change the decision, and how the advisory is expected to sunset.

## 2. Entry Format

Each entry should include:

- **Status**: Accepted (awaiting natural sunset), Mitigated (via overrides or pin), or Resolved
- **Severity** and **Production trigger surface**
- **Where the vulnerable instance lives**: exact `node_modules` path and why dedup did not collapse it
- **Why it does not reach us**: threat-model translation with code-level evidence
- **CI policy alignment**: why current CI policy correctly leaves this to human judgment
- **Sunset path**: how the advisory resolves over time without active intervention
- **Re-evaluate if**: concrete triggers that should reopen the decision

## 3. Active Decisions

### 3.1 GHSA-qx2v-qp2m-jg93 — postcss below 8.5.10

Status: Accepted, awaiting natural sunset
Severity: Moderate (CVE-2026-41305)
Production trigger surface: None
First reviewed: 2026-04-28

#### Where the vulnerable instance lives

- Single nested instance at `node_modules/next/node_modules/postcss@8.4.31`.
- `next@15.5.15` pins postcss exactly in its own `package.json` (`"postcss": "8.4.31"`), which prevents npm dedup from collapsing the nested instance onto the patched top-level instance.
- Every other postcss caller in the tree (autoprefixer, tailwindcss and its plugins, vite) resolves to the patched top-level `postcss@8.5.10`.

#### Why it does not reach us

- next's nested postcss is a build-time tool. It runs during Tailwind compilation, CSS Modules processing, and autoprefixer passes invoked by `npm run build`.
- Production runtime does not invoke postcss. Build output is static CSS in `.next/static/css/*.css`, served directly.
- There is no path in the supported product where user-submitted CSS is parsed by postcss and re-stringified into a `<style>` tag. The advisory's exploit shape requires exactly that flow.
- Advisory text limits impact to "non-bundler use cases" and to "PostCSS plugins with malware code." Neither applies here.
- Code-level checks confirm no direct usage:
  - `grep -rn "from 'postcss'\|require('postcss')" src/` returns nothing.
  - The SUU packages (`types`, `schema`, `validator`, `react`) do not declare postcss as a direct dependency.

#### CI policy alignment

The audit step is configured as `npm audit --audit-level=high --omit=dev`. This advisory is moderate severity and reaches only build-time tooling, so the policy correctly leaves it to human judgment rather than auto-failing the build.

#### Sunset path

- [dependabot.yml](../.github/dependabot.yml) polls npm updates daily at 09:00 KST. When next ships a release that bumps its pinned postcss to 8.5.x, Dependabot opens a version-update PR. Merging that PR collapses the nested instance to the patched version, and the audit warning disappears without further action.
- A `package.json` `overrides` entry could force-resolve the nested instance to 8.5.10 today. That option is not adopted now: production trigger surface is zero, and the Dependabot sunset path is already in place.

#### Re-evaluate if

- RebelAI or SUU code begins calling postcss directly, especially on user-submitted CSS that is parsed and re-emitted into `<style>` tags.
- next's nested postcss starts being invoked at runtime rather than build-time.
- A major next upgrade reshapes the dependency tree in a way that affects this analysis.
