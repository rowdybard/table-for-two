import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AUTHORED_UTTERANCES } from '../src/restaurant/authored';
import { DATES } from '../src/restaurant/content';
import { elevenLabsAdapter, speechText, type SpeechRequest } from '../server/restaurant/providers';

if (existsSync('.env')) process.loadEnvFile('.env');

const directory = resolve('server/restaurant/clips'), model = process.env.DATE_SPEECH_MODEL || 'eleven_v4_turbo';
const price = Number(process.env.DATE_SPEECH_COST_PER_1K || '.04') / 1000;
const limit = Number(process.env.DATE_CLIP_LIMIT_USD || '2');
if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(limit) || limit <= 0) throw new Error('Use positive DATE_SPEECH_COST_PER_1K and DATE_CLIP_LIMIT_USD values.');
const jobs = AUTHORED_UTTERANCES.flatMap(line => {
  const voices = line.speaker === 'date' ? DATES.filter(date => !line.dateId || date.id === line.dateId).map(date => ({ label: date.id, voice: process.env[`DATE_VOICE_${date.id.toUpperCase()}`] || date.voiceId })) : [{ label: line.speaker, voice: process.env[`DATE_VOICE_${line.speaker.toUpperCase()}`] || (line.speaker === 'waiter' ? 'pNInz6obpgDQGcFmaJgB' : 'VR6AewLTigWG4xSOukaG') }];
  return voices.map(voice => { const request: SpeechRequest = { voiceId: voice.voice, model, text: line.text, emotion: line.emotion }; const hash = createHash('sha256').update(JSON.stringify([voice.voice, model, line.emotion, speechText(request), 'mp3_44100_128'])).digest('hex').slice(0, 18); return { id: `${line.clipId}-${voice.label}`, text: line.text, emotion: line.emotion, voiceId: voice.voice, model, file: `${hash}.mp3`, request }; });
});
const estimate = jobs.reduce((sum, job) => sum + speechText(job.request).length * price, 0);
console.log(`${jobs.length} reusable character clips; estimated character cost $${estimate.toFixed(3)}. Output: ${directory}`);
if (!process.argv.includes('--generate')) console.log('Dry run only. Add --generate to synthesize with ELEVENLABS_API_KEY. Existing complete clips are reused.');
else {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('Set ELEVENLABS_API_KEY in the server environment first.');
  if (estimate > limit) throw new Error(`Estimated clip cost exceeds DATE_CLIP_LIMIT_USD ($${limit}).`);
  await mkdir(directory, { recursive: true }); const adapter = elevenLabsAdapter(); const manifest: { clips: Omit<typeof jobs[number], 'request'>[] } = { clips: [] };
  for (const job of jobs) {
    let complete = false;
    try { complete = (await readFile(resolve(directory, job.file))).length > 0; } catch {}
    if (!complete) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30_000), chunks: Buffer[] = []; let length = 0;
      try { for await (const chunk of adapter.stream(job.request, controller.signal)) { length += chunk.length; if (length > 5 * 1024 * 1024) throw new Error('Clip exceeded audio size limit.'); chunks.push(Buffer.from(chunk)); } if (!length) throw new Error('Voice service returned no audio.'); await writeFile(resolve(directory, job.file), Buffer.concat(chunks)); }
      finally { clearTimeout(timer); controller.abort(); }
    }
    const { request: _request, ...entry } = job; manifest.clips.push(entry); await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'); console.log(`${complete ? 'Reused' : 'Generated'} ${job.id}`);
  }
  console.log(`Saved ${manifest.clips.length} clips. Restart the date server to load the manifest.`);
}
