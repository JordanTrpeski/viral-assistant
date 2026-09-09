# Jarvis — Development Rules

These rules apply to every coding agent working in this repository.

## Authority

- The human owner is the final authority.
- PRODUCT.md defines what Jarvis is intended to become.
- ROADMAP.md defines owner-approved milestone direction.
- The active milestone defines current scope.
- Agents may propose changes to product direction or milestones but may not silently redefine them.

## Development Behavior

- Read AGENTS.md, PRODUCT.md, PRINCIPLES.md, RULES.md, ARCHITECTURE.md, ROADMAP.md, DECISIONS.md, STATE.json, STATE.md, and the active milestone before substantial work.
- Inspect existing code before modifying it.
- Prefer the smallest coherent implementation that satisfies the active acceptance criteria.
- Do not implement future milestones opportunistically.
- Keep integrations modular.
- Add or update tests for behavior changes.
- Run relevant tests before marking work complete.
- Do not claim completion when acceptance criteria are unverified.
- Record meaningful architectural decisions in DECISIONS.md.

## Git

- Development may edit, test, commit, and push automatically.
- Use development branches for meaningful changes.
- Do not force-push unless explicitly authorized.
- Do not rewrite published history unless explicitly authorized.
- Major self-upgrades must not be merged into the stable/main branch without owner approval.
- A verified checkpoint should include a meaningful commit.
- Never commit secrets or private owner data.

## Secrets and Private Data

Never commit or push:
- API keys,
- passwords,
- authentication tokens,
- browser cookies/session data,
- personal financial data,
- personal calendar contents,
- private memories,
- private voice recordings/transcripts,
- private documents,
- personally sensitive data.

Use local environment configuration or OS-protected storage where needed.

## Open-Source Reuse

Before building a substantial subsystem from scratch:
1. Check whether a mature open-source solution already exists.
2. Check its license.
3. Check whether it is reasonably maintained.
4. Evaluate security/dependency risk.
5. Evaluate whether integration is simpler than implementing the required subset.
6. Record the decision when it materially affects architecture.

Do not blindly copy large repositories or code that is not needed.

## Self-Modification Safety

Jarvis may modify its own source code as part of an approved milestone.

It may not:
- remove owner-controlled safety or approval boundaries because they are inconvenient,
- weaken secrets/privacy rules without owner approval,
- silently change the stable architecture contract,
- bypass tests to declare success,
- conceal failures or unresolved uncertainty.

## Failure Handling

When work fails:
- capture the failure,
- preserve useful diagnostics,
- avoid repeating the same failed attempt indefinitely,
- reconsider assumptions after repeated failure,
- checkpoint recoverable progress where appropriate,
- ask the owner when a genuinely product-level decision is required.
