import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

function normalizeArabic(value = '') {
  return value
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[“”"'.،؛؟!?()[\]{}:;,_/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractVideoId(input = '') {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;

  try {
    const url = new URL(value);

    if (url.hostname === 'youtu.be') {
      return url.pathname.split('/').filter(Boolean)[0] || null;
    }

    if (url.hostname.includes('youtube.com')) {
      if (url.pathname.startsWith('/shorts/')) {
        return url.pathname.split('/')[2] || null;
      }
      if (url.pathname.startsWith('/embed/')) {
        return url.pathname.split('/')[2] || null;
      }
      return url.searchParams.get('v');
    }
  } catch {
    return null;
  }

  return null;
}

function searchTranscript(transcript, query) {
  const normalizedQuery = normalizeArabic(query);
  const seen = new Set();
  const matches = [];

  for (let i = 0; i < transcript.length; i += 1) {
    for (let windowSize = 1; windowSize <= 4 && i + windowSize <= transcript.length; windowSize += 1) {
      const slice = transcript.slice(i, i + windowSize);
      const joinedText = slice.map((item) => item.text).join(' ');

      if (!normalizeArabic(joinedText).includes(normalizedQuery)) continue;

      const startMs = Number(slice[0].offset || 0);
      const key = Math.round(startMs);
      if (seen.has(key)) break;

      seen.add(key);
      matches.push({
        text: joinedText,
        startMs,
        seconds: Math.floor(startMs / 1000),
        durationMs: slice.reduce((sum, item) => sum + Number(item.duration || 0), 0),
      });
      break;
    }
  }

  return matches;
}

async function fetchTranscriptWithSupadata(videoId) {
  const apiKey = process.env.SUPADATA_API_KEY;

  if (!apiKey) {
    const error = new Error(
      'Ücretsiz Supadata API anahtarı ayarlı değil. Codespaces terminalinde SUPADATA_API_KEY değişkenini ekleyin.'
    );
    error.code = 'MISSING_SUPADATA_KEY';
    throw error;
  }

  const endpoint = new URL('https://api.supadata.ai/v1/transcript');
  endpoint.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`);
  endpoint.searchParams.set('lang', 'ar');

  const response = await fetch(endpoint, {
    headers: {
      'x-api-key': apiKey,
      'accept': 'application/json',
    },
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error ||
      `Supadata isteği başarısız oldu (HTTP ${response.status}).`;
    throw new Error(message);
  }

  if (!Array.isArray(payload?.content)) {
    if (payload?.jobId) {
      throw new Error('Bu video için transkript hazırlanıyor. Birkaç saniye sonra tekrar deneyin.');
    }

    throw new Error('Supadata zaman kodlu transkript döndürmedi.');
  }

  const transcript = payload.content
    .map((item) => ({
      text: String(item?.text || '').trim(),
      offset: Number(item?.offset || 0),
      duration: Number(item?.duration || 0),
    }))
    .filter((item) => item.text);

  if (!transcript.length) {
    throw new Error('Videoda Arapça transkript bulunamadı.');
  }

  return {
    transcript,
    language: payload.lang || 'ar',
    source: 'supadata',
  };
}

app.get('/api/search', async (req, res) => {
  const video = String(req.query.video || '').trim();
  const query = String(req.query.q || '').trim();

  if (!video || !query) {
    return res.status(400).json({
      error: 'Video bağlantısı ve Arapça arama ifadesi gerekli.',
    });
  }

  const videoId = extractVideoId(video);

  if (!videoId) {
    return res.status(400).json({
      error: 'Geçerli bir YouTube bağlantısı veya video kimliği girin.',
    });
  }

  try {
    const result = await fetchTranscriptWithSupadata(videoId);
    const matches = searchTranscript(result.transcript, query);

    return res.json({
      videoId,
      query,
      transcriptLanguage: result.language,
      transcriptSource: result.source,
      count: matches.length,
      results: matches,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const setupRequired = error?.code === 'MISSING_SUPADATA_KEY';

    return res.status(setupRequired ? 503 : 502).json({
      error: setupRequired
        ? 'Bir defalık ücretsiz API anahtarı kurulumu gerekiyor.'
        : 'Arapça altyazı alınamadı.',
      detail,
      code: error?.code || null,
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    transcriptProvider: 'supadata',
    apiKeyConfigured: Boolean(process.env.SUPADATA_API_KEY),
  });
});

app.listen(PORT, () => {
  console.log(`Arabic Video Search running on http://localhost:${PORT}`);
  console.log(`Supadata API key: ${process.env.SUPADATA_API_KEY ? 'configured' : 'missing'}`);
});
