import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ElevenLabsClient } from './client.js';

export interface MusicOptions {
  prompt: string;
  durationMs?: number;
  instrumental?: boolean;
}

export async function generateMusic(
  client: ElevenLabsClient,
  options: MusicOptions,
  outputPath: string,
): Promise<string> {
  const {
    prompt,
    durationMs = 60_000,
    instrumental = true,
  } = options;

  const audioBuffer = await client.streamBinary('/v1/music/stream', {
    prompt,
    length_ms: durationMs,
    force_instrumental: instrumental,
    model_id: 'music_v1',
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, audioBuffer);
  return outputPath;
}
