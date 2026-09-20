import express from 'express';
import { createRequire } from 'node:module';
import { fetchTranscript } from 'youtube-transcript';

const require = createRequire(import.meta.url);
const youtubedl = require('youtube-dl-exec');

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

function parseJson3Captions(payload) {
  if (!payload || !Array.isArray(payload.events)) return [];

  return payload.events
    .map((event) => {
      const text = (event.segs || [])
        .map((segment) => segment.utf8 || '')
        .join('')
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return {
        text,
        offset: Number(event.tStartMs || 0),
        duration: Number(event.dDurationMs || 0),
      };
    })
    .filter((item) => item.text);
}

function parseVttTime(value) {
  const parts = value.trim().split(':').map(Number);

  if (parts.length === 3) {
    return ((parts[0] * 3600) + (parts[1] * 60) + parts[2]) * 1000;
  }

  if (parts.length === 2) {
    return ((parts[0] * 60) + parts[1]) * 1000;
  }

  return 0;
}

function parseVttCaptions(vtt) {
  const blocks = String(vtt)
    .replace(/\r/g, '')
    .split(/\n\n+/);

  const entries = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => line.includes('-->'));

    if (timeIndex === -1) continue;

    const [startRaw, endRaw] = lines[timeIndex].split('-->');
    const start = parseVttTime(startRaw);
    const end = parseVttTime(endRaw.split(' ')[0]);
    const text = lines
      .slice(timeIndex + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

    if (text) {
      entries.push({
        text,
        offset: start,
        duration: Math.max(0, end - start),
      });
    }
  }

  return entries;
}

function findArabicTrack(info) {
  const sources = [
    { kind: 'manual', tracks: info?.subtitles || {} },
    { kind: 'automatic', tracks: info?.automatic_captions || {} },
  ];

  for (const source of sources) {
    const languages = Object.keys(source.tracks);
    const arabicLanguage =
      languages.find((lang) => lang.toLowerCase() === 'ar') ||
      languages.find((lang) => /^ar[-_]/i.test(lang));

    if (!arabicLanguage) continue;

    const formats = source.tracks[arabicLanguage] || [];
    const preferred =
      formats.find((format) => format.ext === 'json3') ||
      formats.find((format) => format.ext === 'vtt') ||
      formats[0];

    if (preferred?.url) {
      return {
        ...preferred,
        language: arabicLanguage,
        source: source.kind,
      };
    }
  }

  return null;
}

async function fetchTranscriptWithYtDlp(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const info = await youtubedl(url, {
    dumpSingleJson: true,
    skipDownload: true,
    noWarnings: true,
    noCheckCertificates: true,
  }, {
    timeout: 45000,
  });

  const track = findArabicTrack(info);

  if (!track) {
    const manual = Object.keys(info?.subtitles || {});
    const automatic = Object.keys(info?.automatic_captions || {});
    const available = [...new Set([...manual, ...automatic])];

    const error = new Error(
      available.length
        ? `Arapça altyazı bulunamadı. Mevcut diller: ${available.slice(0, 12).join(', ')}`
        : 'Bu videoda kullanılabilir altyazı bulunamadı.'
    );
    error.code = 'NO_ARABIC_CAPTIONS';
    throw error;
  }

  const response = await fetch(track.url, {
    headers: {
      'user-agent': 'Mozilla/5.0',
      'accept-language': 'ar,en;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Altyazı dosyası alınamadı (HTTP ${response.status}).`);
  }

  let transcript;

  if (track.ext === 'json3') {
    transcript = parseJson3Captions(await response.json());
  } else {
    transcript = parseVttCaptions(await response.text());
  }

  if (!transcript.length) {
    throw new Error('Altyazı bulundu ancak metin çözümlenemedi.');
  }

  return {
    transcript,
    language: track.language,
    source: `yt-dlp-${track.source}`,
  };
}

async function getArabicTranscript(videoId) {
  let firstError = null;

  try {
    const transcript = await fetchTranscript(videoId, { lang: 'ar' });

    if (transcript?.length) {
      return {
        transcript,
        language: 'ar',
        source: 'youtube-transcript',
      };
    }
  } catch (error) {
    firstError = error;
  }

  try {
    return await fetchTranscriptWithYtDlp(videoId);
  } catch (fallbackError) {
    const error = new Error(
      fallbackError instanceof Error
        ? fallbackError.message
        : 'Altyazı alınamadı.'
    );

    error.firstError = firstError instanceof Error ? firstError.message : null;
    throw error;
  }
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
    const result = await getArabicTranscript(videoId);
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

    return res.status(502).json({
      error: 'Arapça altyazı alınamadı.',
      detail,
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Arabic Video Search running on http://localhost:${PORT}`);
});
