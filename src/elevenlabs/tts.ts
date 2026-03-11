import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ElevenLabsClient } from './client.js';

export interface TTSOptions {
  voiceId: string;
  text: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
}

export async function generateSpeech(
  client: ElevenLabsClient,
  options: TTSOptions,
  outputPath: string,
): Promise<string> {
  const {
    voiceId,
    text,
    modelId = 'eleven_multilingual_v2',
    stability = 0.5,
    similarityBoost = 0.75,
    style = 0.5,
  } = options;

  const audioBuffer = await client.postJsonBinary(
    `/v1/text-to-speech/${voiceId}`,
    {
      text,
      model_id: modelId,
      voice_settings: {
        stability,
        similarity_boost: similarityBoost,
        style,
        use_speaker_boost: true,
      },
    },
  );

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, audioBuffer);
  return outputPath;
}

export interface DialogueLine {
  shotNumber: number;
  character: string;
  voiceId: string;
  text: string;
}

export async function generateDialogueForShots(
  client: ElevenLabsClient,
  lines: DialogueLine[],
  outputDir: string,
): Promise<{ shotNumber: number; character: string; text: string; path: string }[]> {
  await mkdir(outputDir, { recursive: true });
  const results: { shotNumber: number; character: string; text: string; path: string }[] = [];

  for (const line of lines) {
    const shotNum = String(line.shotNumber).padStart(3, '0');
    const filename = `dialogue-shot-${shotNum}.mp3`;
    const outputPath = `${outputDir}/${filename}`;

    await generateSpeech(
      client,
      { voiceId: line.voiceId, text: line.text },
      outputPath,
    );

    results.push({
      shotNumber: line.shotNumber,
      character: line.character,
      text: line.text,
      path: outputPath,
    });

    console.log(`  TTS [${line.character}] shot ${shotNum}: "${line.text.slice(0, 40)}..." -> ${filename}`);
  }

  return results;
}
