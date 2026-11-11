// Reserve-a-table and Bulk-order forms.
// Submitting opens WhatsApp with the request pre-filled, sent to the number in
// site.config.js (injected at build time as data-whatsapp). With no number set,
// the form still renders but submitting is switched off.
import './reveal.js';

const today = new Date();
const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

document.querySelectorAll('form[data-request]').forEach((form) => {
  form.querySelectorAll('[data-min-today]').forEach((input) => { input.min = iso; });

  const number = form.dataset.whatsapp;
  const button = form.querySelector('[type="submit"]');
  if (!number) {
    button.disabled = true;
    form.querySelector('[data-off-note]').hidden = false;
    return;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const lines = [`${form.dataset.request} request`];
    for (const key of new Set(data.keys())) {
      const value = data.getAll(key).map(String).filter((v) => v.trim()).join(', ');
      if (value) lines.push(`${key}: ${value}`);
    }
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');
  });
});
