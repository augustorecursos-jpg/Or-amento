// Gera uma apresentação (PowerPoint) com o resumo do orçamento para a diretoria: mês a mês, ano × ano e os principais
// motivos de aumento. Respeita os filtros do topo (regional, estado, filial, centro de custo e conta).
/* global E, Motor, RUBRICAS, GRUPOS, MESES, RN, Graficos, brl0, num0, totalDe, somaRub, anoAnt, rotulosAnt, notaProjecao,
   notaProvisaoAnt, notaRealizadoAnt, escopoFiltro, ccFiltrado, nomeContaFiltro, noFiltro, rotuloCc, decomporConta,
   textoSimplesPorQueMudou, textoPctReajuste, filiaisComRascunho, lancamentosComoLinhas, GRUPOS_CMP, GRUPOS_CMP_TXT, toast */

function carregarPptx() {
  if (window.PptxGenJS) return Promise.resolve(window.PptxGenJS);
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = 'vendor/pptxgen.bundle.js';
    s.onload = () => ok(window.PptxGenJS);
    s.onerror = () => falha(new Error('Não foi possível carregar o gerador de PowerPoint.'));
    document.head.appendChild(s);
  });
}

const PPT = {
  marinho: '0E3B5C', azul: '2F6FA3', laranja: 'EC6B24', ant: 'F08A3C', cinza: '6B7280', claro: 'F3F6F9', linha: 'DCE3EA',
  sobe: 'C2410C', desce: '15803D', fonte: 'Calibri',
};
const pptCor = c => String(c).replace('#', '').toUpperCase();
const pptMi = v => `R$ ${Graficos.curto(v)}`;
const pptSinal = v => (v > 0.5 ? '+' : v < -0.5 ? '−' : '');
const pptDelta = v => `${pptSinal(v)}R$ ${Graficos.curto(Math.abs(v))}`;
const pptPct = (d, base) => (base ? `${pptSinal(d)}${(Math.abs(d / base) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : 'novo');
const pptCorDelta = v => (v > 0.5 ? PPT.sobe : v < -0.5 ? PPT.desce : PPT.cinza);

/** 2027 sem dissídios e sem reajuste de benefícios: base comum da decomposição de todas as contas (calcula uma vez só). */
function calcSemReajustes() {
  const semReaj = {};
  for (const [f, cfg] of Object.entries(filiaisComRascunho())) semReaj[f] = { ...cfg, dissidio_pct: 0, dissidio_ant_pct: 0, reaj_benef_pct: 0, reaj_benef_ant_pct: 0 };
  return Motor.calcular({ colaboradores: [...E.dados.colaboradores, ...lancamentosComoLinhas()], filiais: semReaj, premissas: E.dados.premissas, niveis: E.dados.niveis });
}

/** Junta os números da apresentação (no escopo do topo). */
function dadosApresentacao() {
  const ano = Number(E.dados.config.ano);
  const ant = anoAnt();
  const escopo = [escopoFiltro(E.eu.admin ? 'Todas as regionais' : E.eu.regionais.join(' · ')), ccFiltrado(), nomeContaFiltro()].filter(Boolean).join(' · ');
  const tot = totalDe(E.res);
  const grupo = (ag, g) => RUBRICAS.reduce((s, r, k) => (r.grupo === g ? s + somaRub(ag, k) : s), 0);
  const grupoMes = (ag, g, m) => RUBRICAS.reduce((s, r, k) => (r.grupo === g ? s + ag.porRubrica[k * 12 + m] : s), 0);
  const x = { ano, ant, escopo, tot, grupos: GRUPOS.map(g => ({ g, total: grupo(tot, g.id), meses: MESES.map((_, m) => grupoMes(tot, g.id, m)) })).filter(y => Math.abs(y.total) >= 0.5) };
  x.hcMedio = tot.hc.reduce((a, b) => a + b, 0) / 12;
  x.vagas = E.dados.colaboradores.filter(c => c.vaga && noFiltro(c)).length;
  x.temAnt = !!E.resAnt;
  if (!x.temAnt) return x;
  const a1 = totalDe(E.resCmp), a0 = totalDe(E.resAnt);
  Object.assign(x, { a0, a1, d: a1.total - a0.total, demais: tot.total - a1.total });
  x.hc0 = a0.hc.reduce((a, b) => a + b, 0) / 12;
  x.hc1 = a1.hc.reduce((a, b) => a + b, 0) / 12;
  x.gruposCmp = GRUPOS.filter(g => GRUPOS_CMP.has(g.id)).map(g => ({ g, v0: grupo(a0, g.id), v1: grupo(a1, g.id) })).filter(y => y.v0 || y.v1).map(y => ({ ...y, d: y.v1 - y.v0 }));
  x.contas = RUBRICAS.map((r, k) => ({ r, k, v0: somaRub(a0, k), v1: somaRub(a1, k) })).map(y => ({ ...y, d: y.v1 - y.v0 }))
    .filter(y => Math.abs(y.v0) + Math.abs(y.v1) >= 0.5).sort((p, q) => q.d - p.d);
  // O que explica a variação (todas as contas comparadas): pessoas, reajustes, custo por pessoa e lançamentos
  const resS = calcSemReajustes();
  const dec = x.contas.map(c => decomporConta(c.k, resS));
  x.motivos = { volume: 0, reajuste: 0, valor: 0, lanc: 0 };
  dec.forEach(y => { for (const k of Object.keys(x.motivos)) x.motivos[k] += y[k]; });
  x.decomp = new Map(dec.map(y => [y.k, y]));
  // Regional / filial / centro de custo
  const nivel = E.filtro.filial ? 'cc' : E.filtro.regional ? 'filial' : 'regional';
  const chave = { regional: c => c.regional, filial: c => c.filial, cc: c => rotuloCc(c) }[nivel];
  x.nomeNivel = { regional: 'Regional', filial: 'Filial', cc: 'Centro de custo' }[nivel];
  const n0 = Motor.agregar(E.resAnt, chave, noFiltro), n1 = Motor.agregar(E.resCmp, chave, noFiltro);
  x.nivel = [...new Set([...n0.keys(), ...n1.keys()])].map(k => {
    const p = n0.get(k), q = n1.get(k);
    return { k, v0: p?.total || 0, v1: q?.total || 0, h0: p ? p.hc[11] : 0, h1: q ? q.hc[11] : 0 };
  }).map(y => ({ ...y, d: y.v1 - y.v0 })).filter(y => Math.abs(y.v0) + Math.abs(y.v1) >= 0.5).sort((p, q) => q.d - p.d);
  return x;
}

async function gerarApresentacao(botao) {
  if (botao) { botao.disabled = true; botao.dataset.txt = botao.textContent; botao.textContent = '⏳ Gerando…'; }
  try {
    await new Promise(r => setTimeout(r, 30)); // deixa o botão redesenhar antes do cálculo
    const [Pptx, x] = await Promise.all([carregarPptx(), Promise.resolve().then(dadosApresentacao)]);
    const pptx = montarApresentacao(Pptx, x);
    const nome = `Orcamento-Pessoal-${x.ano}-${x.escopo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'geral'}.pptx`;
    await pptx.writeFile({ fileName: nome });
    toast('Apresentação gerada.');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Não foi possível gerar a apresentação.', 'erro');
  } finally {
    if (botao) { botao.disabled = false; botao.textContent = botao.dataset.txt; }
  }
}

function montarApresentacao(Pptx, x) {
  const pptx = new Pptx();
  pptx.layout = 'LAYOUT_WIDE'; // 13,33 × 7,5 pol.
  pptx.author = 'Orçamento de Pessoal';
  pptx.company = 'Âmbar Energia';
  pptx.title = `Orçamento de Pessoal ${x.ano}`;
  const W = 13.333;
  const F = { fontFace: PPT.fonte };
  const hoje = new Date().toLocaleDateString('pt-BR');
  let pagina = 1;

  const novoSlide = (titulo, sub) => {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.12, fill: { color: PPT.marinho }, line: { color: PPT.marinho } });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.42, w: 0.08, h: 0.62, fill: { color: PPT.laranja }, line: { color: PPT.laranja } });
    s.addText(titulo, { ...F, x: 0.7, y: 0.32, w: 11.9, h: 0.5, fontSize: 24, bold: true, color: PPT.marinho, margin: 0 });
    if (sub) s.addText(sub, { ...F, x: 0.7, y: 0.8, w: 11.9, h: 0.32, fontSize: 12, color: PPT.cinza, margin: 0 });
    pagina++;
    s.addShape(pptx.ShapeType.line, { x: 0.5, y: 7.02, w: W - 1, h: 0, line: { color: PPT.linha, width: 0.75 } });
    s.addText(`Orçamento de Pessoal ${x.ano} · ${x.escopo}`, { ...F, x: 0.5, y: 7.07, w: 10, h: 0.28, fontSize: 9, color: PPT.cinza, margin: 0 });
    s.addText(String(pagina), { ...F, x: W - 1.5, y: 7.07, w: 1, h: 0.28, fontSize: 9, color: PPT.cinza, align: 'right', margin: 0 });
    return s;
  };
  const cartao = (s, { x: cx, y, w, h, rotulo, valor, nota, cor = PPT.marinho }) => {
    s.addShape(pptx.ShapeType.roundRect, { x: cx, y, w, h, fill: { color: PPT.claro }, line: { color: PPT.linha, width: 0.75 }, rectRadius: 0.08 });
    s.addShape(pptx.ShapeType.rect, { x: cx, y: y + 0.15, w: 0.06, h: h - 0.3, fill: { color: cor }, line: { color: cor } });
    s.addText(rotulo, { ...F, x: cx + 0.22, y: y + 0.12, w: w - 0.35, h: 0.3, fontSize: 11, color: PPT.cinza, margin: 0 });
    s.addText(valor, { ...F, x: cx + 0.22, y: y + 0.42, w: w - 0.35, h: 0.55, fontSize: 24, bold: true, color: cor, margin: 0, fit: 'shrink' });
    if (nota) s.addText(nota, { ...F, x: cx + 0.22, y: y + 0.98, w: w - 0.35, h: h - 1.05, fontSize: 10, color: PPT.cinza, margin: 0, valign: 'top' });
  };
  // Tabela com cabeçalho marinho e números à direita
  const tabela = (s, linhas, opts) => {
    const cab = linhas[0].map((t, i) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: PPT.marinho }, align: i ? 'right' : 'left' } }));
    const corpo = linhas.slice(1).map((l, j) => l.map((c, i) => {
      const o = typeof c === 'object' && c !== null ? c : { text: String(c) };
      return { text: o.text, options: { align: i ? 'right' : 'left', fill: { color: j % 2 ? 'FFFFFF' : 'F8FAFC' }, ...(o.options || {}) } };
    }));
    s.addTable([cab, ...corpo], { ...F, fontSize: 10, color: '1F2937', border: { type: 'solid', pt: 0.5, color: PPT.linha }, margin: 0.05, ...opts });
  };
  const negrito = (text, extra = {}) => ({ text, options: { bold: true, ...extra } });
  const delta = (d, base) => [{ text: pptDelta(d), options: { color: pptCorDelta(d), bold: true } }, { text: pptPct(d, base), options: { color: pptCorDelta(d) } }];
  const eixoMil = { valAxisLabelFormatCode: '#,##0', valAxisLabelFontSize: 9, catAxisLabelFontSize: 10, valGridLine: { color: 'E5E7EB', size: 0.5 }, catAxisLineShow: false, valAxisLineShow: false, ...F, catAxisLabelFontFace: PPT.fonte, valAxisLabelFontFace: PPT.fonte, legendFontFace: PPT.fonte };
  const mil = v => Math.round(v / 1000);

  // 1. Capa
  {
    const s = pptx.addSlide();
    s.background = { color: PPT.marinho };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 6.9, w: W, h: 0.6, fill: { color: PPT.laranja }, line: { color: PPT.laranja } });
    s.addText('ORÇAMENTO DE PESSOAL', { ...F, x: 0.9, y: 1.9, w: 11, h: 0.4, fontSize: 16, bold: true, color: 'F7B48A', charSpacing: 4, margin: 0 });
    s.addText(x.temAnt ? `${x.ano} · comparativo com ${x.ant}` : String(x.ano), { ...F, x: 0.9, y: 2.35, w: 11.5, h: 1.1, fontSize: 48, bold: true, color: 'FFFFFF', margin: 0 });
    s.addText(x.escopo, { ...F, x: 0.9, y: 3.55, w: 11.5, h: 0.5, fontSize: 20, color: 'DCE7F0', margin: 0 });
    s.addText(`Resumo por mês, ${x.temAnt ? 'ano × ano e principais motivos de variação' : 'grupos de custo e headcount'}`, { ...F, x: 0.9, y: 4.15, w: 11.5, h: 0.4, fontSize: 14, color: '9CC3E4', margin: 0 });
    s.addText(`Gerado em ${hoje}`, { ...F, x: 0.9, y: 6.98, w: 11.5, h: 0.45, fontSize: 12, color: 'FFFFFF', margin: 0 });
  }

  // 2. Resumo executivo
  {
    const s = novoSlide('Resumo executivo', x.temAnt ? `Orçamento ${x.ano} × realizado ${x.ant}` : `Orçamento ${x.ano}`);
    const cw = 2.95, gap = 0.17, y = 1.35;
    if (x.temAnt) {
      cartao(s, { x: 0.5, y, w: cw, h: 1.75, rotulo: `Orçamento ${x.ano} (total)`, valor: brl0.format(x.tot.total), nota: `inclui Demais (${pptMi(x.demais)})` });
      cartao(s, { x: 0.5 + (cw + gap), y, w: cw, h: 1.75, rotulo: `Variação sobre ${x.ant}`, valor: `${pptDelta(x.d)}`, nota: `${pptPct(x.d, x.a0.total)} · ${pptMi(x.a0.total)} → ${pptMi(x.a1.total)} (${GRUPOS_CMP_TXT})`, cor: x.d > 0 ? PPT.laranja : PPT.desce });
      cartao(s, { x: 0.5 + 2 * (cw + gap), y, w: cw, h: 1.75, rotulo: 'Headcount médio', valor: `${num0.format(x.hc0)} → ${num0.format(x.hc1)}`, nota: `${pptSinal(x.hc1 - x.hc0)}${num0.format(Math.abs(x.hc1 - x.hc0))} pessoa(s) em média${x.vagas ? ` · ${x.vagas} vaga(s) prevista(s)` : ''}`, cor: PPT.azul });
      const m0 = x.hc0 ? x.a0.total / x.hc0 / 12 : 0, m1 = x.hc1 ? x.a1.total / x.hc1 / 12 : 0;
      cartao(s, { x: 0.5 + 3 * (cw + gap), y, w: cw, h: 1.75, rotulo: 'Custo médio por pessoa / mês', valor: brl0.format(m1), nota: `${x.ant}: ${brl0.format(m0)} (${pptPct(m1 - m0, m0)})`, cor: '8B5FBF' });
      // Mensagens-chave
      const mt = x.motivos;
      const pctDe = v => (x.d ? ` (${Math.round((v / x.d) * 100)}% da variação)` : '');
      const dissTxt = textoPctReajuste('dissidio');
      const sobem = x.contas.filter(c => c.d > 0).slice(0, 3);
      const itens = [
        `O custo de pessoal ${x.d >= 0 ? 'sobe' : 'cai'} ${pptMi(Math.abs(x.d))} (${pptPct(x.d, x.a0.total).replace(/^[+−]/, '')}) de ${x.ant} para ${x.ano}, considerando ${GRUPOS_CMP_TXT}.`,
        Math.abs(mt.reajuste) >= 1 ? `Reajustes (dissídio e benefícios): ${pptDelta(mt.reajuste)}${pctDe(mt.reajuste)}${dissTxt ? ` — dissídio ${dissTxt}` : ''}.` : '',
        Math.abs(mt.volume) >= 1 ? `Quadro de pessoas: headcount médio de ${num0.format(x.hc0)} para ${num0.format(x.hc1)}: ${pptDelta(mt.volume)}${pctDe(mt.volume)}.` : '',
        Math.abs(mt.valor) >= 1 ? `Custo por pessoa (promoções, perfil, valores e regras dos benefícios): ${pptDelta(mt.valor)}${pctDe(mt.valor)}.` : '',
        sobem.length ? `Contas que mais sobem: ${sobem.map(c => `${c.r.nome} (${pptDelta(c.d)})`).join(', ')}.` : '',
      ].filter(Boolean);
      s.addText('Mensagens-chave', { ...F, x: 0.5, y: 3.35, w: 12, h: 0.4, fontSize: 15, bold: true, color: PPT.marinho, margin: 0 });
      s.addText(itens.map(t => ({ text: t, options: { bullet: { indent: 18 }, paraSpaceAfter: 8 } })), { ...F, x: 0.5, y: 3.8, w: 12.3, h: 3.1, fontSize: 14, color: '1F2937', valign: 'top', margin: 0.05 });
    } else {
      cartao(s, { x: 0.5, y, w: cw, h: 1.75, rotulo: `Orçamento ${x.ano}`, valor: brl0.format(x.tot.total), nota: 'custo anual de pessoal' });
      cartao(s, { x: 0.5 + (cw + gap), y, w: cw, h: 1.75, rotulo: 'Média por mês', valor: brl0.format(x.tot.total / 12), cor: PPT.laranja });
      cartao(s, { x: 0.5 + 2 * (cw + gap), y, w: cw, h: 1.75, rotulo: 'Headcount médio', valor: num0.format(x.hcMedio), nota: x.vagas ? `${x.vagas} vaga(s) prevista(s)` : '', cor: PPT.azul });
      cartao(s, { x: 0.5 + 3 * (cw + gap), y, w: cw, h: 1.75, rotulo: 'Custo médio por pessoa / mês', valor: brl0.format(x.hcMedio ? x.tot.total / x.hcMedio / 12 : 0), cor: '8B5FBF' });
      s.addText(`Sem o realizado de ${x.ant} carregado (Histórico), a apresentação mostra só o orçamento ${x.ano}.`, { ...F, x: 0.5, y: 3.5, w: 12, h: 0.5, fontSize: 13, color: PPT.cinza, margin: 0 });
    }
  }

  // 3. Orçamento mês a mês por grupo
  {
    const s = novoSlide(`Orçamento ${x.ano} mês a mês`, 'Por grupo de custo · valores em R$ mil');
    s.addChart(pptx.ChartType.bar, x.grupos.map(y => ({ name: y.g.nome, labels: MESES, values: y.meses.map(mil) })), {
      x: 0.5, y: 1.25, w: 12.3, h: 3.2, barDir: 'col', barGrouping: 'stacked', barGapWidthPct: 60, chartColors: x.grupos.map(y => pptCor(y.g.cor)),
      showLegend: true, legendPos: 't', legendFontSize: 10, ...eixoMil,
    });
    const linhas = [['R$ mil', ...MESES, 'Ano'],
      ...x.grupos.map(y => [y.g.nome, ...y.meses.map(v => num0.format(v / 1000)), negrito(num0.format(y.total / 1000))]),
      [negrito('Total'), ...MESES.map((_, m) => negrito(num0.format(x.tot.meses[m] / 1000))), negrito(num0.format(x.tot.total / 1000), { color: PPT.laranja })]];
    tabela(s, linhas, { x: 0.5, y: 4.6, w: 12.3, colW: [1.45, ...MESES.map(() => 0.8), 1.25], fontSize: 9, rowH: 0.27 });
  }

  if (x.temAnt) {
    // 4. Ano × ano por mês
    {
      const nota = notaProjecao();
      const s = novoSlide(`${x.ant} × ${x.ano} por mês`, `${x.ant} realizado × ${x.ano} orçado · ${GRUPOS_CMP_TXT} · valores em R$ mil`);
      const rot = rotulosAnt();
      s.addChart(pptx.ChartType.bar, [
        { name: `${x.ant} realizado`, labels: rot, values: [...x.a0.meses].map(mil) },
        { name: `${x.ano} orçado`, labels: rot, values: [...x.a1.meses].map(mil) },
      ], { x: 0.5, y: 1.25, w: 12.3, h: 3.35, barDir: 'col', barGrouping: 'clustered', barGapWidthPct: 50, chartColors: [PPT.ant, PPT.azul], showLegend: true, legendPos: 't', legendFontSize: 10, ...eixoMil });
      const linhas = [['R$ mil', ...rot, 'Ano'],
        [String(x.ant), ...[...x.a0.meses].map(v => num0.format(v / 1000)), negrito(num0.format(x.a0.total / 1000))],
        [String(x.ano), ...[...x.a1.meses].map(v => num0.format(v / 1000)), negrito(num0.format(x.a1.total / 1000))],
        [negrito('Δ R$ mil'), ...MESES.map((_, m) => { const d = x.a1.meses[m] - x.a0.meses[m]; return { text: `${pptSinal(d)}${num0.format(Math.abs(d) / 1000)}`, options: { color: pptCorDelta(d) } }; }), { text: `${pptSinal(x.d)}${num0.format(Math.abs(x.d) / 1000)}`, options: { bold: true, color: pptCorDelta(x.d) } }],
        [negrito('Δ %'), ...MESES.map((_, m) => { const d = x.a1.meses[m] - x.a0.meses[m]; return { text: pptPct(d, x.a0.meses[m]), options: { color: pptCorDelta(d) } }; }), { text: pptPct(x.d, x.a0.total), options: { bold: true, color: pptCorDelta(x.d) } }]];
      tabela(s, linhas, { x: 0.5, y: 4.72, w: 12.3, colW: [1.45, ...MESES.map(() => 0.8), 1.25], fontSize: 9, rowH: 0.27 });
      if (nota) s.addText(`* ${nota}`, { ...F, x: 0.5, y: 6.62, w: 12.3, h: 0.3, fontSize: 9, italic: true, color: PPT.cinza, margin: 0 });
    }

    // 5. Ano × ano por grupo + o que explica a variação
    {
      const s = novoSlide(`${x.ant} × ${x.ano}: o que explica a variação`, `Variação total de ${pptDelta(x.d)} (${pptPct(x.d, x.a0.total)})`);
      s.addText('Por grupo de custo', { ...F, x: 0.5, y: 1.3, w: 6, h: 0.35, fontSize: 14, bold: true, color: PPT.marinho, margin: 0 });
      tabela(s, [['Grupo', String(x.ant), String(x.ano), 'Δ R$', 'Δ %'],
        ...x.gruposCmp.map(y => [y.g.nome, pptMi(y.v0), pptMi(y.v1), ...delta(y.d, y.v0)]),
        [negrito('Total'), negrito(pptMi(x.a0.total)), negrito(pptMi(x.a1.total)), ...delta(x.d, x.a0.total)]],
      { x: 0.5, y: 1.75, w: 6.1, colW: [1.7, 1.15, 1.15, 1.2, 0.9], fontSize: 11, rowH: 0.36 });
      if (Math.abs(x.demais) >= 0.5) s.addText(`Demais (treinamento, viagens, serviços…) fica fora do comparativo: ${pptMi(x.demais)} em ${x.ano}.`, { ...F, x: 0.5, y: 4.15, w: 6.1, h: 0.5, fontSize: 10, italic: true, color: PPT.cinza, margin: 0 });

      // Motivos (barras proporcionais)
      s.addText('Por motivo', { ...F, x: 7.05, y: 1.3, w: 5.8, h: 0.35, fontSize: 14, bold: true, color: PPT.marinho, margin: 0 });
      const dissTxt = textoPctReajuste('dissidio');
      const benTxt = textoPctReajuste('reaj_benef');
      const mot = [
        { nome: 'Reajustes', det: [dissTxt && `dissídio ${dissTxt}`, benTxt && `benefícios ${benTxt}`].filter(Boolean).join(' · ') || 'dissídio e reajuste de benefícios', v: x.motivos.reajuste },
        { nome: 'Quadro de pessoas', det: `HC médio ${num0.format(x.hc0)} → ${num0.format(x.hc1)}${x.vagas ? ` · ${x.vagas} vaga(s)` : ''}`, v: x.motivos.volume },
        { nome: 'Custo por pessoa', det: 'promoções, perfil de quem entra e sai, valores e regras dos benefícios', v: x.motivos.valor },
        { nome: 'Lançamentos', det: 'outros lançamentos e provisões fora das pessoas', v: x.motivos.lanc },
      ].filter(m => Math.abs(m.v) >= 1);
      const maxM = Math.max(...mot.map(m => Math.abs(m.v)), 1);
      mot.forEach((m, i) => {
        const y = 1.8 + i * 1.12;
        s.addText(m.nome, { ...F, x: 7.05, y, w: 3.3, h: 0.32, fontSize: 13, bold: true, color: '1F2937', margin: 0 });
        s.addText(`${pptDelta(m.v)}  ·  ${x.d ? `${Math.round((m.v / x.d) * 100)}%` : ''}`, { ...F, x: 10.15, y, w: 2.7, h: 0.32, fontSize: 13, bold: true, color: pptCorDelta(m.v), align: 'right', margin: 0 });
        s.addShape(pptx.ShapeType.rect, { x: 7.05, y: y + 0.38, w: 5.8, h: 0.2, fill: { color: 'EEF2F6' }, line: { color: 'EEF2F6' } });
        s.addShape(pptx.ShapeType.rect, { x: 7.05, y: y + 0.38, w: Math.max(0.05, (Math.abs(m.v) / maxM) * 5.8), h: 0.2, fill: { color: m.v >= 0 ? PPT.laranja : PPT.desce }, line: { type: 'none' } });
        s.addText(m.det, { ...F, x: 7.05, y: y + 0.62, w: 5.8, h: 0.4, fontSize: 10, color: PPT.cinza, margin: 0, valign: 'top' });
      });
    }

    // 6. Contas que mais sobem
    {
      const top = x.contas.filter(c => c.d > 0.5).slice(0, 10);
      const s = novoSlide('Contas que mais sobem', `${x.ant} × ${x.ano} · as ${top.length} maiores variações em R$`);
      if (top.length) {
        s.addChart(pptx.ChartType.bar, [{ name: 'Δ R$ mil', labels: top.map(c => c.r.nome).reverse(), values: top.map(c => mil(c.d)).reverse() }], {
          x: 0.4, y: 1.25, w: 5.6, h: 5.6, barDir: 'bar', chartColors: [PPT.laranja], showLegend: false, showValue: true, dataLabelFormatCode: '#,##0', dataLabelFontSize: 9, dataLabelPosition: 'outEnd',
          ...eixoMil, valAxisHidden: true, valGridLine: { style: 'none' }, catAxisLabelFontSize: 10,
        });
        tabela(s, [['Conta', String(x.ant), String(x.ano), 'Δ R$', 'Δ %', 'Peso'],
          ...top.map(c => [c.r.nome, pptMi(c.v0), pptMi(c.v1), ...delta(c.d, c.v0), x.d ? `${Math.round((c.d / x.d) * 100)}%` : ''])],
        { x: 6.2, y: 1.3, w: 6.65, colW: [2.15, 0.95, 0.95, 1.05, 0.8, 0.75], fontSize: 10, rowH: 0.36 });
        s.addText('Peso = quanto a conta representa da variação total.', { ...F, x: 6.2, y: 6.62, w: 6.65, h: 0.3, fontSize: 9, italic: true, color: PPT.cinza, margin: 0 });
      } else s.addText('Nenhuma conta sobe no escopo selecionado.', { ...F, x: 0.5, y: 1.5, w: 12, h: 0.5, fontSize: 14, color: PPT.cinza });
    }

    // 7+. Principais motivos: as 4 contas que mais sobem, duas por slide
    {
      const top = x.contas.filter(c => c.d > 0.5).slice(0, 4);
      for (let i = 0; i < top.length; i += 2) {
        const s = novoSlide('Principais motivos dos aumentos', `Por que as contas sobem de ${x.ant} para ${x.ano}`);
        const notas = [];
        top.slice(i, i + 2).forEach((c, j) => {
          const dec = x.decomp.get(c.k);
          const texto = textoSimplesPorQueMudou(dec);
          notas.push(texto);
          const linhas = texto.split('\n');
          const motivos = linhas.filter(l => l.startsWith('• ')).map(l => l.slice(2));
          const onde = linhas.find(l => l.startsWith('Onde mais pesa'));
          const cx = 0.5 + j * 6.25, w = 6.0;
          s.addShape(pptx.ShapeType.roundRect, { x: cx, y: 1.3, w, h: 5.55, fill: { color: PPT.claro }, line: { color: PPT.linha, width: 0.75 }, rectRadius: 0.08 });
          s.addText(`${i + j + 1}. ${c.r.nome}`, { ...F, x: cx + 0.25, y: 1.45, w: w - 0.5, h: 0.45, fontSize: 18, bold: true, color: PPT.marinho, margin: 0 });
          s.addText([
            { text: `${pptMi(c.v0)} → ${pptMi(c.v1)}   ` },
            { text: `${pptDelta(c.d)} (${pptPct(c.d, c.v0)})`, options: { bold: true, color: PPT.sobe } },
          ], { ...F, x: cx + 0.25, y: 1.92, w: w - 0.5, h: 0.35, fontSize: 13, color: '1F2937', margin: 0 });
          s.addText(motivos.map(t => ({ text: t, options: { bullet: { indent: 16 }, paraSpaceAfter: 12 } })), { ...F, x: cx + 0.25, y: 2.45, w: w - 0.5, h: onde ? 3.4 : 4.2, fontSize: 14, color: '1F2937', valign: 'top', margin: 0, fit: 'shrink' });
          if (onde) s.addText(onde, { ...F, x: cx + 0.25, y: 5.95, w: w - 0.5, h: 0.75, fontSize: 11, italic: true, color: PPT.cinza, valign: 'top', margin: 0, fit: 'shrink' });
        });
        s.addNotes(notas.join('\n\n'));
      }
    }

    // Headcount
    {
      const s = novoSlide(`Headcount ${x.ant} × ${x.ano}`, 'Pessoas ativas no fim de cada mês');
      const rot = rotulosAnt();
      s.addChart(pptx.ChartType.line, [
        { name: String(x.ant), labels: rot, values: [...x.a0.hc].map(Math.round) },
        { name: String(x.ano), labels: rot, values: [...x.a1.hc].map(Math.round) },
      ], { x: 0.5, y: 1.25, w: 8.2, h: 5.6, chartColors: [PPT.ant, PPT.azul], lineSize: 2.5, lineDataSymbolSize: 7, showLegend: true, legendPos: 't', legendFontSize: 11, ...eixoMil, valAxisLabelFormatCode: '#,##0' });
      const dz = (ag, m) => Math.round(ag.hc[m]);
      cartao(s, { x: 9.0, y: 1.35, w: 3.85, h: 1.65, rotulo: 'Headcount médio', valor: `${num0.format(x.hc0)} → ${num0.format(x.hc1)}`, nota: `${pptSinal(x.hc1 - x.hc0)}${num0.format(Math.abs(x.hc1 - x.hc0))} pessoa(s) em média`, cor: PPT.azul });
      cartao(s, { x: 9.0, y: 3.2, w: 3.85, h: 1.65, rotulo: 'Headcount em dezembro', valor: `${num0.format(dz(x.a0, 11))} → ${num0.format(dz(x.a1, 11))}`, nota: `${pptSinal(dz(x.a1, 11) - dz(x.a0, 11))}${num0.format(Math.abs(dz(x.a1, 11) - dz(x.a0, 11)))} pessoa(s)` });
      if (x.vagas) cartao(s, { x: 9.0, y: 5.05, w: 3.85, h: 1.65, rotulo: 'Vagas previstas', valor: num0.format(x.vagas), nota: `no orçamento ${x.ano}`, cor: PPT.laranja });
    }

    // Por regional / filial / centro de custo
    {
      const lista = x.nivel.length > 14 ? [...x.nivel.slice(0, 13)] : x.nivel;
      const resto = x.nivel.slice(lista.length);
      const s = novoSlide(`Por ${x.nomeNivel.toLowerCase()}`, `${x.ant} × ${x.ano}${resto.length ? ` · as 13 maiores variações; ${resto.length} outras somadas` : ''}`);
      const sv = (arr, k) => arr.reduce((a, y) => a + y[k], 0);
      const linhas = [[x.nomeNivel, `HC dez/${String(x.ant).slice(-2)}`, `HC dez/${String(x.ano).slice(-2)}`, String(x.ant), String(x.ano), 'Δ R$', 'Δ %'],
        ...lista.map(y => [y.k, num0.format(y.h0), num0.format(y.h1), pptMi(y.v0), pptMi(y.v1), ...delta(y.d, y.v0)])];
      if (resto.length) linhas.push([`Outras (${resto.length})`, num0.format(sv(resto, 'h0')), num0.format(sv(resto, 'h1')), pptMi(sv(resto, 'v0')), pptMi(sv(resto, 'v1')), ...delta(sv(resto, 'd'), sv(resto, 'v0'))]);
      linhas.push([negrito('Total'), negrito(num0.format(sv(x.nivel, 'h0'))), negrito(num0.format(sv(x.nivel, 'h1'))), negrito(pptMi(x.a0.total)), negrito(pptMi(x.a1.total)), ...delta(x.d, x.a0.total)]);
      tabela(s, linhas, { x: 0.5, y: 1.3, w: 12.3, colW: [4.3, 1.2, 1.2, 1.45, 1.45, 1.5, 1.2], fontSize: 10.5, rowH: 0.33 });
    }
  } else {
    // Sem histórico: grupos do ano
    const s = novoSlide(`Orçamento ${x.ano} por grupo`, 'Custo anual');
    tabela(s, [['Grupo', `${x.ano}`, '% do total'], ...x.grupos.map(y => [y.g.nome, pptMi(y.total), `${Math.round((y.total / (x.tot.total || 1)) * 100)}%`]), [negrito('Total'), negrito(pptMi(x.tot.total)), negrito('100%')]],
      { x: 0.5, y: 1.3, w: 6, colW: [2.6, 1.9, 1.5], fontSize: 12, rowH: 0.4 });
    s.addChart(pptx.ChartType.doughnut, [{ name: 'Grupos', labels: x.grupos.map(y => y.g.nome), values: x.grupos.map(y => mil(y.total)) }],
      { x: 7, y: 1.2, w: 5.8, h: 5.6, chartColors: x.grupos.map(y => pptCor(y.g.cor)), showLegend: true, legendPos: 'b', showPercent: true, showValue: false, holeSize: 55, dataLabelColor: 'FFFFFF', ...F });
  }

  // Premissas e notas
  {
    const s = novoSlide('Premissas e observações', 'O que está considerado nos números');
    const diss = textoPctReajuste('dissidio');
    const ben = textoPctReajuste('reaj_benef');
    const itens = [
      diss ? `Dissídio: ${diss}.` : 'Sem dissídio lançado nas filiais selecionadas.',
      ben ? `Reajuste de benefícios: ${ben}.` : '',
      x.vagas ? `${x.vagas} vaga(s) prevista(s) no orçamento ${x.ano}, a partir do mês de abertura de cada uma.` : '',
      x.temAnt ? `O comparativo com ${x.ant} considera ${GRUPOS_CMP_TXT}; o grupo Demais (treinamento, viagens, serviços…) fica fora.` : '',
      x.temAnt && notaProjecao() ? `${notaProjecao()}.` : '',
      x.temAnt && notaProvisaoAnt() ? `${notaProvisaoAnt()}.` : '',
      x.temAnt && notaRealizadoAnt() ? notaRealizadoAnt() : '',
      'Encargos, provisões (férias e 13º) e benefícios seguem as premissas e regras de cada filial cadastradas na ferramenta.',
    ].filter(Boolean);
    s.addText(itens.map(t => ({ text: t, options: { bullet: { indent: 18 }, paraSpaceAfter: 10 } })), { ...F, x: 0.6, y: 1.35, w: 12.1, h: 5.5, fontSize: 14, color: '1F2937', valign: 'top', margin: 0.05, fit: 'shrink' });
  }
  return pptx;
}
