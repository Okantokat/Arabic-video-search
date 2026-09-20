const form = document.querySelector('#searchForm');
const queryInput = document.querySelector('#queryInput');
const exactInput = document.querySelector('#exactInput');
const sourceInput = document.querySelector('#sourceInput');
const button = document.querySelector('#searchButton');
const statusBox = document.querySelector('#status');
const resultsBox = document.querySelector('#results');

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return [hours, minutes, secs]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
  }

  return [minutes, secs]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

function formatNumber(value) {
  return new Intl.NumberFormat('tr-TR', { notation: 'compact' }).format(
    Number(value) || 0
  );
}

function setStatus(message, kind = '') {
  statusBox.textContent = message;
  statusBox.className = `status ${kind}`.trim();
}

function renderResults(data) {
  resultsBox.innerHTML = '';

  if (!data.videos?.length) {
    setStatus('Bu kalıp için indekslenmiş Arapça altyazı sonucu bulunamadı.', 'empty');
    return;
  }

  const totalText = data.totalIndexedMatches
    ? ` · Filmot indeksinde yaklaşık ${formatNumber(data.totalIndexedMatches)} eşleşen video kaydı`
    : '';

  setStatus(
    `${data.count} video gösteriliyor${totalText}.`,
    'success'
  );

  if (data.warnings?.length) {
    const warning = document.createElement('div');
    warning.className = 'warning';
    warning.textContent = data.warnings.join(' ');
    resultsBox.appendChild(warning);
  }

  const list = document.createElement('div');
  list.className = 'result-list';

  data.videos.forEach((video) => {
    const article = document.createElement('article');
    article.className = 'result-card';

    const title = document.createElement('a');
    title.className = 'video-title';
    title.href = `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
    title.textContent = video.title;

    const meta = document.createElement('div');
    meta.className = 'meta';

    const metaParts = [video.channel];
    if (video.views) metaParts.push(`${formatNumber(video.views)} görüntülenme`);
    if (video.subtitleType === 'manual') metaParts.push('manuel altyazı');
    if (video.subtitleType === 'automatic') metaParts.push('otomatik altyazı');
    if (video.subtitleType === 'automatic+manual') metaParts.push('otomatik + manuel');

    meta.textContent = metaParts.join(' · ');

    const hits = document.createElement('div');
    hits.className = 'hits';

    video.hits.forEach((hit) => {
      const hitLink = document.createElement('a');
      hitLink.className = 'hit';
      hitLink.href =
        `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}&t=${Math.floor(hit.seconds)}s`;
      hitLink.target = '_blank';
      hitLink.rel = 'noopener noreferrer';

      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = formatTime(hit.seconds);

      const text = document.createElement('span');
      text.className = 'arabic';
      text.dir = 'rtl';
      text.lang = 'ar';
      text.textContent = hit.text;

      hitLink.append(time, text);
      hits.appendChild(hitLink);
    });

    article.append(title, meta, hits);
    list.appendChild(article);
  });

  resultsBox.appendChild(list);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const q = queryInput.value.trim();
  if (!q) return;

  button.disabled = true;
  resultsBox.innerHTML = '';
  setStatus('YouTube altyazı indeksinde aranıyor…', 'loading');

  try {
    const params = new URLSearchParams({
      q,
      exact: exactInput.checked ? '1' : '0',
      source: sourceInput.value,
    });

    const response = await fetch(`/api/search?${params.toString()}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || data.error || 'Arama sırasında hata oluştu.');
    }

    renderResults(data);
  } catch (error) {
    setStatus(error.message || 'Arama sırasında hata oluştu.', 'error');
  } finally {
    button.disabled = false;
  }
});
