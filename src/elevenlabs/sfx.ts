import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ElevenLabsClient } from './client.js';

export interface SFXOptions {
  text: string;
  durationSeconds?: number;
  promptInfluence?: number;
}

export async function generateSoundEffect(
  client: ElevenLabsClient,
  options: SFXOptions,
  outputPath: string,
): Promise<string> {
  const {
    text,
    durationSeconds = 5,
    promptInfluence = 0.5,
  } = options;

  const audioBuffer = await client.postJsonBinary('/v1/sound-generation', {
    text,
    duration_seconds: durationSeconds,
    prompt_influence: promptInfluence,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, audioBuffer);
  return outputPath;
}
