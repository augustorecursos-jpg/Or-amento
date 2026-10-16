// Utilitários compartilhados entre as páginas.
async function api(url, opcoes = {}) {
  const init = { credentials: 'same-origin', ...opcoes };
  if (init.body && !(init.body instanceof FormData) && typeof init.body !== 'string') {
    init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    init.body = JSON.stringify(init.body);
  }
  const resp = await fetch(url, init);
  const tipo = resp.headers.get('content-type') || '';
  const dados = tipo.includes('application/json') ? await resp.json() : await resp.text();
  if (!resp.ok) {
    const erro = new Error((dados && dados.erro) || 'Erro inesperado');
    erro.status = resp.status;
    throw erro;
  }
  return dados;
}

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let _toastTimer;
function toast(msg, tipo = '') {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast show ${tipo}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}
