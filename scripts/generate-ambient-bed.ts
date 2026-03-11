import 'dotenv/config';
import { ElevenLabsClient } from '../src/elevenlabs/client.js';
import { generateSoundEffect } from '../src/elevenlabs/sfx.js';

const prompt = process.argv[2];
const outputPath = process.argv[3];
const duration = parseInt(process.argv[4] || '22', 10);

if (!prompt || !outputPath) {
  console.error('Usage: npx tsx scripts/generate-ambient-bed.ts "<prompt>" "output/<series>/episodes/episode-NNN/audio/file.mp3" [duration]');
  process.exit(1);
}

const client = new ElevenLabsClient();

console.log(`Generating ${duration}s ambient bed...`);
console.log(`Prompt: ${prompt}`);

await generateSoundEffect(client, {
  text: prompt,
  durationSeconds: duration,
  promptInfluence: 0.7,
}, outputPath);

console.log(`Saved to: ${outputPath}`);
