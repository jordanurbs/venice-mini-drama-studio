#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import { resolve, join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile, unlink } from 'node:fs/promises';

import {
  createSeries,
  saveSeries,
  loadSeries,
  listSeries,
  addCharacter,
  getCharacter,
  addEpisode,
  getEpisodeDir,
  getCharacterDir,
  saveEpisodeScript,
  loadEpisodeScript,
} from '../series/manager.js';
import type {
  SeriesState,
  MiniDramaCharacter,
  EpisodeScript,
  ShotScript,
} from '../series/types.js';
import {
  FEMALE_BASE_TRAITS,
  MALE_BASE_TRAITS,
  DEFAULT_ACTION_MODEL,
  DEFAULT_ATMOSPHERE_MODEL,
} from '../series/types.js';
import type { AestheticProfile } from '../storyboard/prompt-builder.js';
import { VeniceClient } from '../venice/client.js';
import { generateImage } from '../venice/generate.js';
import { getVeniceApiKey } from '../config.js';
import { listVoices, filterVoices, auditionVoices } from '../venice/voices.js';
import { generateDialogueForShots, generateSoundEffect, generateMusic } from '../venice/audio.js';
import type { DialogueLine } from '../venice/audio.js';

import { buildImagePrompt, buildCharacterReferencePrompt } from './prompt-builder.js';
import { generateEpisodeVideos } from './video-generator.js';
import { generateSubtitles, saveSrt } from './subtitle-generator.js';
import { fixPanel, refineWithReferences, refineStyleConsistency } from './panel-fixer.js';
import type { MultiEditModel } from '../venice/types.js';
import { assembleEpisode, collectShotVideos } from './assembler.js';
import { buildGenerationPlan, saveGenerationPlan } from './generation-planner.js';

const program = new Command();
program
  .name('mini-drama')
  .description('Mini-Drama creation pipeline using Venice AI')
  .version('1.0.0');

// ── new-series ────────────────────────────────────────────────────────
program
  .command('new-series')
  .description('Create a new mini-drama series')
  .requiredOption('-n, --name <name>', 'Series name')
  .requiredOption('--concept <concept>', 'Series concept/premise')
  .option('-g, --genre <genre>', 'Genre', 'drama')
  .option('--setting <setting>', 'General setting description', '')
  .action(async (opts: { name: string; concept: string; genre: string; setting: string }) => {
    const series = createSeries(opts.name, opts.concept, opts.genre, opts.setting);
    await saveSeries(series);

    console.log(`\nSeries created: ${series.name}`);
    console.log(`  Slug: ${series.slug}`);
    console.log(`  Genre: ${series.genre}`);
    console.log(`  Concept: ${series.concept}`);
    console.log(`  Output: ${series.outputDir}`);
    console.log(`\nNext: explore-aesthetic -p ${series.outputDir}`);
  });

// ── list-series ───────────────────────────────────────────────────────
program
  .command('list-series')
  .description('List all mini-drama series')
  .action(async () => {
    const all = await listSeries();
    if (all.length === 0) {
      console.log('No series found. Create one with: mini-drama new-series');
      return;
    }
    console.log('Mini-Drama Series:');
    for (const s of all) {
      console.log(`  ${s.name} (${s.slug}) -> ${s.dir}`);
    }
  });

// ── explore-aesthetic ─────────────────────────────────────────────────
program
  .command('explore-aesthetic')
  .description('Generate aesthetic comparison samples for a series')
  .requiredOption('-p, --project <dir>', 'Series output directory')
  .option('--count <n>', 'Number of aesthetic variants', '5')
  .action(async (opts: { project: string; count: string }) => {
    const series = await loadSeries(resolve(opts.project));
    if (!series) { console.error('Series not found.'); process.exit(1); }

    const apiKey = getVeniceApiKey();
    const client = new VeniceClient(apiKey);
    const count = parseInt(opts.count);

    const samplesDir = join(series.outputDir, 'aesthetic-samples');
    await mkdir(samplesDir, { recursive: true });

    const sceneDescription = series.setting || series.concept;

    const aestheticStyles = [
      { name: 'anime-noir', style: 'Dark anime noir', palette: 'high contrast shadows with neon accents', lighting: 'dramatic rim lighting, hard shadows', lens: 'wide-angle with depth', film: 'digital anime rendering with grain' },
      { name: 'manhwa-realism', style: 'Korean manhwa semi-realism', palette: 'rich saturated colors, warm skin tones', lighting: 'soft cinematic lighting with bokeh', lens: 'portrait lens shallow depth of field', film: 'digital illustration with painterly finish' },
      { name: 'retro-anime', style: '90s anime cel-shaded', palette: 'vintage warm tones, sunset palette', lighting: 'flat cel-shading with dramatic highlights', lens: 'standard composition', film: '35mm anime film grain' },
      { name: 'hyper-stylized', style: 'Hyper-stylized digital illustration', palette: 'vibrant pop colors with dark contrasts', lighting: 'dramatic chiaroscuro with color splashes', lens: 'dynamic angles and foreshortening', film: 'clean digital with subtle texture' },
      { name: 'webtoon-drama', style: 'Webtoon drama illustration', palette: 'moody desaturated with selective color', lighting: 'atmospheric with volumetric light', lens: 'cinematic wide and close alternation', film: 'soft digital brushwork' },
      { name: 'neo-baroque', style: 'Neo-baroque dramatic illustration', palette: 'deep golds, crimsons, and midnight blues', lighting: 'Caravaggio-inspired chiaroscuro', lens: 'classical composition', film: 'oil painting texture overlay' },
      { name: 'cyberpunk-anime', style: 'Cyberpunk anime', palette: 'electric blue, magenta, toxic green on black', lighting: 'neon glow with rain reflections', lens: 'dutch angles, extreme perspective', film: 'digital with chromatic aberration' },
    ];

    const selected = aestheticStyles.slice(0, count);

    console.log(`Generating ${selected.length} aesthetic samples...`);
    console.log(`Scene: ${sceneDescription}\n`);

    for (const aes of selected) {
      const prompt = `${sceneDescription}. ${aes.style}, ${aes.palette}, ${aes.lighting}, ${aes.lens}, ${aes.film}. Beautiful elegant woman with hourglass figure and handsome man, dramatic scene.`;

      try {
        const response = await generateImage(client, {
          prompt,
          negative_prompt: 'deformed, blurry, bad anatomy, low quality, text, watermark',
          resolution: '1K',
          aspect_ratio: '9:16',
          steps: 30,
          cfg_scale: 7,
          safe_mode: false,
          hide_watermark: true,
        });

        if (response.images?.[0]) {
          const imgBuffer = Buffer.from(response.images[0].b64_json, 'base64');
          const imgPath = join(samplesDir, `${aes.name}.png`);
          await writeFile(imgPath, imgBuffer);
          console.log(`  ${aes.name}: ${imgPath}`);
        }
      } catch (err) {
        console.warn(`  Failed: ${aes.name} - ${err}`);
      }
    }

    const html = generateCompareHtml(selected, series.name);
    const htmlPath = join(samplesDir, 'compare.html');
    await writeFile(htmlPath, html, 'utf-8');
    console.log(`\nComparison page: ${htmlPath}`);
    console.log(`Pick a style and run: set-aesthetic -p ${series.outputDir} --style "..." --palette "..." ...`);
  });

// ── set-aesthetic ─────────────────────────────────────────────────────
program
  .command('set-aesthetic')
  .description('Lock the visual aesthetic for the series')
  .requiredOption('-p, --project <dir>', 'Series output directory')
  .requiredOption('--style <style>', 'Visual style')
  .requiredOption('--palette <palette>', 'Color palette')
  .requiredOption('--lighting <lighting>', 'Lighting approach')
  .option('--lens <lens>', 'Lens characteristics', 'cinematic depth of field')
  .option('--film <film>', 'Film stock/texture', 'digital illustration')
  .action(async (opts: { project: string; style: string; palette: string; lighting: string; lens: string; film: string }) => {
    const series = await loadSeries(resolve(opts.project));
    if (!series) { console.error('Series not found.'); process.exit(1); }

    const aesthetic: AestheticProfile = {
      style: opts.style,
      palette: opts.palette,
      lighting: opts.lighting,
      lensCharacteristics: opts.lens,
      filmStock: opts.film,
    };

    series.aesthetic = aesthetic;
    await saveSeries(series);

    console.log('Aesthetic locked:');
    Object.entries(aesthetic).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    console.log(`\nNext: add-character -p ${series.outputDir} --name "CHARACTER" --gender female`);
  });

// ── add-character ─────────────────────────────────────────────────────
program
  .command('add-character')
  .description('Add and generate reference images for a character')
  .requiredOption('-p, --project <dir>', 'Series output directory')
  .requiredOption('--name <name>', 'Character name')
  .requiredOption('--gender <gender>', 'Gender (male/female/other)')
  .option('--age <age>', 'Age description', 'mid 20s')
  .option('--description <desc>', 'Physical description')
  .option('--wardrobe <wardrobe>', 'Default wardrobe', 'stylish contextual attire')
  .option('--voice-desc <voiceDesc>', 'Voice description (pitch, timbre, accent, cadence)')
  .option('--skip-images', 'Skip reference image generation', false)
  .action(async (opts: {
    project: string; name: string; gender: string; age: string;
    description?: string; wardrobe: string; voiceDesc?: string; skipImages: boolean;
  }) => {
    const series = await loadSeries(resolve(opts.project));
    if (!series) { console.error('Series not found.'); process.exit(1); }

    const baseTraits = opts.gender === 'female' ? FEMALE_BASE_TRAITS : MALE_BASE_TRAITS;
    const physicalDesc = opts.description || `${opts.age}, ${baseTraits}`;

    const defaultVoice = opts.gender === 'female'
      ? 'smooth, confident feminine voice, medium pitch, clear diction, measured pacing'
      : 'deep, resonant masculine voice, low pitch, authoritative tone, steady cadence';
    const voiceDescription = opts.voiceDesc || defaultVoice;

    const seed = Math.abs([...opts.name].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)) % 999_999_999;

    const character: MiniDramaCharacter = {
      name: opts.name.toUpperCase(),
      gender: opts.gender as 'male' | 'female' | 'other',
      age: opts.age,
      description: physicalDesc,
      fullDescription: `${opts.name}, ${opts.age}, ${physicalDesc}`,
      wardrobe: opts.wardrobe,
      voiceDescription,
      locked: false,
      seed,
    };

    addCharacter(series, character);

    if (!opts.skipImages && series.aesthetic) {
      const apiKey = getVeniceApiKey();
      const client = new VeniceClient(apiKey);
      const charDir = getCharacterDir(series, character.name);
      await mkdir(charDir, { recursive: true });

      const angles: ('front' | 'three-quarter' | 'profile' | 'full-body')[] = ['front', 'three-quarter', 'profile', 'full-body'];
      const filenames = ['front.png', 'three-quarter.png', 'profile.png', 'full-body.png'];

      console.log(`Generating reference images for ${character.name}...`);

      for (let i = 0; i < angles.length; i++) {
        const prompt = buildCharacterReferencePrompt(character, series.aesthetic, angles[i]);

        try {
          const response = await generateImage(client, {
            prompt,
            negative_prompt: 'deformed, blurry, bad anatomy, low quality, multiple people, text, watermark, character reference sheet, annotations, labels, inset panels, detail callouts, multi-view layout, comic panels, panel borders',
            resolution: '1K',
            aspect_ratio: '1:1',
            steps: 30,
            cfg_scale: 7,
            seed,
            safe_mode: false,
            hide_watermark: true,
          });

          if (response.images?.[0]) {
            const imgBuffer = Buffer.from(response.images[0].b64_json, 'base64');
            await writeFile(join(charDir, filenames[i]), imgBuffer);
            console.log(`  ${angles[i]}: saved`);
          }
        } catch (err) {
          console.warn(`  ${angles[i]}: failed - ${err}`);
        }
      }

      character.locked = true;
      await writeFile(
        join(charDir, 'character.json'),
        JSON.stringify(character, null, 2),
        'utf-8',
      );
    }

    await saveSeries(series);
    console.log(`\nCharacter added: ${character.name}`);
    console.log(`Next: audition-voices -p ${series.outputDir} --character "${character.name}"`);
  });

// ── audition-voices ───────────────────────────────────────────────────
program
  .command('audition-voices')
  .description('Generate Venice TTS voice samples for a character')
  .requiredOption('-p, --project <dir>', 'Series output directory')
  .requiredOption('-c, --character <name>', 'Character name')
  .option('--sample-text <text>', 'Sample line for audition')
  .option('--count <n>', 'Number of voice candidates', '5')
  .action(async (opts: { project: string; character: string; sampleText?: string; count: string }) => {
    const series = await loadSeries(resolve(opts.project));
    if (!series) { console.error('Series not found.'); process.exit(1); }

    const char = getCharacter(series, opts.character);
    if (!char) { console.error(`Character "${opts.character}" not found.`); process.exit(1); }

    const apiKey = getVeniceApiKey();
    const client = new VeniceClient(apiKey);

    const sampleText = opts.sampleText || `You crossed the line tonight. I expected better from you.`;

    console.log(`Loading Venice voice catalog...`);
    const allVoices = await listVoices();
    const gender = char.gender === 'other' ? undefined : char.gender;
    const filtered = filterVoices(allVoices, gender);

    const candidates = filtered.slice(0, parseInt(opts.count));
    console.log(`Found ${filtered.length} matching voices, auditioning ${candidates.length}...`);

    const charDir = getCharacterDir(series, char.name);
    const samplesDir = join(charDir, 'voice-samples');

    const results = await auditionVoices(client, candidates, sampleText, samplesDir);

    console.log(`\nVoice samples saved to: ${samplesDir}`);
    console.log('Listen and pick a voice, then run:');
    console.log(`  lock-character -p ${series.outputDir} -c "${char.name}" --voice-id <VOICE_ID>`);
    console.log('\nAvailable voices:');
    for (const r of results) {
      console.log(`  ${r.voiceName}: ${r.voiceId}`);
    }
  });

// ── lock-character ────────────────────────────────────────────────────
program
  .command('lock-character')
  .description('Finalize a character with selected voice')
  .requiredOption('-p, --project <dir>', 'Series output directory')
  .requiredOption('-c, --character <name>', 'Character name')
  .requiredOption('--voice-id <id>', 'Venice voice ID')
  .option('--voice-name <name>', 'Display name for the voice')
  .action(async (opts: { project: string; character: string; voiceId: string; voiceName?: string }) => {
    const series = await loadSeries(resolve(opts.project));
    if (!series) { console.error('Series not found.'); process.exit(1); }

    const char = getCharacter(series, opts.character);
    if (!char) { console.error(`Character "${opts.character}" not found.`); process.exit(1); }

    char.voiceId = opts.voiceId;
    char.voiceName = opts.voiceName || opts.voiceId;
    char.locked = true;

    const charDir = getCharacterDir(series, char.name);
    if (existsSync(charDir)) {
      await writeFile(
        join(charDir, 'character.json'),
        JSON.stringify(char, null, 2),
        'utf-8',
      );
    }

    await saveSeries(series);
    console.log(`Character locked: ${char.name}`);
    console.log(`  Voice: ${char.voiceName} (${char.voiceId})`);
  });

// ── storyboard-episode ────────────────────────────────────────────────
program
  .command('storyboard-episode')
  .description('Generate storyboard panel images from an episode script')
  .requiredOption('-p, --project <dir>', 'Series output directory')
  .requiredOption('-e, --episode <number>', 'Episode number', parseInt)
  .option('--no-refine', 'Skip the multi-edit refinement pass (refinement is ON by default)')
  .option('--edit-model <model>', 'Model for multi-edit refinement', 'nano-banana-pro-edit')
  .option('--cfg-scale <number>', 'Prompt adherence (1-10, higher = stricter)', parseFloat)
  .action(async (opts: { project: string; episode: number; refine: boolean; editModel: string; cfgScale?: number }) => {
    const series = await loadSeries(resolve(opts.project));
    if (!series) { console.error('Series not found.'); process.exit(1); }

    const script = await loadEpisodeScript(series, opts.episode);
    if (!script) { console.error(`Episode ${opts.episode} script not found.`); process.exit(1); }

    if (!series.aesthetic) { console.error('Set aesthetic first.'); process.exit(1); }

    const cfgScale = opts.cfgScale ?? 10;
    const apiKey = getVeniceApiKey();
    const client = new VeniceClient(apiKey);
    const episodeDir = getEpisodeDir(series, opts.episode);
    const sceneDir = join(episodeDir, 'scene-001');
    await mkdir(sceneDir, { recursive: true });

    console.log(`Generating storyboard for Episode ${opts.episode}: ${script.title}`);
    console.log(`${script.shots.length} shots to generate`);
    console.log(`  cfg_scale: ${cfgScale} | seed: ${series.aestheticSeed ?? 'random'} | refine: ${opts.refine}\n`);

    // ── Pass 1: Generate base panels ──────────────────────────────────
    console.log('Pass 1: Generating base panels...\n');

    const newlyGenerated = new Set<number>();

    for (const shot of script.shots) {
      const shotNum = String(shot.shotNumber).padStart(3, '0');
      const imgPath = join(sceneDir, `shot-${shotNum}.png`);

      if (existsSync(imgPath)) {
        console.log(`  Shot ${shotNum}: already exists, skipping`);
        continue;
      }

      const imagePrompt = buildImagePrompt(shot, series);

      try {
        const response = await generateImage(client, {
          prompt: imagePrompt.prompt,
          negative_prompt: imagePrompt.negativePrompt,
          resolution: '1K',
          aspect_ratio: '9:16',
          steps: 30,
          cfg_scale: cfgScale,
          seed: imagePrompt.seed,
          safe_mode: false,
          hide_watermark: true,
        });

        if (response.images?.[0]) {
          const imgBuffer = Buffer.from(response.images[0].b64_json, 'base64');
          await writeFile(imgPath, imgBuffer);

          // Venice returns WebP internally disguised as PNG -- convert immediately
          try {
            const { execSync } = await import('node:child_process');
            const header = execSync(`file -b "${imgPath}"`).toString().slice(0, 4);
            if (header === 'RIFF') {
              const tmpPath = imgPath.replace(/\.png$/, '-webp-conv.png');
              execSync(`ffmpeg -i "${imgPath}" -y "${tmpPath}" 2>/dev/null`);
              const { renameSync } = await import('node:fs');
              renameSync(tmpPath, imgPath);
            }
          } catch { /* conversion is best-effort */ }

          newlyGenerated.add(shot.shotNumber);
          console.log(`  Shot ${shotNum}: saved`);
        }
      } catch (err) {
        console.warn(`  Shot ${shotNum}: failed - ${err}`);
      }
    }

    // ── Pass 2: Refine with multi-edit ────────────────────────────────
    if (opts.refine) {
      const editModel = opts.editModel as MultiEditModel;
      console.log(`\nPass 2: Refining with multi-edit (${editModel})...`);

      // Save a snapshot of the first character shot BEFORE refinement to use as style anchor.
      // Post-refinement panels can inherit layout artifacts from character reference sheets,
      // which would contaminate non-character shots during style-matching.
      const firstCharShot = script.shots.find(s => s.characters.length > 0);
      let styleAnchorPath: string | undefined;
      if (firstCharShot) {
        const firstCharShotPath = join(sceneDir, `shot-${String(firstCharShot.shotNumber).padStart(3, '0')}.png`);
        if (existsSync(firstCharShotPath)) {
          styleAnchorPath = join(sceneDir, '.style-anchor.png');
          await copyFile(firstCharShotPath, styleAnchorPath);
        }
      }

      // Process character shots first, then non-character shots
      const charShots = script.shots.filter(s => s.characters.length > 0);
      const nonCharShots = script.shots.filter(s => s.characters.length === 0);

      for (const shot of charShots) {
        const shotNum = String(shot.shotNumber).padStart(3, '0');
        const imgPath = join(sceneDir, `shot-${shotNum}.png`);
        if (!existsSync(imgPath)) continue;

        // Skip panels that were already refined in a previous run
        const preFixPath = join(sceneDir, `shot-${shotNum}-pre-fix.png`);
        if (existsSync(preFixPath) && !newlyGenerated.has(shot.shotNumber)) {
          console.log(`  Shot ${shotNum}: already refined, skipping`);
          continue;
        }

        try {
          await refineWithReferences(client, series, imgPath, shot, editModel);
          console.log(`  Shot ${shotNum}: character-refined`);
        } catch (err) {
          console.warn(`  Shot ${shotNum}: refinement failed - ${err}`);
        }
      }

      for (const shot of nonCharShots) {
        const shotNum = String(shot.shotNumber).padStart(3, '0');
        const imgPath = join(sceneDir, `shot-${shotNum}.png`);
        if (!existsSync(imgPath)) continue;

        // Skip panels that were already style-matched in a previous run
        const preStylePath = join(sceneDir, `shot-${shotNum}-pre-style.png`);
        if (existsSync(preStylePath) && !newlyGenerated.has(shot.shotNumber)) {
          console.log(`  Shot ${shotNum}: already style-matched, skipping`);
          continue;
        }

        if (styleAnchorPath && existsSync(styleAnchorPath)) {
          try {
            const aestheticStr = [
              series.aesthetic!.style,
              series.aesthetic!.palette,
              series.aesthetic!.lighting,
            ].join(', ');
            await refineStyleConsistency(client, imgPath, styleAnchorPath, aestheticStr, editModel);
            console.log(`  Shot ${shotNum}: style-refined`);
          } catch (err) {
            console.warn(`  Shot ${shotNum}: refinement failed - ${err}`);
          }
        }
      }

      // Clean up temporary anchor
      if (styleAnchorPath && existsSync(styleAnchorPath)) {
        await unlink(styleAnchorPath);
      }
    }

    const ep = series.episodes.find(e => e.number === opts.episode);
    if (ep) ep.status = 'storyboarded';
    await saveSeries(series);

    console.log(`\nStoryboard complete. ${script.shots.length} panels in: ${sceneDir}`);
    console.log(`\n>> QA REVIEW NEEDED: Run /qa-storyboard to check character/setting consistency before proceeding.`);
    console.log(`   The agent will compare each panel against character references and flag issues.`);
    console.log(`\nAfter QA approval: generate-videos -p ${series.outputDir} -e ${opts.episode}`);
  });

// ── fix-panel ─────────────────────────────────────────────────────────
program
  .command('fix-panel')
  .description('Fix character appearance in a panel using multi-edit with character references')
  .requiredOption('-p, --project <dir>', 'Series output directory')
  .requiredOption('-e, --episode <number>', 'Episode number', parseInt)
  .requiredOption('-s, --shot <number>', 'Shot number to fix', parseInt)
  .option('-c, --characters <names>', 'Character names to fix (comma-separated)')
  .option('--edit-model <model>', 'Multi-edit model', 'nano-banana-pro-edit')
  .option('--prompt <prompt>', 'Custom edit prompt (overrides auto-generated)')
  .action(async (opts: {
    project: string; episode: number; shot: number;
    characters?: string; editModel: string; prompt?: string;
  }) => {
    const series = await loadSeries(resolve(opts.project));
    if (!series) { console.error('Series not found.'); process.exit(1); }

    const script = await loadEpisodeScript(series, opts.episode);
    if (!script) { console.error(`Episode ${opts.episode} script not found.`); process.exit(1); }

    const shot = script.shots.find(s => s.shotNumber === opts.shot);
    if (!shot) { console.error(`Shot ${opts.shot} not found in script.`); process.exit(1); }

    const episodeDir = getEpisodeDir(series, opts.episode);
    const shotNum = String(opts.shot).padStart(3, '0');
    const panelPath = join(episodeDir, 'scene-001', `shot-${shotNum}.png`);

    if (!existsSync(panelPath)) {
      console.error(`Panel not found: ${panelPath}`);
      process.exit(1);
    }

    const charNames = opts.characters
      ? opts.characters.split(',').map(s => s.trim())
      : shot.characters;

    if (charNames.length === 0) {
      console.error('No characters specified and shot has no characters.');
      process.exit(1);
    }

    const apiKey = getVeniceApiKey();
    const client = new VeniceClient(apiKey);

    console.log(`Fixing shot ${shotNum} with character references: ${charNames.join(', ')}`);

    await fixPanel(
      client,
      series,
      panelPath,
      charNames,
      opts.editModel as MultiEditModel,
      opts.prompt,
    );

    console.log(`\nPanel fixed. Review: ${panelPath}`);
    console.log(`Original archived as: shot-${shotNum}-pre-fix.png`);
  });

// ── generate-videos ───────────────────────────────────────────────────
program
  .command('generate-videos')
  .description('Generate video clips from storyboard panels (with native audio)')
  .requiredOption('-p, --project <dir>', 'Series output directory')
  .requiredOption('-e, --episode <number>', 'Episode number', parseInt)
  .action(async (opts: { project: string; episode: number }) => {
    const series = await loadSeries(resolve(opts.project));
    if (!series) { console.error('Series not found.'); process.exit(1); }

    const script = await loadEpisodeScript(series, opts.episode);
    if (!script) { console.error(`Episode ${opts.episode} script not found.`); process.exit(1); }

    const apiKey = getVeniceApiKey();
    const client = new VeniceClient(apiKey);
    const episodeDir = getEpisodeDir(series, opts.episode);
    const sceneDir = join(episodeDir, 'scene-001');
    const generationPlan = buildGenerationPlan(script);

    console.log(`Generating videos for Episode ${opts.episode}: ${script.title}`);
    console.log(`Models: action=${series.videoDefaults.actionModel}, atmosphere=${series.videoDefaults.atmosphereModel}\n`);
    console.log(`Generation units: ${generationPlan.units.length}`);
    const multiUnitCount = generationPlan.units.filter(unit => unit.unitType === 'kling-multishot').length;
    if (multiUnitCount > 0) {
      console.log(`Kling multi-shot units: ${multiUnitCount}\n`);
    }

    const { videoPaths, plan } = await generateEpisodeVideos(client, series, script.shots, sceneDir, generationPlan);
    await saveGenerationPlan(episodeDir, plan);

    const ep = series.episodes.find(e => e.number === opts.episode);
    if (ep) ep.status = 'produced';
    await saveSeries(series);

    console.log(`\nGenerated ${videoPaths.length} video clips.`);
    console.log(`Generation plan saved to: ${join(episodeDir, 'generation-plan.json')}`);
    console.log(`Next: assemble-episode -p ${series.outputDir} -e ${opts.episode}`);
  });

// ── override-audio ────────────────────────────────────────────────────
program
  .command('override-audio')
  .description('Replace dialogue/SFX with Venice audio models (optional, post video-gen)')
  .requiredOption('-p, --project <dir>', 'Series output directory')
  .requiredOption('-e, --episode <number>', 'Episode number', parseInt)
  .option('--dialogue', 'Override dialogue with Venice TTS', false)
  .option('--sfx', 'Generate SFX overrides', false)
  .action(async (opts: { project: string; episode: number; dialogue: boolean; sfx: boolean }) => {
    const series = await loadSeries(resolve(opts.project));
    if (!series) { console.error('Series not found.'); process.exit(1); }

    const script = await loadEpisodeScript(series, opts.episode);
    if (!script) { console.error(`Episode ${opts.episode} script not found.`); process.exit(1); }

    const apiKey = getVeniceApiKey();
    const client = new VeniceClient(apiKey);
    const episodeDir = getEpisodeDir(series, opts.episode);
    const audioDir = join(episodeDir, 'audio');
    await mkdir(audioDir, { recursive: true });

    if (opts.dialogue) {
      console.log('Generating dialogue with locked character voices...');
      const lines: DialogueLine[] = script.shots
        .filter(s => s.dialogue)
        .map(s => {
          const char = getCharacter(series, s.dialogue!.character);
          return {
            shotNumber: s.shotNumber,
            character: s.dialogue!.character,
            voiceId: char?.voiceId || '',
            text: s.dialogue!.line,
            voicePrompt: char?.voiceDescription,
          };
        })
        .filter(l => l.voiceId);

      if (lines.length === 0) {
        console.warn('  No characters have locked voices. Run audition-voices first.');
      } else {
        await generateDialogueForShots(client, lines, audioDir);
        console.log(`  Generated ${lines.length} dialogue lines (mapped to shot numbers).`);
      }
    }

    if (opts.sfx) {
      console.log('Generating SFX overrides...');
      const sfxShots = script.shots.filter(s => s.sfx);
      for (let i = 0; i < sfxShots.length; i++) {
        const shot = sfxShots[i];
        const outputPath = join(audioDir, `sfx-${String(i + 1).padStart(3, '0')}.mp3`);
        try {
          await generateSoundEffect(
            client,
            {
              text: shot.sfx!,
              durationSeconds: parseShotDurationSeconds(shot.duration),
            },
            outputPath,
          );
          console.log(`  SFX: "${shot.sfx!.slice(0, 40)}" -> ${outputPath}`);
        } catch (err) {
          console.warn(`  SFX failed: ${err}`);
        }
      }
    }

    console.log(`\nAudio overrides saved to: ${audioDir}`);
  });

// ── generate-music ────────────────────────────────────────────────────
program
  .command('generate-music')
  .description('Generate background music track via Venice audio')
  .requiredOption('-p, --project <dir>', 'Series output directory')
  .requiredOption('-e, --episode <number>', 'Episode number', parseInt)
  .option('--prompt <prompt>', 'Music style/mood description')
  .option('--duration <value>', 'Duration in seconds, or milliseconds for backward compatibility', '60')
  .action(async (opts: { project: string; episode: number; prompt?: string; duration: string }) => {
    const series = await loadSeries(resolve(opts.project));
    if (!series) { console.error('Series not found.'); process.exit(1); }

    const apiKey = getVeniceApiKey();
    const client = new VeniceClient(apiKey);
    const episodeDir = getEpisodeDir(series, opts.episode);
    const audioDir = join(episodeDir, 'audio');
    await mkdir(audioDir, { recursive: true });

    const musicPrompt = opts.prompt || `Dramatic ${series.genre} background music, tension and emotion, cinematic`;
    const outputPath = join(audioDir, 'music.mp3');
    const durationSeconds = normalizeAudioDurationSeconds(opts.duration, 60);

    console.log(`Generating music: "${musicPrompt}" (${durationSeconds}s)`);
    await generateMusic(client, {
      prompt: musicPrompt,
      durationSeconds,
    }, outputPath);

    console.log(`Music saved: ${outputPath}`);
  });

// ── assemble-episode ──────────────────────────────────────────────────
program
  .command('assemble-episode')
  .description('Stitch video clips + dialogue replacement + music + subtitles')
  .requiredOption('-p, --project <dir>', 'Series output directory')
  .requiredOption('-e, --episode <number>', 'Episode number', parseInt)
  .option('--no-subtitles', 'Skip subtitle burn-in')
  .option('--no-music', 'Skip background music mixing')
  .option('--no-ambient', 'Skip ambient bed mixing')
  .option('--ambient-volume <vol>', 'Ambient bed volume (0-1)', '0.3')
  .option('--no-dialogue-replace', 'Skip Venice dialogue replacement (use native model voices)')
  .option('--native-volume <vol>', 'Native audio volume when dialogue is replaced (0-1)', '0.2')
  .action(async (opts: {
    project: string; episode: number; subtitles: boolean; music: boolean;
    ambient: boolean; ambientVolume: string;
    dialogueReplace: boolean; nativeVolume: string;
  }) => {
    const series = await loadSeries(resolve(opts.project));
    if (!series) { console.error('Series not found.'); process.exit(1); }

    const script = await loadEpisodeScript(series, opts.episode);
    if (!script) { console.error(`Episode ${opts.episode} script not found.`); process.exit(1); }

    const episodeDir = getEpisodeDir(series, opts.episode);
    const sceneDir = join(episodeDir, 'scene-001');
    const audioDir = join(episodeDir, 'audio');

    const videoFiles = await collectShotVideos(sceneDir);
    if (videoFiles.length === 0) {
      console.error('No video clips found. Run generate-videos first.');
      process.exit(1);
    }

    console.log(`Assembling Episode ${opts.episode}: ${script.title}`);
    console.log(`  ${videoFiles.length} video clips`);

    const hasDialogueFiles = existsSync(audioDir) &&
      readdirSync(audioDir).some((f: string) => f.startsWith('dialogue-shot-'));
    const useDialogueReplace = opts.dialogueReplace !== false && hasDialogueFiles;

    if (useDialogueReplace) {
      console.log(`  Dialogue replacement: ON (native audio ducked to ${Math.round(parseFloat(opts.nativeVolume) * 100)}%)`);
    } else if (opts.dialogueReplace !== false && !hasDialogueFiles) {
      console.log(`  Dialogue replacement: OFF (no TTS files found -- run override-audio --dialogue first for voice consistency)`);
    } else {
      console.log(`  Dialogue replacement: OFF (using native model voices)`);
    }

    // Collect per-shot trim/flip metadata from script
    const shotTrims = script.shots
      .filter(s => s.trimStart || s.trimEnd || s.flip)
      .map(s => ({ shotNumber: s.shotNumber, trimStart: s.trimStart, trimEnd: s.trimEnd, flip: s.flip }));
    if (shotTrims.length > 0) {
      console.log(`  Trim/flip metadata: ${shotTrims.length} shots`);
    }

    let srtPath: string | undefined;
    if (opts.subtitles !== false) {
      const subtitles = generateSubtitles(script.shots, sceneDir);
      if (subtitles.length > 0) {
        srtPath = join(episodeDir, 'subtitles.srt');
        await saveSrt(subtitles, srtPath);
        console.log(`  Generated ${subtitles.length} subtitle entries`);
      }
    }

    const musicPath = join(audioDir, 'music.mp3');
    const hasMusic = opts.music !== false && existsSync(musicPath);

    const ambientCandidates = [
      join(audioDir, 'ambient-rain-heavy.mp3'),
      join(audioDir, 'ambient-rain.mp3'),
    ];
    const ambientPath = ambientCandidates.find(path => existsSync(path));
    const hasAmbient = opts.ambient !== false && !!ambientPath;
    if (hasAmbient) {
      console.log(`  Ambient bed: ON (${Math.round(parseFloat(opts.ambientVolume) * 100)}% volume)`);
    } else if (opts.ambient !== false) {
      console.log(`  Ambient bed: OFF (no ambient bed found in audio/)`);
    }

    const epNum = String(opts.episode).padStart(3, '0');
    const outputPath = join(episodeDir, `episode-${epNum}-final.mp4`);

    await assembleEpisode({
      videoFiles,
      outputPath,
      srtPath,
      musicPath: hasMusic ? musicPath : undefined,
      musicVolume: 0.15,
      ambientBedPath: hasAmbient ? ambientPath : undefined,
      ambientBedVolume: parseFloat(opts.ambientVolume),
      dialogueDir: useDialogueReplace ? audioDir : undefined,
      nativeAudioVolume: parseFloat(opts.nativeVolume),
      shotTrims,
    });

    const ep = series.episodes.find(e => e.number === opts.episode);
    if (ep) ep.status = 'assembled';
    await saveSeries(series);

    console.log(`\nFinal episode: ${outputPath}`);
  });

// ── produce-episode ───────────────────────────────────────────────────
program
  .command('produce-episode')
  .description('Full pipeline: storyboard -> video -> music -> assembly')
  .requiredOption('-p, --project <dir>', 'Series output directory')
  .requiredOption('-e, --episode <number>', 'Episode number', parseInt)
  .option('--with-tts', 'Add Venice dialogue replacement for voice consistency across episodes', false)
  .option('--skip-music', 'Skip background music generation', false)
  .action(async (opts: { project: string; episode: number; withTts: boolean; skipMusic: boolean }) => {
    console.log('=== Full Episode Production Pipeline ===\n');

    console.log('Step 1: Generating storyboard panels...');
    await program.parseAsync(['', '', 'storyboard-episode', '-p', opts.project, '-e', String(opts.episode)]);

    console.log('\nStep 2: QA -- Review panels for character/setting consistency');
    console.log('  >> Run /qa-storyboard now to verify before proceeding to video generation.');
    console.log('  >> Delete and regenerate any flagged panels, then continue.\n');

    console.log('Step 3: Generating video clips (dialogue + SFX + ambient via native model audio)...');
    await program.parseAsync(['', '', 'generate-videos', '-p', opts.project, '-e', String(opts.episode)]);

    if (opts.withTts) {
      console.log('\nStep 4: Replacing dialogue with Venice TTS (voice consistency mode)...');
      await program.parseAsync(['', '', 'override-audio', '-p', opts.project, '-e', String(opts.episode), '--dialogue']);
    }

    if (!opts.skipMusic) {
      const stepNum = opts.withTts ? 5 : 4;
      console.log(`\nStep ${stepNum}: Generating background music...`);
      await program.parseAsync(['', '', 'generate-music', '-p', opts.project, '-e', String(opts.episode)]);
    }

    const finalStep = opts.withTts ? (opts.skipMusic ? 5 : 6) : (opts.skipMusic ? 4 : 5);
    console.log(`\nStep ${finalStep}: Assembling final episode (music + subtitles)...`);
    await program.parseAsync(['', '', 'assemble-episode', '-p', opts.project, '-e', String(opts.episode)]);

    console.log('\n=== Production Complete ===');
  });

program.parse();

// ── Helpers ───────────────────────────────────────────────────────────

function generateCompareHtml(
  styles: { name: string; style: string; palette: string }[],
  seriesName: string,
): string {
  const cards = styles.map(s => `
    <div class="card">
      <img src="${s.name}.png" alt="${s.name}" />
      <h3>${s.name}</h3>
      <p>${s.style}</p>
      <p class="sub">${s.palette}</p>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <title>Aesthetic Comparison - ${seriesName}</title>
  <style>
    body { background: #111; color: #eee; font-family: system-ui; padding: 2rem; }
    h1 { text-align: center; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; }
    .card { background: #222; border-radius: 12px; overflow: hidden; }
    .card img { width: 100%; display: block; }
    .card h3 { padding: 0.5rem 1rem 0; margin: 0; }
    .card p { padding: 0 1rem 0.5rem; margin: 0; color: #aaa; font-size: 0.9rem; }
    .card .sub { color: #777; font-size: 0.8rem; padding-bottom: 1rem; }
  </style>
</head>
<body>
  <h1>${seriesName} - Aesthetic Options</h1>
  <div class="grid">${cards}</div>
</body>
</html>`;
}

function normalizeAudioDurationSeconds(rawValue: string, fallbackSeconds: number): number {
  const parsed = parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackSeconds;
  }

  if (parsed > 1_000) {
    return Math.max(1, Math.round(parsed / 1_000));
  }

  return parsed;
}

function parseShotDurationSeconds(duration: string): number {
  const match = duration.match(/(\d+(?:\.\d+)?)\s*s/i);
  if (match) {
    return Math.max(1, Math.round(parseFloat(match[1])));
  }

  const numeric = parseFloat(duration);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.max(1, Math.round(numeric));
  }

  return 5;
}
