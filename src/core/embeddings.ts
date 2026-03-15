import { join } from 'path';
import { homedir } from 'os';

const MODELS_DIR = join(homedir(), '.cmc', 'models');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pipe: any = null;
let _onnxAvailable: boolean | null = null;

async function tryGetONNXPipeline() {
  if (_onnxAvailable === false) return null;
  if (_pipe) return _pipe;

  try {
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir          = MODELS_DIR;
    env.allowLocalModels  = false;
    env.allowRemoteModels = true;

    _pipe = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { progress_callback: () => {} },
    );
    _onnxAvailable = true;
    return _pipe;
  } catch {
    _onnxAvailable = false;
    return null;
  }
}

// ── Fallback: character 3-gram hash embedding (zero deps) ─────────────────
// Good enough for keyword/code similarity — cosine search still works well.
function hashEmbed(text: string, dims = 384): number[] {
  const vec = new Float32Array(dims).fill(0);
  const s   = text.toLowerCase().replace(/\s+/g, ' ');
  for (let i = 0; i < s.length - 2; i++) {
    let h = 5381;
    for (let j = i; j < i + 3; j++) h = (Math.imul(h, 33) ^ s.charCodeAt(j)) | 0;
    vec[(h >>> 0) % dims] += 1;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return norm > 0 ? Array.from(vec).map(v => v / norm) : Array.from(vec);
}

/**
 * Embed a text string.
 * Tries ONNX (all-MiniLM-L6-v2) first; silently falls back to n-gram hashing
 * if the native ONNX runtime (or sharp) is unavailable.
 */
export async function embedText(text: string): Promise<{ vector: number[]; method: 'onnx' | 'hash' }> {
  const pipe = await tryGetONNXPipeline();
  if (pipe) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const output: any = await pipe(text.slice(0, 512), { pooling: 'mean', normalize: true });
      return { vector: Array.from(output.data as Float32Array), method: 'onnx' };
    } catch {
      _onnxAvailable = false;
    }
  }
  return { vector: hashEmbed(text), method: 'hash' };
}

export async function embedBatch(texts: string[]): Promise<{ vector: number[]; method: 'onnx' | 'hash' }[]> {
  const results = [];
  for (const t of texts) results.push(await embedText(t));
  return results;
}
