# Mini-Drama Creation Studio

This workspace creates **AI-powered mini-dramas** -- short-form animated drama series (1-minute episodes, 20-100 per series) designed for mobile consumption. Each series has consistent characters, a locked visual aesthetic, and episodes produced through Venice AI (images + video) and ElevenLabs (voices, SFX, music).

The user interacts entirely through natural language conversation -- never ask them to run commands manually.

## What This Project Does

1. **Creates a series** with concept, genre, setting, and locked visual aesthetic
2. **Designs characters** with 4-angle reference images for visual consistency -- women are always beautiful/elegant with hourglass figures and classy cleavage; men are always extremely handsome
3. **Auditions voices** per character via ElevenLabs, locked for series consistency
4. **Workshops episode scripts** collaboratively (user provides concept, we draft together)
5. **Generates storyboard panels** at 9:16 (vertical/mobile-first) using Venice AI
6. **Generates video clips** with native audio (dialogue, SFX, ambient) using Kling V3 Pro (action) and Veo 3.1 (atmosphere)
7. **Assembles final episodes** with burned-in subtitles, optional ElevenLabs audio overrides, and background music

## How To Operate

**You execute everything on behalf of the user.** Run `npx tsx src/mini-drama/cli.ts` commands via Bash. Examples:

| User says | You run |
|-----------|---------|
| "Create a new series" | `npx tsx src/mini-drama/cli.ts new-series -n "<name>" --concept "<concept>" -g "<genre>" --setting "<setting>"` |
| "Show me style options" | `npx tsx src/mini-drama/cli.ts explore-aesthetic -p output/<series>` |
| "Use the manhwa style" | `npx tsx src/mini-drama/cli.ts set-aesthetic -p output/<series> --style "..." --palette "..." --lighting "..." --lens "..." --film "..."` |
| "Add a female lead" | `npx tsx src/mini-drama/cli.ts add-character -p output/<series> --name "VICTORIA" --gender female --age "mid 20s" --description "..." --wardrobe "..."` |
| "Audition voices for Victoria" | `npx tsx src/mini-drama/cli.ts audition-voices -p output/<series> -c "VICTORIA"` |
| "Lock Victoria with that voice" | `npx tsx src/mini-drama/cli.ts lock-character -p output/<series> -c "VICTORIA" --voice-id "<id>"` |
| "Storyboard episode 1" | `npx tsx src/mini-drama/cli.ts storyboard-episode -p output/<series> -e 1` (auto-refines with multi-edit by default) |
| "Storyboard without refinement" | `npx tsx src/mini-drama/cli.ts storyboard-episode -p output/<series> -e 1 --no-refine` |
| "Fix Sera in shot 4" | `npx tsx src/mini-drama/cli.ts fix-panel -p output/<series> -e 1 -s 4 -c "SERA"` |
| "Generate videos for episode 1" | `npx tsx src/mini-drama/cli.ts generate-videos -p output/<series> -e 1` |
| "Replace dialogue with ElevenLabs" | `npx tsx src/mini-drama/cli.ts override-audio -p output/<series> -e 1 --dialogue` |
| "Generate background music" | `npx tsx src/mini-drama/cli.ts generate-music -p output/<series> -e 1 --prompt "dramatic tension"` |
| "Assemble the episode" | `npx tsx src/mini-drama/cli.ts assemble-episode -p output/<series> -e 1` |
| "Produce the whole episode" | `npx tsx src/mini-drama/cli.ts produce-episode -p output/<series> -e 1` |

### Finding the series directory

After creating a series, the project is saved to `output/<series-slug>/`. Check `output/` to find the right directory, or run `npx tsx src/mini-drama/cli.ts list-series`.

## Pipeline Order

1. **New Series** -- create series with concept, genre, setting
2. **Explore Aesthetic** -- generate comparison samples, user picks a style
3. **Set Aesthetic** -- lock the chosen visual style
4. **Add Characters** -- design characters with reference images (requires aesthetic)
5. **Audition Voices** -- generate ElevenLabs voice samples per character
6. **Lock Characters** -- finalize appearance + voice
7. **Workshop Episode Script** -- collaboratively write the shot-by-shot script (target: 60s)
8. **Storyboard Episode** -- generate panel images
9. **QA Storyboard** -- analyze panels for character/setting consistency (automatic, uses vision)
10. **Generate Videos** -- animate panels with dialogue + delivery cues in prompt; model generates voice, SFX, ambient
11. **Generate Ambient Layers** -- create rain/crowd/quiet-night ambient beds via ElevenLabs SFX (22s each, looped)
12. **Audio Post-Production Mix** -- `scripts/mix-episode-audio.ts` -- per-shot volume/fades + layered ambient beds + subtitles
13. *(Optional)* **Generate Music** -- create background music track via ElevenLabs (mixed during assembly)
14. *(Optional)* **Override Audio** -- replace dialogue with ElevenLabs TTS for cross-episode voice consistency (`--with-tts`)

### Script Workshop (Step 7) -- Collaborative, Not Automated

When the user wants to create an episode script:
1. Ask for the episode concept/outline
2. Draft a shot-by-shot script targeting 60 seconds total
3. Each shot specifies type, duration, videoModel (action/atmosphere), characters, dialogue with **delivery cues** (tone/manner/emotion), camera movement
4. Delivery cues are critical -- they control how the video model voices the line (e.g., "in a dominant, irritated tone", "nervously", "whispering seductively")
5. Present to user for review and iterate until approved
6. Save as `output/<series>/episodes/episode-NNN/script.json`

#### `panelDescription` -- Separating Image from Video Prompts

For action shots with sequential action (e.g., "Marcus chases the thief, punches him, grabs the device"), the `description` field describes the **full video action**. But the image model only generates a **single frame** -- feeding it sequential action causes comic-panel layouts.

Use the optional `panelDescription` field to provide a single-frame description for the starting image:

```json
{
  "description": "MARCUS chases the thief, punches him, grabs the device, thief runs off...",
  "panelDescription": "Close-up of MARCUS's face in the rain, eyes wide with shock, three-quarter angle."
}
```

- `panelDescription` → used by `buildImagePrompt()` for panel generation (single frame)
- `description` → used by `buildVideoPrompt()` for video generation (full action sequence)
- If `panelDescription` is absent, both use `description` (fine for static/dialogue shots)

**When to use `panelDescription`:**
- Action shots with "A happens, then B, then C" language
- Shots where the starting frame composition differs from the overall action
- Any shot where the image model produces comic-panel layouts

**When NOT needed:**
- Dialogue shots (static framing, no sequential action)
- Establishing shots (single composition)
- Close-ups (single frame by nature)

### Panel Generation -- Two-Pass Pipeline (Step 8)

Storyboard generation is a **two-pass process by default**:

**Pass 1 (Generate)**: Generate base panels from prompts using `nano-banana-pro` with `cfg_scale: 10` and a fixed series-level `aestheticSeed`. The prompt front-loads the aesthetic description with specific style, palette, lighting, and lens characteristics, and repeats it at the end to bookend the scene content. Character prompts include full descriptions with gender-specific base traits. After generation, Venice's WebP-disguised PNGs are auto-converted to real PNGs via ffmpeg.

**Pass 2 (Refine via Multi-Edit)**: Each panel is passed through Venice's multi-edit endpoint (`POST /api/v1/image/multi-edit`) using `nano-banana-pro-edit`:
- **Character shots**: The panel + up to 2 character face reference images are sent as layers. The model aligns character appearance to match the references.
- **Non-character shots** (establishing, inserts, title cards): The panel + a "style anchor" image (the first character shot) are sent. The model harmonizes the visual style to match.
- **Skip logic**: Panels that already have a `-pre-fix.png` or `-pre-style.png` backup are skipped unless they were newly generated in the current run. This prevents re-refining all panels when adding a single new shot.
- **Aspect ratio restoration**: Multi-edit always returns 1024x1024. The pipeline auto-crops and scales back to the original 9:16 (768x1376) dimensions.

This ensures both **character consistency** (faces/bodies match references) and **aesthetic consistency** (all panels share the same visual treatment).

```bash
# Default: generate + refine (recommended)
npx tsx src/mini-drama/cli.ts storyboard-episode -p output/<series> -e 1

# Skip refinement (generate only)
npx tsx src/mini-drama/cli.ts storyboard-episode -p output/<series> -e 1 --no-refine

# Use a different edit model
npx tsx src/mini-drama/cli.ts storyboard-episode -p output/<series> -e 1 --edit-model nano-banana-2-edit

# Custom cfg_scale (default 10)
npx tsx src/mini-drama/cli.ts storyboard-episode -p output/<series> -e 1 --cfg-scale 8
```

### Aesthetic Requirements

Aesthetics must be **extremely prescriptive** to produce consistent results across shots. Vague descriptions like "Webtoon drama illustration" produce wildly different interpretations per call.

**Good aesthetic** (specific rendering instructions):
```json
{
  "style": "Korean manhwa romance illustration, clean sharp digital linework, semi-realistic character proportions with large expressive eyes, smooth cel-shaded rendering with soft gradients",
  "palette": "dark charcoal backgrounds (#2B2D42), steel blue (#4A6FA5) and deep violet (#6B3FA0) neon accents, cool desaturated base tones with selective neon color pops",
  "lighting": "dramatic rim lighting from neon signs, volumetric light rays through rain, strong key light on faces with soft fill",
  "lensCharacteristics": "shallow depth of field with bokeh neon circles, cinematic framing adapted to 9:16 vertical",
  "filmStock": "clean digital illustration with no film grain, smooth color gradients, high contrast between dark environments and neon highlights"
}
```

**Bad aesthetic** (too vague, model interprets differently each call):
```json
{
  "style": "Webtoon drama illustration",
  "palette": "moody desaturated with selective color",
  "lighting": "atmospheric with volumetric light"
}
```

### Series Aesthetic Seed

Every series should have an `aestheticSeed` in `series.json` -- a fixed numeric seed used for ALL storyboard panels. This gives the model the same random initialization across every shot, reducing visual drift. Set it once when creating the series:

```json
"aestheticSeed": 88442211
```

### Panel Fixing (Post-QA)

When QA flags panels with character issues, use `fix-panel` to correct them in-place without regenerating the entire panel:

```bash
# Fix Sera's appearance in shot 4
npx tsx src/mini-drama/cli.ts fix-panel -p output/<series> -e 1 -s 4 -c "SERA"

# Fix both characters in shot 6
npx tsx src/mini-drama/cli.ts fix-panel -p output/<series> -e 1 -s 6 -c "MARCUS,SERA"

# Custom edit instruction
npx tsx src/mini-drama/cli.ts fix-panel -p output/<series> -e 1 -s 4 --prompt "Make the woman's dress a deep plunging V-neckline showing generous cleavage. Make her extremely busty."
```

Multi-edit takes the panel + up to 2 character reference images and corrects the characters while keeping the composition/background intact. The original panel is archived as `shot-NNN-pre-fix.png`.

Available edit models: `nano-banana-pro-edit` (default), `gpt-image-1-5-edit`, `grok-imagine-edit`, `qwen-edit`, `flux-2-max-edit`, `seedream-v4-edit`, `seedream-v5-lite-edit`.

### Storyboard QA (Step 9) -- Automatic After Panel Generation

After generating storyboard panels, **always run QA before proceeding to video generation.** This step uses vision to compare each panel against character reference images and descriptions, checking for:

- **Character consistency**: hair color/length/style, facial features, body type (especially bust/figure for female characters), wardrobe, skin tone
- **Setting continuity**: time of day, weather, location style, background elements across sequential panels
- **Aesthetic adherence**: art style, color palette, lighting match the locked aesthetic

The QA agent reads character references from `characters/<name>/front.png`, compares against each panel, and produces a report rating each panel PASS / FLAG-CRITICAL / FLAG-MODERATE / FLAG-LOW.

Flagged panels should be regenerated before proceeding. Delete the flagged PNG and re-run `storyboard-episode` (it skips existing panels).

Use `/qa-storyboard` to invoke, or it runs automatically after every `storyboard-episode` generation.

### Aesthetic Selection (Step 2) -- Auto-Generate, Don't Discuss

When the user reaches the aesthetic step, **do not ask them to describe a style**. Instead:
1. Generate 5-7 visual samples automatically
2. Show each inline with description
3. Let them pick one, request hybrids, or ask for more options
4. Once chosen, run set-aesthetic

## Video Model Selection

- **Action/movement shots** (dialogue with gestures, walking, fights): `kling-v3-pro-image-to-video`
- **Atmosphere/static shots** (establishing, close-ups, inserts): `veo3.1-fast-image-to-video`
- Each shot in the script specifies `videoModel: "action" | "atmosphere"`
- Venice API `reference_image_urls` (up to 4) used for character consistency in video

**CRITICAL: Every video prompt MUST end with:** `"No background music. Only generate dialogue, ambient sound, and sound effects."`
This is appended automatically by the prompt builder. Music is always a separate ElevenLabs layer.

### Transition-Aware Frame Handling

NOT every shot needs `end_image_url` or frame chaining from the previous shot. The video generator uses the shot's `transition` field to decide:

**`end_image_url`** (Kling only -- targets the next panel as the ending composition):
- ONLY used for: `DISSOLVE`, `MATCH CUT`, `MORPH`, `WIPE`, `CROSSFADE`
- NOT used for: `CUT`, `FADE`, `SMASH CUT` -- these end naturally

**Frame chaining** (using last frame of previous video as `image_url` for continuity):
- ONLY used for: `DISSOLVE`, `MATCH CUT`, `MORPH`, `WIPE`, `CROSSFADE`, `FADE`
- NOT used for: `CUT`, `SMASH CUT` -- these use the panel image directly as the starting frame

This prevents over-constraining the animation. A basic `CUT` between shots should feel like a natural edit, not a morph from one composition to another. The shot's own panel image is the right starting point for a cut.

When writing scripts, use transitions intentionally:
- `CUT` (default) -- sharp edit, no frame linking needed
- `FADE` -- gentle transition, chain start frame but no end frame target
- `DISSOLVE` -- smooth blend, chain start + target end frame
- `MATCH CUT` -- compositional match, chain start + target end frame
- `SMASH CUT` -- abrupt jarring cut, no linking at all

### Frame Chaining vs Panel Start -- Character Consistency Trade-off

Frame chaining (using previous video's last frame as next video's start) preserves **visual continuity** between shots but can break **character consistency** when a new character appears in the next shot. The video model has no reference for the new character's face/body -- it will invent an appearance.

**Use panel image (not chaining) when:**
- A new character enters the scene who wasn't in the previous shot
- The shot type changes dramatically (e.g., wide to close-up)
- Character consistency matters more than frame-to-frame continuity
- The transition is `CUT` or `SMASH CUT`

**Use frame chaining when:**
- Same characters continue across shots
- Smooth visual continuity is critical (DISSOLVE, FADE)
- The action flows directly from the previous shot

**Kling v3 pro limitations:**
- `reference_image_urls` parameter is NOT supported (returns 400 error)
- Character consistency in video relies entirely on the starting image and prompt descriptions
- For critical character consistency, always use the multi-edit refined panel as the starting frame

### Image Prompt Anti-Patterns (Learned)

These cause recurring issues in panel generation:

1. **Sequential action in descriptions** → comic-panel layouts. Fix: use `panelDescription` for single-frame.
2. **Characters facing camera** → breaks immersion in scene shots. Fix: auto-added "characters are engaged in the scene, NOT looking at the camera" for non-portrait shots.
3. **Rain scenes** → model adds umbrellas unprompted. Fix: "umbrella, holding umbrella" added to negative prompt.
4. **Vague body orientation** → twisted poses (upper body facing camera, lower body walking away). Fix: explicitly describe full-body orientation ("seen entirely from behind", "does NOT turn").
5. **Direction of movement matters enormously** in video prompts. "runs toward camera" vs "runs away from camera" produces completely different results. Always specify direction relative to camera.
6. **Object ownership must be explicit.** If a character is holding something, say WHO has it. Otherwise the model may give it to the wrong person.
7. **Spatial relationships between characters** need explicit left/right/foreground/background positioning. "SERA on the left, MARCUS on the right" prevents random placement.

### Video Prompt Patterns (Learned)

- **"runs toward camera"** -- character charges at lens, dramatic
- **"runs away from camera"** -- character recedes into distance
- **"handheld tracking backward, shaky cinematic"** -- action movie chase feel
- **"Matrix-style horizontal 180-degree orbit"** -- bullet-time spin around character
- **"static camera, Marcus runs toward camera"** -- camera holds, character fills frame
- **`end_image_url`** -- Kling targets this as the ending composition. Great for transition shots.
- **Voice consistency** is inherently limited with native model voices. Each generation produces a different voice. For cross-shot consistency, use ElevenLabs TTS override.

### Assembly -- Normalization Required

**CRITICAL**: Never use `-c copy` concat for Kling outputs. Different generations have subtle codec/container parameter differences that cause duration reporting errors (e.g., 83s of clips reported as 251s). Always re-encode to identical params:

```
ffmpeg -y -i input.mp4 -c:v libx264 -preset fast -crf 18 -r 24 -c:a aac -ar 44100 -ac 2 -b:a 192k output.mp4
```

The assembler now normalizes all clips automatically before concat.

### Sound Production -- Audio Post-Production Mix (Locked)

Each shot's native audio is generated independently by the video model, causing hard audio cuts between shots -- especially noticeable with continuous ambient sounds like rain, crowd noise, and city ambience. A dedicated audio post-production script (`scripts/mix-episode-audio.ts`) handles this.

#### The Problem

AI video models generate audio per-shot with no awareness of adjacent shots. Volume levels can vary by 10+ dB between clips. Ambient textures (rain intensity, crowd density, city hum) change randomly. Hard-cutting these together sounds jarring.

#### The Solution: Layered Ambient Beds + Per-Shot Volume Control

**Multiple ambient layers** -- not one blanket track. Each layer has per-shot volume envelopes that match the episode's dramatic structure:

1. **Rain layer** (`ambient-rain-heavy.mp3`): Continuous rain, volume varies by section. Fades gradually during action (never hard-cuts to zero), returns after action resolves.
2. **Crowd layer** (`ambient-crowd.mp3`): Urban bustle for market/street scenes, absent during intimate moments.
3. **Quiet night layer** (`ambient-quiet-night.mp3`): Low ambient hum for close-ups, dialogue, and emotional scenes.

**Per-shot native audio processing:**
- Volume ducking per shot type (dialogue shots keep 85% native, action 60-70%, contemplation 45%, title card 30%)
- Fade envelopes (150ms in/out) at every shot boundary to smooth hard cuts
- No `loudnorm` -- it distorts dialogue dynamics. Use manual volume control only.

#### Generating Ambient Layers

```bash
# Generate each layer via ElevenLabs SFX (max 22s, will be looped)
npx tsx scripts/generate-ambient-bed.ts "<prompt>" "<output-path>" 22

# Rain:
npx tsx scripts/generate-ambient-bed.ts \
  "Heavy steady rain falling on city streets at night, rhythmic rain on metal awnings, puddles splashing, wet concrete, continuous steady loop, no thunder, no music, no voices" \
  output/<series>/episodes/episode-NNN/audio/ambient-rain-heavy.mp3 22

# Crowd:
npx tsx scripts/generate-ambient-bed.ts \
  "Busy outdoor night market crowd ambience, people talking in background, footsteps on wet pavement, distant vendor calls, urban nightlife bustle, no music, no rain, continuous loop" \
  output/<series>/episodes/episode-NNN/audio/ambient-crowd.mp3 22

# Quiet night:
npx tsx scripts/generate-ambient-bed.ts \
  "Quiet empty city street at night, distant urban hum, far away traffic, gentle wind, lonely atmospheric night ambience, no rain, no music, no voices, continuous loop" \
  output/<series>/episodes/episode-NNN/audio/ambient-quiet-night.mp3 22
```

#### Running the Audio Mix

```bash
npx tsx scripts/mix-episode-audio.ts output/<series>/episodes/episode-NNN
```

This script:
1. Extracts native audio from each shot, applies volume + fade envelopes
2. Concatenates processed native audio
3. Builds each ambient layer with per-shot volume envelopes (looped to full duration)
4. Mixes all layers (native + rain + crowd + quiet) via `amix`
5. Muxes final audio onto concatenated video
6. Burns subtitles with locked settings

#### Volume Design Principles (Learned from Ep 1)

- **Ambient layers should fade gradually, never hard-cut.** Going from rain=0.25 to rain=0 between adjacent shots creates an audible cliff. Fade over 2-3 shots instead.
- **Rain fades out during chase/action** but gradually (0.25 → 0.18 → 0.12 → 0.08), returns when action resolves.
- **Dialogue shots need highest native volume** (85%) -- the AI-generated voice is the primary audio. Keep ambient layers low (0.05-0.15) during dialogue.
- **Crowd layer only where crowds exist** -- don't use it in intimate/isolated scenes.
- **Title card: fade everything** -- native to 30%, all ambients low, 1.5s fade out.

#### What NOT to Do

- **Don't use `loudnorm`** -- it squashes dialogue dynamics and makes voices sound unnatural. Use manual per-shot volume control instead.
- **Don't use audio crossfades between shots** -- visually continuous shots often have discontinuous audio, making crossfades unpredictable.
- **Don't use a single ambient bed** -- one track can't cover the episode's dramatic range. Multiple layers with per-section volumes sound far more natural.
- **Don't hard-cut ambient layers to zero** -- always fade gradually over multiple shots.

#### Audio Files Location

```
output/<series>/episodes/episode-NNN/audio/
  ambient-rain-heavy.mp3   -- Rain layer (22s, looped)
  ambient-crowd.mp3        -- Crowd layer (22s, looped)
  ambient-quiet-night.mp3  -- Quiet night layer (22s, looped)
  music.mp3                -- Background music (optional, via ElevenLabs)
  dialogue-shot-NNN.mp3    -- TTS overrides (optional)
```

### Per-Shot Trim and Flip

Shots often need the first or last N seconds trimmed after generation (bad starts from chaining, unwanted endings). Add `trimStart`, `trimEnd`, and `flip` to the shot in `script.json`:

```json
{
  "shotNumber": 6,
  "trimStart": 1,
  "trimEnd": 0,
  "flip": false,
  ...
}
```

The assembler applies these automatically during normalization. No need to manually ffmpeg individual clips.

### Subtitle Burn-In Settings (Locked)

Subtitles are burned into the final assembled video using ffmpeg's `subtitles` filter. These settings are locked:

```bash
ffmpeg -y -i episode-final-nosubs.mp4 \
  -vf "subtitles=subtitles.srt:force_style='FontName=D-DIN Condensed,FontSize=11,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=0.8,Shadow=0,Alignment=2,MarginV=100,Spacing=0.5'" \
  -c:v libx264 -preset fast -crf 18 -c:a copy episode-final.mp4
```

**Key parameters:**
- **Font**: D-DIN Condensed (geometric, sci-fi typeface -- must be installed)
- **FontSize**: 11 (in ASS coordinates, renders ~73px on 1924px-tall video)
- **MarginV**: 100 (positions text in the lower-third, above bottom but below center)
- **Outline**: 0.8 (thin black outline for readability without bulk)
- **Shadow**: 0 (clean, no drop shadow)
- **Spacing**: 0.5 (slight letter spacing for futuristic feel)
- **Alignment**: 2 (bottom center)
- **Color**: white text, black outline

**Workflow:**
1. Always save a no-subtitles backup as `episode-NNN-final-nosubs.mp4` before burning
2. Generate `subtitles.srt` from script dialogue with timings calculated from cumulative shot durations
3. Burn subtitles into the final video
4. Do NOT use `original_size` parameter -- it causes incorrect scaling. Use default ASS play resolution.

**SRT timing**: Calculate each shot's start time by summing actual durations of all preceding shots (use `ffprobe`, not script target durations). Place dialogue subtitles ~2-3s after the shot starts -- AI-generated dialogue typically begins 1-2s into a shot. Expect to iterate: render, watch, adjust timing, re-burn. The no-subs backup makes re-burning fast (subtitle burn only, no audio remix needed).

### Common Production Workflow Patterns

**Shot insertion** (done ~8 times during Ep 1 production):
1. Rename files backwards to make room: `for old in 015 014 013...; do mv shot-${old}* shot-$(old+1)*`
2. Update `script.json` with new shot, renumber all shots sequentially
3. Run `storyboard-episode` -- only generates missing panels, skips existing
4. Generate video (often chained from previous shot's last frame)

**Single-shot video regen** (done ~12 times):
1. Extract last frame from previous shot: `ffmpeg -ss <dur-0.05> -i prev.mp4 -frames:v 1 lastframe.png`
2. Archive old video: `mv shot-NNN.mp4 shot-NNN-vN.mp4`
3. Generate new video using last frame as `image_url` (for continuity) or panel (for character consistency)

**When to chain vs use panel:**
- Chain from last frame: same characters continue, action flows directly
- Use panel: new character enters, different angle/composition, character consistency critical

## Audio Strategy: Native Model Voices + Delivery Cues

Video models (Kling V3, Veo 3.1) generate native audio including lip-synced dialogue, SFX, and ambient sound. **The video model IS the voice actor.** Vocal performance is controlled through **delivery cues** in the prompt -- matching the proven Framer/Sora workflow.

**How dialogue works in video prompts:**
Each shot's dialogue includes a `delivery` field describing tone/manner/emotion:
```json
{ "character": "VICTORIA", "line": "You crossed the line tonight.", "delivery": "in a dominant, irritated tone" }
```
This generates the video prompt: `VICTORIA says in a dominant, irritated tone: "You crossed the line tonight."`

Good delivery cues (controls how the model voices the line):
- `"in a dominant, irritated tone"` -- angry authority
- `"in a cold manner"` -- detached menace
- `"nervously"` -- anxious uncertainty
- `"whispering seductively"` -- intimate intensity
- `"with quiet fury"` -- restrained anger
- `"sarcastically"` -- mocking tone

**Default pipeline** (`produce-episode`):
1. Generate videos with `audio: true` + dialogue/delivery in prompt -> model generates voice, SFX, ambient
2. Generate background music via ElevenLabs
3. Assemble: stitch clips + layer music + burn subtitles

**Voice consistency mode** (`produce-episode --with-tts`):
If native model voices aren't consistent enough across many episodes, add `--with-tts` to replace dialogue with ElevenLabs TTS using locked character voices. This ducks native audio to 20% (preserving ambient/SFX) and overlays the consistent ElevenLabs voice.

**ElevenLabs dialogue replacement** (optional, via `override-audio --dialogue`):
- TTS files are named by shot number: `dialogue-shot-001.mp3`, `dialogue-shot-003.mp3`
- During assembly, matching shots get native audio ducked to 20% with TTS overlaid
- Use `--native-volume 0.3` to adjust (0 = mute native, 1 = full native + TTS)

## Character Design Requirements

**Visual** (enforced in all image/video prompts):
- Women: beautiful, elegant, hourglass figure, classy cleavage, skin showing, detailed features
- Men: extremely handsome, strong jawline, styled appearance, detailed features
- Both: style consistency per series aesthetic

**Voice** (enforced in all video prompts where the character speaks):
Every character must have a detailed `voiceDescription` that anchors the video model's voice generation. This is the audio equivalent of the exhaustive visual description -- it gives the model a consistent vocal identity to target.

A good voice description covers:
- **Pitch/register**: deep baritone, low contralto, youthful tenor, bright soprano
- **Timbre/texture**: smooth, gravelly, silky, raspy, warm, crisp, resonant
- **Pacing/cadence**: measured, rapid, unhurried, deliberate, staccato
- **Accent/inflection**: American, British, slight Eastern European, urban, unplaceable
- **Personality in voice**: authoritative, playful, breathy, analytical, earnest

Example: `"low, silky contralto with an almost musical quality, unhurried deliberate pacing, faintly breathy, hints of an unplaceable European accent, speaks with quiet intensity"`

The voice description is injected into every video prompt as: `SERA (voice: low, silky contralto...) says in a dominant tone: "..."`

## Key Architecture

```
src/
  series/         -- SeriesState types, create/load/save series.json
  elevenlabs/     -- ElevenLabs API client (TTS, SFX, music, voice audition)
  mini-drama/     -- Prompt builder, video generator, subtitle gen, assembler
  venice/         -- Venice AI API client (image + video generation)
  storyboard/     -- Shot planning, prompt templates (shared with legacy pipeline)
  characters/     -- Character profiling (shared with legacy pipeline)
  parsers/        -- Fountain + PDF parsing (legacy pipeline)
  assembly/       -- Remotion scaffolding (legacy pipeline)
  output/         -- HTML storyboard renderer (legacy pipeline)
  config.ts       -- Legacy project state
  cli.ts          -- Legacy CLI (screenplay pipeline)
```

## Output Structure

```
output/<series>/
  series.json                     -- Series state and metadata
  characters/<NAME>/
    front.png, three-quarter.png, profile.png, full-body.png
    character.json                -- Description + locked voice_id
    voice-samples/                -- ElevenLabs audition clips
  aesthetic-samples/
    *.png + compare.html
  episodes/episode-NNN/
    script.json                   -- Shot-by-shot episode script
    scene-001/
      shot-001.png                -- Panel image
      shot-001.video.json         -- Video config + metadata
      shot-001.mp4                -- Generated video (with native audio)
    audio/
      dialogue-*.mp3              -- Optional ElevenLabs TTS overrides
      sfx-*.mp3                   -- Optional ElevenLabs SFX overrides
      music.mp3                   -- Background music (ElevenLabs)
    subtitles.srt                 -- Generated subtitle file
    episode-NNN-final.mp4         -- Assembled final episode
```

## Environment

- `VENICE_API_KEY` in `.env` -- Venice AI image + video generation
- `ELEVENLABS_API_KEY` in `.env` -- ElevenLabs TTS, SFX, music
- `ffmpeg` and `ffprobe` on PATH -- video/audio processing
- Node.js with TypeScript (ES modules, Node16 resolution)

## Slash Commands

Mini-drama pipeline commands in `.claude/commands/`:
- `/new-series` -- create a new mini-drama series
- `/explore-aesthetic` -- generate aesthetic comparison samples
- `/add-character` -- design and generate character reference images
- `/audition-voices` -- generate ElevenLabs voice samples per character
- `/lock-character` -- finalize character with selected voice
- `/workshop-episode` -- collaboratively write episode script
- `/storyboard-episode` -- generate panel images for review
- `/generate-episode-videos` -- generate video clips with native audio
- `/assemble-episode` -- stitch video + music + subtitles
- `/fix-panel` -- fix character appearance in a panel using Venice multi-edit with references
- `/qa-storyboard` -- analyze panels for character/setting consistency (vision-based)
- `/produce-episode` -- full pipeline (storyboard -> video -> assembly)

## Venice Image Format -- WebP Workaround

Venice API returns images as WebP internally even when saved as `.png`. The Cursor IDE image viewer cannot display WebP files (errors with "Mime type image/webp does not support decoding"). After generating any images via Venice, convert them to actual PNG using ffmpeg:

```bash
cd <image-directory> && for f in *.png; do
  actual=$(file -b "$f" | head -c 4)
  if [ "$actual" = "RIFF" ]; then
    ffmpeg -i "$f" -y "${f%.png}_conv.png" 2>/dev/null && mv "${f%.png}_conv.png" "$f"
  fi
done
```

Always run this conversion after `explore-aesthetic` and `add-character` image generation before displaying images to the user.

## Active Series

No active series are included in this fresh copy. Start by creating a new series in `output/`.

## Important

- Never ask the user to run terminal commands. Execute them yourself via Bash.
- Always report progress and results in plain language.
- When setting aesthetics, generate visual samples automatically -- don't ask users to describe styles. Show images and let them react.
- For character design, always include the attractiveness traits in prompts.
- If a Venice API call fails, report the error and suggest next steps.
- Never delete generated videos when regenerating. Archive previous versions.

---

# Legacy: Screenplay-to-Storyboard Pipeline

The original pipeline for converting full screenplays into storyboards is still available via `npx tsx src/cli.ts`. The legacy pipeline uses .fountain/.pdf files as input and generates 16:9 panels for film-format storyboards.

## Legacy CLI Examples

| User says | You run |
|-----------|---------|
| "Load my screenplay" or "ingest captain-jax" | `npx tsx src/cli.ts ingest screenplays/captain-jax.fountain` |
| "Lock the characters" | `npx tsx src/cli.ts lock-characters -p output/<project>` |
| "Lock just SARAH" | `npx tsx src/cli.ts lock-characters -p output/<project> -c SARAH` |
| "Set a film noir look" | `npx tsx src/cli.ts set-aesthetic -p output/<project> --style "Film noir" --palette "high contrast black and white" --lighting "hard shadows, venetian blind patterns" --lens "wide-angle distortion, deep focus" --film "35mm Kodak Tri-X 400"` |
| "Storyboard scene 1" | `npx tsx src/cli.ts generate-scene -p output/<project> -s 1` |
| "Generate the full storyboard" | `npx tsx src/cli.ts generate-all -p output/<project>` |
| "Continue where we left off" | `npx tsx src/cli.ts generate-all -p output/<project> --skip-completed` |
| "Generate videos for scene 1" | `npx tsx scripts/generate-scene-videos.ts output/<project> 1` (uses Kling O3 Pro with frame chaining) |
| "Generate videos for scene 2 with Vidu" | `npx tsx scripts/generate-scene-videos.ts output/<project> 2 vidu-q3-image-to-video` |
| "Use Vidu Q3" | Switch video model to `vidu-q3-image-to-video` (1080p, up to 16s) |
| "Use Veo instead" | Switch video model to `veo3.1-fast-image-to-video` (8s only, 720p) |
| "Assemble the film" | `npx tsx src/cli.ts assemble -p output/<project>` |
| "Just scaffold the Remotion project" | `npx tsx src/cli.ts assemble -p output/<project> --scaffold-only` |
| "Assemble scene 1" | `npx tsx src/cli.ts assemble -p output/<project> --render-scene 1` |

### Finding the project directory

After ingesting a screenplay, the project is saved to `output/<screenplay-name>/`. Check `output/` to find the right project directory if unsure.

## Pipeline Order

The pipeline must be run in this order. If a user tries to skip a step, run the prerequisite steps first or warn them.

1. **Ingest** -- parse screenplay, extract scenes + characters
2. **Lock Characters** -- generate reference images for visual consistency (requires ingest)
3. **Set Aesthetic** -- generate comparison samples, let user pick, then set (see below)
4. **Generate Scene(s)** -- create storyboard panels (requires ingest + lock at minimum)
5. **Generate Videos** -- animate storyboard panels into video clips via Kling O3 Pro, Vidu Q3, or Veo 3.1 (requires panels)
6. **Assemble** -- build a Remotion project from video clips and render the final film (requires videos)

### Aesthetic Selection (Step 3) -- Auto-Generate, Don't Discuss

When the user reaches the aesthetic step, **do not ask them to describe a style or discuss options verbally**. Instead:

1. Read the screenplay's tone, setting, and genre from the ingested project data
2. Design 5-7 diverse aesthetic options that fit the material (e.g., neo-noir, clean dystopia, retro-futurism, pixel art, analog sci-fi, anime realism, etc.)
3. Write a Node.js script that calls Venice API directly to generate one sample image per aesthetic, all using the same representative scene from the screenplay
4. Save all samples to `output/<project>/aesthetic-samples/` and generate an HTML comparison page (`compare.html`)
5. Show the user each image inline and describe the aesthetic in a few words
6. Let them pick one, request hybrids, or ask for more options
7. Once chosen, run `set-aesthetic` with the selected parameters

This is the same approach used for any visual decision -- generate options, show them, let the user react to images rather than words.

If the user specifies a style upfront (e.g., "make it film noir"), skip the comparison and go straight to `set-aesthetic`.

## Slash Commands

These slash commands are defined in `.claude/commands/` and map to CLI operations:

- `/ingest-screenplay` -- parse a screenplay file
- `/lock-characters` -- generate character reference images
- `/set-aesthetic` -- auto-generate aesthetic comparison samples, then set the chosen style
- `/storyboard-scene` -- generate storyboard for one scene
- `/storyboard-all` -- generate storyboard for all scenes
- `/generate-videos` -- generate video clips from storyboard panels (Kling O3 Pro default, Vidu Q3 and Veo 3.1 also available)

When invoked, read the corresponding command file in `.claude/commands/` for full details, then execute the appropriate `npx tsx src/cli.ts` command.

## Key Architecture

```
src/
  parsers/       -- Fountain + PDF parsing, scene extraction
  characters/    -- Character profiling, description building, reference image management
  venice/        -- Venice AI API client (generate + edit endpoints)
  storyboard/    -- Shot planning, prompt building (with register extraction), panel assembly
  assembly/      -- Remotion project scaffolding, shot manifest builder
  output/        -- HTML storyboard renderer
  config.ts      -- Project state (saved as output/<project>/project.json)
  cli.ts         -- Commander-based CLI entry point
scripts/
  generate-scene-videos.ts   -- Video generation with frame chaining (primary video workflow)
  regenerate-scene1-panels.ts -- Reference impl for custom panel regeneration
  generate-all-videos.ts     -- Legacy batch video generation (no chaining)
  generate-aesthetic-samples.ts -- Aesthetic comparison image generation
```

## Character & Aesthetic Consistency Strategy

Four layers ensure visual consistency across all panels:
1. **Prescriptive aesthetic descriptions** -- extremely specific style, palette (with hex colors), lighting, and rendering instructions. Vague terms like "Webtoon" are insufficient.
2. **Fixed aesthetic seed** -- `aestheticSeed` in `series.json` ensures all panels use the same random initialization.
3. **Front-loaded + bookended aesthetic in prompts** -- the aesthetic string appears at both the start (`STYLE:`) and end (`STYLE REMINDER:`) of every image prompt, bookending the scene content.
4. **Multi-edit refinement (Pass 2)** -- every panel is refined via Venice multi-edit endpoint with character reference images (for character shots) or a style anchor image (for non-character shots). This is the primary visual anchoring mechanism.

### Why `nano-banana-pro` Can't Do It Alone

The generation model (`nano-banana-pro`) does NOT accept reference image payloads -- `image_references`, `image_1`/`image_2` params cause 400 errors. Each panel is generated independently from text alone. No matter how good the prompt is, text-to-image inherently produces style drift between calls.

The multi-edit endpoint (`/api/v1/image/multi-edit`) solves this by taking the generated panel + character/style reference images as inputs and correcting the output to match the references.

## Venice API

- **Generation Model**: `nano-banana-pro` (NOT `fluently-xl` -- retired)
- **Generate Endpoint**: `POST /api/v1/image/generate`
- **Multi-Edit Endpoint**: `POST /api/v1/image/multi-edit` -- takes up to 3 images (base + 2 reference layers), returns binary PNG
- **Multi-Edit Models**: `nano-banana-pro-edit` (default), `nano-banana-2-edit`, `gpt-image-1-5-edit`, `grok-imagine-edit`, `qwen-edit`, `flux-2-max-edit`, `seedream-v4-edit`, `seedream-v5-lite-edit`
- **Auth**: Bearer token via `VENICE_API_KEY` in `.env`
- **Image generation `cfg_scale`**: Use 10 (not 7) for storyboard panels to force strict prompt adherence

### Multi-Edit for Visual Anchoring

The multi-edit endpoint is the **primary visual anchoring mechanism** in the pipeline. It runs automatically as Pass 2 of storyboard generation (enabled by default, skip with `--no-refine`).

**For character shots** (shots with characters):
- `images[0]`: the generated panel (base image)
- `images[1]`: character 1's front reference image
- `images[2]`: character 2's front reference image (optional, max 2)
- `prompt`: instruction to match character appearance to references

**For non-character shots** (establishing, inserts, title cards):
- `images[0]`: the generated panel (base image)
- `images[1]`: a "style anchor" panel (the first character shot that was already refined)
- `prompt`: instruction to match visual style to the anchor

The model corrects appearance while preserving scene composition. This is far more reliable than regenerating from scratch.

**CRITICAL: Multi-edit always returns 1024x1024 (1:1).** The endpoint rejects `resolution`, `aspect_ratio`, `width`, `height`, and `output_resolution` params with `"Unrecognized key(s)"`. The pipeline automatically restores the original aspect ratio after multi-edit via center-crop + Lanczos scale (e.g. 1024x1024 → crop 576x1024 center → scale 768x1376). This is handled by `restoreAspectRatio()` in `panel-fixer.ts`.

**Veo 3.1 auto-corrects 1:1 input.** For atmosphere shots using Veo 3.1, square panels work fine -- the model generates proper aspect ratio video regardless. For Kling action shots, the 9:16 crop is essential since Kling derives output aspect from input.

Images can be base64 strings, data URLs (`data:image/png;base64,...`), or HTTP URLs.

### Venice API -- Critical Details (Learned from Testing)

- **Resolution params**: Use `resolution` + `aspect_ratio`, NOT `width`/`height`. The `width`/`height` params are deprecated and silently ignored -- the API defaults to 1024x1024 (1:1). Max 1280 on any dimension.
- **Storyboard panels**: Use `resolution: "1K"` + `aspect_ratio: "16:9"` (produces 1376x768).
- **Character references**: Use `resolution: "1K"` + `aspect_ratio: "1:1"` (produces 1024x1024).
- **No reference image payloads**: `nano-banana-pro` does NOT accept `image_references` or `image_1`/`image_2` params. These cause a 400 error. Character consistency relies on exhaustive text descriptions and seed anchoring.
- **Response format**: The `/image/generate` endpoint returns `{ images: ["base64string", ...] }` where each element in the `images` array is a raw base64-encoded image string -- NOT `{ images: [{ b64_json: "..." }] }`. Code must handle `typeof images[0] === "string"`.
- **Rate limits**: Requests run concurrently but keep batches to 2-3 at a time with ~500ms delay between batches to avoid 429s.
- **Retired models**: `fluently-xl` no longer exists. If the API returns a 404 with "model not found", check the model name.
- **Useful params**: `steps: 30`, `cfg_scale: 10`, `hide_watermark: true`, `safe_mode: false` are good defaults for storyboard work. Use `cfg_scale: 10` (not 7) for strict prompt adherence.
- **Never delete generated videos**: Generated MP4 files should never be automatically deleted, even when regenerating. Previous versions serve as variants. Use naming like `shot-001-v2.mp4` or save to a `variants/` subdirectory if re-generating.

## Venice Video API

Venice provides multiple video generation models. The flow is asynchronous: queue a job, poll for status, download the MP4.

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/video/queue` | POST | Queue a video generation job |
| `/api/v1/video/retrieve` | POST | Poll status or download completed video |
| `/api/v1/video/complete` | POST | Cleanup after download (optional) |

### Available Models

| Model | Type | Duration | Resolution | Aspect Ratio | Cost |
|-------|------|----------|------------|--------------|------|
| `kling-o3-pro-image-to-video` | Image-to-Video | `3s`, `5s`, `8s`, `10s`, `13s`, `15s` | Not supported (derived from image) | Not supported (derived from image) | -- |
| `vidu-q3-image-to-video` | Image-to-Video | `3s`, `5s`, `8s`, `10s`, `12s`, `14s`, `16s` | `1080p` | Not supported (derived from image) | $0.58 |
| `veo3.1-fast-image-to-video` | Image-to-Video | `8s` only | `720p` | Not supported (derived from image) | -- |
| `veo3.1-fast-text-to-video` | Text-to-Video | `4s`, `6s`, `8s` | `720p` | **Required** (`16:9`, `9:16`) | -- |
| `veo3.1-full-text-to-video` | Text-to-Video | `4s`, `6s`, `8s` | `720p` | **Required** (`16:9`, `9:16`) | -- |

### Preferred Model: Kling O3 Pro (Image-to-Video)

For trailer and storyboard video work, **prefer `kling-o3-pro-image-to-video`**:
- Flexible durations: `3s`, `5s`, `8s`, `10s`, `13s`, `15s` -- choose based on shot pacing needs
- Do NOT include `resolution` (causes 400 error -- derived from input image)
- Do NOT include `aspect_ratio` (causes 400 error -- derived from input image)
- Pass the panel PNG as `image_url` (data URI: `data:image/png;base64,...`)
- **`end_image_url`** (optional): Target end frame composition. Pass the NEXT shot's panel PNG. Kling will animate toward this image, creating smoother transitions between shots. Only Kling supports this -- Vidu Q3 and Veo do not.
- `audio: true` for ambient sound generation
- Prompt should be plain prose (camera first, then action, then style/audio)

#### Duration Selection Guide
- **3s**: Rapid cuts, montage beats, insert shots, impact moments
- **5s**: Standard dialogue shots, character reactions, medium-paced action
- **8s**: Establishing shots, atmosphere, slow reveals, tracking shots
- **10s**: Extended atmosphere, complex camera movements, emotional beats
- **12s**: Long takes, dialogue scenes (Vidu Q3 only)
- **13s**: Long takes, dialogue scenes, elaborate tracking shots (Kling only)
- **14s**: Extended dialogue, complex sequences (Vidu Q3 only)
- **15s**: Opening shots, climactic moments, epic reveals (Kling only)
- **16s**: Maximum length -- epic reveals, extended takes (Vidu Q3 only)

### Queue Request -- Kling O3 Pro (Image-to-Video)
```json
{
  "model": "kling-o3-pro-image-to-video",
  "prompt": "A slow dolly shot pushes forward...",
  "duration": "8s",
  "image_url": "data:image/png;base64,...",
  "end_image_url": "data:image/png;base64,...",
  "audio": true
}
```

### Vidu Q3 (Image-to-Video)

New model with **1080p output** and flexible durations up to 16s:
- Durations: `3s`, `5s`, `8s`, `10s`, `12s`, `14s`, `16s`
- Supports `resolution: "1080p"`
- $0.58 per generation
- Aspect ratio derived from input image (do NOT pass `aspect_ratio`)
- Longer max duration (16s) than Kling O3 Pro (15s) -- useful for extended takes

### Queue Request -- Vidu Q3 (Image-to-Video)
```json
{
  "model": "vidu-q3-image-to-video",
  "prompt": "A slow dolly shot pushes forward...",
  "duration": "8s",
  "image_url": "data:image/png;base64,...",
  "resolution": "1080p",
  "audio": true
}
```

### Queue Request -- Veo 3.1 (Image-to-Video, Legacy)
```json
{
  "model": "veo3.1-fast-image-to-video",
  "prompt": "A slow dolly shot pushes forward...",
  "duration": "8s",
  "image_url": "data:image/png;base64,...",
  "resolution": "720p",
  "audio": true
}
```

Response: `{ "model": "...", "queue_id": "uuid" }`

### Polling for Completion

POST to `/api/v1/video/retrieve` with `{ model, queue_id }`. While processing, returns JSON:
```json
{ "status": "PROCESSING", "average_execution_time": 115000, "execution_duration": 45000 }
```
When complete, returns binary `video/mp4` data. Poll every 10 seconds.

#### Actual Render Time Benchmarks (Scene 1, Kling O3 Pro)
| Duration | Render Time | File Size |
|----------|-------------|-----------|
| 8s | 331s (~5.5 min) | 14.3 MB |
| 5s | 202-214s (~3.5 min) | 7.7-9.3 MB |
| 3s | 139s (~2.3 min) | 2.6 MB |

Venice reports `average_execution_time: ~1015s` but actual times are much shorter. Veo 3.1 is ~60-90s per shot.

### Veo Video Prompt Best Practices

- **Plain prose, no tags**: No `[AESTHETIC]` or `Setting:` labels. Describe everything in natural sentences.
- **Camera first**: "A slow dolly shot pushes forward framing a wide shot at eye level."
- **Use Veo camera terms**: "dolly shot", "tracking shot", "crane shot", "slow pan", "locked-off static shot"
- **Subject + action concretely**: "JAX stands in formation in a dim corridor lined with CRT monitors."
- **Setting as visual description**: "Off-white institutional walls glow under flickering fluorescent light."
- **Style in film terms**: "1970s analog science fiction, 16mm Ektachrome with faded warm tones and heavy grain."
- **Audio in separate sentences**: "Sound of a low fluorescent hum and distant door closing."
- **Keep under ~150 words** to stay within Veo's 1,024 token limit.

### Multi-Register Aesthetics -- Scene-Specific Extraction

When a project uses a multi-register aesthetic (e.g., Clean Dystopia for scenes 1-7, Baroque for scenes 8-9, Warm Analog for scenes 29-32), **only include the register relevant to the current scene** in image and video prompts. The full multi-register description is stored in `project.json` under `aesthetic`, but dumping all registers into a prompt produces 1000+ word monstrosities and confuses the model.

The `buildVideoPrompt()` function in `src/storyboard/prompt-builder.ts` now uses `extractRegister()` to pull only the applicable register based on scene number. For manual scripts, extract the relevant section by looking for the register label (e.g., `CLEAN DYSTOPIA:`, `BAROQUE:`, `WARM ANALOG:`) and taking the text up to the next label.

**Critical**: The scene heading's time of day (e.g., "NIGHT") can override the aesthetic if the prompt doesn't explicitly enforce it. Scene 1 has heading "EXT. BRUTALIST CITYSCAPE - NIGHT" but Clean Dystopia requires sterile white with no shadows. Always let the aesthetic register override the scene heading's lighting implications in the image prompt.

### Panel Regeneration Pattern

When the built-in shot planner (`generate-scene`) produces too many shots or prompts that don't match the aesthetic, use a custom regeneration script instead of re-running the CLI:

1. Write a script in `scripts/` that calls Venice image API directly with hand-crafted prompts
2. Include ONLY the relevant aesthetic register in each prompt
3. Save new panels as `shot-001.png` through `shot-NNN.png` in the scene directory (overwrites old panels with same names)
4. Generate matching `.video.json` files with the `video` block format (not legacy `veo`)
5. Rename old shots' `.video.json` files to `.video.json.bak` to exclude them from video generation

See `scripts/regenerate-scene1-panels.ts` as a reference implementation.

### Video JSON Structure

Each shot produces a `shot-NNN.video.json` with two blocks:
```json
{
  "panelId": "S1-P3",
  "sceneNumber": 1,
  "shotNumber": 3,
  "video": {
    "model": "kling-o3-pro-image-to-video",
    "prompt": "A slow dolly shot...",
    "duration": "5s",
    "audio": true
  },
  "metadata": {
    "imagePrompt": "...",
    "characters": ["JAX"],
    "dialogue": { "character": "JAX", "line": "..." },
    "sfx": "boots on tile",
    "ambient": "fluorescent hum",
    "transition": "CUT",
    "cameraMovement": "dolly-in, slowly"
  }
}
```

The `video` block is API-ready (params vary by model -- see model table above). The `metadata` block preserves pipeline data for the HTML viewer.

### Video Generation Workflow -- Frame Chaining

Use `scripts/generate-scene-videos.ts` for video generation. This script processes shots sequentially with **frame chaining** for visual continuity between cuts:

```bash
# From project root (must run from root, not scene dir)
npx tsx scripts/generate-scene-videos.ts output/<project> <scene-number> [model]

# Examples:
npx tsx scripts/generate-scene-videos.ts output/erik-voorhees-manifesto 1
npx tsx scripts/generate-scene-videos.ts output/erik-voorhees-manifesto 2 vidu-q3-image-to-video
```

**Frame chaining flow:**
- **Shot 1**: `image_url` = panel PNG (the storyboard image IS the first frame)
- **Shot N>1**: `image_url` = last frame extracted from previous video via ffmpeg (continuity chain)
- **Kling O3 Pro only**: `end_image_url` = next shot's panel PNG (guides the video toward the next composition)

This means each video begins where the previous one ended visually, creating smooth transitions even with hard cuts.

**How it works internally:**
1. Reads `shot-NNN.video.json` for prompt, duration, and model config
2. For shot 1, encodes the panel PNG as the `image_url` data URI
3. For subsequent shots, extracts the last frame from the previous MP4 using ffmpeg (`ffprobe` for duration, `ffmpeg -ss <duration-0.05>` for frame grab)
4. Queues via `/api/v1/video/queue` with model-specific params
5. Polls `/api/v1/video/retrieve` every 10s until binary MP4 is returned
6. Saves to `shot-NNN.mp4`, archives existing files as `-v1.mp4`
7. Calls `/api/v1/video/complete` for cleanup

**Requirements**: `ffmpeg` and `ffprobe` must be available on PATH.

**Important**: The script only processes shots that have a `.video.json` file. To exclude old/unwanted shots, rename their `.video.json` to `.video.json.bak`.

### Video Model Selection

At the start of a video generation session, present the user with model options if they haven't already specified one:

| Model | Best For | Durations | Render Time | Notes |
|-------|----------|-----------|-------------|-------|
| `kling-o3-pro-image-to-video` (default) | Most work -- flexible pacing, higher quality, `end_image_url` for frame targeting | 3s/5s/8s/10s/13s/15s | 2-6 min | No resolution/aspect_ratio params, supports `end_image_url` |
| `vidu-q3-image-to-video` | 1080p output, longest takes (16s) | 3s/5s/8s/10s/12s/14s/16s | TBD | Requires `resolution: "1080p"`, $0.58/gen |
| `veo3.1-fast-image-to-video` | Quick tests, fixed-length clips | 8s only | ~90s/shot | Requires `resolution: "720p"` |

Default to Kling O3 Pro unless the user requests otherwise. Store the selected model for the session so it doesn't need to be re-asked per shot.

## Assembly (Stage 6) -- Remotion Video Editing

The `assemble` command builds a Remotion project from generated video clips and renders the final assembled film.

### How It Works

1. **Manifest building**: Scans `scene-NNN/` directories for `shot-NNN.mp4` files. Runs `ffprobe` on each to get exact duration/fps. Reads `shot-NNN.video.json` for transition metadata. Outputs `shot-manifest.json`.
2. **Remotion scaffolding**: Generates a complete Remotion project at `output/<project>/remotion/` with React components that compose all shots using `TransitionSeries`.
3. **Dependency install**: Runs `npm install` in the Remotion project directory.
4. **Rendering**: Calls `npx remotion render` with `--public-dir` pointing at the project output directory (where the real MP4 files live).

### CLI Usage

```bash
# Full pipeline: scaffold + render entire film
npx tsx src/cli.ts assemble -p output/<project>

# Scaffold only (for manual preview/render)
npx tsx src/cli.ts assemble -p output/<project> --scaffold-only

# Render a single scene
npx tsx src/cli.ts assemble -p output/<project> --render-scene 1
```

### Transition Mapping

The `transition` field from `shot-NNN.video.json` maps to Remotion transitions:

| Pipeline | Remotion | Duration |
|----------|----------|----------|
| `CUT` | 1-frame fade | instant |
| `FADE` | `fade()` | 0.5s |
| `DISSOLVE` | `fade()` | 0.75s |
| `WIPE` | `slide()` | 0.5s |

Between scenes, a 1-second fade is applied.

### Remotion Project Structure

```
output/<project>/remotion/
  src/
    index.ts         -- Remotion entry point
    Root.tsx          -- Composition definitions (Film + per-scene)
    Film.tsx          -- Top-level TransitionSeries of all scenes
    Scene.tsx         -- Per-scene TransitionSeries of shots
    types.ts          -- TypeScript types for manifest data
  shot-manifest.json  -- Generated manifest with timing + metadata
  package.json
  tsconfig.json
```

### Output

- `output/<project>/<name>-final.mp4` -- full assembled film
- `output/<project>/scene-N-assembled.mp4` -- per-scene renders

### Music (Planned)

Epidemic Sound integration via MCP server is planned for automated music selection and track adaptation to match assembled video duration. Will use `search_music` (mood/genre/BPM), `edit_recording` (adapt to exact duration), and `download_music_track` tools.

## Reusable Scripts

Scripts in `scripts/` handle operations not yet in the CLI. **All must be run from the project root directory.**

| Script | Purpose | Usage |
|--------|---------|-------|
| `mix-episode-audio.ts` | Full audio post-production: per-shot volume/fades, layered ambient beds, subtitle burn-in | `npx tsx scripts/mix-episode-audio.ts <episode-dir>` |
| `generate-ambient-bed.ts` | Generate ambient SFX layer via ElevenLabs (22s max, looped during mix) | `npx tsx scripts/generate-ambient-bed.ts "<prompt>" "<output-path>" <duration>` |
| `generate-scene-videos.ts` | Generate videos for a scene with frame chaining and `end_image_url` targeting | `npx tsx scripts/generate-scene-videos.ts <project-dir> <scene-num> [model]` |
| `regenerate-scene1-panels.ts` | Regenerate Scene 1 panels with Clean Dystopia aesthetic (reference implementation for custom panel scripts) | `npx tsx scripts/regenerate-scene1-panels.ts` |
| `generate-all-videos.ts` | Batch generate videos for ALL scenes (legacy, no frame chaining) | `npx tsx scripts/generate-all-videos.ts <project-dir>` |
| `generate-aesthetic-samples.ts` | Generate aesthetic comparison samples | `npx tsx scripts/generate-aesthetic-samples.ts` |

When writing new per-scene panel scripts, use `regenerate-scene1-panels.ts` as a template -- it demonstrates the Clean Dystopia prompt pattern, the correct image API params, and the `video` block JSON format.

## Environment

- `VENICE_API_KEY` must be set in `.env` (see `.env.example`)
- `ffmpeg` and `ffprobe` must be on PATH (used for frame extraction in video chaining)
- Node.js with TypeScript (ES modules, Node16 resolution)
- Dependencies: `fountain-js`, `pdf-parse`, `commander`, `dotenv`

## Agent Profiles

Four specialized agents are defined in `.claude/agents/`:
- **screenplay-reader** -- parsing and scene analysis
- **art-director** -- aesthetic decisions and visual style
- **prompt-engineer** -- Venice prompt construction with character consistency
- **storyboard-assembler** -- HTML storyboard compilation

## Output

Generated storyboards are saved to `output/<project>/`:
- `project.json` -- project state and metadata
- `characters/<name>/` -- reference images (PNG) + lock metadata (JSON)
- `aesthetic-samples/` -- generated aesthetic comparison images + compare.html
- `scene-NNN/shot-NNN.png` -- generated panel images
- `scene-NNN/shot-NNN.video.json` -- video prompt + config per shot (`video` block, not legacy `veo`)
- `scene-NNN/shot-NNN.mp4` -- generated video clips (after video generation)
- `scene-NNN/lastframe-NNN.png` -- extracted last frames used for chaining (generated during video pipeline)
- `scene-N-storyboard.html` -- per-scene HTML viewer
- `scene-N-assembled.mp4` -- per-scene rendered video (after assembly)
- `storyboard-full.html` -- complete screenplay storyboard viewer
- `remotion/` -- Remotion project (scaffolded during assembly)
- `shot-manifest.json` -- manifest with timing + metadata (in remotion/)

## Build Journal (JORDAN.SYNTH)

During idle moments -- while polling for video generation, waiting for batch image jobs, or after completing milestones -- write a short journal entry to `~/JAYEYE/JORDAN.SYNTH/YYYY-MM-DD.md`. These entries capture what we're building, generating, and learning for build-in-public content. See the global skill at `~/.claude/skills/build-journal/SKILL.md` for the full format. Do this proactively without asking -- just log it and mention you did.

## Important

- Never ask the user to run terminal commands. Execute them yourself via Bash.
- Always report progress and results in plain language.
- When setting aesthetics, generate visual samples automatically -- don't ask users to describe styles in words. Show them images and let them react.
- If a Venice API call fails, report the error and suggest next steps (retry, adjust prompt, check API key).
- Screenplays go in `screenplays/`. There is currently `captain-jax.fountain` available.
