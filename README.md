# Mini-Drama Rig

Agent-first, Venice-optimized tooling for creating short-form vertical mini-dramas with consistent characters, locked aesthetics, storyboard generation, video generation, audio generation, and assembly.

This project is opinionated for a very specific workflow:
- `9:16` mobile-first episodic dramas
- Venice AI for image generation, multi-edit refinement, video generation, TTS, SFX, and music
- Character and aesthetic consistency across a series, not one-off clips

## Why This Exists

Most AI video projects are generic wrappers around media APIs. This rig is built specifically for serialized mini-dramas where continuity matters:
- recurring characters
- locked visual style
- episode-level script structure
- panel-to-video workflow
- subtitle-ready assembly

If you want a Venice-specific production rig that is meant to be operated by an IDE agent instead of a generic prompt-and-pray content generator, this rig is designed for that use case.

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

## Intended Runtime

This rig is not primarily meant to be operated by humans typing raw CLI commands.

It is meant to run inside an IDE like Cursor or VS Code with an agent such as Claude Code operating the workflow on your behalf.

The intended interface is:

- natural-language requests to the agent
- project rules and workflow guidance in `CLAUDE.md`
- reusable command playbooks in `.claude/commands/`
- the TypeScript CLI as the execution layer underneath

In other words: the CLI exists to support the agent, not to be the main product surface.

## Preferred Video Models

For the mini-drama workflow, the rig is opinionated about model choice:

- `kling-v3-pro-image-to-video` for action, movement, dialogue with physical performance, and shots that need stronger cinematic motion
- `veo3.1-fast-image-to-video` for atmosphere, inserts, close-ups, establishing shots, and quieter beats

Those defaults are intentional. The rig is tuned around high-end model behavior rather than cheapest-possible generation.

## Budgeting Note

This rig assumes you want best-of-the-best output quality for serialized drama production. That means it leans toward premium Venice image, edit, video, and audio workflows instead of bargain-mode defaults.

Before running large episode batches, factor API budgeting into your plan:

- Venice image generation and multi-edit can stack quickly across full episodes
- Premium video generations are the biggest cost driver
- Venice TTS, SFX, ambience, and music layers add additional spend on top
- Multi-episode series work compounds fast if you regenerate often

Treat this as a quality-first production rig and budget API usage accordingly.

## Project Structure

```text
src/
  mini-drama/     CLI + prompt building + assembly
  venice/         Venice API client and generation helpers
  series/         Series state and metadata
  storyboard/     Legacy screenplay storyboard pipeline
scripts/          Utility scripts for generation and post-production
output/           Generated series data (gitignored)
```

## Agent Workflow

Open the rig in Cursor or VS Code with an agent enabled, then work through the pipeline conversationally.

Examples:

- "Create a new mini-drama series"
- "Show me aesthetic options"
- "Add a female lead"
- "Workshop episode 1"
- "Storyboard episode 1"
- "Generate videos for episode 1"
- "Assemble the episode"

The agent should use the playbooks in `.claude/commands/` as the operational interface. For example, `.claude/commands/new-series.md` defines how a new series should be gathered and executed.

## Getting Started In Agent Chat

Use this rig from the agent chat, not by manually stepping through the pipeline in the terminal.

1. Open the project folder in Cursor or VS Code.
2. Make sure your agent can read the project files, especially `CLAUDE.md` and `.claude/commands/`.
3. Make sure the environment has `VENICE_API_KEY` available via `.env`.
4. Ask the agent to initialize the rig if dependencies are not installed yet.
5. Start the workflow by telling the agent what you want to make.

Good first messages in the agent chat:

- "Set up this rig for first use, then create a new mini-drama series"
- "Create a new mini-drama series"
- "Help me start a Venice mini-drama series"
- "Workshop episode 1 for a cyberpunk romance mini-drama"

What should happen next:

- the agent reads the project guidance in `CLAUDE.md`
- the agent follows the relevant playbook from `.claude/commands/`
- the agent asks for missing creative inputs when needed
- the agent installs dependencies and runs setup commands if the rig needs them
- the agent runs the underlying TypeScript commands for you
- the agent keeps moving you through the pipeline from series creation to final assembly

If the agent is operating correctly, you should mostly be directing the creative workflow in natural language while the rig handles the execution layer underneath.

## Requirements

- Node.js 20+
- `ffmpeg` and `ffprobe` on your PATH
- A Venice API key

## Setup

Ask the agent to initialize local setup for the rig. That setup should include:

- creating `.env` from `.env.example` if it does not exist yet
- confirming `VENICE_API_KEY` is available
- installing dependencies needed by the TypeScript execution layer

The environment file should contain:

```bash
VENICE_API_KEY=your_key_here
```

## Setup Check

If the rig is being used the intended way, ask the agent to handle setup and validation for you. It should install dependencies as needed and make sure the TypeScript layer builds cleanly.

Typical setup commands the agent may run under the hood:

```bash
npm install
npm run build
```

If you are wiring up an agent manually, the underlying commands live in `src/mini-drama/cli.ts` and the reusable agent-facing playbooks live in `.claude/commands/`.

You can still inspect the underlying CLI directly if needed:

```bash
npx tsx src/mini-drama/cli.ts --help
```

## Environment

Secrets belong in `.env`, never in source control. Generated series output is written to `output/`, which is intentionally gitignored.

## Notes

- This rig is intentionally opinionated and not model-agnostic
- This is an agent-operated rig first, not a CLI-first end-user app
- The production path is optimized around Venice-specific behavior and constraints
- The legacy screenplay pipeline is still included, but the main focus is the mini-drama workflow
