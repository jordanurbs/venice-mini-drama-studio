import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { VeniceClient } from '../venice/client.js';
import type {
  GenerationPlan,
  GenerationUnit,
  GenerationUnitSegment,
  SeriesState,
  ShotScript,
} from '../series/types.js';
import {
  buildKlingMultiShotPrompt,
  buildVideoPrompt,
  type MiniDramaVideoPrompt,
} from './prompt-builder.js';
import { parseShotDuration } from './generation-planner.js';

const VIDEO_QUEUE_PATH = '/api/v1/video/queue';
const VIDEO_RETRIEVE_PATH = '/api/v1/video/retrieve';
const VIDEO_COMPLETE_PATH = '/api/v1/video/complete';
const POLL_INTERVAL_MS = 10_000;

interface QueueResponse {
  model: string;
  queue_id: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function extractLastFrame(videoPath: string, outputPath: string): void {
  const durationStr = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
    { encoding: 'utf-8' },
  ).trim();
  const duration = parseFloat(durationStr);
  const seekTo = Math.max(0, duration - 0.05);

  execSync(
    `ffmpeg -y -ss ${seekTo} -i "${videoPath}" -frames:v 1 "${outputPath}"`,
    { stdio: 'pipe' },
  );
}

function imageToDataUri(imagePath: string, mimeType = 'image/png'): string {
  const buffer = readFileSync(imagePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function getVideoDuration(path: string): number {
  const out = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${path}"`,
    { encoding: 'utf-8' },
  ).trim();
  return parseFloat(out);
}

function archiveExisting(outputPath: string): void {
  if (!existsSync(outputPath)) return;

  let version = 1;
  let archivePath = outputPath.replace(/\.mp4$/, `-v${version}.mp4`);
  while (existsSync(archivePath)) {
    version += 1;
    archivePath = outputPath.replace(/\.mp4$/, `-v${version}.mp4`);
  }

  renameSync(outputPath, archivePath);
  console.log(`  Archived previous: ${archivePath}`);
}

function saveJson(path: string, data: unknown): Promise<void> {
  return writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

interface RenderVideoOptions {
  prompt: MiniDramaVideoPrompt;
  anchorImagePath: string;
  outputPath: string;
  endFrameImagePath?: string;
}

async function renderVideoFile(
  client: VeniceClient,
  options: RenderVideoOptions,
): Promise<string> {
  const { prompt, anchorImagePath, outputPath, endFrameImagePath } = options;
  await mkdir(dirname(outputPath), { recursive: true });

  const body: Record<string, unknown> = {
    model: prompt.model,
    prompt: prompt.prompt,
    duration: prompt.duration,
    image_url: imageToDataUri(anchorImagePath),
    audio: prompt.audio,
  };

  if (endFrameImagePath && existsSync(endFrameImagePath) && prompt.model.includes('kling')) {
    body.end_image_url = imageToDataUri(endFrameImagePath);
  }

  if (prompt.model.includes('veo')) {
    body.resolution = '720p';
  }

  console.log(`  Queueing video: model=${prompt.model}, duration=${prompt.duration}`);
  const queueResponse = await client.post<QueueResponse>(VIDEO_QUEUE_PATH, body);
  const { queue_id, model } = queueResponse;
  console.log(`  Queue ID: ${queue_id}`);

  let elapsed = 0;
  while (true) {
    await sleep(POLL_INTERVAL_MS);
    elapsed += POLL_INTERVAL_MS;

    try {
      const response = await fetch(`https://api.venice.ai/api/v1/video/retrieve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.VENICE_API_KEY}`,
        },
        body: JSON.stringify({ model, queue_id }),
      });

      if (response.headers.get('content-type')?.includes('video/mp4')) {
        const videoBuffer = Buffer.from(await response.arrayBuffer());

        archiveExisting(outputPath);

        await writeFile(outputPath, videoBuffer);
        console.log(`  Video saved: ${outputPath} (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB, ${(elapsed / 1000).toFixed(0)}s)`);

        try {
          await client.post(VIDEO_COMPLETE_PATH, { model, queue_id });
        } catch { /* cleanup is optional */ }

        return outputPath;
      }

      const status = (await response.json()) as { status: string; execution_duration?: number };
      const pct = status.execution_duration
        ? `${(status.execution_duration / 1000).toFixed(0)}s elapsed`
        : '';
      process.stdout.write(`\r  Polling... ${status.status} ${pct}   `);
    } catch (err) {
      console.warn(`  Poll error (will retry): ${err}`);
    }
  }
}

function getShotPanelPath(sceneDir: string, shotNumber: number): string {
  return join(sceneDir, `shot-${String(shotNumber).padStart(3, '0')}.png`);
}

function getShotVideoPath(sceneDir: string, shotNumber: number): string {
  return join(sceneDir, `shot-${String(shotNumber).padStart(3, '0')}.mp4`);
}

function chooseAnchorImagePath(
  unit: GenerationUnit,
  sceneDir: string,
  unitOutputPath: string,
  previousRenderedShotPath?: string,
): string {
  const firstShotNumber = unit.shotNumbers[0];
  const panelPath = getShotPanelPath(sceneDir, firstShotNumber);

  if (unit.startFrameStrategy === 'previous-last-frame'
    && previousRenderedShotPath
    && existsSync(previousRenderedShotPath)) {
    const lastFramePath = unitOutputPath.replace(/\.mp4$/, '-lastframe.png');
    extractLastFrame(previousRenderedShotPath, lastFramePath);
    console.log('  Start frame: chained from previous rendered shot');
    return lastFramePath;
  }

  console.log('  Start frame: panel image');
  return panelPath;
}

function chooseEndFrameImagePath(
  unit: GenerationUnit,
  sceneDir: string,
  nextShotNumber?: number,
): string | undefined {
  if (unit.endFrameStrategy !== 'next-panel-target' || nextShotNumber === undefined) {
    console.log('  End frame: natural');
    return undefined;
  }

  const nextPanelPath = getShotPanelPath(sceneDir, nextShotNumber);
  if (!existsSync(nextPanelPath)) {
    console.log('  End frame: natural (next panel missing)');
    return undefined;
  }

  console.log(`  End frame: targeting shot-${String(nextShotNumber).padStart(3, '0')}`);
  return nextPanelPath;
}

async function saveSingleShotMetadata(
  series: SeriesState,
  shot: ShotScript,
  videoPath: string,
  videoPrompt: MiniDramaVideoPrompt,
  extraMetadata: Record<string, unknown> = {},
): Promise<void> {
  const videoJsonPath = videoPath.replace(/\.mp4$/, '.video.json');
  await saveJson(videoJsonPath, {
    panelId: `E${series.episodes.length}-S${shot.shotNumber}`,
    shotNumber: shot.shotNumber,
    video: {
      model: videoPrompt.model,
      prompt: videoPrompt.prompt,
      duration: videoPrompt.duration,
      audio: videoPrompt.audio,
    },
    metadata: {
      characters: shot.characters,
      dialogue: shot.dialogue,
      sfx: shot.sfx,
      transition: shot.transition,
      cameraMovement: shot.cameraMovement,
      ...extraMetadata,
    },
  });
}

function splitRenderedUnitIntoShots(
  unitOutputPath: string,
  unit: GenerationUnit,
  shotsByNumber: Map<number, ShotScript>,
  sceneDir: string,
): GenerationUnitSegment[] {
  const renderedDuration = getVideoDuration(unitOutputPath);
  const plannedTotal = unit.shotNumbers.reduce((sum, shotNumber) => {
    const shot = shotsByNumber.get(shotNumber);
    return sum + (shot ? parseShotDuration(shot.duration) : 0);
  }, 0);

  let offset = 0;
  const segments: GenerationUnitSegment[] = [];

  for (let index = 0; index < unit.shotNumbers.length; index++) {
    const shotNumber = unit.shotNumbers[index];
    const shot = shotsByNumber.get(shotNumber);
    if (!shot) continue;

    const outputPath = getShotVideoPath(sceneDir, shotNumber);
    const isLast = index === unit.shotNumbers.length - 1;
    const durationSec = isLast
      ? Math.max(0.1, renderedDuration - offset)
      : Math.max(0.1, renderedDuration * (parseShotDuration(shot.duration) / plannedTotal));

    archiveExisting(outputPath);
    execSync(
      `ffmpeg -y -ss ${offset} -i "${unitOutputPath}" -t ${durationSec} ` +
      `-c:v libx264 -preset fast -crf 18 -c:a aac -ar 44100 -ac 2 -b:a 192k "${outputPath}"`,
      { stdio: 'pipe' },
    );

    segments.push({
      shotNumber,
      startOffsetSec: Number(offset.toFixed(3)),
      durationSec: Number(durationSec.toFixed(3)),
      outputFile: `shot-${String(shotNumber).padStart(3, '0')}.mp4`,
    });

    offset += durationSec;
  }

  return segments;
}

async function renderSingleShotUnit(
  client: VeniceClient,
  series: SeriesState,
  shot: ShotScript,
  unit: GenerationUnit,
  sceneDir: string,
  previousRenderedShotPath: string | undefined,
  nextShotNumber: number | undefined,
): Promise<string[]> {
  const panelPath = getShotPanelPath(sceneDir, shot.shotNumber);
  if (!existsSync(panelPath)) {
    console.warn(`  Panel not found: ${panelPath}, skipping shot ${shot.shotNumber}`);
    return [];
  }

  const videoPath = getShotVideoPath(sceneDir, shot.shotNumber);
  if (existsSync(videoPath)) {
    console.log(`  Shot ${String(shot.shotNumber).padStart(3, '0')}: video exists, skipping`);
    unit.renderedDurationSec = getVideoDuration(videoPath);
    unit.segments = [{
      shotNumber: shot.shotNumber,
      startOffsetSec: 0,
      durationSec: unit.renderedDurationSec,
      outputFile: `shot-${String(shot.shotNumber).padStart(3, '0')}.mp4`,
    }];
    return [videoPath];
  }

  const videoPrompt = buildVideoPrompt(shot, series);
  unit.model = videoPrompt.model;
  const anchorImagePath = chooseAnchorImagePath(unit, sceneDir, videoPath, previousRenderedShotPath);
  const endFramePath = chooseEndFrameImagePath(unit, sceneDir, nextShotNumber);
  const savedPath = await renderVideoFile(client, {
    prompt: videoPrompt,
    anchorImagePath,
    outputPath: videoPath,
    endFrameImagePath: endFramePath,
  });

  const durationSec = getVideoDuration(savedPath);
  unit.renderedDurationSec = durationSec;
  unit.segments = [{
    shotNumber: shot.shotNumber,
    startOffsetSec: 0,
    durationSec,
    outputFile: `shot-${String(shot.shotNumber).padStart(3, '0')}.mp4`,
  }];

  await saveSingleShotMetadata(series, shot, savedPath, videoPrompt, {
    generationUnit: unit.unitId,
  });
  return [savedPath];
}

async function renderMultiShotUnit(
  client: VeniceClient,
  series: SeriesState,
  shots: ShotScript[],
  unit: GenerationUnit,
  sceneDir: string,
  previousRenderedShotPath: string | undefined,
  nextShotNumber: number | undefined,
): Promise<string[]> {
  const shotOutputPaths = shots.map(shot => getShotVideoPath(sceneDir, shot.shotNumber));
  if (shotOutputPaths.every(path => existsSync(path))) {
    console.log(`  ${unit.unitId}: shot outputs exist, skipping`);
    let offset = 0;
    unit.segments = shotOutputPaths.map((path, index) => {
      const durationSec = getVideoDuration(path);
      const segment: GenerationUnitSegment = {
        shotNumber: shots[index].shotNumber,
        startOffsetSec: Number(offset.toFixed(3)),
        durationSec: Number(durationSec.toFixed(3)),
        outputFile: `shot-${String(shots[index].shotNumber).padStart(3, '0')}.mp4`,
      };
      offset += durationSec;
      return segment;
    });
    unit.renderedDurationSec = offset;
    return shotOutputPaths;
  }

  const firstPanelPath = getShotPanelPath(sceneDir, shots[0].shotNumber);
  if (!existsSync(firstPanelPath)) {
    console.warn(`  Panel not found: ${firstPanelPath}, skipping unit ${unit.unitId}`);
    return [];
  }

  const unitOutputPath = join(sceneDir, unit.outputFile);
  const prompt = buildKlingMultiShotPrompt(shots, unit, series);
  const anchorImagePath = chooseAnchorImagePath(unit, sceneDir, unitOutputPath, previousRenderedShotPath);
  const endFramePath = chooseEndFrameImagePath(unit, sceneDir, nextShotNumber);

  const savedUnitPath = await renderVideoFile(client, {
    prompt,
    anchorImagePath,
    outputPath: unitOutputPath,
    endFrameImagePath: endFramePath,
  });

  const segments = splitRenderedUnitIntoShots(savedUnitPath, unit, new Map(shots.map(shot => [shot.shotNumber, shot])), sceneDir);
  const shotPaths: string[] = [];

  for (const segment of segments) {
    const shot = shots.find(item => item.shotNumber === segment.shotNumber);
    if (!shot) continue;
    const shotPath = join(sceneDir, segment.outputFile);
    shotPaths.push(shotPath);

    await saveSingleShotMetadata(series, shot, shotPath, {
      ...prompt,
      duration: shot.duration,
    }, {
      generationUnit: unit.unitId,
      generatedFromUnit: unit.outputFile,
      unitStartOffsetSec: segment.startOffsetSec,
      unitDurationSec: segment.durationSec,
    });
  }

  unit.renderedDurationSec = Number(getVideoDuration(savedUnitPath).toFixed(3));
  unit.segments = segments;
  await saveJson(savedUnitPath.replace(/\.mp4$/, '.video.json'), {
    unitId: unit.unitId,
    shotNumbers: unit.shotNumbers,
    video: prompt,
    metadata: {
      unitType: unit.unitType,
      segments,
      decisionReasons: unit.decisionReasons,
    },
  });

  return shotPaths;
}

export interface GenerateEpisodeVideosResult {
  videoPaths: string[];
  plan: GenerationPlan;
}

export async function generateEpisodeVideos(
  client: VeniceClient,
  series: SeriesState,
  shots: ShotScript[],
  sceneDir: string,
  plan: GenerationPlan,
): Promise<GenerateEpisodeVideosResult> {
  const videoPaths: string[] = [];
  const shotsByNumber = new Map(shots.map(shot => [shot.shotNumber, shot]));
  let previousRenderedShotPath: string | undefined;

  for (let unitIndex = 0; unitIndex < plan.units.length; unitIndex++) {
    const unit = plan.units[unitIndex];
    const unitShots = unit.shotNumbers
      .map(shotNumber => shotsByNumber.get(shotNumber))
      .filter((shot): shot is ShotScript => Boolean(shot));
    const nextUnit = plan.units[unitIndex + 1];
    const nextShotNumber = nextUnit?.shotNumbers[0];

    if (unitShots.length === 0) continue;

    try {
      const savedPaths = unit.unitType === 'single'
        ? await renderSingleShotUnit(
          client,
          series,
          unitShots[0],
          unit,
          sceneDir,
          previousRenderedShotPath,
          nextShotNumber,
        )
        : await renderMultiShotUnit(
          client,
          series,
          unitShots,
          unit,
          sceneDir,
          previousRenderedShotPath,
          nextShotNumber,
        );

      if (savedPaths.length > 0) {
        videoPaths.push(...savedPaths);
        previousRenderedShotPath = savedPaths[savedPaths.length - 1];
      }
      console.log('');
    } catch (err) {
      if (unit.unitType === 'kling-multishot' && unit.fallbackToSingles) {
        console.warn(`  ${unit.unitId}: multi-shot render failed, falling back to single shots - ${err}`);
        for (const shot of unitShots) {
          const singleUnit: GenerationUnit = {
            ...unit,
            unitId: `${unit.unitId}-fallback-${String(shot.shotNumber).padStart(3, '0')}`,
            unitType: 'single',
            shotNumbers: [shot.shotNumber],
            outputFile: `shot-${String(shot.shotNumber).padStart(3, '0')}.mp4`,
            fallbackToSingles: false,
          };
          const shotPaths = await renderSingleShotUnit(
            client,
            series,
            shot,
            singleUnit,
            sceneDir,
            previousRenderedShotPath,
            nextShotNumber,
          );
          if (shotPaths.length > 0) {
            videoPaths.push(...shotPaths);
            previousRenderedShotPath = shotPaths[shotPaths.length - 1];
          }
        }
        console.log('');
        continue;
      }

      throw err;
    }
  }

  return { videoPaths, plan };
}
