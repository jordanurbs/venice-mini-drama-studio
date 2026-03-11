const BASE_URL = 'https://api.elevenlabs.io';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1_000;

export class ElevenLabsRequestError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ElevenLabsRequestError';
    this.status = status;
    this.body = body;
  }
}

export class ElevenLabsClient {
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!key) {
      throw new Error('ElevenLabs API key is required. Pass it explicitly or set ELEVENLABS_API_KEY.');
    }
    this.apiKey = key;
  }

  async postJson<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async postJsonBinary(path: string, body: Record<string, unknown>): Promise<Buffer> {
    const url = `${BASE_URL}${path}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1));
      }

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.apiKey,
          },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          return Buffer.from(arrayBuffer);
        }

        let errorBody: unknown;
        try { errorBody = await response.json(); } catch { errorBody = await response.text(); }

        if (response.status === 429 || response.status >= 500) {
          lastError = new ElevenLabsRequestError(
            `ElevenLabs API returned HTTP ${response.status}`,
            response.status,
            errorBody,
          );
          continue;
        }

        throw new ElevenLabsRequestError(
          `ElevenLabs API returned HTTP ${response.status}`,
          response.status,
          errorBody,
        );
      } catch (err) {
        if (err instanceof ElevenLabsRequestError && err.status > 0 && err.status < 500 && err.status !== 429) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError ?? new Error('ElevenLabs API request failed after all retries.');
  }

  async getJson<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  async streamBinary(path: string, body: Record<string, unknown>): Promise<Buffer> {
    return this.postJsonBinary(path, body);
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${BASE_URL}${path}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1));
      }

      try {
        const headers: Record<string, string> = {
          'xi-api-key': this.apiKey,
          ...(init.headers as Record<string, string> ?? {}),
        };

        const response = await fetch(url, { ...init, headers });

        if (response.ok) {
          return (await response.json()) as T;
        }

        let errorBody: unknown;
        try { errorBody = await response.json(); } catch { errorBody = await response.text(); }

        if (response.status === 429 || response.status >= 500) {
          lastError = new ElevenLabsRequestError(
            `ElevenLabs API returned HTTP ${response.status}`,
            response.status,
            errorBody,
          );
          continue;
        }

        throw new ElevenLabsRequestError(
          `ElevenLabs API returned HTTP ${response.status}`,
          response.status,
          errorBody,
        );
      } catch (err) {
        if (err instanceof ElevenLabsRequestError && err.status > 0 && err.status < 500 && err.status !== 429) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError ?? new Error('ElevenLabs API request failed after all retries.');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
