let showSynopses = true;
let activeTab = 'outline';
let lastData = null;

function applyActiveTab() {
  document.querySelectorAll('.f-tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === activeTab);
  });
  document.querySelectorAll('.f-tab-content').forEach((c) => {
    c.classList.toggle('active', c.id === `f-tab-${activeTab}`);
  });
}

function renderData(data) {
  lastData = data;
  const inactiveBanner = document.getElementById('f-inactive-banner');
  const activeContent = document.getElementById('f-active-content');

  // Если DOM панели еще не смонтирован, отложим отрисовку на 50 мс
  if (!inactiveBanner || !activeContent) {
    setTimeout(() => renderData(data), 50);
    return;
  }

  if (!data || !data.enabled) {
    inactiveBanner.classList.remove('f-hidden');
    activeContent.classList.add('f-hidden');
    return;
  }

  inactiveBanner.classList.add('f-hidden');
  activeContent.classList.remove('f-hidden');
  applyActiveTab();

  const statPages = document.getElementById('f-stat-pages');
  const statTime = document.getElementById('f-stat-time');
  if (statPages) statPages.textContent = `~${data.estimatedPages}`;
  if (statTime) statTime.textContent = `~${data.estimatedMinutes} мин`;

  // 1. Структура (секции, сцены, синопсисы)
  const outlineList = document.getElementById('f-outline-list');
  if (outlineList) {
    outlineList.innerHTML = '';
    const items = (data.outline || []).filter(
      (node) => !(node.type === 'synopsis' && !showSynopses)
    );
    if (items.length === 0) {
      outlineList.innerHTML = '<li class="f-empty-msg">Сцены и секции (#) пока не добавлены</li>';
    } else {
      for (const node of items) {
        const li = document.createElement('li');
        li.className = `f-nav-item f-nav-${node.type}`;
        li.dataset.line = String(node.lineNumber);
        if (node.type === 'scene') {
          li.textContent = `${node.sceneNumber}. ${node.title}`;
        } else if (node.type === 'synopsis') {
          li.textContent = `= ${node.title}`;
        } else {
          li.textContent = node.title;
        }
        outlineList.appendChild(li);
      }
    }
  }

  // 2. Персонажи
  const charList = document.getElementById('f-characters-list');
  if (charList) {
    charList.innerHTML = '';
    const chars = data.characters || [];
    if (chars.length === 0) {
      charList.innerHTML = '<li class="f-empty-msg">Персонажи пока не найдены</li>';
    } else {
      for (const [name, count] of chars) {
        const li = document.createElement('li');
        li.className = 'f-entity-item';
        li.innerHTML = `<span>${name}</span><span>${count} репл.</span>`;
        charList.appendChild(li);
      }
    }
  }

  // 3. Локации
  const locList = document.getElementById('f-locations-list');
  if (locList) {
    locList.innerHTML = '';
    const locs = data.locations || [];
    if (locs.length === 0) {
      locList.innerHTML = '<li class="f-empty-msg">Локации пока не найдены</li>';
    } else {
      for (const loc of locs) {
        const li = document.createElement('li');
        li.className = 'f-entity-item';
        li.textContent = loc;
        locList.appendChild(li);
      }
    }
  }
}

// Единый обработчик кликов через делегирование (работает всегда, даже после перерисовки DOM)
document.addEventListener('click', (e) => {
  const target = e.target;
  if (!target) return;

  if (target.id === 'f-btn-activate') {
    webviewApi.postMessage({ type: 'toggleMode' });
    return;
  }

  const tabBtn = target.closest('.f-tab-btn');
  if (tabBtn && tabBtn.dataset.tab) {
    activeTab = tabBtn.dataset.tab;
    applyActiveTab();
    return;
  }

  const navItem = target.closest('.f-nav-item');
  if (navItem && navItem.dataset.line) {
    webviewApi.postMessage({
      type: 'scrollToLine',
      lineNumber: Number(navItem.dataset.line),
    });
  }
});

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'f-toggle-synopses') {
    showSynopses = e.target.checked;
    if (lastData) renderData(lastData);
  }
});

webviewApi.onMessage((event) => {
  if (event.message && event.message.type === 'update') {
    renderData(event.message.payload);
  }
});

// Запрашиваем актуальное состояние сразу при загрузке панели
webviewApi.postMessage({ type: 'ready' });
