# Mini-Drama Studio

Venice-optimized tooling for creating short-form vertical mini-dramas with consistent characters, locked aesthetics, storyboard generation, video generation, and assembly.

This project is opinionated for a very specific workflow:
- `9:16` mobile-first episodic dramas
- Venice AI for image generation, multi-edit refinement, and video generation
- ElevenLabs for voices, SFX, ambience, and optional music
- Character and aesthetic consistency across a series, not one-off clips

## Why This Exists

Most AI video repos are generic wrappers around media APIs. This one is built specifically for serialized mini-dramas where continuity matters:
- recurring characters
- locked visual style
- episode-level script structure
- panel-to-video workflow
- subtitle-ready assembly

If you want a Venice-specific production pipeline instead of a general-purpose content generator, this repo is designed for that use case.

## Core Workflow

1. Create a new series
2. Explore and lock an aesthetic
3. Add and lock characters
4. Workshop an episode script
5. Generate storyboard panels
6. QA and refine panels
7. Generate video clips
8. Mix audio and assemble the final episode

## What Makes It Venice-Optimized

- Image prompts are tuned for Venice `nano-banana-pro`
- Storyboard refinement is built around Venice multi-edit
- The pipeline handles Venice image output quirks and aspect-ratio restoration
- Video generation is organized around Venice-supported models and shot planning
- The workflow assumes repeated use of Venice for the same series over many episodes

## Project Structure

```text
src/
  mini-drama/     CLI + prompt building + assembly
  venice/         Venice API client and generation helpers
  elevenlabs/     Voice, music, SFX, and TTS helpers
  series/         Series state and metadata
  storyboard/     Legacy screenplay storyboard pipeline
scripts/          Utility scripts for generation and post-production
output/           Generated series data (gitignored)
```

## Requirements

- Node.js 20+
- `ffmpeg` and `ffprobe` on your PATH
- A Venice API key
- An ElevenLabs API key

## Setup

```bash
npm install
cp .env.example .env
```

Then add:

```bash
VENICE_API_KEY=your_key_here
ELEVENLABS_API_KEY=your_key_here
```

## Quick Start

Create a new series:

```bash
npx tsx src/mini-drama/cli.ts new-series \
  -n "Neon Hearts" \
  --concept "Cyberpunk romance between a corporate executive and a mysterious woman" \
  -g "romance / sci-fi" \
  --setting "Rain-soaked neon megacity"
```

Build the project:

```bash
npm run build
```

Run the mini-drama CLI directly:

```bash
npx tsx src/mini-drama/cli.ts --help
```

## Environment

Secrets belong in `.env`, never in source control. Generated series output is written to `output/`, which is intentionally gitignored.

## Notes

- This repo is intentionally opinionated and not model-agnostic
- The production path is optimized around Venice-specific behavior and constraints
- The legacy screenplay pipeline is still included, but the main focus is the mini-drama workflow
