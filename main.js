(function () {
  const galleryEl = document.querySelector('[data-gallery]');
  const folderNavEl = document.querySelector('[data-folder-nav]');
  const lightboxEl = document.querySelector('[data-lightbox]');
  const lightboxImg = lightboxEl?.querySelector('.lightbox__image');
  const lightboxStage = lightboxEl?.querySelector('.lightbox__stage');
  const lightboxCloseBtn = lightboxEl?.querySelector('[data-lightbox-close]');
  const themeLinkEl = document.getElementById('themeStylesheet');
  const themeSwitchForm = document.querySelector('[data-theme-switcher]');
  const themeOptions = themeSwitchForm ? Array.from(themeSwitchForm.querySelectorAll('.theme-option')) : [];
  const themeRadios = themeSwitchForm ? Array.from(themeSwitchForm.querySelectorAll("input[name='theme']")) : [];
  const globalManifest = Array.isArray(window.__PHOTO_MANIFEST__) ? window.__PHOTO_MANIFEST__ : null;
  let allItems = [];
  let currentDirectory = '';
  let currentItems = [];
  let currentIndex = -1;
  let currentImageToken = 0;
  const prefetchCache = new Set();
  const THEME_STORAGE_KEY = 'photo-zone-theme';
  const THEME_MAP = {
    blue: 'styles/theme-blue.css',
    neon: 'styles/theme-neon.css',
    sepia: 'styles/theme-sepia.css',
    sunny: 'styles/theme-sunny.css',
  };

  function initializeContactReveal() {
    const container = document.querySelector('[data-contact-container]');
    if (!container) return;

    const trigger = container.querySelector('[data-contact-trigger]');
    const target = container.querySelector('[data-contact-target]');
    const link = container.querySelector('[data-contact-link]');

    if (!trigger || !target || !link) return;

    const user = link.getAttribute('data-user');
    const domain = link.getAttribute('data-domain');
    if (!user || !domain) return;

    const email = `${user}@${domain}`;

    function revealEmail() {
      if (!target.hidden) return;
      target.hidden = false;
      link.textContent = email;
      link.setAttribute('href', `mailto:${email}`);
      link.setAttribute('aria-label', `Email ${email}`);
      trigger.setAttribute('aria-expanded', 'true');
      trigger.hidden = true;
    }

    trigger.addEventListener('click', revealEmail);
  }

  initializeContactReveal();

  if (!galleryEl) {
    return;
  }

  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'];

  function setLightboxVisibility(visible) {
    if (!lightboxEl) return;

    if (visible) {
      lightboxEl.removeAttribute('hidden');
      document.body.style.overflow = 'hidden';
    } else {
      lightboxEl.setAttribute('hidden', '');
      document.body.style.overflow = '';
    }
  }

  function showImageAt(index) {
    if (!lightboxImg || !currentItems.length) return;

    const total = currentItems.length;
    const normalizedIndex = ((index % total) + total) % total;
    currentIndex = normalizedIndex;

    const item = currentItems[normalizedIndex];
    if (!item) return;

    const { full, thumb, title } = item;
    currentImageToken += 1;
    const requestToken = currentImageToken;

    lightboxImg.dataset.index = String(normalizedIndex);
    lightboxImg.alt = title;

    const hasDistinctThumb = Boolean(thumb && thumb !== full);
    if (hasDistinctThumb) {
      lightboxImg.src = thumb;
    } else {
      lightboxImg.src = full;
    }

    const fullImage = new Image();
    fullImage.decoding = 'async';
    const swapToFull = () => {
      if (!lightboxImg || currentImageToken !== requestToken) return;
      lightboxImg.src = full;
    };
    const handleError = () => {
      if (currentImageToken !== requestToken) return;
    };
    fullImage.addEventListener('load', swapToFull);
    fullImage.addEventListener('error', handleError);
    fullImage.src = full;
    if (fullImage.complete && fullImage.naturalWidth) {
      swapToFull();
    }

    prefetchImage(normalizedIndex + 1);
    prefetchImage(normalizedIndex - 1);
  }

  function openLightbox(index) {
    if (!lightboxImg || !currentItems.length) return;
    setLightboxVisibility(true);
    showImageAt(index);
  }

  function closeLightbox() {
    if (lightboxImg) {
      lightboxImg.src = '';
      lightboxImg.alt = '';
    }
    currentIndex = -1;
    setLightboxVisibility(false);
  }

  function changeImage(step) {
    if (!currentItems.length) return;
    showImageAt(currentIndex + step);
  }

  function setActiveThemeOption(theme) {
    themeOptions.forEach((option) => {
      const input = option.querySelector("input[name='theme']");
      const isMatch = input?.value === theme;
      option.classList.toggle('is-active', Boolean(isMatch));
      if (input) {
        input.checked = Boolean(isMatch);
      }
    });
  }

  function applyTheme(theme, { persist = true } = {}) {
    const normalized = THEME_MAP[theme] ? theme : 'blue';
    const href = THEME_MAP[normalized];

    if (themeLinkEl && themeLinkEl.getAttribute('href') !== href) {
      themeLinkEl.setAttribute('href', href);
    }

    document.body.dataset.theme = normalized;
    setActiveThemeOption(normalized);

    if (persist) {
      try {
        window.localStorage?.setItem(THEME_STORAGE_KEY, normalized);
      } catch (err) {
        // Storage might be unavailable; ignore.
      }
    }
  }

  function initializeTheme() {
    const defaultTheme = themeLinkEl?.dataset.defaultTheme || 'blue';
    let desiredTheme = defaultTheme;

    try {
      const stored = window.localStorage?.getItem(THEME_STORAGE_KEY);
      if (stored && THEME_MAP[stored]) {
        desiredTheme = stored;
      }
    } catch (err) {
      desiredTheme = defaultTheme;
    }

    applyTheme(desiredTheme, { persist: false });
  }

  function createGallery(items) {
    galleryEl.innerHTML = '';
    currentItems = Array.isArray(items) ? items.slice() : [];
    prefetchCache.clear();
    currentIndex = -1;
    if (!Array.isArray(items) || items.length === 0) {
      const emptyMessage = document.createElement('p');
      emptyMessage.textContent = 'No photos found for this selection.';
      emptyMessage.className = 'instructions';
      galleryEl.appendChild(emptyMessage);
      return;
    }

    currentItems.forEach((item, index) => {
      const figure = document.createElement('figure');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gallery__trigger';

      const img = document.createElement('img');
      img.src = item.thumb;
      img.alt = item.title;
      img.loading = 'lazy';
      img.decoding = 'async';

      button.appendChild(img);
      figure.appendChild(button);
      galleryEl.appendChild(figure);

      button.addEventListener('click', () => {
        openLightbox(index);
      });
    });
  }

  async function fetchJsonList(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load ${url}`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error(`${url} did not return an array`);
    }
    return data;
  }

  async function fetchFromDirectoryListing() {
    const response = await fetch('photos/', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Directory listing unavailable');
    }
    const html = await response.text();
    const regex = /href="([^"?#]+\.(?:jpg|jpeg|png|gif|webp|bmp|tiff))"/gi;
    const files = new Set();
    let match;
    while ((match = regex.exec(html)) !== null) {
      const file = decodeURIComponent(match[1]);
      const lower = file.toLowerCase();
      const valid = imageExtensions.some((ext) => lower.endsWith(`.${ext}`));
      if (valid) {
        files.add(`photos/${file}`);
      }
    }
    return Array.from(files);
  }

  function deriveDirectoryFromFull(fullPath, explicitValue) {
    if (typeof explicitValue === 'string') {
      return explicitValue.trim();
    }
    if (!fullPath || typeof fullPath !== 'string') {
      return '';
    }
    const prefix = 'photos/';
    const normalized = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length <= 1) {
      return '';
    }
    return segments.slice(0, -1).join('/');
  }

  function normalizeItems(items) {
    if (!Array.isArray(items)) return [];

    return items
      .map((raw, index) => {
        if (!raw) return null;
        if (typeof raw === 'string') {
          const fullPath = normalizePath(raw, 'photos/');
          return {
            filename: extractFilename(fullPath) || `image-${index + 1}`,
            full: fullPath,
            thumb: fullPath,
            title: buildTitleFromFilename(fullPath, index),
            directory: deriveDirectoryFromFull(fullPath),
          };
        }
        if (typeof raw === 'object') {
          const fullPath = normalizePath(raw.full ?? raw.path ?? raw.src ?? raw.url ?? '', 'photos/');
          const thumbPath = normalizePath(raw.thumb ?? raw.thumbnail ?? raw.thumbUrl ?? '', 'thumbnails/');
          const fallbackFull = fullPath || normalizePath(raw.filename ?? raw.name ?? '', 'photos/');
          const finalFull = fullPath || fallbackFull;
          const finalThumb = thumbPath || finalFull;
          const filename = raw.filename ?? raw.name ?? extractFilename(finalFull) ?? `image-${index + 1}`;
          const title = raw.title ?? buildTitleFromFilename(filename, index);
          if (!finalFull) {
            return null;
          }
          return {
            filename,
            full: finalFull,
            thumb: finalThumb,
            title,
            directory: deriveDirectoryFromFull(finalFull, raw.directory),
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  function normalizePath(value, basePrefix) {
    if (!value || typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^(?:https?:)?\//i.test(trimmed) || trimmed.startsWith('./') || trimmed.startsWith('../')) {
      return trimmed;
    }
    if (trimmed.startsWith('photos/') || trimmed.startsWith('thumbnails/')) {
      return trimmed;
    }
    return `${basePrefix || ''}${trimmed.replace(/^\.\/?/, '')}`;
  }

  function extractFilename(path) {
    if (!path) return '';
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || '';
  }

  function buildTitleFromFilename(filename, index) {
    const stem = filename.replace(/\.[^.]+$/, '');
    const cleaned = stem.replace(/[-_]+/g, ' ').trim();
    if (cleaned) {
      return cleaned.replace(/\b\w/g, (match) => match.toUpperCase());
    }
    return `Gallery Image ${index + 1}`;
  }

  function prefetchImage(index) {
    if (!currentItems.length) return;
    const total = currentItems.length;
    const normalizedIndex = ((index % total) + total) % total;
    const item = currentItems[normalizedIndex];
    if (!item) return;
    const url = item.full;
    if (prefetchCache.has(url)) {
      return;
    }
    const img = new Image();
    img.src = url;
    prefetchCache.add(url);
  }

  function formatDirectorySegment(segment) {
    if (!segment) {
      return '';
    }
    const cleaned = segment.replace(/[-_]+/g, ' ').trim();
    if (!cleaned) {
      return segment;
    }
    if (/^[A-Z0-9\s]+$/.test(cleaned)) {
      return cleaned;
    }
    return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function formatDirectoryLabel(directory) {
    if (!directory) {
      return 'portfolio';
    }
    return directory
      .split('/')
      .map(formatDirectorySegment)
      .filter(Boolean)
      .join(' / ') || 'portfolio';
  }

  function updateActiveDirectory(directory) {
    if (!folderNavEl) {
      return;
    }
    const buttons = folderNavEl.querySelectorAll('[data-directory]');
    buttons.forEach((button) => {
      const isActive = button.dataset.directory === directory;
      button.classList.toggle('is-active', isActive);
      if (isActive) {
        button.setAttribute('aria-pressed', 'true');
      } else {
        button.removeAttribute('aria-pressed');
      }
    });
  }

  function initializeDirectoryNavigation(items) {
    if (!folderNavEl) {
      return '';
    }

    if (!Array.isArray(items) || items.length === 0) {
      folderNavEl.hidden = true;
      folderNavEl.innerHTML = '';
      return '';
    }

    const directoryMap = new Map();

    items.forEach((item) => {
      const rawDirectory = typeof item.directory === 'string' ? item.directory : '';
      const key = rawDirectory.trim();
      const existing = directoryMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        directoryMap.set(key, {
          key,
          label: formatDirectoryLabel(key),
          count: 1,
        });
      }
    });

    const sorted = Array.from(directoryMap.values()).sort((a, b) => {
      if (a.key === '' && b.key !== '') return -1;
      if (a.key !== '' && b.key === '') return 1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    });

    if (sorted.length <= 1 && sorted[0]?.key === '') {
      folderNavEl.hidden = true;
      folderNavEl.innerHTML = '';
      return sorted[0]?.key ?? '';
    }

    folderNavEl.hidden = false;
    folderNavEl.innerHTML = '';

    const fragment = document.createDocumentFragment();
    sorted.forEach((meta) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'folder-nav__button';
      button.dataset.directory = meta.key;
      button.textContent = meta.label;
      button.addEventListener('click', () => {
        setDirectory(meta.key);
      });
      fragment.appendChild(button);
    });

    folderNavEl.appendChild(fragment);

    const rootEntry = directoryMap.get('');
    return rootEntry ? rootEntry.key : sorted[0]?.key ?? '';
  }

  function setDirectory(directory) {
    const normalized = typeof directory === 'string' ? directory : '';
    currentDirectory = normalized;
    updateActiveDirectory(normalized);

    const filtered = normalized
      ? allItems.filter((item) => (item.directory || '') === normalized)
      : allItems.filter((item) => (item.directory || '') === '');

    createGallery(filtered);
  }

  function initializeGallery(items) {
    allItems = normalizeItems(items);
    const defaultDirectory = initializeDirectoryNavigation(allItems);
    setDirectory(defaultDirectory);
  }

  async function loadGallery() {
    const manifestCandidates = ['photos/photos.json', 'photos/manifest.json'];

    if (globalManifest?.length) {
      initializeGallery(globalManifest);
      return;
    }

    for (const manifest of manifestCandidates) {
      try {
        const list = await fetchJsonList(manifest);
        if (list.length) {
          initializeGallery(list);
          return;
        }
      } catch (err) {
        // Continue to next candidate or fallback
      }
    }

    try {
      const list = await fetchFromDirectoryListing();
      initializeGallery(list);
    } catch (err) {
      initializeGallery([]);
    }
  }

  lightboxStage?.addEventListener('click', (event) => {
    if (!currentItems.length || !lightboxStage) return;

    if (event.target === lightboxImg) {
      return;
    }

    const rect = lightboxStage.getBoundingClientRect();
    if (rect.width === 0) return;

    const midpoint = rect.left + rect.width / 2;
    const direction = event.clientX < midpoint ? -1 : 1;
    changeImage(direction);
  });
  lightboxCloseBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    closeLightbox();
  });
  lightboxImg?.addEventListener('click', (event) => {
    if (!lightboxImg || !currentItems.length) return;

    const rect = lightboxImg.getBoundingClientRect();
    if (rect.width === 0) return;

    const midpoint = rect.left + rect.width / 2;
    const direction = event.clientX < midpoint ? -1 : 1;
    changeImage(direction);
  });
  lightboxEl?.addEventListener('click', (event) => {
    if (event.target === lightboxEl) {
      closeLightbox();
    }
  });
  themeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        applyTheme(radio.value);
      }
    });
  });
  document.addEventListener('keydown', (event) => {
    const isLightboxOpen = lightboxEl && !lightboxEl.hasAttribute('hidden');
    if (!isLightboxOpen) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeLightbox();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      changeImage(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      changeImage(-1);
    }
  });

  initializeTheme();
  loadGallery();
})();
