const form = document.querySelector('#searchForm');
const queryInput = document.querySelector('#queryInput');
const exactInput = document.querySelector('#exactInput');
const button = document.querySelector('#searchButton');
const statusBox = document.querySelector('#status');
const resultsBox = document.querySelector('#results');

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return [hours, minutes, secs].map((n) => String(n).padStart(2, '0')).join(':');
  }
  return [minutes, secs].map((n) => String(n).padStart(2, '0')).join(':');
}

function formatNumber(value) {
  return new Intl.NumberFormat('tr-TR', { notation: 'compact' }).format(Number(value) || 0);
}

function setStatus(message, kind = '') {
  statusBox.textContent = message;
  statusBox.className = `status ${kind}`.trim();
}

async function resolveTimes(video, query, holder, resolveButton) {
  resolveButton.disabled = true;
  resolveButton.textContent = 'Zaman kodu aranıyor…';

  try {
    const params = new URLSearchParams({ videoId: video.videoId, q: query });
    const response = await fetch(`/api/resolve?${params.toString()}`);
    const data = await response.json();

    if (!response.ok) throw new Error(data.detail || data.error);

    holder.innerHTML = '';

    if (!data.matches?.length) {
      holder.textContent = 'Bu videoda kesin zaman kodu bulunamadı.';
      return;
    }

    data.matches.forEach((match) => {
      const link = document.createElement('a');
      link.className = 'hit';
      link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}&t=${match.seconds}s`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = formatTime(match.seconds);

      const text = document.createElement('span');
      text.className = 'arabic';
      text.dir = 'rtl';
      text.lang = 'ar';
      text.textContent = match.text;

      link.append(time, text);
      holder.appendChild(link);
    });
  } catch (error) {
    holder.textContent = error.message || 'Zaman kodu bulunamadı.';
  } finally {
    resolveButton.remove();
  }
}

function renderResults(data, query) {
  resultsBox.innerHTML = '';

  if (!data.videos?.length) {
    setStatus('Bu kalıp için sonuç bulunamadı.', 'empty');
    return;
  }

  const total = data.totalClips ? ` · ${data.totalClips}` : '';
  setStatus(`${data.count} video gösteriliyor${total}.`, 'success');

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
    const parts = [video.channel];
    if (video.views) parts.push(`${formatNumber(video.views)} görüntülenme`);
    if (video.uploadDate) parts.push(video.uploadDate);
    meta.textContent = parts.join(' · ');

    const snippet = document.createElement('p');
    snippet.className = 'arabic snippet';
    snippet.dir = 'rtl';
    snippet.lang = 'ar';
    snippet.textContent = video.snippet || 'Eşleşen altyazı bulundu.';

    const resolveButton = document.createElement('button');
    resolveButton.type = 'button';
    resolveButton.className = 'secondary-button';
    resolveButton.textContent = 'Zaman kodunu bul';

    const resolved = document.createElement('div');
    resolved.className = 'hits';

    resolveButton.addEventListener('click', () =>
      resolveTimes(video, query, resolved, resolveButton)
    );

    article.append(title, meta, snippet, resolveButton, resolved);
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
    });

    const response = await fetch(`/api/search?${params.toString()}`);
    const data = await response.json();

    if (!response.ok) throw new Error(data.detail || data.error);
    renderResults(data, q);
  } catch (error) {
    setStatus(error.message || 'Arama sırasında hata oluştu.', 'error');
  } finally {
    button.disabled = false;
  }
});
