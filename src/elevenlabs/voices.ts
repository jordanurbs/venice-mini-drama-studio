import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElevenLabsClient } from './client.js';

export interface VoiceInfo {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  preview_url: string | null;
  description: string | null;
}

interface VoicesResponse {
  voices: VoiceInfo[];
}

export async function listVoices(
  client: ElevenLabsClient,
): Promise<VoiceInfo[]> {
  const response = await client.getJson<VoicesResponse>('/v1/voices');
  return response.voices;
}

export function filterVoices(
  voices: VoiceInfo[],
  gender?: string,
  age?: string,
): VoiceInfo[] {
  return voices.filter(v => {
    const labels = v.labels ?? {};
    if (gender && labels.gender && labels.gender.toLowerCase() !== gender.toLowerCase()) {
      return false;
    }
    if (age && labels.age && labels.age.toLowerCase() !== age.toLowerCase()) {
      return false;
    }
    return true;
  });
}

export async function generateVoiceSample(
  client: ElevenLabsClient,
  voiceId: string,
  sampleText: string,
  outputPath: string,
): Promise<string> {
  const audioBuffer = await client.postJsonBinary(
    `/v1/text-to-speech/${voiceId}`,
    {
      text: sampleText,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.5,
        use_speaker_boost: true,
      },
    },
  );

  await writeFile(outputPath, audioBuffer);
  return outputPath;
}

export async function auditionVoices(
  client: ElevenLabsClient,
  candidateVoices: VoiceInfo[],
  sampleText: string,
  outputDir: string,
): Promise<{ voiceId: string; voiceName: string; samplePath: string }[]> {
  await mkdir(outputDir, { recursive: true });

  const results: { voiceId: string; voiceName: string; samplePath: string }[] = [];

  for (const voice of candidateVoices) {
    const safeName = voice.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const samplePath = join(outputDir, `${safeName}-${voice.voice_id.slice(0, 8)}.mp3`);

    try {
      await generateVoiceSample(client, voice.voice_id, sampleText, samplePath);
      results.push({
        voiceId: voice.voice_id,
        voiceName: voice.name,
        samplePath,
      });
      console.log(`  Generated sample: ${voice.name} -> ${samplePath}`);
    } catch (err) {
      console.warn(`  Failed to generate sample for ${voice.name}: ${err}`);
    }
  }

  return results;
}
