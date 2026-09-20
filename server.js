import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;
const PARSE_FILMOT_API =
  'https://api.parse.bot/scraper/17532800-a068-4b63-a3c0-61fa737691d9';

app.use(express.static('public'));

function stripArabicMarks(value = '') {
  return String(value)
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/\u0640/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeQuery(input, exact) {
  const cleaned = stripArabicMarks(input);
  if (!cleaned) return '';
  if (!exact) return cleaned;
  return cleaned.startsWith('"') && cleaned.endsWith('"')
    ? cleaned
    : `"${cleaned.replace(/"/g, '')}"`;
}

function unwrapPayload(payload) {
  if (payload?.data && typeof payload.data === 'object') return payload.data;
  return payload || {};
}

function normalizeSearchResult(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const videoId = String(raw.video_id || raw.videoId || raw.id || '').trim();
  if (!videoId) return null;

  return {
    videoId,
    title: String(raw.title || 'Başlıksız video'),
    channel: String(raw.channel_name || raw.channel || raw.channelTitle || 'Bilinmeyen kanal'),
    channelId: String(raw.channel_id || ''),
    views: Number(raw.view_count || raw.views || 0) || 0,
    uploadDate: String(raw.upload_date || raw.uploadDate || ''),
    duration: Number(raw.duration || 0) || 0,
    snippet: String(raw.subtitle_snippet || raw.snippet || raw.text || '').trim(),
  };
}

async function searchFilmot(query, page) {
  const apiKey = process.env.PARSE_API_KEY;

  if (!apiKey) {
    const error = new Error(
      'Parse API anahtarı ayarlı değil. PARSE_API_KEY ortam değişkenini ekleyin.'
    );
    error.code = 'MISSING_PARSE_KEY';
    throw error;
  }

  const endpoint = new URL(`${PARSE_FILMOT_API}/search_subtitles`);
  endpoint.searchParams.set('query', query);
  endpoint.searchParams.set('page', String(page));

  const response = await fetch(endpoint, {
    headers: {
      'X-API-Key': apiKey,
      accept: 'application/json',
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
      `Filmot araması başarısız oldu (HTTP ${response.status}).`;
    throw new Error(String(message));
  }

  const data = unwrapPayload(payload);
  const rawVideos = Array.isArray(data.videos)
    ? data.videos
    : Array.isArray(data.results)
      ? data.results
      : Array.isArray(payload?.videos)
        ? payload.videos
        : [];

  return {
    videos: rawVideos.map(normalizeSearchResult).filter(Boolean),
    totalClips: data.total_clips || data.totalClips || payload?.total_clips || '',
  };
}

function normalizeArabic(value = '') {
  return stripArabicMarks(value)
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[“”"'.،؛؟!?()[\]{}:;,_/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function transcriptFromPayload(payload) {
  const candidate =
    (Array.isArray(payload?.content) && payload) ||
    (Array.isArray(payload?.data?.content) && payload.data) ||
    (Array.isArray(payload?.result?.content) && payload.result) ||
    null;

  if (!candidate) return null;

  return candidate.content
    .map((item) => ({
      text: String(item?.text || '').trim(),
      offset: Number(item?.offset || 0),
      duration: Number(item?.duration || 0),
    }))
    .filter((item) => item.text);
}

async function pollSupadataJob(jobId, apiKey) {
  const url = `https://api.supadata.ai/v1/transcript/${encodeURIComponent(jobId)}`;

  for (let i = 0; i < 45; i += 1) {
    await sleep(1000);
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    }

    const transcript = transcriptFromPayload(payload);
    if (transcript?.length) return transcript;

    if (String(payload?.status || '').toLowerCase() === 'failed') {
      throw new Error('Transkript hazırlanamadı.');
    }
  }

  throw new Error('Transkript hazırlanması uzun sürdü.');
}

async function getSupadataTranscript(videoId) {
  const apiKey = process.env.SUPADATA_API_KEY;

  if (!apiKey) {
    const error = new Error('SUPADATA_API_KEY ayarlı değil.');
    error.code = 'MISSING_SUPADATA_KEY';
    throw error;
  }

  const endpoint = new URL('https://api.supadata.ai/v1/transcript');
  endpoint.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`);
  endpoint.searchParams.set('lang', 'ar');

  const response = await fetch(endpoint, {
    headers: { 'x-api-key': apiKey, accept: 'application/json' },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
  }

  const immediate = transcriptFromPayload(payload);
  if (immediate?.length) return immediate;

  if (payload?.jobId) {
    return await pollSupadataJob(payload.jobId, apiKey);
  }

  throw new Error('Arapça transkript bulunamadı.');
}

function findMatches(transcript, query) {
  const q = normalizeArabic(query);
  const results = [];

  for (let i = 0; i < transcript.length; i += 1) {
    for (let size = 1; size <= 4 && i + size <= transcript.length; size += 1) {
      const slice = transcript.slice(i, i + size);
      const text = slice.map((x) => x.text).join(' ');
      if (!normalizeArabic(text).includes(q)) continue;

      results.push({
        text,
        seconds: Math.floor(Number(slice[0].offset || 0) / 1000),
      });
      break;
    }
  }

  const deduped = [];
  for (const match of results) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(match.seconds - prev.seconds) < 12) continue;
    deduped.push(match);
    if (deduped.length >= 5) break;
  }

  return deduped;
}

app.get('/api/search', async (req, res) => {
  const input = String(req.query.q || '').trim();
  const exact = String(req.query.exact ?? '1') !== '0';
  const page = Math.max(1, Math.min(50, Number(req.query.page || 1) || 1));

  if (!input) {
    return res.status(400).json({ error: 'Aranacak Arapça kelime veya kalıbı yazın.' });
  }

  try {
    const query = makeQuery(input, exact);
    const result = await searchFilmot(query, page);

    return res.json({
      query: input,
      page,
      count: result.videos.length,
      totalClips: result.totalClips,
      videos: result.videos,
    });
  } catch (error) {
    const missing = error?.code === 'MISSING_PARSE_KEY';
    return res.status(missing ? 503 : 502).json({
      error: missing
        ? 'Bir defalık Parse API anahtarı kurulumu gerekiyor.'
        : 'YouTube altyazı araması yapılamadı.',
      detail: error instanceof Error ? error.message : String(error),
      code: error?.code || null,
    });
  }
});

app.get('/api/resolve', async (req, res) => {
  const videoId = String(req.query.videoId || '').trim();
  const query = String(req.query.q || '').trim();

  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !query) {
    return res.status(400).json({ error: 'Geçerli video kimliği ve arama ifadesi gerekli.' });
  }

  try {
    const transcript = await getSupadataTranscript(videoId);
    const matches = findMatches(transcript, query);

    return res.json({
      videoId,
      count: matches.length,
      matches,
    });
  } catch (error) {
    return res.status(502).json({
      error: 'Zaman kodu bulunamadı.',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    searchProvider: 'parse-filmot',
    parseKeyConfigured: Boolean(process.env.PARSE_API_KEY),
    supadataKeyConfigured: Boolean(process.env.SUPADATA_API_KEY),
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Arabic Video Search running on port ${PORT}`);
  console.log(`Parse key: ${process.env.PARSE_API_KEY ? 'configured' : 'missing'}`);
  console.log(`Supadata key: ${process.env.SUPADATA_API_KEY ? 'configured' : 'missing'}`);
});
