# Syntasia plan validation

**Decision**: Awaiting plan approval; no scaffolding or deployment performed.
**Requirements source**: `C:\Git\GraemeMalcolm\syntasia\spec.md`, read through line 453. Node reports 453 split lines including the trailing blank (452 nontrailing line entries). The specification is unchanged.
**Scope**: Planning, derived requirements and script-free HTML/CSS visual specification only.

## Architecture and workflow checks

- One frontend service rooted at the repository root, HTML/CSS/strict TypeScript compiled to browser JavaScript. No backend, API server, database, proxy, server-side renderer or Azure hosting resource.
- GitHub Pages home document at `/syntasia/`, base-aware locally bundled assets, future build/publish only. Configuration is a modal on that same page; two preview tabs do not imply two application routes.
- API Login is No. The specification's independent service configuration and feasibility restrictions remain authoritative.
- Derived `.azure\requirements.json` explicitly identifies `spec.md` and the user's selection as the source. Every answer is confirmed; no requirements interview was repeated.
- Plan uses bold top metadata, numbered sequential sections, one frontend stack, Services Required, Run/Debug prerequisite groups, Design System & UI, Project Structure, Route Definitions and Next Steps. No improvised top-level architecture headings or Mermaid block.
- Static-only App Type is stated honestly rather than mislabeling the app “Static + API.” Toolkit orchestration metadata does not create a Docker requirement.
- Plan status remains Planning. Preview manifest is ready; neither that state nor design approval implies successful Azure or video capability validation.
- No delegated agents were used in this task.

## Specification section coverage

| Spec section | Plan coverage |
|---------------|---------------|
| 1 Purpose/scope | §1 static-only architecture; §2 module isolation and reference adaptations |
| 2 Feasibility/release gates | §3 independent Responses/research/Speech/avatar/background/SVG/MP4/isolation/CORS gates; unsupported paths remain blocked |
| 3 Page layout | §2 chat/scenes/production behavior; §5 toolbar, target scene, ordered editor/preview rows and responsive layout |
| 4 Configuration/persistence | §2 URL validation, modal operations, memory-only fields, two persisted values, denial handling and old-configuration invalidation; §5 configuration visual spec |
| 5 Voices/avatars | §2 fetched voice identifiers, maintained regional standard-avatar catalog, missing selections and global invalidation |
| 6 Chat/research | §2 attachments/tokens, target revision protection, typed Responses/SSE, identical tools, actual research verification, cloud continuity and disclosures |
| 7 SSML/speech preview | §2 supported XML conversion/validation, authoritative voice, lossy-conversion confirmation and independent audio preview |
| 8 Scene generation | §2 local image validation/alpha composition, declarative SVG/timing safety, common 1080p profile and stale/cancellation lifecycle |
| 9 Production/VTT | §2 snapshot locks, sequential normalization/muxing/hard cuts, final validation/downloads and approximate phrase/cue allocation |
| 10 State/errors | §2 typed modules, scene states, redacted actionable errors, bounded retries, cleanup and production state independence |
| 11 Accessibility/privacy/security | §2 semantic controls, modal focus, announcements, reduced motion, untrusted content, disclosure/CSP/no sensitive persistence |
| 12 Implementation/Pages | §6 root structure, strict build/bundling, local assets/base path, offline editing and future Pages publishing; §7 static routes |
| 12.1 COI bootstrap | §2 startup/controller/bounded reload, same-origin eligible responses, remote pass-through, dirty updates, fallback and diagnostics; §3 gates |
| 13 Acceptance criteria | Matrix below maps all 24 IDs to planned implementation and qualification |
| 14 References | §2 names supplied local references and required corrections; authoritative spec retains service documentation links for implementation-time verification |

## Acceptance-criteria traceability

“Covered” below means specified in the plan, **not implemented or passed**. All application tests are future work.

| ID | Plan coverage | Required eventual test |
|----|---------------|------------------------|
| AC-01 | §§2, 6, 7 static build, compiled assets, workers/WASM and `/syntasia/` | Build + deployed browser asset/MIME/base-path checks |
| AC-02 | §2 configuration persistence boundary and fresh-load secret re-entry | Storage/reload + dependency/build inspection |
| AC-03 | §2 Save/Cancel/Clear/storage denial and independent failures | Unit settings + browser modal/state tests |
| AC-04 | §2 voice IDs, standard catalog and conditional actions; §3 gates | Controlled empty/error UI + opt-in real catalog/access tests |
| AC-05 | §2 preserved collapsible chat, UTF-8/type/size/token checks and transmission disclosure | File validation + desktop/drawer UI tests |
| AC-06 | §2 shared request builder/research/editorial parity and actual provenance verification | Unit request parity + funded real Web Search/Learn execution/failure tests |
| AC-07 | §2 one target, replacement confirmation and revision-safe Apply | Unit/browser obsolete-response and target-isolation tests |
| AC-08 | §2 SSML validation/escape/voice/conversion rules | XML/subset and conversion unit/browser tests |
| AC-09 | §2 speech-only preview/current voice/Stop | Adapter-spy + actual selected-voice synthesis/playback |
| AC-10 | §2 white placeholders/local image validation/alpha composition; §3 background gate | JPEG/PNG validation + real transparent-output CORS/alpha/video tests |
| AC-11 | §2 conceptual mode exclusion/retention/restoration; §5 scene two | Browser toggle/state/output tests |
| AC-12 | §2 narration duration, hand-drawn semantic SVG schema and deterministic renderer | Hostile-plan allowlist tests + synchronized render fixture |
| AC-13 | §2 scene ordering, minimum one, confirmation, playback/duration | Browser add/reorder/delete and real clip metadata |
| AC-14 | §2 fingerprint/stale clips/final invalidation | Input-mutation matrix + production reuse tests |
| AC-15 | §§2–3 exact 1920 × 1080/30 fps/H.264/AAC, normalize/mux/order and ≤100 ms duration difference | Real every-scene/final media decode, metadata and playback qualification |
| AC-16 | §2 actual timing preference, proportional approximate cues, offsets/NOTE/UI labels | VTT parser/unit offsets + final playback/bounds tests |
| AC-17 | §§2–3 actionable errors, cancellation/memory/resource failures and no fake fallback | Controlled failure fixtures + real browser/service limits |
| AC-18 | §§2, 5 semantic/focus/keyboard/responsive/reduced-motion requirements | Full keyboard, dialog/drawer, announcements and accessibility audit |
| AC-19 | §2 no sensitive stores/logs/assets/exports/tool context | Build/storage/network inspection with controlled test values |
| AC-20 | §§2–3 worker startup/control/isolation/SAB/threaded fixture and fallback | Deployed Pages real encoding + startup/reload/failure tests |
| AC-21 | §2 validated URL.origin/exact suffix candidate/explicit overrides | URL allowlist tests + shared Speech failure/request-origin checks |
| AC-22 | §2 production snapshot/lock/late response/cancel/cleanup/unlock; §5 toolbar behavior | Browser adversarial concurrency and all terminal-path tests |
| AC-23 | §§2–3 unchanged denied CORS, diagnostics and no sensitive cache | Controlled CORS-denied endpoint with worker active + Cache API inspection |
| AC-24 | §2 successful Responses IDs, chain resets and cloud-retention disclosure | Streaming/nonstreaming completion/failure/cancel/reset tests |

## Executed planning/preview validation

Local Node assertions passed:

- Parsed derived requirements and preview manifest JSON.
- Verified eight exact numbered section headings, required bold metadata, single API Login row, frontend-only service and answered requirements.
- Matched all six fixed palette tokens to CSS values.
- Verified both nonempty HTML files are below 24 KiB: Video Studio 20,160 bytes; Configuration approximately 11.1 KiB.
- Exactly one load-bearing `./theme.css` link in each file; no author scripts, event handlers, inline styles or remote assets.
- Unique IDs, matching labels/ARIA references, defined CSS classes and existing local preview links.
- Preserved every shared preview CSS class from the loaded HTML recipe reference.
- Matched all three scene titles to plan sample content; data/loading/empty/error states are present and explicitly illustrative.

Hidden, ephemeral **local headless Chrome iframe** checks passed at 1440px and 390px:

- HTML/CSS rendered using the same stylesheet-inlining pattern, without loading files in an external browser tab or starting a preview server.
- No document horizontal overflow in either view; scene editor/preview columns were side-by-side on desktop and stacked on narrow screens.
- Computed Segoe UI typography, all primary CTA SVG icons, script-free documents and heading presence confirmed.
- Loading skeletons shimmer normally and stop under `prefers-reduced-motion: reduce`.
- Chrome helper was closed and its temporary profile cleaned up. No credentials or service calls were involved.

The final addition of `role="alert"` is a semantic-only change to the illustrative Configuration error panel; final static checks revalidate it.

## Limitations and approval boundary

- The embedded plan-view provider failed to initialize (transport failure). An embedded preview panel was **not** opened or verified. Files are ready for its normal manifest/iframe consumption when the provider is available.
- Headless layout checks are not a screenshot-based design review, full keyboard/focus audit or working application test. Preview controls are static; billable operations/downloads are not simulated as successful.
- No real deployment, configuration, model, voice, avatar, transparent media, Speech timing, COI service worker or MP4 encoder was tested. Node/browser tool presence and local mocks do not establish those capabilities.
- All spec feasibility gates and AC-01–AC-24 application tests remain mandatory before release.
- No package/build/runtime files, application source, service resources, database, workflow or deployment were created. Existing specification/reference files were not changed.
- Deliverables are persisted on disk, not committed. The preview folder is intentionally retained for approval; do not remove it before review.

**Next step**: Review `.azure\project-plan.md` and the preview states, then approve or request changes. This task stops here; no automatic scaffold/deploy is authorized.
