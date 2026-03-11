import type {
  GenerationUnit,
  SeriesState,
  ShotScript,
  MiniDramaCharacter,
} from '../series/types.js';
import { VIDEO_NO_MUSIC_SUFFIX, FEMALE_BASE_TRAITS, MALE_BASE_TRAITS } from '../series/types.js';
import type { AestheticProfile } from '../storyboard/prompt-builder.js';
import { KLING_MULTISHOT_MODEL } from '../series/types.js';
import { parseShotDuration } from './generation-planner.js';

export interface MiniDramaImagePrompt {
  prompt: string;
  negativePrompt: string;
  seed?: number;
}

export interface MiniDramaVideoPrompt {
  prompt: string;
  model: string;
  duration: string;
  audio: boolean;
  imageUrl?: string;
  endImageUrl?: string;
  referenceImageUrls?: string[];
}

const NEGATIVE_PROMPT =
  'comic panels, multiple panels, panel layout, panel borders, panel grid, speech bubbles, text bubbles, ' +
  'manga panels, comic strip, storyboard grid, split screen, multiple frames, ' +
  'deformed, blurry, bad anatomy, bad hands, extra fingers, mutation, ' +
  'poorly drawn face, watermark, text, signature, low quality, ugly, ' +
  'umbrella, holding umbrella';

const CAMERA_TERMS: Record<string, string> = {
  'static': 'locked-off static shot',
  'slow dolly forward': 'slow dolly shot pushing forward',
  'slow dolly back': 'slow dolly shot pulling back',
  'pan left': 'slow pan left',
  'pan right': 'slow pan right',
  'tilt up': 'tilt up',
  'tilt down': 'tilt down',
  'tracking': 'tracking shot following the subject',
  'crane up': 'crane shot rising upward',
  'handheld': 'handheld shot with subtle movement',
  'zoom in': 'slow zoom in',
  'zoom out': 'slow zoom out',
};

function getCharacterPromptText(char: MiniDramaCharacter): string {
  const baseTraits = char.gender === 'female' ? FEMALE_BASE_TRAITS : MALE_BASE_TRAITS;
  return `${char.name} (${baseTraits}): ${char.fullDescription}`;
}

function buildAestheticString(aesthetic: AestheticProfile): string {
  return [aesthetic.style, aesthetic.palette, aesthetic.lighting, aesthetic.lensCharacteristics, `shot on ${aesthetic.filmStock}`]
    .filter(Boolean)
    .join(', ');
}

export function buildImagePrompt(
  shot: ShotScript,
  series: SeriesState,
): MiniDramaImagePrompt {
  if (!series.aesthetic) {
    throw new Error('Series aesthetic must be set before generating images.');
  }

  const aestheticStr = buildAestheticString(series.aesthetic);
  const parts: string[] = [];

  // Front-load the aesthetic and anti-comic directives
  parts.push(`STYLE: ${aestheticStr}.`);
  parts.push('Single cinematic frame, one continuous image, NOT a comic panel layout, NO panel borders, NO speech bubbles, NO text overlays.');

  // Anti-camera-facing for non-portrait shot types
  const portraitTypes = new Set(['close-up', 'reaction']);
  if (!portraitTypes.has(shot.type)) {
    parts.push('Characters are engaged in the scene, NOT looking at the camera.');
  }

  // Scene content -- use panelDescription (single-frame) if available,
  // otherwise fall back to description (which may contain sequential action)
  parts.push(`Camera: ${shot.cameraMovement}.`);
  parts.push(shot.panelDescription ?? shot.description);

  // Characters with full descriptions including base traits
  if (shot.characters.length > 0) {
    for (const charName of shot.characters) {
      const char = series.characters.find(c => c.name.toUpperCase() === charName.toUpperCase());
      if (char) {
        const baseTraits = char.gender === 'female' ? FEMALE_BASE_TRAITS : MALE_BASE_TRAITS;
        parts.push(`${char.name} (${baseTraits}): ${char.description}, wearing ${char.wardrobe}.`);
      }
    }
  }

  // Repeat aesthetic at end to bookend the prompt
  parts.push(`STYLE REMINDER: ${aestheticStr}.`);

  // Use series-level aesthetic seed for consistency across all shots
  const seed = series.aestheticSeed ?? undefined;

  return {
    prompt: parts.join(' ').trim(),
    negativePrompt: NEGATIVE_PROMPT,
    seed,
  };
}

function getCharacterVideoTag(char: MiniDramaCharacter): string {
  const key = char.gender === 'female'
    ? `${char.name}, ${char.age}, ${char.wardrobe}`
    : `${char.name}, ${char.age}, ${char.wardrobe}`;
  return key;
}

function buildCharacterAnchorText(characters: MiniDramaCharacter[]): string {
  if (characters.length === 0) return '';

  const anchors = characters.map(char => {
    const baseTraits = char.gender === 'female' ? FEMALE_BASE_TRAITS : MALE_BASE_TRAITS;
    return `${char.name}: ${baseTraits}, ${char.fullDescription}, wearing ${char.wardrobe}`;
  });

  return `Core subjects: ${anchors.join('; ')}.`;
}

export function buildVideoPrompt(
  shot: ShotScript,
  series: SeriesState,
): MiniDramaVideoPrompt {
  if (!series.aesthetic) {
    throw new Error('Series aesthetic must be set before generating videos.');
  }

  const parts: string[] = [];

  const cameraTerm = CAMERA_TERMS[shot.cameraMovement.toLowerCase()] ?? shot.cameraMovement;
  parts.push(`${cameraTerm}.`);

  parts.push(shot.description);

  if (shot.dialogue) {
    const speakingChar = series.characters.find(
      c => c.name.toUpperCase() === shot.dialogue!.character.toUpperCase(),
    );
    const voiceDesc = speakingChar?.voiceDescription
      ? ` (voice: ${speakingChar.voiceDescription})`
      : '';
    const delivery = shot.dialogue.delivery || 'in character';
    parts.push(`${shot.dialogue.character}${voiceDesc} says ${delivery}: "${shot.dialogue.line}"`);
  }

  if (shot.sfx) {
    parts.push(`Sound of ${shot.sfx}.`);
  }

  parts.push(buildAestheticString(series.aesthetic) + '.');
  parts.push(VIDEO_NO_MUSIC_SUFFIX);

  const videoPrompt = parts.join(' ');

  const modelId = shot.videoModel === 'action'
    ? series.videoDefaults.actionModel
    : series.videoDefaults.atmosphereModel;

  return {
    prompt: videoPrompt,
    model: modelId,
    duration: shot.duration,
    audio: true,
  };
}

export function buildKlingMultiShotPrompt(
  shots: ShotScript[],
  unit: GenerationUnit,
  series: SeriesState,
): MiniDramaVideoPrompt {
  if (!series.aesthetic) {
    throw new Error('Series aesthetic must be set before generating videos.');
  }

  const uniqueCharacters = Array.from(
    new Set(shots.flatMap(shot => shot.characters.map(name => name.toUpperCase()))),
  )
    .map(name => series.characters.find(char => char.name.toUpperCase() === name))
    .filter((char): char is MiniDramaCharacter => Boolean(char));

  const parts: string[] = [];
  const anchorText = buildCharacterAnchorText(uniqueCharacters);
  if (anchorText) parts.push(anchorText);

  parts.push('Generate this as one continuous multi-shot sequence with clearly distinct cinematic beats and stable subject continuity.');

  for (let index = 0; index < shots.length; index++) {
    const shot = shots[index];
    const cameraTerm = CAMERA_TERMS[shot.cameraMovement.toLowerCase()] ?? shot.cameraMovement;
    const shotParts: string[] = [];

    shotParts.push(`Shot ${index + 1} (${parseShotDuration(shot.duration)} seconds): ${cameraTerm}.`);
    shotParts.push(shot.description);

    if (shot.dialogue) {
      const speakingChar = series.characters.find(
        c => c.name.toUpperCase() === shot.dialogue!.character.toUpperCase(),
      );
      const voiceDesc = speakingChar?.voiceDescription
        ? `, voice: ${speakingChar.voiceDescription}`
        : '';
      const delivery = shot.dialogue.delivery || 'in character';
      shotParts.push(`[Character: ${shot.dialogue.character}${voiceDesc}, ${delivery}] "${shot.dialogue.line}"`);
    }

    if (shot.sfx) {
      shotParts.push(`Ambient and effects: ${shot.sfx}.`);
    }

    parts.push(shotParts.join(' '));
  }

  parts.push(buildAestheticString(series.aesthetic) + '.');
  parts.push(VIDEO_NO_MUSIC_SUFFIX);

  return {
    prompt: parts.join(' ').trim(),
    model: KLING_MULTISHOT_MODEL,
    duration: unit.duration,
    audio: true,
  };
}

export function buildCharacterReferencePrompt(
  char: MiniDramaCharacter,
  aesthetic: AestheticProfile,
  angle: 'front' | 'three-quarter' | 'profile' | 'full-body',
): string {
  const baseTraits = char.gender === 'female' ? FEMALE_BASE_TRAITS : MALE_BASE_TRAITS;

  const anglePrompts: Record<string, string> = {
    'front': 'front-facing portrait, looking directly at camera, centered, studio lighting, neutral background',
    'three-quarter': 'three-quarter view portrait, 45 degree angle, studio lighting, neutral background',
    'profile': 'side profile portrait, 90 degree angle, studio lighting, neutral background',
    'full-body': 'full body shot, head to toe, standing pose, studio lighting, neutral background',
  };

  const noLayout = 'single portrait only, no text, no labels, no annotations, no inset panels, no detail callouts, no multi-view layout';
  const aestheticStr = buildAestheticString(aesthetic);
  return `${char.fullDescription}. ${baseTraits}. ${anglePrompts[angle]}. ${noLayout}. ${aestheticStr}. ${char.wardrobe}.`;
}
