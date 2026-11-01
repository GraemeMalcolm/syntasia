# Syntasia

Browser-only narrated-video authoring for a static GitHub Pages site. There is no backend, credential proxy, application database or server renderer. The authoritative requirements remain in `spec.md`.

## Run and validate

Use Node.js 22.12+ and npm:

```powershell
npm ci
npm run dev
npm run check
npm test
npm run test:browser
```

Development runs at `http://127.0.0.1:5173/syntasia/`. `npm run build` produces `dist`. Browser tests build the application, use bounded Vite development/preview servers and installed **Chrome and Edge**, and stop their servers afterward. All external requests in tests are blocked or fulfilled with local fixtures. Tests do **not** invoke billable Azure services.

`npm test` runs Vitest unit/integration tests. The Vite/Vitest configuration excludes `tests/browser/**` without relying on shell glob handling; those Playwright tests run separately with `npm run test:browser`.

`scripts/assets.mjs` copies the pinned FFmpeg cores, worker modules and Caveat font into same-origin `public/vendor` assets. Vite keeps the `/syntasia/` base path. The production-build tests check actual worker/WASM/font loading and MIME types.

## Capability-driven workflow

1. Startup completes the scope-limited isolation worker before allowing credentials or editing, with at most one startup reload. Local editing becomes available while media checks run. Worker updates do not reload dirty work.
2. Real local fixtures test H.264/AAC encoding, exact **1920 × 1080 / 30 fps / 48 kHz**, decoding, timed SVG animation, ordered hard cuts, MP4 muxing/playback and independent VP9 alpha decoding. A failed threaded fixture tries the single-thread path; neither path is enabled solely because an API exists.
3. Save your own Foundry project URL, API key and deployment name. Only **project URL and model name** persist. Keys, advanced settings, selections, chat, files and media remain session-only. Storage denial is visible. Memory-only keys are still accessible to page code; never distribute a shared secret.
4. **Test connection** requires explicit billable consent and verifies inference only. **Load Speech voices** independently checks the selected Speech endpoint/key. The exact same-account Speech hostname mapping is only a candidate; provide an explicit supported override on failure.
5. Select a voice and successfully **Preview speech** to verify/decode synthesis using that voice. For conceptual scenes, Generate requires this Speech check, the inference check and the local media fixtures. Model plans are bounded declarative shapes/text, not executable SVG or JavaScript.
6. Avatar scenes additionally require an explicit supported Speech region, a selected documented standard Lisa/Lori candidate and **Verify selected avatar** in Configuration. This separately consented, billable sample tests submit/poll/download and local normalization. The optional transparency checkbox qualifies the separate transparent VP9/background-composition path; an opaque success does not qualify transparency, or vice versa. Changing configuration/voice/style requires new matching qualification.
7. **Generate** creates one scene. **Produce** snapshots order, revisions and global settings, cancels conflicting work, locks generation-affecting controls and generates missing/stale clips sequentially. Cancel and existing-media playback remain available. Failed/canceled jobs retain reusable successful clips and always unlock after cleanup. Canceling locally does not promise remote cancellation or avoided charges.
8. Downloads appear only after final media, snapshot and transcript validation. Clips are normalized and muxed with hard cuts—not appended as MP4 bytes or relabeled WebM. Edits invalidate the final downloads and mark prior scene clips stale.

Local JPEG/PNG backgrounds never leave the browser. Avatar outputs must come from the documented Microsoft-managed `stttssvcprod*.blob.core.windows.net/batchsynthesis-output/` location; credentials are never sent to download URLs. Unsupported/custom output origins are rejected, not proxied. Actual VP9 alpha decoding is required before background composition; an opaque white video is never accepted as a background success.

Limits are ceilings, not device guarantees: 20 scenes, five minutes per scene, 30 minutes total; conservative 384 MiB media-operation input/encoded-frame budget, 256 MiB avatar download budget and 64 MiB Speech audio limit. Animation frames are encoded in one-second batches and released. WASM memory/resource errors remain explicit failures; there is no lower-resolution success fallback.

## Research and transcript behavior

Streaming/nonstreaming use the same Responses request builder with `store: true`, built-in `web_search` and only the fixed Microsoft Learn MCP endpoint with `require_approval: never`. Credentials stay on the validated Foundry request. Attachments are untrusted UTF-8 TXT/MD reference data: 10 files, 1 MiB each, 5 MiB combined. A conservative UTF-8-byte token upper bound reserves 24,000 input tokens; deployment context limits still apply, and nothing is silently truncated.

Actual successful Web Search execution is required for new factual content; Microsoft claims additionally require actual Learn output. Source annotations/tool-returned URLs are preserved; model-invented source URLs are not accepted as provenance. Missing tool execution permits at most two additional research attempts. Tool failure or missing provenance yields a clearly unresearched draft, requiring separate explicit consent to apply. Editorial revisions send `tools: []`, retain applicable existing sources and are not newly researched.

Only validated completed researched/editorial turns advance `previous_response_id`. Malformed, incomplete, canceled or reset responses never overwrite scenes or advance continuity. New chat/configuration resets the local chain, **not** Azure-retained data. Prompt/file transmission, automatic Learn approval, research data boundaries and cloud retention are disclosed before Send.

SSML is parsed, subset-validated and single-voice; the toolbar voice is authoritative. External entities/audio/resources and unsupported markup are rejected before synthesis. Spoken aliases are used in transcripts, not markup/citations.

Embedded avatar subtitle timing is preferred when returned. Otherwise phrase cues are distributed proportionally over measured scene duration, offset by actual preceding durations, escaped and validated for positive/nonoverlapping bounds. Approximate scenes are identified in a `WEBVTT NOTE` and beside downloads. Final playback includes the VTT track.

## Validation versus release qualification

Local unit and Chrome/Edge browser tests cover contracts, research mocks/SSE/continuity, storage/privacy, safe markup, scene editing, production locks/cancellation, real browser codecs/media/alpha, compiled assets, isolation startup/fallback and a genuinely CORS-denied loopback fixture.

Validated on 2026-10-31: strict typecheck and production build passed; **36 unit tests** passed; **32 browser tests** passed (16 each on Chrome **156.0.8078.76** and Edge **156.0.4314.58**). Both browsers passed actual threaded and blocked-worker single-thread local fixtures. No test servers were left listening on ports 4173/4174.

**This is not live Azure or deployed GitHub Pages qualification.** Before advertising or publishing an end-to-end supported deployment, separately authorize and verify:

- Responses deployment authentication/CORS, actual Web Search/Learn execution, permissions and billing.
- Speech voices/synthesis for the selected resource/key/voice.
- Regional avatar/style access, quota, submission/poll/download CORS, subtitle output and actual transparent output/composition.
- Real narration, scene order, selected backgrounds, final playback and resource limits with representative long/multiscene content.
- Deployed `/syntasia/` isolation/worker updates, threaded and fallback media, CORS boundaries and asset MIME/base paths. Mobile/other browsers are unqualified.
- Distribution licensing. The FFmpeg wrapper is MIT; the bundled `@ffmpeg/core`/`core-mt` builds declare **GPL-2.0-or-later** and include GPL codecs. Package metadata is shipped with the cores, but publishing binaries additionally requires a reviewed GPL license/corresponding-source distribution arrangement. Caveat uses OFL and its license is copied locally; Pico uses MIT. Do not treat npm installation as license clearance.

Service API references were checked against Microsoft Learn's [batch synthesis](https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech-avatar/batch-synthesis-avatar), [properties](https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech-avatar/batch-synthesis-avatar-properties), [standard avatars](https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech-avatar/standard-avatars) and [regional availability](https://learn.microsoft.com/azure/ai-services/speech-service/regions) on 2026-10-31. The adapter uses API version `2024-08-01`; documentation is not proof of your resource's capability.

No deployment or live service calls were performed. Do not trigger the existing Pages publishing workflow until deployment and redistribution are separately authorized.
