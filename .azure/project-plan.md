# Project Plan

**Status**: Implemented locally — deployment/service release qualification pending
**Approval**: User explicitly confirmed “I approved the project plan; proceed with implementation” in conversation on 2026-10-31. Implementation authorized; deployment and live billable calls require separate confirmation.
**Created**: 2026-10-31
**Mode**: NEW

---

## 1. Project Overview

**Goal**: Build Syntasia, a browser-only GitHub Pages video-authoring website that turns researched, editable scripts into narrated avatar or conceptual-animation scenes and downloads an assembled MP4 plus WebVTT transcript. The project is designed so that every module is independently testable.

**App Type**: Static frontend only (browser-only HTML/CSS/TypeScript; one frontend service, no backend)

**API Login**: No

**Mode**: NEW

**Deployment Plan**: No deployment plan found

Requirements are authoritative in `spec.md` (all 453 lines), as explicitly selected by the user. `.azure/requirements.json` is a derived record, not a replacement specification. This plan preserves sections 1–14 and AC-01–AC-24. Toolkit defaults are adapted to a static-only app: no API server, database, Azure hosting resource, container emulator, server renderer or credential proxy. GitHub Pages serves static assets; Azure performs inference and synthesis.

Approval covers product scope and visual intent, not proof of deployment feasibility. Editing remains usable when a service or encoding gate fails. Do not advertise the end-to-end workflow as supported until real deployment/browser qualification passes. This task ends at approval; implementation and deployment are separate work.

### Authorized implementation status (2026-10-31)

The approved scaffold's integration blockers have been resolved without replacing its studio UI. Configuration, narration/provenance, Speech and scene contracts are canonicalized. Shared Responses/SSE/research/continuity, SSML and attachment validation, safe declarative animation, conditional avatar submission/poll/download, local FFmpeg production, snapshot locking/cancellation, 1080p verification and WebVTT downloads are wired.

Local qualification uses `npm run check`, `npm test` and `npm run test:browser` (installed desktop Chrome/Edge; development and compiled static build). Browser fixtures perform actual encode/decode, SVG rendering, muxing/playback and alpha decoding; Azure requests are exclusively mocked or blocked. A controlled CORS-denied loopback origin remains denied with the worker active, and a blocked-worker single-thread fallback is tested. Detailed operating instructions and release gates are in `README.md`.

Evidence: strict typecheck/build passed; 36 unit tests passed; 32 browser tests passed across Chrome 156.0.8078.76 and Edge 156.0.4314.58. Both compiled/static assets and development UI were exercised. Test servers were stopped after verification.

Live Responses/tools, Speech/avatars/output CORS/transparency, representative long-form media, deployed GitHub Pages behavior and GPL corresponding-source redistribution remain release gates. No deployment or billable live requests are authorized or performed by this implementation task.

---

## 2. Frontend — Syntasia Web App

| Component | Technology |
|-----------|-----------|
| **Language** | TypeScript |
| **Framework** | None (HTML + CSS + TypeScript) |
| **Runtime** | Browser; Node for build/test tooling only |
| **Build Tool** | Vite static bundling plus `tsc --noEmit` strict checking |
| **Package Manager** | npm |
| **Test Runner** | vitest; Playwright for browser qualification |
| **Mocking Library** | vi.mock; injectable adapters and controlled browser fixtures |
| **Test Command** | npm test |
| **Orchestration** | docker-compose |

The orchestration row is toolkit metadata only: no Compose files, Docker prerequisite, container or emulator is needed for this app. Build configuration, dependencies and production files are deferred until approval.

Use the root layout suggested in spec §12. Compile TypeScript, bundle browser-compatible dependencies, pin versions and verify licenses. Pico.css provides locally bundled, themed native controls; do not introduce a SPA framework. Candidate media paths are WebCodecs plus a compatible MP4 muxer, and browser FFmpeg/WASM with independently verified H.264/AAC support. Neither dependency selection nor codec support is approved merely by naming a library. Bundle appropriate licensed fonts/assets, Speech SDK, encoder, workers and WASM locally after capability verification.

### Module contracts and authoring behavior

- `configuration.ts`: validated URL parsing using `URL`, HTTPS and documented hostname/path allowlists; reject embedded user information, unexpected ports, queries and fragments. Derive `URL.origin`, never substring-to-first-`.com`. Accept the specified project path or supported resource root. Exact `.services.ai.azure.com` suffix mapping produces only a same-account Speech candidate; independently test it, require an explicit override on failure, and never try unrelated origins. Follow spec §§4, 6.3 and 11 for the service request contract.
- Persist only Project URL and Model name under `syntasia.config.v1`. Keep Authorization key, all advanced service fields, voice/avatar selections, scenes, chat, files, images and media in memory. Every fresh load requires re-entry of the secret fields. Cancel discards unsaved configuration; Clear settings removes the two stored values and active service settings. Storage denial degrades visibly to session-only operation. Reset/cancel old-configuration operations and the local conversation chain without losing unrelated edits.
- Configuration has Project URL, masked Authorization key with optional reveal, Model name, Save, Cancel, Test connection and Clear settings. Advanced settings contain explicit Responses origin, Speech endpoint/region and separate Speech authorization field. Validate each capability independently; obtain confirmation before billable tests. Same-origin scripts can read the persisted settings; disclose this and memory-only exposure while the page runs.
- `foundry.ts`: one typed Responses request builder for streaming/nonstreaming. New factual content uses built-in `web_search` and the fixed Microsoft Learn remote `mcp` definition from spec §6.3; purely editorial changes send `tools: []` and retain applicable provenance. Foundry, not the browser, executes Learn calls; there is no separate agent, toolbox or browser MCP client.
- Separate validated narration, sources and actual tool-use metadata. Microsoft claims require verified Learn execution in addition to Web Search; unrelated topics do not. `tool_choice: auto` alone proves nothing. Permit at most two additional supported research attempts. Required-tool failure retains the draft; a user-approved unresearched draft is labeled and cannot pass AC-06.
- Use `store: true` and only the last successfully completed `response.id` as `previous_response_id`. Disclose cloud retention and fixed Learn automatic approval before first Send; New chat/configuration/Clear resets the local chain, not stored Azure data. Streaming uses correct SSE chunk/event buffering, handles incomplete/malformed/error events, and never applies canceled/partial results. Preserve annotations rather than flattening output.
- `chat.ts`: collapsible left pane, accessible narrow-screen drawer, preserved unsent text/history, explicit target selector defaulting to scene one, Send/Cancel/New chat and Apply to scene. One request targets one scene; manual addition only. Protect nonempty content and late-result revisions. Accept valid UTF-8 TXT/MD only: 10 files, 1 MiB each, 5 MiB combined; show size/removal and transmission disclosure. Model-appropriate token budgeting never silently truncates. Attachments/retrieval are untrusted reference material, not instructions.
- `speech.ts` / `ssml.ts`: fetch available Azure voices with friendly name, locale and identifier; no unlabeled OS-voice substitution. Maintain a documented standard avatar/style catalog filtered by region/capability; do not assume a listing API or introduce custom avatars. Missing/empty/invalid selections block relevant actions. Global voice affects all narration, avatar only avatar-mode scenes.
- Start in plain text. Label the toggle “Use Speech Synthesis Markup Language (SSML)”; escape/wrap supported markup, validate XML/subset, reject external entities/audio and conflicting voice declarations, update the permitted voice from the global selector. Warn before lossy conversion; preserve a cancelable in-session copy. Preview speech uses the selected voice and current script with synthesis progress, playback and Stop; it never generates video. Reject invalid/empty scripts before billing; invalidate preview audio when inputs change.
- `scenes.ts` / `state.ts`: start with one scene, keep at least one, add/reorder/delete with nonempty-work confirmation. Numbered scrollable rows contain Script, SSML, Preview speech/Stop, Generate/status, avatar-or-video preview, background upload/removal and Conceptual animation. Stack columns on narrow screens. Limits: 20 scenes, five minutes per scene, 30 minutes total, always subject to actual device capacity.
- Validate JPEG/PNG decoded content, 10 MiB size and maximum 4096 pixels per dimension; local centered-cover background never silently uploads. Avatar placeholders are approved catalog assets on white and clearly labeled, not promised renderings. Preview uses neutral illustrated media placeholders, not fabricated service results.
- `avatar.ts`: supported async Speech synthesis submission/polling/download/composition with visible queued, generating, downloading and rendering phases. Use selected voice/style and real timing/subtitle output where available; avoid modes that ignore the voice or suppress required subtitles. Backgrounds require verified transparent WebM/VP9 alpha decoding, composited locally and normalized to MP4. If unsupported, report it; never claim a background was used on an opaque white output.
- `animation.ts`: conceptual mode shows a white canvas without an avatar, disables upload/removal with explanation, retains but excludes the local image and restores it on returning to avatar mode. Synthesize narration, obtain actual audio duration and available word/bookmark timing, then request a declarative SVG plan grounded in script/duration. Missing word timing uses approximate event placement, not a failure.
- App-controlled SVG renderer uses hand-drawn strokes, stroke reveal, handwritten-looking concise labels and semantic illustrations with limited accents on white. Validate bounds on elements, paths, text and duration; reject scripts, event attributes, `foreignObject`, external URLs/resources, arbitrary CSS and unsafe data URLs. Never execute generated JavaScript. Explicit time-based seeking/frame rendering must be deterministic, within-frame and audio-synchronized; invalid plans fail rather than become blank success videos.
- Every scene and final clip is **1920 × 1080, 16:9, 30 fps, H.264 video/AAC audio in MP4**, with one verified common sample rate. Verify dimensions and actual encoded media, not scaled player sizes. No lower-resolution success fallback.
- Fingerprint all generation inputs. Script/SSML/mode/background/global selection/service changes invalidate affected scenes and final output. Keep the last successful clip marked stale during regeneration. Obsolete results never become current. Scene states: `idle`, `queued`, `generating`, `rendering`, `ready`, `stale`, `failed`, `canceled`. Sequential heavy work is default; cancellation cleans local resources without promising a remote job stopped or charges were avoided.
- `production.ts`: settle conflicting work, snapshot order/revisions/settings, lock all generation-affecting controls, validate inputs/capabilities/limits and confirm billable generation. Produce generates missing/stale clips sequentially, stops on any failure while retaining successful clips, decodes/normalizes and joins every scene with hard cuts. Never append MP4 bytes or rename another format. Cancellation rejects late completion; all terminal paths unlock after cleanup. Cancel and existing-media playback stay available.
- Before downloads validate final playback, dimensions/profile/order, actual duration (within 100 ms of summed normalized scenes), narration/backgrounds and transcript bounds. Successful output provides playback and `syntasia-<timestamp>.mp4` / `.vtt`. Until success the download actions are absent, not misleading success buttons.
- `transcript.ts`: UTF-8 `WEBVTT`, valid `HH:MM:SS.mmm`, spoken content only; exclude SSML/citations/animation directions. Prefer actual service cues. Otherwise allocate readable phrase cues proportionally by word count over actual scene duration, round to milliseconds, positive lengths, chronological/nonoverlapping, at most two lines and about 42 characters per line. Offset by actual preceding durations, preserve intentional gaps, escape sensitive VTT syntax and verify playback. Approximation is accepted without extra opt-in; label “Transcript timing: approximate” and add a `NOTE` identifying affected scenes.
- `coi-bootstrap.ts` / `coi-serviceworker.js`: complete secure-context/worker startup before credentials or editing. Base-aware `/syntasia/` scope, listener before activation, bounded readiness/control and at most one startup reload. Show recoverable failure and verified nonisolated fallback; registration alone does not prove isolation or threaded encoding.
- Rewrite only eligible same-origin public document/assets with COOP/COEP/CORP; pass service/media requests through unchanged. Preserve redirects, range requests, HEAD and empty bodies; never turn opaque/failed CORS into usable output. No sensitive caching, injected service headers or dirty-session update reload; defer updates until confirmed. Probe isolation, SharedArrayBuffer, worker initialization, codec/muxer support and memory. Keep engine/fonts/WASM same-origin with valid MIME/base paths under COEP.
- `errors.ts`: typed, redacted local errors distinguish validation, service access, CORS/network, rate limits, unsupported capabilities, model output, synthesis and rendering. Inline actionable messages and accessible progress; respect retry guidance but never blindly resubmit billable jobs. Release object URLs, frames, workers and buffers on replacement/deletion/cancellation. Use `{ error: { code, message, details } }` internally, never invent a backend response.

### Accessibility, privacy and reference adaptations

Semantic labeled controls, keyboard use, visible focus, contrast, safe modal focus trap/Escape/return, nonflooding status announcements and reduced-motion UI are mandatory. No autoplay on load. Warn before leaving unsaved session work; do not promise recovery or analytics. Safely render untrusted text and restrict external links/resources. Apply static-hosting-compatible CSP and pinned dependencies; a meta policy is not a substitute for all response-header features.

Prompt/file contents go to the configured service; research queries may have distinct terms/data boundaries. Never put secrets in model context, tools, URLs, stores, exports, telemetry, logs, assets or workflow variables. Never use public CORS proxies or shared embedded secrets. Unsupported service combinations require explicit remediation or approved scope change, not silent architecture changes.

Adapt `reference/ask-azure/script.js` request/continuity/Speech patterns, not its overly broad URL handling or streaming tool mismatch. Adapt `reference/coi-serviceworker.js` with controlled startup, same-origin-only rewriting, unchanged remote failure semantics and dirty-work protection. Reference code is illustrative, not deployment evidence; reverify service versions and licenses during implementation using spec §14.

---

## 3. Services Required

| Azure Service | Role in App | Environment Variable | Default Value (Local) | Classification |
|---------------|------------|---------------------|----------------------|----------------|
| Microsoft Foundry Responses | Narration and declarative animation planning; direct browser requests | — (runtime configuration) | Unconfigured; requires independently tested resource/model | Essential for model generation |
| Foundry built-in Web Search | Research new factual content through Responses | — | Unverified deployment tool capability | Essential for researched factual generation |
| Microsoft Learn remote MCP | Research Microsoft claims through Foundry at the fixed Learn endpoint | — | `https://learn.microsoft.com/api/mcp`; no browser-side MCP client | Essential when Microsoft claims are relevant |
| Azure Speech | Voice catalog, preview and timed narration | — (runtime configuration) | Candidate same-account endpoint, independently tested; otherwise explicit override | Essential for narration/video |
| Azure Speech standard avatar synthesis | Avatar clips and supported transparent output | — | Region/style/quota/CORS/alpha support unverified | Essential for avatar-mode video |

GitHub Pages is the static host, not an Azure service. There is no application datastore. No service values or secrets enter build-time environment variables. These are external user-configured dependencies, not resources this plan provisions. Service failures block only dependent actions, never local editing.

### Conditional feasibility and release gates

| Gate | Evidence required before declaring supported | Failure behavior |
|------|--------------------------------------------|------------------|
| Responses | Validated origin, deployment compatibility, accepted access and real browser CORS | Disable Send/model-plan generation; keep editing |
| Research | Real Web Search and relevant Learn executions, deployment/tool access and billing enabled | Preserve draft and show required-tool failure |
| Speech | Same-account capability or explicit override, working selected voice and timing path | Block dependent preview/synthesis; request settings correction |
| Avatar | Actual regional catalog/style availability, permission/quota, submit/poll/download CORS | Block avatar generation with specific limitation |
| Local background | Service transparent VP9/WebM output and actual browser alpha decode/composition | Disable affected background output; no fake white-background success |
| SVG animation | Safe schema, deterministic timed rendering and narrated encoding fixture | Report invalid/unsupported pipeline; no blank output |
| MP4 / 1080p | Real H.264/AAC scene/final metadata, 1920 × 1080/30 fps, muxing, memory and download playback | Disable Produce if neither tested path works; no relabeling |
| Isolation | Deployed worker control, `crossOriginIsolated`, SharedArrayBuffer and real threaded fixture | Visible single-thread/nonisolated fallback only if verified |
| COEP / remote CORS | Correct MIME and asset paths; denied remote CORS stays denied with worker active | Separate CORS from COI diagnosis; no proxy workaround |

Targets initially qualify current desktop Chrome and Edge only. Local controlled browser/media fixtures are now implemented and verified; they do not qualify external services or a deployment. Mobile and other browsers remain unqualified until identical gates pass. No deployment/credentials were supplied for live qualification, so **all live-service and deployed-host feasibility gates remain unverified**.

---

## 4. Prerequisites

### Run

| Tool | Service(s) | Installed | Version |
|------|------------|-----------|---------|
| Node.js | syntasia-web (build/test only) | ✅ | 26.13.0 |
| npm | syntasia-web | ✅ | 11.20.0 |
| Git | * | ✅ | 2.56.0.windows.4 |

### Debug

| Tool | Service(s) | Installed | Version |
|------|------------|-----------|---------|
| Chrome | syntasia-web | ✅ | 156.0.8078.76 |
| Edge | syntasia-web (additional release target) | ✅ | 156.0.4314.58 |

Scanned installed executables on Windows on 2026-10-31. Chrome is the primary local debug browser; Edge is the additional mandatory qualification target. VS Code's built-in JavaScript debugging needs no Azure integration extension. No emulator dependency exists, so no Docker/Compose or Functions tooling is required. Browser presence does not prove codec support. Any later ❓ result must be double-checked before proceeding. Project-local TypeScript/Vite/Vitest/Playwright and media dependencies will be installed and checked only in a separately approved implementation task.

---

## 5. Design System & UI

**Component Library**: Pico.css
**Style Direction**: A calm, compact creative studio: violet action accents, ink text, pale lavender workspace surfaces and white 16:9 media canvases. Script editing and research conversation dominate, with restrained elevation and rounded 6–10px controls rather than marketing dashboards.
**Typography**: Segoe UI, system-ui

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#6243BC` | Generate, Send and Produce actions; active scene and configuration links |
| `accent` | `#087C86` | Research provenance and conceptual-animation accents |
| `surface` | `#F5F3FA` | Authoring workspace behind white script and media panels |
| `text` | `#242134` | Narration, scene headings and toolbar labels |
| `muted` | `#645F74` | Scene durations, source notes and session-only disclosures |
| `border` | `#D9D4E5` | Script inputs, scene boundaries and media framing |

### Pages

| Page | Route | Purpose | Layout |
|------|-------|---------|--------|
| Video Studio | `/` | Research one target script, edit ordered scenes and review conditional production | `header + split(form|card-list) + action-bar + footer` |
| Configuration | `/` | Modal state of the same home view; configure and separately diagnose service/media capabilities | `header + main + modal + form + table + footer` |

Configuration is **not** a new URL route; its preview tab depicts the modal content inline, without backdrop or a fake route. The sole runtime page is the GitHub Pages home document. Static cross-preview links connect `video-studio.html` and `configuration.html`; real controls open/close a focus-managed modal/drawer. No rewrite-dependent routing.

Persistent toolbar: Syntasia, Configuration, global Voice/Avatar selectors, Produce and progress; downloads only after validated success. Production locks every generation-affecting input/action, including chat Apply/Send, scene reordering and configuration clearing, while Cancel production and existing-media playback remain available.

Preview depicts a representative three-scene session, **not** the empty first-load state or tested Azure output. Initial real application still starts with one empty scene, unselected catalogs and no reusable media. Catalog examples are illustrative, subject to actual documented availability. Media blocks explicitly say placeholder; there are no fabricated downloaded videos.

### Sample Content

Video Studio — scene drafts:

| Scene | Title / Script | Mode | Media status |
|-------|----------------|------|--------------|
| 1 | Meet Microsoft Foundry — “Microsoft Foundry brings models and tools into one place. Start with a deployment that supports your task, then test the experience with your own data.” | Avatar; white background | idle; avatar placeholder; no synthesized clip |
| 2 | From prompt to researched script — “A useful script begins with a question. Web research supplies sources, and Microsoft Learn helps check Microsoft-specific claims. Keep citations separate from the narration.” | Conceptual animation; background excluded | idle; white canvas placeholder; no clip |
| 3 | Review before you publish — “Review every scene, listen to the narration, and check the final video. An approximate transcript is useful, but it should be clearly labeled.” | Avatar; white background | stale illustration; last clip unavailable in static preview |

Video Studio — chat:

- Prompt: “Explain Microsoft Foundry to a new developer in a short narrated video.”
- Target: Scene 1 · attachment: `foundry-outline.md`, 2.4 KiB (illustration only).
- Draft: Scene 1 narration above; source reference: Microsoft Learn, “Microsoft Foundry documentation”, `https://learn.microsoft.com/azure/foundry/`.
- Provenance: “Draft · research not verified”; never claim sample content proves a real tool call.
- Pending chat region: “Researching the selected scene…” with skeleton, separately identified as a loading-state example.
- Output region: “No assembled video yet” with Produce disabled pending capability validation.
- Voice example: Ava · en-US · `en-US-AvaMultilingualNeural`; avatar example: Lisa / casual-sitting. Verify both before enabling use.

Configuration — fields: Project URL example `https://syntasia-demo.services.ai.azure.com/api/projects/studio` · Authorization key blank masked input (no sample secret) · Model name example `video-script` (deployment identifier, not a validated deployment).

Configuration — diagnostic examples:

| Capability | Status | Remediation |
|------------|--------|-------------|
| Responses / research tools | Not tested | Confirm a billable connection test |
| Speech voices | Not tested | Validate candidate endpoint or supply an override |
| Avatar / transparent media | Not tested | Verify region/style and alpha decode |
| Browser MP4 / isolation | Not tested | Probe codecs, worker and encoding fixture |

Show an **illustrative**, clearly labeled inline error: “Speech access could not be verified. Set an explicit Speech endpoint and retry.” It is a visual error-state example, not a claim that a request ran. Advanced fields are blank. Disclosure text covers local settings, session-only secrets/work, Foundry `store: true`, fixed Learn approval and prompt/attachment transmission. This single-page app naturally places loading/empty states in different studio sections and the error example in Configuration.

---

## 6. Project Structure

```text
syntasia\
├── .azure\
│   ├── requirements.json             derived from spec.md
│   ├── project-plan.md               approval artifact
│   ├── plan-validation.md            coverage and preview checks
│   └── .preview-temp\
│       ├── theme.css
│       ├── manifest.json
│       ├── video-studio.html
│       └── configuration.html
├── spec.md                           authoritative, unchanged
├── reference\                        examples, unchanged
├── index.html                        future static entry
├── styles.css                        future themed Pico/native layout
├── coi-serviceworker.js              future adapted bootstrap/worker
├── src\
│   ├── main.ts
│   ├── configuration.ts
│   ├── capability.ts
│   ├── foundry.ts
│   ├── chat.ts
│   ├── speech.ts
│   ├── ssml.ts
│   ├── scenes.ts
│   ├── state.ts
│   ├── avatar.ts
│   ├── animation.ts
│   ├── production.ts
│   ├── transcript.ts
│   ├── coi-bootstrap.ts
│   ├── errors.ts
│   ├── contracts\                    canonical typed schemas/results/state
│   └── media\                        injectable decode/encode/mux adapters
├── assets\                           licensed local catalog/fonts/media engines
├── tests\
│   ├── unit\
│   ├── browser\
│   ├── fixtures\
│   └── integration\                  opt-in, explicitly funded service checks
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── dist\                             generated static site, not source
└── .github\workflows\pages.yml        future build/publish workflow
```

Only planning deliverables are created now. No backend/shared server package or monorepo migration is needed. Canonical validation schemas define request types once; entity/response contracts and dependency-injected adapters stay separate. Build to `dist`, base `/syntasia/`, with base-aware workers, WASM, fonts and assets; support local development and optional custom domain. Future GitHub Actions builds static assets with no secrets embedded and publishes Pages only when separately authorized. Editing can operate offline after loaded assets; network services cannot.

---

## 7. Route Definitions

| # | Method | Path | Description | Request Body | Response Body | Status Codes |
|---|--------|------|-------------|-------------|--------------|-------------|
| 1 | GET | `/syntasia/` | Sole deployed home document; local/custom-domain base can be `/` | — | Static HTML | 200, 404 |
| 2 | GET | `/syntasia/assets/*` | Compiled JavaScript, styles, fonts, WASM and media workers | — | Static assets with valid MIME | 200, 206, 404 |
| 3 | GET | `/syntasia/coi-serviceworker.js` | Same-directory bootstrap/worker, `/syntasia/` scope | — | JavaScript | 200, 404 |
| 4 | POST | `<validated-resource-origin>/openai/v1/responses` | External service call, shared streaming/nonstreaming builder per spec §6.3 | `{ model, input, instructions, tools, tool_choice, store, previous_response_id?, stream? }` | Typed Responses items/annotations or SSE events | 200; handle documented 4xx/5xx and CORS failures |
| 5 | GET | `<validated-speech-origin>/tts/cognitiveservices/voices/list` | Conditional supported external voice catalog | — | Voice identifiers/locales/names | 200; handle service 4xx/5xx and CORS |
| 6 | POST | `<validated-speech-origin>/tts/cognitiveservices/v1` | External speech preview per spec §6.3 | Validated supported SSML | Supported audio blob | 200; handle service 4xx/5xx and CORS |
| 7 | POST / GET | `<documented-avatar-submission-and-status-URLs>` | Conditional external avatar submit/poll, version/path selected only after documentation/deployment verification | Narration, selected voice/character/style, verified output settings | Job state and output/subtitle references | Documented success/status codes; handle service/CORS failures |
| 8 | GET | `<validated-service-output-URL>` | Conditional CORS-readable media download; use original network semantics | — | Media/subtitle bytes | Documented 200/206 and failures |

Rows 4–8 describe **outbound dependencies**, not Syntasia endpoints. Do not add `/api/health`, API routes or a server. Learn's fixed URL is passed inside the Foundry tool definition; Web Search has no independent browser endpoint. Exact avatar/timing APIs and downloadable origin access remain feasibility decisions, not invented concrete endpoints.

---

## 8. Next Steps

1. Approval is recorded above; the separately authorized local implementation and unit/browser validation are complete.
2. Keep external capabilities conditional. Run explicitly funded live integration qualification for actual Responses tools, Speech, avatar outputs and representative final production; local mocks do not satisfy live-service acceptance evidence.
3. Resolve binary redistribution/source-license obligations before publishing bundled GPL media cores.
4. Only in separately authorized deployment work, build/publish the static output to GitHub Pages and repeat live `/syntasia/` COI/CORS/codec/media qualification. No Azure application hosting or IaC is required.
