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

function textOverlapRatio(a, b) {
  const aWords = new Set(normalizeArabic(a).split(' ').filter(Boolean));
  const bWords = new Set(normalizeArabic(b).split(' ').filter(Boolean));

  if (!aWords.size || !bWords.size) return 0;

  let shared = 0;
  for (const word of aWords) {
    if (bWords.has(word)) shared += 1;
  }

  return shared / Math.min(aWords.size, bWords.size);
}

function searchTranscript(transcript, query) {
  const normalizedQuery = normalizeArabic(query);
  const rawMatches = [];

  for (let i = 0; i < transcript.length; i += 1) {
    for (let windowSize = 1; windowSize <= 4 && i + windowSize <= transcript.length; windowSize += 1) {
      const slice = transcript.slice(i, i + windowSize);
      const joinedText = slice.map((item) => item.text).join(' ');

      if (!normalizeArabic(joinedText).includes(normalizedQuery)) continue;

      const startMs = Number(slice[0].offset || 0);

      rawMatches.push({
        text: joinedText,
        startMs,
        seconds: Math.floor(startMs / 1000),
        durationMs: slice.reduce((sum, item) => sum + Number(item.duration || 0), 0),
      });
      break;
    }
  }

  const matches = [];

  for (const match of rawMatches) {
    const previous = matches[matches.length - 1];

    if (previous) {
      const closeInTime = match.startMs - previous.startMs <= 15000;
      const previousText = normalizeArabic(previous.text);
      const currentText = normalizeArabic(match.text);
      const nearDuplicate =
        previousText.includes(currentText) ||
        currentText.includes(previousText) ||
        textOverlapRatio(previous.text, match.text) >= 0.6;

      if (closeInTime && nearDuplicate) {
        continue;
      }
    }

    matches.push(match);
  }

  return matches;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function transcriptFromPayload(payload) {
  const candidate =
    (Array.isArray(payload?.content) && payload) ||
    (Array.isArray(payload?.data?.content) && payload.data) ||
    (Array.isArray(payload?.result?.content) && payload.result) ||
    null;

  if (!candidate) return null;

  return {
    transcript: candidate.content
      .map((item) => ({
        text: String(item?.text || '').trim(),
        offset: Number(item?.offset || 0),
        duration: Number(item?.duration || 0),
      }))
      .filter((item) => item.text),
    language: candidate.lang || payload?.lang || 'ar',
  };
}

async function pollSupadataJob(jobId, apiKey) {
  const jobUrl = `https://api.supadata.ai/v1/transcript/${encodeURIComponent(jobId)}`;

  for (let attempt = 0; attempt < 45; attempt += 1) {
    await sleep(1000);

    const response = await fetch(jobUrl, {
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
        `Transkript sonucu alınamadı (HTTP ${response.status}).`;
      throw new Error(message);
    }

    const ready = transcriptFromPayload(payload);
    if (ready?.transcript?.length) {
      return ready;
    }

    const status = String(payload?.status || '').toLowerCase();

    if (status === 'failed') {
      throw new Error(
        payload?.error?.message ||
        payload?.error ||
        'Transkript hazırlanırken Supadata işlemi başarısız oldu.'
      );
    }

    if (!status || !['queued', 'active', 'processing', 'pending'].includes(status)) {
      if (attempt >= 4) {
        throw new Error('Supadata transkript sonucunu beklenen biçimde döndürmedi.');
      }
    }
  }

  throw new Error('Transkript hazırlanması 45 saniyeden uzun sürdü. Biraz sonra tekrar deneyin.');
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

  let ready = transcriptFromPayload(payload);

  if (!ready && payload?.jobId) {
    ready = await pollSupadataJob(payload.jobId, apiKey);
  }

  if (!ready?.transcript?.length) {
    throw new Error('Supadata zaman kodlu Arapça transkript döndürmedi.');
  }

  return {
    transcript: ready.transcript,
    language: ready.language || 'ar',
    source: payload?.jobId ? 'supadata-async' : 'supadata',
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Arabic Video Search running on port ${PORT}`);
  console.log(`Supadata API key: ${process.env.SUPADATA_API_KEY ? 'configured' : 'missing'}`);
});
