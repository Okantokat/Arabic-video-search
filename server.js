import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;
const RAPIDAPI_HOST =
  process.env.RAPIDAPI_HOST || 'filmot-tube-metadata-archive.p.rapidapi.com';

app.use(express.static('public'));

function stripArabicMarks(value = '') {
  return String(value)
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/\u0640/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeFilmotQuery(input, exact) {
  const cleaned = stripArabicMarks(input);
  if (!cleaned) return '';

  if (!exact) return cleaned;

  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    return cleaned;
  }

  return `"${cleaned.replace(/"/g, '')}"`;
}

function secondsValue(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function normalizeHit(hit, query) {
  if (!hit || typeof hit !== 'object') return null;

  const start = secondsValue(
    hit.start ?? hit.seconds ?? hit.offset ?? hit.starttime ?? 0
  );

  const token = String(hit.token || '').trim();
  const lines = Array.isArray(hit.lines) ? hit.lines : [];

  let text = '';

  if (lines.length) {
    const normalizedQuery = stripArabicMarks(query);
    const preferred =
      lines.find((line) =>
        stripArabicMarks(line?.text || '').includes(normalizedQuery)
      ) || lines[0];

    text = String(preferred?.text || '').trim();

    if (preferred && preferred.start != null) {
      return {
        seconds: secondsValue(preferred.start),
        text,
      };
    }
  }

  if (!text) {
    text = [
      String(hit.ctx_before || '').trim(),
      token,
      String(hit.ctx_after || '').trim(),
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (!text) return null;

  return { seconds: start, text };
}

function normalizeVideo(video, query, subtitleType) {
  if (!video || typeof video !== 'object') return null;

  const videoId = String(video.id || video.videoid || '').trim();
  if (!videoId) return null;

  const rawHits = Array.isArray(video.hits) ? video.hits : [];
  const seen = new Set();
  const hits = [];

  for (const rawHit of rawHits) {
    const hit = normalizeHit(rawHit, query);
    if (!hit) continue;

    const key = `${Math.floor(hit.seconds)}|${stripArabicMarks(hit.text).slice(0, 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(hit);

    if (hits.length >= 5) break;
  }

  return {
    videoId,
    title: String(video.title || 'Başlıksız video'),
    channel: String(
      video.channelname || video.channeltitle || video.channel || 'Bilinmeyen kanal'
    ),
    views: Number(video.viewcount || 0) || 0,
    duration: Number(video.duration || 0) || 0,
    uploadDate: String(video.uploaddate || ''),
    language: String(video.lang || 'ar'),
    subtitleType,
    hits,
  };
}

async function callFilmot(query, page, manual) {
  const apiKey = process.env.RAPIDAPI_KEY;

  if (!apiKey) {
    const error = new Error(
      'Filmot RapidAPI anahtarı ayarlı değil. RAPIDAPI_KEY ortam değişkenini ekleyin.'
    );
    error.code = 'MISSING_RAPIDAPI_KEY';
    throw error;
  }

  const endpoint = new URL(
    `https://${RAPIDAPI_HOST}/getsearchsubtitles`
  );

  endpoint.searchParams.set('query', query);
  endpoint.searchParams.set('lang', 'ar');
  endpoint.searchParams.set('page', String(page));
  endpoint.searchParams.set('hitFormat', '1');
  endpoint.searchParams.set('maxQueryTime', '10000');

  if (manual) {
    endpoint.searchParams.set('searchManualSubs', '1');
  }

  const response = await fetch(endpoint, {
    headers: {
      'x-rapidapi-key': apiKey,
      'x-rapidapi-host': RAPIDAPI_HOST,
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
    const detail =
      payload?.message ||
      payload?.error ||
      `Filmot API isteği başarısız oldu (HTTP ${response.status}).`;
    const error = new Error(String(detail));
    error.status = response.status;
    throw error;
  }

  if (payload?.error) {
    throw new Error(String(payload.error));
  }

  const videos = Array.isArray(payload?.result)
    ? payload.result
    : Array.isArray(payload?.videos)
      ? payload.videos
      : Array.isArray(payload?.items)
        ? payload.items
        : [];

  return {
    videos,
    total: Number(payload?.totalresultcount || videos.length) || videos.length,
  };
}

function mergeVideoResults(groups, query) {
  const map = new Map();

  for (const group of groups) {
    if (!group?.videos) continue;

    for (const rawVideo of group.videos) {
      const item = normalizeVideo(rawVideo, query, group.subtitleType);
      if (!item) continue;

      const existing = map.get(item.videoId);

      if (!existing) {
        map.set(item.videoId, item);
        continue;
      }

      const hitKeys = new Set(
        existing.hits.map(
          (hit) =>
            `${Math.floor(hit.seconds)}|${stripArabicMarks(hit.text).slice(0, 100)}`
        )
      );

      for (const hit of item.hits) {
        const key = `${Math.floor(hit.seconds)}|${stripArabicMarks(hit.text).slice(0, 100)}`;
        if (!hitKeys.has(key) && existing.hits.length < 5) {
          existing.hits.push(hit);
          hitKeys.add(key);
        }
      }

      if (existing.subtitleType !== item.subtitleType) {
        existing.subtitleType = 'automatic+manual';
      }
    }
  }

  return [...map.values()]
    .filter((video) => video.hits.length > 0)
    .slice(0, 20);
}

app.get('/api/search', async (req, res) => {
  const input = String(req.query.q || '').trim();
  const exact = String(req.query.exact ?? '1') !== '0';
  const source = String(req.query.source || 'all');
  const page = Math.max(1, Math.min(50, Number(req.query.page || 1) || 1));

  if (!input) {
    return res.status(400).json({ error: 'Aranacak Arapça kelime veya kalıbı yazın.' });
  }

  const query = makeFilmotQuery(input, exact);

  try {
    const groups = [];
    const warnings = [];

    if (source === 'all' || source === 'auto') {
      try {
        const auto = await callFilmot(query, page, false);
        groups.push({ ...auto, subtitleType: 'automatic' });
      } catch (error) {
        warnings.push(`Otomatik altyazı araması: ${error.message}`);
      }
    }

    if (source === 'all' || source === 'manual') {
      try {
        const manual = await callFilmot(query, page, true);
        groups.push({ ...manual, subtitleType: 'manual' });
      } catch (error) {
        warnings.push(`Manuel altyazı araması: ${error.message}`);
      }
    }

    if (!groups.length) {
      const message = warnings.join(' ') || 'Filmot araması başarısız oldu.';
      const missingKey = message.includes('RAPIDAPI_KEY');
      return res.status(missingKey ? 503 : 502).json({
        error: missingKey
          ? 'Bir defalık Filmot API anahtarı kurulumu gerekiyor.'
          : 'YouTube altyazı araması yapılamadı.',
        detail: message,
        code: missingKey ? 'MISSING_RAPIDAPI_KEY' : 'FILMOT_SEARCH_FAILED',
      });
    }

    const videos = mergeVideoResults(groups, input);
    const totalIndexedMatches = groups.reduce((sum, group) => sum + group.total, 0);

    return res.json({
      query: input,
      filmotQuery: query,
      page,
      source,
      exact,
      count: videos.length,
      totalIndexedMatches,
      videos,
      warnings,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Arama sırasında beklenmeyen bir hata oluştu.',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    searchProvider: 'filmot-rapidapi',
    apiKeyConfigured: Boolean(process.env.RAPIDAPI_KEY),
    host: RAPIDAPI_HOST,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Arabic Video Search running on port ${PORT}`);
  console.log(
    `Filmot RapidAPI key: ${process.env.RAPIDAPI_KEY ? 'configured' : 'missing'}`
  );
});
