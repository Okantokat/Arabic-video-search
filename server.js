import express from 'express';
import { fetchTranscript } from 'youtube-transcript';

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

app.get('/api/search', async (req, res) => {
  const video = String(req.query.video || '').trim();
  const query = String(req.query.q || '').trim();

  if (!video || !query) {
    return res.status(400).json({ error: 'Video bağlantısı ve Arapça arama ifadesi gerekli.' });
  }

  const videoId = extractVideoId(video);
  if (!videoId) {
    return res.status(400).json({ error: 'Geçerli bir YouTube bağlantısı veya video kimliği girin.' });
  }

  try {
    let transcript;
    try {
      transcript = await fetchTranscript(videoId, { lang: 'ar' });
    } catch (arabicError) {
      transcript = await fetchTranscript(videoId);
    }

    const results = searchTranscript(transcript, query);

    return res.json({
      videoId,
      query,
      transcriptLanguage: transcript?.[0]?.lang || null,
      count: results.length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(502).json({
      error: 'Bu videonun altyazısı alınamadı. Video altyazısız olabilir veya YouTube geçici olarak erişimi engelliyor olabilir.',
      detail: message,
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Arabic Video Search running on http://localhost:${PORT}`);
});
