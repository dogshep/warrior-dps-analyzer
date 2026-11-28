// Keeps the tips list short: only the top few play tips show, each opens for its detail, and the rest sit behind
// one "Show N more" line. Works on the finished list (live or from the sample snapshot), so the HTML builders stay plain.
const SHOWN = 4;

export function tidyTips(ol) {
  if (!ol) return;
  let n = 0, extra = 0, inPlay = true;
  for (const li of ol.querySelectorAll(':scope > li:not(.more)')) {
    if (li.classList.contains('grp')) { if (n) inPlay = false; continue; }
    const title = li.querySelector('.t');
    if (title && li.querySelector('.d, .src')) {
      li.classList.add('fold');
      title.setAttribute('role', 'button');
      title.tabIndex = 0;
      title.setAttribute('aria-expanded', 'false');
    }
    if (inPlay && ++n > SHOWN) { li.classList.add('extra'); extra++; }
  }
  ol.querySelector(':scope > li.more')?.remove();
  if (!extra) { ol.classList.remove('all'); return; }
  const more = document.createElement('li');
  more.className = 'more';
  more.innerHTML = `<button class="link" type="button">Show ${extra} more</button>`;
  const extras = ol.querySelectorAll(':scope > li.extra');
  extras[extras.length - 1].after(more);
  ol.classList.remove('all');
  ol.querySelector('li.fold')?.classList.add('open');
  ol.querySelector('li.fold .t')?.setAttribute('aria-expanded', 'true');
  if (!ol.dataset.bound) {
    ol.dataset.bound = '1';
    ol.addEventListener('click', e => {
      if (e.target.closest('li.more button')) {
        ol.classList.toggle('all');
        const m = ol.querySelector('li.more button'), k = ol.querySelectorAll(':scope > li.extra').length;
        m.textContent = ol.classList.contains('all') ? 'Show fewer' : `Show ${k} more`;
        return;
      }
      const t = e.target.closest('.t[role=button]');
      if (t) t.setAttribute('aria-expanded', String(t.closest('li').classList.toggle('open')));
    });
    ol.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.t[role=button]')) { e.preventDefault(); e.target.click(); }
    });
  }
}
