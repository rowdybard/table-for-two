import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request } from 'node:https';
import { dirname, extname, resolve, sep } from 'node:path';

// Import this helper from an authenticated automation session. Keep the upload
// JWT in memory; it must never be a command-line argument, log or local file.
export async function uploadAssetBuckets({ artifactFile, accountId, jwt, buckets, progress = () => {} }) {
  if (!/^[a-f0-9]{32}$/.test(accountId) || typeof jwt !== 'string' || !jwt || /[\r\n]/.test(jwt)) throw new Error('Invalid upload session.');
  if (!Array.isArray(buckets) || buckets.some(bucket => !Array.isArray(bucket))) throw new Error('Invalid upload buckets.');
  const artifact = JSON.parse(await readFile(artifactFile, 'utf8'));
  const assetsRoot = resolve(dirname(artifactFile), 'output/v0/workers/default/assets') + sep;
  const files = new Map(artifact.files.map(file => [file.hash, file]));
  const seen = new Set();
  for (const bucket of buckets) for (const hash of bucket) {
    const file = files.get(hash);
    if (!/^[a-f0-9]{32}$/.test(hash) || !file || seen.has(hash) || !resolve(file.file).startsWith(assetsRoot)) throw new Error('Upload bucket does not match the reviewed artifact.');
    seen.add(hash);
  }
  let uploadedBytes = 0;
  for (let index = 0; index < buckets.length; index++) {
    const boundary = `cf-assets-${randomBytes(18).toString('hex')}`;
    const parts = [];
    for (const hash of buckets[index]) {
      const file = files.get(hash), bytes = await readFile(file.file);
      const actualHash = createHash('sha256').update(bytes.toString('base64') + extname(file.file).slice(1)).digest('hex').slice(0, 32);
      if (bytes.length !== file.size || actualHash !== hash) throw new Error('An asset changed after the deployment package was built.');
      if (/[\r\n]/.test(file.contentType)) throw new Error('Invalid asset media type.');
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${hash}"; filename="${hash}"\r\nContent-Type: ${file.contentType}\r\n\r\n`));
      parts.push(Buffer.from(bytes.toString('base64')));
      parts.push(Buffer.from('\r\n'));
      uploadedBytes += bytes.length;
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);
    let completed = false;
    for (let attempt = 0; attempt < 3 && !completed; attempt++) {
      const response = await postBucket(accountId, jwt, boundary, body);
      if (response.status >= 200 && response.status < 300 && response.success) completed = true;
      else if ((response.status === 429 || response.status >= 500) && attempt < 2) await new Promise(resolveDelay => setTimeout(resolveDelay, 1000 * 2 ** attempt));
      else throw new Error(`Cloudflare asset upload failed (HTTP ${response.status}; codes ${response.codes.join(',') || 'none'}).`);
    }
    progress({ uploadedBuckets: index + 1, totalBuckets: buckets.length, uploadedFiles: buckets.slice(0, index + 1).reduce((sum, bucket) => sum + bucket.length, 0) });
  }
  // A fresh session for this manifest supplies a redeemable JWT after all hashes
  // are present. Do that and the Worker upload inside the remote API tool so no
  // completion token needs to pass through tool output.
  return { uploadedBuckets: buckets.length, uploadedFiles: seen.size, uploadedBytes };
}

function postBucket(accountId, jwt, boundary, body) {
  return new Promise((resolveResponse, reject) => {
    const req = request({ hostname: 'api.cloudflare.com', path: `/client/v4/accounts/${accountId}/workers/assets/upload?base64=true`, method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length } }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 1_000_000) { req.destroy(new Error('Oversized asset-upload response.')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => {
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reject(new Error(`Cloudflare asset upload returned invalid JSON (HTTP ${res.statusCode}).`)); return; }
        resolveResponse({ status: res.statusCode || 0, success: data.success === true, codes: (Array.isArray(data.errors) ? data.errors : []).map(error => String(error.code)).filter(code => /^[\w.-]+$/.test(code)) });
      });
      res.on('error', () => reject(new Error('The asset-upload response was interrupted.')));
    });
    req.setTimeout(120_000, () => req.destroy(new Error('The asset upload timed out.')));
    req.on('error', () => reject(new Error('The asset-upload connection failed.')));
    req.end(body);
  });
}
