# Release SemVer Policy

## Source of truth

The SDLC Release phase derives the next version from git history since the latest release tag unless an explicit version override is supplied.

## Formal SemVer mapping

- **MAJOR** — backward-incompatible public/API change
- **MINOR** — backward-compatible feature addition
- **PATCH** — backward-compatible bug fix or internal non-breaking change

This follows Semantic Versioning 2.0.0: incompatible changes increment MAJOR, backward-compatible features increment MINOR, backward-compatible fixes increment PATCH. Source: https://semver.org/ (Tier C, Confidence: High, applicable because this project needs a deterministic release version policy).

## Commit-history derivation rule

Release automation reads commits since the latest tag and applies this precedence:

1. **MAJOR** if any commit declares a breaking change with Conventional Commits `!` in the header or a `BREAKING CHANGE:` footer
2. **MINOR** if no breaking change exists and any commit is `feat:`
3. **PATCH** otherwise

This uses Conventional Commits 1.0.0 as the machine-readable signal for SemVer classification. Source: https://www.conventionalcommits.org/en/v1.0.0/ (Tier C, Confidence: High, applicable because the release command derives versions from git history).

## Initial release fallback

- If no release tag exists, use `package.json.version` when present and valid.
- If no valid package version exists, default to `0.1.0`.

## Explicit override

An explicit version may still be supplied to the release command when a maintainer needs to override automatic derivation.

## Safety gate

Automatic version derivation removes manual version selection from normal release flow.
It does **not** remove the explicit `YES` confirmation gate before changelog writes, tag creation, push, or GitHub release creation.

## Maintainer note

If a change is breaking, the commit history must mark it explicitly with Conventional Commits `!` or `BREAKING CHANGE:`. Unmarked breaking changes will be treated as non-breaking by release automation.
