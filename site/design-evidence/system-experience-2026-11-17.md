# System entry experience

Status: implementation draft; not a production release.
Implementation owner: OpenAI Codex. Review must bind to the PR head SHA.

## Scope and decision

Unify the GitHub README, homepage, linked protocol page and Explorer deployment path. Preserve the protocol specification, existing routes, evidence console, source-counted metrics, and the existing constellation renderer.

The first read names shared memory and operator control. The next action is local setup or an illustrated architecture tour, followed by local setup, source inspection or public Explorer deployment. No account capture, checkout, invented customer claims or simulated live telemetry were added.

Source references: site/DESIGN.md; .starlight/voice/context.md (voice source 3d6fc8fdd38b5db69a16db1078e30d454e891af1); starlight-design-intelligence portfolio/experience-standard.md and evals/motion-purpose-gate.md, read 17 November 2026. The Windows-only taste-kernel paths were unavailable in this environment; repository design sources supplied the applicable guidance.

## Motion specification

- Job: show the spatial relationship between memory, agent definitions and review; associate a selected layer with a concrete input, output and source.
- First read: static layered architecture, clearly labeled as an illustration rather than a running system.
- Trigger: user selects Remember, Coordinate or Inspect. Only the selected layer's border/background and associated copy change.
- Depth control: flatten the stack for a planar reading; 550ms interruptible CSS transform using cubic-bezier(.2,.7,.2,1).
- Runtime: CSS perspective and React state; no new dependencies, animation timer, autoplay or WebGL context.
- Mobile: illustration above controls and copy; single-column paths below 480px.
- Reduced motion: planar stack, no transitions, unnecessary depth control hidden. All information and source links retained.
- Semantics: native buttons with aria-pressed, controlled live region, visible focus; decorative scene hidden from assistive technology.

## Validation

- Site production build passed, including six vault-fetch tests, metrics, public install, layout and deployment contracts.
- Changed TSX files passed ESLint. TypeScript checked separately.
- README and deployment contract now reference the organization-owned repository.
- The installed Next.js 16.4.1 reports an existing security vulnerability. Resolve through the repository's security maintenance path before production release; this change does not update dependencies.
- Connected browser verification timed out. Desktop/mobile screenshots, keyboard journey, reduced-motion rendering and performance are NOT verified. No visual quality score or motion-gate pass is claimed.

## Release checks still required

Inspect desktop 1440px and phone 390px/320px, 200% zoom, all layer buttons, depth toggle, keyboard focus and each CTA. Verify the Vercel clone flow points to the organization repository with root directory site. Resolve the dependency advisory, obtain independent review and release through the existing deployment owner. Do not treat the draft as deployed.

Built on SIP: presentation of the existing file-contract, attribution and sovereignty concepts. Protocol authority and permissions are unchanged.
