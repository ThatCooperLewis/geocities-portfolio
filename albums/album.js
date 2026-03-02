(function () {
  const root = document.querySelector('[data-album-root]');
  if (!root) {
    return;
  }

  const titleEl = root.querySelector('[data-album-title]');
  const descriptionEl = root.querySelector('[data-album-description]');
  const countEl = root.querySelector('[data-album-count]');
  const statusEl = root.querySelector('[data-album-status]');
  const galleryEl = root.querySelector('[data-album-gallery]');
  const archiveLink = root.querySelector('[data-album-archive]');
  const heroEl = root.querySelector('[data-album-hero]');
  const shareButton = root.querySelector('[data-album-share]');
  const shareStatus = root.querySelector('[data-share-status]');
  const yearEl = document.querySelector('[data-album-year]');

  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  function detectSlug() {
    const explicit = document.documentElement.getAttribute('data-album-slug');
    if (explicit) return explicit.trim();

    const path = window.location.pathname.replace(/\/+/g, '/');
    const withoutTrailing = path.endsWith('/') ? path.slice(0, -1) : path;
    const parts = withoutTrailing.split('/').filter(Boolean);
    const albumsIndex = parts.lastIndexOf('albums');
    if (albumsIndex === -1) return null;
    return parts[albumsIndex + 1] || null;
  }

  const slug = detectSlug();
  if (!slug) {
    if (statusEl) {
      statusEl.innerHTML = '<p>Album not found. Check the link name.</p>';
    }
    if (shareButton) {
      shareButton.disabled = true;
    }
    return;
  }

  const SHARE_FILE_LIMIT = 40;
  const rootPrefix = document.documentElement.getAttribute('data-root-prefix') || '../..';

  function resolveSharedPath(pathSegment) {
    const safeSegment = String(pathSegment || '');
    if (/^https?:\/\//i.test(safeSegment)) {
      return safeSegment;
    }
    if (safeSegment.startsWith('/')) {
      return new URL(safeSegment, window.location.origin).toString();
    }
    const prefix = rootPrefix.endsWith('/') ? rootPrefix : `${rootPrefix}/`;
    const normalized = safeSegment.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
    return new URL(`${prefix}${normalized}`, window.location.href).toString();
  }

  function formatCount(files) {
    const total = Array.isArray(files) ? files.length : 0;
    if (!total) return '';
    return total === 1 ? '1 photo' : `${total} photos`;
  }

  function updateArchiveLink(manifest) {
    if (!archiveLink) return;
    if (!manifest.downloadArchive) {
      archiveLink.hidden = true;
      return;
    }
    archiveLink.hidden = false;
    archiveLink.href = resolveSharedPath(manifest.downloadArchive);
    const filename = manifest.downloadArchive.split('/').pop();
    if (filename) {
      archiveLink.setAttribute('download', filename);
      archiveLink.textContent = `Download ${filename}`;
    }
  }

  function renderGallery(manifest) {
    if (!galleryEl) return;
    galleryEl.innerHTML = '';

    if (!Array.isArray(manifest.files) || !manifest.files.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No photos uploaded yet. Check back soon!';
      galleryEl.appendChild(empty);
      return;
    }

    manifest.files.forEach((file, index) => {
      const card = document.createElement('a');
      card.className = 'album-card';
      card.target = '_blank';
      card.rel = 'noopener';
      const source = resolveSharedPath(file.src || file.path || `shared-albums/${slug}/${file.filename}`);
      card.href = source;
      card.setAttribute('data-filename', file.filename);

      const image = document.createElement('img');
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = source;
      image.alt = `${manifest.title || 'Shared album'} photo ${index + 1}`;
      card.appendChild(image);

      galleryEl.appendChild(card);
    });
  }

  function setShareAvailability(supported) {
    if (!shareButton) return;
    if (supported) {
      shareButton.disabled = false;
      shareButton.setAttribute('aria-busy', 'false');
    } else {
      shareButton.disabled = true;
      shareButton.setAttribute('aria-busy', 'false');
    }
  }

  function isShareApiAvailable() {
    if (typeof navigator === 'undefined') return false;
    const { share, canShare } = navigator;
    return typeof share === 'function' && typeof canShare === 'function';
  }

  function canShareFiles(files) {
    if (!Array.isArray(files) || !files.length) return false;
    if (!isShareApiAvailable()) {
      return false;
    }
    try {
      return navigator.canShare({ files });
    } catch (error) {
      return false;
    }
  }

  async function fetchManifest() {
    const manifestUrl = new URL(`../../shared-albums/${encodeURIComponent(slug)}/manifest.json`, window.location.href);
    const response = await fetch(manifestUrl.toString(), { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Unable to load album (${response.status})`);
    }
    return response.json();
  }

  function updateShareStatus(message, state) {
    if (!shareStatus) return;
    shareStatus.textContent = message;
    shareStatus.dataset.state = state || 'info';
  }

  async function shareAlbum(manifest) {
    if (!shareButton) return;
    if (!isShareApiAvailable()) {
      updateShareStatus('Sharing files is not supported on this browser. Use the download link instead.', 'error');
      return;
    }

    shareButton.disabled = true;
    shareButton.setAttribute('aria-busy', 'true');
    updateShareStatus('Preparing photos for your camera roll...', 'info');

    try {
      const files = Array.isArray(manifest.files) ? manifest.files : [];
      const limitedFiles = files.slice(0, SHARE_FILE_LIMIT);
      const blobs = [];
      for (const file of limitedFiles) {
        const assetUrl = resolveSharedPath(file.src || file.path || `shared-albums/${slug}/${file.filename}`);
        const response = await fetch(assetUrl);
        if (!response.ok) {
          throw new Error(`Failed to download ${file.filename}`);
        }
        const blob = await response.blob();
        const filename = file.downloadName || file.filename || `${slug}-${Date.now()}.jpg`;
        blobs.push(new File([blob], filename, { type: blob.type || 'image/jpeg' }));
      }

      if (!blobs.length) {
        throw new Error('Album is empty, nothing to share.');
      }

      if (!canShareFiles(blobs)) {
        throw new Error('Your browser cannot share multiple photos from this page.');
      }

      await navigator.share({
        files: blobs,
        title: manifest.title || 'Shared album',
        text: manifest.shareText || 'Tap Save to add each photo to your camera roll.',
      });
      updateShareStatus('Shared! Choose \"Save Images\" on your iPhone to add them to Photos.', 'success');
    } catch (error) {
      console.error(error);
      updateShareStatus('Could not share automatically. Use the .zip download instead.', 'error');
    } finally {
      shareButton.disabled = false;
      shareButton.setAttribute('aria-busy', 'false');
    }
  }

  function bindShare(manifest) {
    if (!shareButton) return;
    shareButton.addEventListener('click', () => {
      shareAlbum(manifest);
    });
    const shareSupported = isShareApiAvailable();
    setShareAvailability(shareSupported);
    if (!shareSupported) {
      updateShareStatus('Your browser does not support Add to Photos. Download the .zip instead.', 'error');
    }
  }

  function hydrate(manifest) {
    if (titleEl && manifest.title) {
      titleEl.textContent = manifest.title;
    }
    if (descriptionEl) {
      if (manifest.description) {
        descriptionEl.textContent = manifest.description;
        descriptionEl.removeAttribute('hidden');
      } else {
        descriptionEl.setAttribute('hidden', '');
      }
    }
    if (countEl) {
      countEl.textContent = formatCount(manifest.files);
    }
    if (heroEl) {
      heroEl.classList.add('is-ready');
    }
    document.title = `${manifest.title || 'Shared Album'} • Cooper's Photo Zone`;
    updateArchiveLink(manifest);
    renderGallery(manifest);
    bindShare(manifest);
  }

  async function init() {
    try {
      const manifest = await fetchManifest();
      if (statusEl) {
        statusEl.hidden = true;
      }
      hydrate(manifest);
    } catch (error) {
      console.error(error);
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.innerHTML = '<p>We couldn\'t find that album. Double-check the link or ask Cooper for a fresh one.</p>';
      }
      if (shareButton) {
        shareButton.disabled = true;
      }
      updateShareStatus('Album unavailable right now.', 'error');
    }
  }

  init();
})();
