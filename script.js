/* ===========================
   RRL Generator — script.js
   =========================== */

let selectedCountry = 'any';
let selectedCount = 10;

/* ===== Filter State ===== */

function setCountry(val) {
  selectedCountry = val;
  document.querySelectorAll('[data-country]').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.country === val);
  });
}

function setCount(val) {
  selectedCount = val;
  document.querySelectorAll('[data-count]').forEach(chip => {
    chip.classList.toggle('active', Number(chip.dataset.count) === val);
  });
}

/* ===== Abstract Toggle ===== */

function toggleAbstract(btn) {
  const abstract = btn.closest('.paper-card').querySelector('.abstract');
  const expanded = abstract.classList.toggle('expanded');
  btn.textContent = expanded ? 'Show less' : 'Read more';
}

/* ===== Copy All to Clipboard ===== */

function copyAll() {
  let out = '';

  document.querySelectorAll('.section-divider').forEach(divider => {
    const tag = divider.querySelector('.section-tag');
    if (tag) {
      out += tag.textContent.toUpperCase() + '\n' + '='.repeat(50) + '\n\n';
    }

    let next = divider.nextElementSibling;
    while (next && !next.classList.contains('section-divider') && !next.classList.contains('results-header')) {
      if (next.classList.contains('paper-card')) {
        const title   = next.querySelector('.paper-title')?.textContent?.trim() || '';
        const authors = next.querySelector('.authors')?.textContent?.trim() || '';
        const year    = next.querySelector('.year-badge')?.textContent?.trim() || '';
        const cites   = next.querySelector('.cites-badge')?.textContent?.trim() || '';
        const abstract = next.querySelector('.abstract')?.textContent?.trim() || '';
        const link    = next.querySelector('.paper-link')?.href || '';

        out += `${title} (${year})\n`;
        out += `Authors: ${authors}\n`;
        if (cites) out += `${cites}\n`;
        out += `Abstract: ${abstract}\n`;
        out += `Link: ${link}\n\n`;
      }
      next = next.nextElementSibling;
    }
  });

  if (!out.trim()) return;

  navigator.clipboard.writeText(out.trim()).then(() => {
    const btn = document.querySelector('.copy-all');
    if (btn) {
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = original; }, 2000);
    }
  }).catch(() => {
    alert('Could not copy — please select and copy the text manually.');
  });
}

/* ===== Reconstruct Abstract from Inverted Index ===== */

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return null;
  try {
    const words = {};
    for (const [word, positions] of Object.entries(invertedIndex)) {
      positions.forEach(pos => { words[pos] = word; });
    }
    const sorted = Object.keys(words)
      .map(Number)
      .sort((a, b) => a - b);
    return sorted.map(k => words[k]).join(' ');
  } catch {
    return null;
  }
}

/* ===== HTML Escape ===== */

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ===== Render a Single Paper Card ===== */

function renderCard(paper, type) {
  const label = type === 'local' ? 'PH' : '🌐';
  const citesHtml = paper.cites
    ? `<span class="cites-badge">${paper.cites.toLocaleString()} citations</span>`
    : '';

  return `
    <div class="paper-card">
      <div class="paper-top">
        <div class="paper-badge ${type}">${label}</div>
        <div class="paper-title">${escHtml(paper.title)}</div>
      </div>
      <div class="paper-meta">
        <span class="year-badge">${escHtml(String(paper.year))}</span>
        <span class="authors">${escHtml(paper.authors)}</span>
        ${citesHtml}
      </div>
      <div class="abstract">${escHtml(paper.abstract)}</div>
      <div class="paper-footer">
        <a class="paper-link" href="${escHtml(paper.link)}" target="_blank" rel="noopener noreferrer">
          View paper →
        </a>
        <button class="expand-btn" onclick="toggleAbstract(this)">Read more</button>
      </div>
    </div>
  `;
}

/* ===== Main Search Function ===== */

async function searchRRL() {
  const topic   = document.getElementById('topic').value.trim();
  const yearFrom = document.getElementById('year-from').value.trim();
  const yearTo   = document.getElementById('year-to').value.trim();
  const output   = document.getElementById('output');
  const btn      = document.getElementById('gen-btn');

  if (!topic) {
    document.getElementById('topic').focus();
    return;
  }

  /* Loading state */
  btn.classList.add('loading');
  btn.disabled = true;
  output.innerHTML = `
    <div class="loading-state">
      <div class="loading-dots">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
      <p>Searching OpenAlex…</p>
    </div>
  `;

  try {
    /* Build API URL */
    let url = `https://api.openalex.org/works?search=${encodeURIComponent(topic)}&per-page=${selectedCount}&sort=cited_by_count:desc`;

    if (yearFrom || yearTo) {
      const from = yearFrom || '1900';
      const to   = yearTo   || new Date().getFullYear();
      url += `&filter=publication_year:${from}-${to}`;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenAlex returned status ${res.status}`);

    const data    = await res.json();
    const results = data.results || [];

    if (!results.length) {
      output.innerHTML = `
        <div class="empty-state">
          <h3>No results found</h3>
          <p>OpenAlex returned no papers for that query.</p>
          <div class="tips">
            <div class="tip">Try a broader or shorter topic phrase</div>
            <div class="tip">Widen your year range</div>
            <div class="tip">Set Origin to "All Countries"</div>
          </div>
        </div>
      `;
      return;
    }

    /* Process results */
    const local   = [];
    const foreign = [];

    results.forEach(paper => {
      const title = paper.title || 'Untitled';
      const year  = paper.publication_year || '?';
      const link  = paper.doi
        ? `https://doi.org/${paper.doi}`
        : (paper.id || '#');

      const institutions = paper.authorships?.flatMap(a => a.institutions || []) || [];
      const isLocal = institutions.some(inst =>
        inst.country_code === 'PH' ||
        inst.display_name?.toLowerCase().includes('philippines')
      );

      /* Apply country filter */
      if (selectedCountry === 'local'   && !isLocal) return;
      if (selectedCountry === 'foreign' &&  isLocal) return;

      const authors = paper.authorships
        ?.map(a => a.author?.display_name)
        .filter(Boolean)
        .slice(0, 4)
        .join(', ') || 'Unknown authors';

      /* Prefer plain abstract; fall back to inverted index */
      const abstract =
        paper.abstract ||
        reconstructAbstract(paper.abstract_inverted_index) ||
        'Abstract not available.';

      const cites = paper.cited_by_count || 0;

      const item = { title, year, authors, abstract, link, cites };

      if (isLocal) local.push(item);
      else         foreign.push(item);
    });

    /* Nothing matched after filtering */
    if (!local.length && !foreign.length) {
      output.innerHTML = `
        <div class="empty-state">
          <h3>No matching studies</h3>
          <p>Results existed but none matched your current filters.</p>
          <div class="tips">
            <div class="tip">Set Origin to "All Countries"</div>
            <div class="tip">Widen your year range</div>
            <div class="tip">Increase results count to 30</div>
          </div>
        </div>
      `;
      return;
    }

    /* Build output HTML */
    const totalCount = local.length + foreign.length;
    let html = `
      <div class="results-header">
        <h2>Results</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="results-meta">${totalCount} paper${totalCount !== 1 ? 's' : ''} found</span>
          <button class="copy-all" onclick="copyAll()">Copy All</button>
        </div>
      </div>
    `;

    if (local.length) {
      html += `
        <div class="section-divider">
          <span class="section-tag local">Local Studies</span>
          <hr>
          <span class="section-count">${local.length} paper${local.length !== 1 ? 's' : ''}</span>
        </div>
      `;
      local.forEach(p => { html += renderCard(p, 'local'); });
    }

    if (foreign.length) {
      html += `
        <div class="section-divider">
          <span class="section-tag foreign">Foreign Studies</span>
          <hr>
          <span class="section-count">${foreign.length} paper${foreign.length !== 1 ? 's' : ''}</span>
        </div>
      `;
      foreign.forEach(p => { html += renderCard(p, 'foreign'); });
    }

    output.innerHTML = html;

  } catch (err) {
    console.error(err);
    output.innerHTML = `
      <div class="error-state">
        <strong>Something went wrong.</strong><br>
        ${escHtml(err.message)}.<br>
        Please check your internet connection and try again.
      </div>
    `;
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

/* ===== Enter Key Support ===== */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('topic').addEventListener('keydown', e => {
    if (e.key === 'Enter') searchRRL();
  });
});