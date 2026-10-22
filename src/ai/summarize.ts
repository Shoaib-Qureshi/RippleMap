// Opt-in AI summary of a file or function. The ONLY network call in FlowLens, made when the user clicks
// "Explain with AI". Speaks the OpenAI-compatible chat API (OpenRouter by default; Gemini, Ollama, OpenAI work too).

export interface AiConfig {
  baseUrl: string;
  model: string;
  key: string;
}

export interface SummaryRequest {
  file: string;
  /** Symbol label when summarising one function/class; undefined for a whole file. */
  symbol?: string;
  code: string;
}

const MAX_CODE = 24_000;

/**
 * Accepts a key pasted however it was copied: a whole `.env` line (`OPENROUTER_API_KEY=...`), quoted,
 * with `Bearer ` or stray whitespace. OpenRouter answers any of those with "Missing Authentication header".
 */
export function cleanKey(raw: string): string {
  return raw
    .trim()
    .replace(/^(export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*/, '')
    .replace(/^bearer\s+/i, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\s+/g, '');
}

export async function summarize(
  cfg: AiConfig,
  req: SummaryRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const what = req.symbol ? `the ${req.symbol} code below (from ${req.file})` : `the file ${req.file}`;
  const code = req.code.length > MAX_CODE ? `${req.code.slice(0, MAX_CODE)}\n… (truncated)` : req.code;
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cleanKey(cfg.key)}`,
        'content-type': 'application/json',
        // OpenRouter app attribution; ignored by other providers.
        'x-title': 'FlowLens',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 800, // headroom for reasoning models; the answer itself is ~40 words
        messages: [
          {
            role: 'system',
            content:
              'You explain source code to developers. Reply with 1-2 plain sentences (max 40 words): what it does and its role in the app. No markdown, no preamble.',
          },
          { role: 'user', content: `Explain ${what}.\n\n${code}` },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new Error(
      `Could not reach ${cfg.baseUrl} (${(e as Error).name === 'TimeoutError' ? 'timed out' : String(e)})`,
      {
        cause: e,
      },
    );
  }
  const body = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string | null } }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    const detail = body.error?.message ?? res.statusText;
    if (res.status === 401) throw new Error(`API key rejected (${detail}). Run "FlowLens: Set AI API Key".`);
    if (res.status === 429)
      throw new Error(`Rate limited (free models have limits); try again shortly. ${detail}`);
    throw new Error(`AI request failed (${res.status}): ${detail}`);
  }
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text)
    throw new Error(`${cfg.model} returned no text; try another model in the flowlens.ai.model setting.`);
  return text.replace(/\s+/g, ' ');
}
