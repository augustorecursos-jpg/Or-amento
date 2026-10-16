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

  return { colunasEmpilhadas, barras, composicao, curto, brl };
})();
