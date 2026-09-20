const form = document.querySelector('#searchForm');
const videoInput = document.querySelector('#videoInput');
const queryInput = document.querySelector('#queryInput');
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

function setStatus(message, kind = '') {
  statusBox.textContent = message;
  statusBox.className = `status ${kind}`.trim();
}

function renderResults(data) {
  resultsBox.innerHTML = '';

  if (!data.results?.length) {
    setStatus('Bu videonun altyazısında eşleşme bulunamadı.', 'empty');
    return;
  }

  setStatus(`${data.count} eşleşme bulundu.`, 'success');

  const list = document.createElement('div');
  list.className = 'result-list';

  data.results.forEach((item) => {
    const article = document.createElement('article');
    article.className = 'result-card';

    const timeLink = document.createElement('a');
    timeLink.className = 'time';
    timeLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(data.videoId)}&t=${item.seconds}s`;
    timeLink.target = '_blank';
    timeLink.rel = 'noopener noreferrer';
    timeLink.textContent = formatTime(item.seconds);

    const text = document.createElement('p');
    text.className = 'arabic';
    text.dir = 'rtl';
    text.lang = 'ar';
    text.textContent = item.text;

    article.append(timeLink, text);
    list.appendChild(article);
  });

  resultsBox.appendChild(list);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const video = videoInput.value.trim();
  const q = queryInput.value.trim();

  if (!video || !q) return;

  button.disabled = true;
  resultsBox.innerHTML = '';
  setStatus('Altyazı alınıyor ve ifade aranıyor…', 'loading');

  try {
    const params = new URLSearchParams({ video, q });
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
