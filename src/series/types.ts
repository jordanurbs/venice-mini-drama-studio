import type { AestheticProfile } from '../storyboard/prompt-builder.js';

export interface SeriesState {
  name: string;
  slug: string;
  concept: string;
  genre: string;
  setting: string;
  aesthetic: AestheticProfile | null;
  /** Fixed seed used for all storyboard panels to ensure consistent aesthetic rendering. */
  aestheticSeed?: number;
  characters: MiniDramaCharacter[];
  episodes: EpisodeMeta[];
  videoDefaults: VideoModelDefaults;
  outputDir: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoModelDefaults {
  actionModel: string;
  atmosphereModel: string;
}

export interface MiniDramaCharacter {
  name: string;
  gender: 'male' | 'female' | 'other';
  age: string;
  description: string;
  fullDescription: string;
  wardrobe: string;
  voiceDescription: string;
  voiceId?: string;
  voiceName?: string;
  locked: boolean;
  seed: number;
}

export interface EpisodeMeta {
  number: number;
  title: string;
  status: 'draft' | 'scripted' | 'storyboarded' | 'produced' | 'assembled';
}

export interface EpisodeScript {
  episode: number;
  title: string;
  seriesName: string;
  totalDuration: string;
  shots: ShotScript[];
}

export interface ShotScript {
  shotNumber: number;
  type: 'establishing' | 'dialogue' | 'action' | 'reaction' | 'insert' | 'close-up';
  duration: string;
  videoModel: 'action' | 'atmosphere';
  description: string;
  /**
   * Optional single-frame description used only for panel (image) generation.
   * When present, buildImagePrompt uses this instead of `description`.
   * The full `description` (which may contain sequential action) is still
   * used for video prompts. This prevents the image model from rendering
   * comic-panel layouts when the description contains "A happens, then B
   * happens, then C" language.
   */
  panelDescription?: string;
  characters: string[];
  dialogue: { character: string; line: string; delivery?: string } | null;
  sfx: string | null;
  cameraMovement: string;
  transition: string;
  /**
   * Seconds to trim from the start of the generated video during assembly.
   * Use when the first N seconds have continuity issues (e.g., character twist,
   * duplicate frames from chaining). Applied automatically by the assembler.
   */
  trimStart?: number;
  /**
   * Seconds to trim from the end of the generated video during assembly.
   * Use when the last N seconds have unwanted content.
   */
  trimEnd?: number;
  /**
   * If true, the video should be horizontally flipped during assembly.
   * Use when the shot angle needs mirroring for visual continuity.
   */
  flip?: boolean;
  /**
   * When false, the generation planner must not group this shot into a
   * Kling multi-shot unit.
   */
  allowMultiShot?: boolean;
  /**
   * Strong override that forces this shot to remain a standalone render.
   */
  mustStaySingle?: boolean;
  /**
   * Hint for continuity decisions. "identity" favors the current panel over
   * chaining, "continuity" favors chaining when safe, and "balanced" uses
   * planner heuristics.
   */
  continuityPriority?: 'identity' | 'continuity' | 'balanced';
}

export type GenerationUnitType = 'single' | 'kling-multishot';
export type StartFrameStrategy = 'panel' | 'previous-last-frame';
export type EndFrameStrategy = 'natural' | 'next-panel-target';

export interface GenerationUnitSegment {
  shotNumber: number;
  startOffsetSec: number;
  durationSec: number;
  outputFile: string;
}

export interface GenerationUnit {
  unitId: string;
  unitType: GenerationUnitType;
  shotNumbers: number[];
  outputFile: string;
  model: string;
  duration: string;
  startFrameStrategy: StartFrameStrategy;
  endFrameStrategy: EndFrameStrategy;
  decisionReasons: string[];
  fallbackToSingles: boolean;
  renderedDurationSec?: number;
  segments?: GenerationUnitSegment[];
}

export interface GenerationPlan {
  episode: number;
  generatedAt: string;
  units: GenerationUnit[];
}

export const DEFAULT_ACTION_MODEL = 'kling-v3-pro-image-to-video';
export const DEFAULT_ATMOSPHERE_MODEL = 'veo3.1-fast-image-to-video';
export const KLING_MULTISHOT_MODEL = 'kling-o3-pro-image-to-video';

export const VIDEO_NO_MUSIC_SUFFIX = 'No background music. Only generate dialogue, ambient sound, and sound effects.';

export const FEMALE_BASE_TRAITS = 'beautiful, elegant, hourglass figure, classy cleavage, skin showing, detailed features';
export const MALE_BASE_TRAITS = 'extremely handsome, strong jawline, styled appearance, detailed features';
