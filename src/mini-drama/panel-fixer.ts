import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { VeniceClient } from '../venice/client.js';
import type { MultiEditModel } from '../venice/types.js';
import { multiEditImage, loadImageAsDataUri } from '../venice/multi-edit.js';
import type { SeriesState, ShotScript, MiniDramaCharacter } from '../series/types.js';
import { FEMALE_BASE_TRAITS, MALE_BASE_TRAITS } from '../series/types.js';
import { getCharacterDir } from '../series/manager.js';

/**
 * Venice multi-edit always returns 1024x1024 regardless of input.
 * This crops the center of the square output to match the original
 * panel's aspect ratio, then scales to the original dimensions.
 *
 * For 9:16 (768x1376): crops center 576x1024 strip, scales to 768x1376.
 * Veo 3.1 auto-corrects 1:1 input, so atmosphere shots can skip this.
 */
function getImageDimensions(filePath: string): [number, number] | null {
  const info = execSync(`file "${filePath}"`).toString();
  // PNG: "1024 x 1024", WebP: "768x1376"
  const match = info.match(/(\d+)\s*x\s*(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/**
 * Convert WebP-disguised PNGs to real PNGs (Venice returns WebP internally).
 * This ensures multi-edit gets proper PNG input and dimensions parse correctly.
 */
async function ensureRealPng(filePath: string): Promise<void> {
  const header = execSync(`file -b "${filePath}"`).toString().slice(0, 4);
  if (header === 'RIFF') {
    const tmpPath = filePath.replace(/\.png$/, '-webp-conv.png');
    execSync(`ffmpeg -i "${filePath}" -y "${tmpPath}" 2>/dev/null`);
    execSync(`mv "${tmpPath}" "${filePath}"`);
  }
}

async function restoreAspectRatio(
  filePath: string,
  targetWidth: number,
  targetHeight: number,
): Promise<void> {
  const dims = getImageDimensions(filePath);
  if (!dims) return;
  const [curW, curH] = dims;
  if (curW === targetWidth && curH === targetHeight) return;

  const targetRatio = targetWidth / targetHeight;
  const curRatio = curW / curH;

  // Only crop if aspect ratios actually differ
  if (Math.abs(targetRatio - curRatio) < 0.01) return;

  let cropW: number, cropH: number;
  if (targetRatio < curRatio) {
    // Target is taller (e.g. 9:16) -- crop width, keep height
    cropH = curH;
    cropW = Math.round(curH * targetRatio);
  } else {
    // Target is wider -- crop height, keep width
    cropW = curW;
    cropH = Math.round(curW / targetRatio);
  }

  const cropX = Math.round((curW - cropW) / 2);
  const cropY = Math.round((curH - cropH) / 2);

  const tmpPath = filePath.replace(/\.png$/, '-crop-tmp.png');
  execSync(
    `ffmpeg -i "${filePath}" -vf "crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${targetWidth}:${targetHeight}:flags=lanczos" -y "${tmpPath}" 2>/dev/null`,
  );
  execSync(`mv "${tmpPath}" "${filePath}"`);
  console.log(`  Restored aspect ratio: ${curW}x${curH} → ${targetWidth}x${targetHeight}`);
}

function buildCharacterFixPrompt(char: MiniDramaCharacter): string {
  const traits = char.gender === 'female' ? FEMALE_BASE_TRAITS : MALE_BASE_TRAITS;
  return (
    `Make the ${char.gender === 'female' ? 'woman' : 'man'} in the scene match the reference image's CHARACTER APPEARANCE ONLY. ` +
    `Character: ${char.name}. ${traits}. ${char.fullDescription}. ` +
    `Wearing: ${char.wardrobe}. ` +
    `CRITICAL: Keep the scene as a single continuous image. Do NOT copy the reference image's layout. ` +
    `Do NOT add text labels, annotations, inset panels, detail callouts, or multi-view compositions. ` +
    `Keep the scene composition, background, and other characters unchanged. ` +
    `Only modify this character's face, hair, body, and clothing to match the reference.`
  );
}

function buildTwoCharacterFixPrompt(char1: MiniDramaCharacter, char2: MiniDramaCharacter): string {
  const traits1 = char1.gender === 'female' ? FEMALE_BASE_TRAITS : MALE_BASE_TRAITS;
  const traits2 = char2.gender === 'female' ? FEMALE_BASE_TRAITS : MALE_BASE_TRAITS;
  return (
    `Make both characters match their reference images' CHARACTER APPEARANCE ONLY. ` +
    `Image 2 is the reference for ${char1.name} (${traits1}, ${char1.fullDescription}, wearing ${char1.wardrobe}). ` +
    `Image 3 is the reference for ${char2.name} (${traits2}, ${char2.fullDescription}, wearing ${char2.wardrobe}). ` +
    `CRITICAL: Keep the scene as a single continuous image. Do NOT copy the reference images' layout. ` +
    `Do NOT add text labels, annotations, inset panels, detail callouts, or multi-view compositions. ` +
    `Keep the scene composition and background unchanged. Fix character appearance only.`
  );
}

export async function fixPanel(
  client: VeniceClient,
  series: SeriesState,
  panelPath: string,
  characterNames: string[],
  model?: MultiEditModel,
  customPrompt?: string,
): Promise<string> {
  // Convert WebP-disguised PNGs to real PNGs before reading dimensions
  await ensureRealPng(panelPath);

  // Capture original dimensions before multi-edit squashes to 1024x1024
  const origDims = getImageDimensions(panelPath);
  const origW = origDims ? origDims[0] : 0;
  const origH = origDims ? origDims[1] : 0;

  const panelDataUri = await loadImageAsDataUri(panelPath);

  const chars = characterNames
    .map(name => series.characters.find(c => c.name.toUpperCase() === name.toUpperCase()))
    .filter((c): c is MiniDramaCharacter => c !== undefined);

  if (chars.length === 0) {
    throw new Error(`No matching characters found for: ${characterNames.join(', ')}`);
  }

  const charRefs: string[] = [];
  for (const char of chars.slice(0, 2)) {
    const frontPath = join(getCharacterDir(series, char.name), 'front.png');
    if (!existsSync(frontPath)) {
      throw new Error(`Reference image not found for ${char.name}: ${frontPath}`);
    }
    charRefs.push(await loadImageAsDataUri(frontPath));
  }

  let prompt: string;
  if (customPrompt) {
    prompt = customPrompt;
  } else if (chars.length === 1) {
    prompt = buildCharacterFixPrompt(chars[0]);
  } else {
    prompt = buildTwoCharacterFixPrompt(chars[0], chars[1]);
  }

  console.log(`  Multi-editing panel with ${chars.length} character reference(s)...`);
  console.log(`  Model: ${model || 'nano-banana-pro-edit'}`);

  const resultBuffer = await multiEditImage(client, {
    model,
    prompt,
    baseImage: panelDataUri,
    referenceImages: charRefs,
  });

  if (existsSync(panelPath)) {
    const archivePath = panelPath.replace(/\.png$/, '-pre-fix.png');
    await rename(panelPath, archivePath);
    console.log(`  Archived original: ${archivePath}`);
  }

  await writeFile(panelPath, resultBuffer);

  // Restore original aspect ratio (multi-edit always returns 1024x1024)
  if (origW > 0 && origH > 0) {
    await restoreAspectRatio(panelPath, origW, origH);
  }

  console.log(`  Fixed panel saved: ${panelPath}`);
  return panelPath;
}

export async function refineWithReferences(
  client: VeniceClient,
  series: SeriesState,
  panelPath: string,
  shot: ShotScript,
  model?: MultiEditModel,
): Promise<string> {
  if (shot.characters.length === 0) return panelPath;
  return fixPanel(client, series, panelPath, shot.characters, model);
}

/**
 * Refine a panel's aesthetic to match a style anchor image.
 * Used for shots without characters (establishing, insert, title cards)
 * to maintain visual consistency with the rest of the episode.
 */
export async function refineStyleConsistency(
  client: VeniceClient,
  panelPath: string,
  styleAnchorPath: string,
  aesthetic: string,
  model?: MultiEditModel,
): Promise<string> {
  await ensureRealPng(panelPath);
  const origDims = getImageDimensions(panelPath);
  const origW = origDims ? origDims[0] : 0;
  const origH = origDims ? origDims[1] : 0;

  const panelDataUri = await loadImageAsDataUri(panelPath);
  const anchorDataUri = await loadImageAsDataUri(styleAnchorPath);

  const prompt =
    `Match the visual style of the reference image: same rendering style, color palette, line weight, and lighting treatment. ` +
    `Style: ${aesthetic}. ` +
    `CRITICAL: Keep the scene composition and content unchanged. Only harmonize the visual style. ` +
    `Do NOT add characters, people, text, labels, or inset panels. Do NOT change the scene's subject matter.`;

  console.log(`  Style-matching panel against anchor image...`);

  const resultBuffer = await multiEditImage(client, {
    model,
    prompt,
    baseImage: panelDataUri,
    referenceImages: [anchorDataUri],
  });

  if (existsSync(panelPath)) {
    const archivePath = panelPath.replace(/\.png$/, '-pre-style.png');
    await rename(panelPath, archivePath);
  }

  await writeFile(panelPath, resultBuffer);

  if (origW > 0 && origH > 0) {
    await restoreAspectRatio(panelPath, origW, origH);
  }

  console.log(`  Style-matched panel saved: ${panelPath}`);
  return panelPath;
}
