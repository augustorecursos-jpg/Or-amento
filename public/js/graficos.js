// Gráficos em SVG/HTML puro, com dica ao passar o mouse.
const Graficos = (() => {
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

  function curto(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
    if (a >= 1e3) return `${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
    return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }

  /** Escala "redonda" para o eixo: 4 a 5 divisões com passos 1/2/2,5/5 × 10^n. */
  function escala(max) {
    if (max <= 0) return { topo: 1, passo: 1 };
    const bruto = max / 4;
    const pot = 10 ** Math.floor(Math.log10(bruto));
    const passo = [1, 2, 2.5, 5, 10].map(x => x * pot).find(x => x >= bruto);
    return { topo: Math.ceil(max / passo) * passo, passo };
  }

  let dica;
  function mostrarDica(html, ev) {
    if (!dica) {
      dica = document.createElement('div');
      dica.className = 'dica-grafico';
      document.body.appendChild(dica);
    }
    dica.innerHTML = html;
    dica.hidden = false;
    const x = Math.min(ev.clientX + 14, window.innerWidth - dica.offsetWidth - 8);
    const y = Math.min(ev.clientY + 14, window.innerHeight - dica.offsetHeight - 8);
    dica.style.left = `${x}px`;
    dica.style.top = `${y}px`;
  }
  function esconderDica() { if (dica) dica.hidden = true; }

  function ligarDicas(raiz, conteudo) {
    raiz.querySelectorAll('[data-dica]').forEach(el => {
      el.addEventListener('mousemove', ev => mostrarDica(conteudo(el.dataset.dica), ev));
      el.addEventListener('mouseleave', esconderDica);
    });
  }

  /**
   * Colunas empilhadas por mês.
   * series: [{ nome, cor, valores: [12] }], rotulos: [12]
   */
  function colunasEmpilhadas(el, { series, rotulos, destaque }) {
    const L = 760, A = 280, me = 54, md = 8, mt = 22, mb = 26;
    const totais = rotulos.map((_, m) => series.reduce((s, se) => s + se.valores[m], 0));
    const { topo, passo } = escala(Math.max(...totais, 0));
    const larg = (L - me - md) / rotulos.length;
    const bw = Math.min(38, larg * 0.62);
    const y = v => mt + (A - mt - mb) * (1 - v / topo);
    let svg = `<svg class="grafico-svg" viewBox="0 0 ${L} ${A}" role="img" aria-label="Custo mensal por grupo">`;
    for (let v = 0; v <= topo + 1e-9; v += passo) {
      svg += `<line class="grade" x1="${me}" x2="${L - md}" y1="${y(v)}" y2="${y(v)}"/><text x="${me - 8}" y="${y(v) + 4}" text-anchor="end">${curto(v)}</text>`;
    }
    rotulos.forEach((r, m) => {
      const cx = me + larg * m + larg / 2;
      let acum = 0;
      const segs = series.map(s => ({ s, v: s.valores[m] })).filter(x => x.v > 0);
      segs.forEach((seg, k) => {
        const y1 = y(acum + seg.v);
        const y0 = y(acum);
        const h = Math.max(0, y0 - y1 - (k > 0 ? 2 : 0));
        const ultimo = k === segs.length - 1;
        const x = cx - bw / 2;
        if (ultimo && h > 4) {
          const rr = 4;
          svg += `<path d="M${x},${y1 + h} V${y1 + rr} Q${x},${y1} ${x + rr},${y1} H${x + bw - rr} Q${x + bw},${y1} ${x + bw},${y1 + rr} V${y1 + h} Z" fill="${seg.s.cor}"/>`;
        } else {
          svg += `<rect x="${x}" y="${y1}" width="${bw}" height="${h}" fill="${seg.s.cor}"/>`;
        }
        acum += seg.v;
      });
      if (totais[m] > 0) svg += `<text class="rot-total" x="${cx}" y="${y(totais[m]) - 6}" text-anchor="middle">${curto(totais[m])}</text>`;
      svg += `<text x="${cx}" y="${A - 8}" text-anchor="middle"${destaque && destaque.includes(m) ? ' style="fill:#ec6b24;font-weight:700"' : ''}>${r}</text>`;
      svg += `<rect class="alvo" data-dica="${m}" x="${me + larg * m}" y="${mt}" width="${larg}" height="${A - mt - mb}"/>`;
    });
    svg += `<line class="eixo" x1="${me}" x2="${L - md}" y1="${y(0)}" y2="${y(0)}"/></svg>`;
    el.innerHTML = `<div class="legenda">${series.map(s => `<span><i style="background:${s.cor}"></i>${esc(s.nome)}</span>`).join('')}</div>${svg}`;
    ligarDicas(el, m => {
      m = Number(m);
      return `<b>${rotulos[m]}${destaque && destaque.includes(m) ? ' · dissídio' : ''}</b>` +
        series.slice().reverse().map(s => `<div class="linha"><span><i style="background:${s.cor}"></i>${esc(s.nome)}</span><span>${brl.format(s.valores[m])}</span></div>`).join('') +
        `<div class="linha" style="border-top:1px solid rgba(255,255,255,.2);margin-top:.3rem;padding-top:.3rem"><b>Total</b><b>${brl.format(totais[m])}</b></div>`;
    });
  }

  /** Barras horizontais: itens [{ rotulo, valor, sub }]. */
  function barras(el, itens, { formato = brl.format, limite = 12 } = {}) {
    const lista = itens.slice(0, limite);
    const max = Math.max(...lista.map(i => i.valor), 1);
    el.innerHTML = lista.length
      ? `<div class="barras">${lista.map((i, k) => `
        <div class="barra-linha" data-dica="${k}">
          <span class="barra-rotulo" title="${esc(i.rotulo)}">${esc(i.rotulo)}</span>
          <span class="barra-trilho"><i style="width:${(i.valor / max) * 78}%"></i><b>${curto(i.valor)}</b></span>
        </div>`).join('')}</div>${itens.length > limite ? `<p class="subtitulo" style="margin:.6rem 0 0;font-size:.8rem">+ ${itens.length - limite} outras</p>` : ''}`
      : '<div class="vazio">Sem dados</div>';
    ligarDicas(el, k => `<b>${esc(lista[k].rotulo)}</b><br>${formato(lista[k].valor)}${lista[k].sub ? `<br>${esc(lista[k].sub)}` : ''}`);
  }

  /** Barra única de composição + lista com valores e %. */
  function composicao(el, partes) {
    const total = partes.reduce((s, p) => s + p.valor, 0) || 1;
    el.innerHTML = `
      <div class="composicao">${partes.filter(p => p.valor > 0).map((p, k) => `<i data-dica="${k}" style="width:${(p.valor / total) * 100}%;background:${p.cor}"></i>`).join('')}</div>
      <div class="comp-lista">${partes.map(p => `
        <div class="comp-item"><i style="background:${p.cor}"></i><span>${esc(p.nome)}</span><b>${brl.format(p.valor)}</b><small>${((p.valor / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</small></div>`).join('')}
      </div>`;
    const visiveis = partes.filter(p => p.valor > 0);
    ligarDicas(el, k => `<b>${esc(visiveis[k].nome)}</b><br>${brl.format(visiveis[k].valor)} · ${((visiveis[k].valor / total) * 100).toFixed(1)}%`);
  }

  /** Rosca com o total no centro e legenda ao lado. partes: [{ nome, cor, valor }] */
  function rosca(el, partes, { centro = '', sub = '' } = {}) {
    const total = partes.reduce((s, p) => s + p.valor, 0) || 1;
    const R = 80, C = 2 * Math.PI * R, folga = 3;
    let acum = 0;
    const visiveis = partes.filter(p => p.valor > 0);
    const arcos = visiveis.map((p, k) => {
      const frac = p.valor / total;
      const tam = Math.max(0, frac * C - folga);
      const arco = `<circle class="rosca-arco" data-dica="${k}" cx="110" cy="110" r="${R}" fill="none" stroke="${p.cor}" stroke-width="30"
        stroke-dasharray="${tam} ${C - tam}" stroke-dashoffset="${-acum * C}" transform="rotate(-90 110 110)"/>`;
      acum += frac;
      return arco;
    }).join('');
    el.innerHTML = `<div class="rosca">
      <svg viewBox="0 0 220 220" role="img" aria-label="Composição do custo">${arcos}
        <text x="110" y="106" text-anchor="middle" class="rosca-valor">${esc(centro)}</text>
        <text x="110" y="128" text-anchor="middle" class="rosca-sub">${esc(sub)}</text></svg>
      <div class="comp-lista">${partes.map(p => `
        <div class="comp-item"><i style="background:${p.cor}"></i><span>${esc(p.nome)}</span><b>${curto(p.valor)}</b><small>${((p.valor / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</small></div>`).join('')}</div>
    </div>`;
    ligarDicas(el, k => `<b>${esc(visiveis[k].nome)}</b><br>${brl.format(visiveis[k].valor)} · ${((visiveis[k].valor / total) * 100).toFixed(1)}%`);
  }

  /** Área do custo mês a mês sobre fundo escuro (destaque do painel). */
  function areaAno(el, valores, rotulos, { destaque = [] } = {}) {
    const L = 640, A = 190, me = 8, md = 8, mt = 26, mb = 24;
    const max = Math.max(...valores, 1), min = Math.min(...valores);
    const piso = Math.max(0, min - (max - min) * 1.2 - max * 0.02);
    const x = i => me + ((L - me - md) * i) / (valores.length - 1);
    const y = v => mt + (A - mt - mb) * (1 - (v - piso) / (max - piso || 1));
    const pts = valores.map((v, i) => [x(i), y(v)]);
    let linha = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      linha += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
    }
    const area = `${linha} L${pts.at(-1)[0]},${A - mb} L${pts[0][0]},${A - mb} Z`;
    const iMax = valores.indexOf(max);
    el.innerHTML = `<svg class="area-ano" viewBox="0 0 ${L} ${A}" role="img" aria-label="Custo mês a mês">
      <defs><linearGradient id="grad-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f39a4a" stop-opacity=".55"/><stop offset="1" stop-color="#f39a4a" stop-opacity="0"/></linearGradient></defs>
      ${destaque.map(m => `<line x1="${x(m)}" x2="${x(m)}" y1="${mt - 12}" y2="${A - mb}" class="area-dissidio"/><text x="${x(m)}" y="${mt - 16}" text-anchor="middle" class="area-rot-diss">dissídio</text>`).join('')}
      <path d="${area}" fill="url(#grad-area)"/>
      <path d="${linha}" fill="none" stroke="#f39a4a" stroke-width="2.5" stroke-linecap="round"/>
      ${pts.map(([px, py], i) => `<circle cx="${px}" cy="${py}" r="${i === iMax ? 5 : 3.5}" class="area-ponto${i === iMax ? ' max' : ''}"/>`).join('')}
      <text x="${pts[iMax][0]}" y="${pts[iMax][1] - 10}" text-anchor="middle" class="area-max">${curto(max)}</text>
      ${rotulos.map((r, i) => `<text x="${x(i)}" y="${A - 6}" text-anchor="middle" class="area-mes">${r}</text>`).join('')}
      ${pts.map(([px], i) => `<rect class="alvo" data-dica="${i}" x="${px - (L / valores.length) / 2}" y="0" width="${L / valores.length}" height="${A}"/>`).join('')}
    </svg>`;
    ligarDicas(el, i => `<b>${rotulos[i]}</b><br>${brl.format(valores[i])}`);
  }

  /** Ponte do custo: do salário até o total, somando cada grupo. passos: [{ nome, valor, cor }] */
  function ponte(el, passos, { total }) {
    const L = 760, A = 260, me = 10, md = 10, mt = 30, mb = 46;
    const cols = [...passos, { nome: 'Total', valor: total, cor: '#0e3b5c', total: true }];
    const larg = (L - me - md) / cols.length;
    const bw = Math.min(70, larg * 0.62);
    const y = v => mt + (A - mt - mb) * (1 - v / (total || 1));
    let acum = 0;
    let svg = `<svg class="grafico-svg" viewBox="0 0 ${L} ${A}" role="img" aria-label="Composição do custo do salário ao total">`;
    cols.forEach((c, k) => {
      const cx = me + larg * k + larg / 2;
      const base = c.total ? 0 : acum;
      const topo = base + c.valor;
      const y0 = y(base), y1 = y(topo);
      svg += `<rect x="${cx - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(2, y0 - y1)}" rx="4" fill="${c.cor}"/>`;
      if (k < cols.length - 1) svg += `<line x1="${cx + bw / 2}" x2="${cx + larg - bw / 2}" y1="${y1}" y2="${y1}" class="ponte-liga"/>`;
      svg += `<text x="${cx}" y="${y1 - 8}" text-anchor="middle" class="rot-total">${c.total ? '' : '+'}${curto(c.valor)}</text>`;
      svg += `<text x="${cx}" y="${A - mb + 18}" text-anchor="middle" class="ponte-nome">${esc(c.nome)}</text>`;
      svg += `<text x="${cx}" y="${A - mb + 34}" text-anchor="middle">${((c.valor / (total || 1)) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</text>`;
      svg += `<rect class="alvo" data-dica="${k}" x="${me + larg * k}" y="${mt}" width="${larg}" height="${A - mt - mb}"/>`;
      if (!c.total) acum = topo;
    });
    svg += `<line class="eixo" x1="${me}" x2="${L - md}" y1="${y(0)}" y2="${y(0)}"/></svg>`;
    el.innerHTML = svg;
    ligarDicas(el, k => `<b>${esc(cols[k].nome)}</b><br>${brl.format(cols[k].valor)} no ano`);
  }

  /** Minigráfico de linha (12 meses). */
  function minilinha(valores, cor = '#2f6fa3') {
    const L = 120, A = 34, max = Math.max(...valores, 1), min = Math.min(...valores);
    const pts = valores.map((v, i) => `${(L * i) / (valores.length - 1)},${A - 4 - ((v - min) / (max - min || 1)) * (A - 8)}`);
    return `<svg class="minilinha" viewBox="0 0 ${L} ${A}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="${cor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  /** Conta de 0 até o valor (efeito de apresentação); respeita "reduzir movimento". */
  function contar(el, valor, formato) {
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = formato(valor); return; }
    const t0 = performance.now(), dur = 900;
    const passo = t => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = formato(valor * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  return { colunasEmpilhadas, barras, composicao, rosca, areaAno, ponte, minilinha, contar, curto, brl };
})();
