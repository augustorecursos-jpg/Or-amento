// Orçamento de Pessoal · Âmbar Energia — aplicação (admin e coordenadores)
const { MESES, GRUPOS, RUBRICAS, METODOS, BASES, PERIODOS, IDX } = Motor;
const RN = RUBRICAS.length;
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const num2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const pctFmt = v => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const COR_GRUPO = Object.fromEntries(GRUPOS.map(g => [g.id, g.cor]));
const NOME_GRUPO = Object.fromEntries(GRUPOS.map(g => [g.id, g.nome]));
const STATUS = { aberta: ['Aberta', 'pend'], em_analise: ['Em análise', 'azul'], ajustada: ['Ajustada', 'ok'], recusada: ['Recusada', 'neutra'] };

const E = {
  eu: null,
  dados: null,
  res: null,          // cálculo com o rascunho do simulador aplicado
  resSalvo: null,     // cálculo só com o que está salvo (para medir o impacto do rascunho)
  resSemDissidio: null,
  rascunho: {},       // filial → { dissidio_pct, dissidio_mes }
  filtro: { regional: '', filial: '' },
  aba: 'painel',
  sim: { visao: 'rubricas', mil: false, fechados: new Set(), busca: '', abertos: new Set() },
  prem: { escopo: '*', edits: {}, filial: {}, busca: '', visao: 'filial', ocultarVazios: true, quadroReg: '' },
  base: { busca: '', soVagas: false, soProprias: false },
  conf: { filial: '', modo: 'mes', sel: new Set() },
  solic: [],
  solicFiltro: 'pendentes',
  contabil: { cfg: null, zeradas: false },
};

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
const painel = id => $(`[data-painel="${id}"]`);
const fmtVal = v => (E.sim.mil ? num0.format(v / 1000) : num2.format(v));

// ---------- dados e cálculo ----------

function filiaisComRascunho() {
  const out = {};
  for (const [f, cfg] of Object.entries(E.dados.filiais)) out[f] = { ...cfg, ...(E.rascunho[f] || {}) };
  return out;
}

function recalcular() {
  const { colaboradores, premissas, niveis } = E.dados;
  E.res = Motor.calcular({ colaboradores, filiais: filiaisComRascunho(), premissas, niveis });
  E.resSalvo = Object.keys(E.rascunho).length ? Motor.calcular({ colaboradores, filiais: E.dados.filiais, premissas, niveis }) : E.res;
  const semDiss = {};
  for (const [f, cfg] of Object.entries(filiaisComRascunho())) semDiss[f] = { ...cfg, dissidio_pct: 0 };
  E.resSemDissidio = Motor.calcular({ colaboradores, filiais: semDiss, premissas, niveis });
}

async function carregar() {
  E.dados = await api('/api/dados');
  recalcular();
  montarFiltros();
}

const noFiltro = c => (!E.filtro.regional || c.regional === E.filtro.regional) && (!E.filtro.filial || c.filial === E.filtro.filial);
const regionais = () => [...new Set(Object.values(E.dados.filiais).map(f => f.regional))].sort();
const filiaisDa = regional => Object.values(E.dados.filiais).filter(f => !regional || f.regional === regional).map(f => f.filial).sort();

function totalDe(res, filtro = noFiltro) {
  const ag = Motor.agregar(res, () => 'x', filtro).get('x');
  return ag || { porRubrica: new Float64Array(RN * 12), meses: new Float64Array(12), hc: new Float64Array(12), total: 0, n: 0 };
}

// ---------- estrutura (menu, filtros, modal) ----------

function montarFiltros() {
  const r = $('#f-regional');
  const f = $('#f-filial');
  const regs = regionais();
  if (!regs.includes(E.filtro.regional)) E.filtro.regional = '';
  r.innerHTML = `<option value="">${E.eu.admin ? 'Todas as regionais' : 'Minhas regionais'}</option>${regs.map(x => `<option ${x === E.filtro.regional ? 'selected' : ''}>${esc(x)}</option>`).join('')}`;
  const fils = filiaisDa(E.filtro.regional);
  if (!fils.includes(E.filtro.filial)) E.filtro.filial = '';
  f.innerHTML = `<option value="">Todas as filiais</option>${fils.map(x => `<option ${x === E.filtro.filial ? 'selected' : ''}>${esc(x)}</option>`).join('')}`;
}

const TITULOS = {
  painel: 'Painel', simulacao: 'Simulação mês a mês', premissas: 'Premissas e regras', base: 'Base de colaboradores',
  conferencia: 'Conferência', contabil: 'Relatório contábil', solicitacoes: 'Pedidos de ajuste', coordenadores: 'Acessos dos coordenadores', historico: 'Histórico',
};

function irPara(aba) {
  E.aba = aba;
  $$('.lateral-item[data-aba]').forEach(b => b.classList.toggle('ativo', b.dataset.aba === aba));
  $$('[data-painel]').forEach(s => { s.hidden = s.dataset.painel !== aba; });
  $('#barra-pagina').textContent = TITULOS[aba];
  $('#barra-filtros').style.visibility = ['painel', 'simulacao', 'base', 'conferencia', 'contabil'].includes(aba) ? '' : 'hidden';
  $('#lateral').classList.remove('aberta');
  history.replaceState(null, '', `#${aba}`);
  renderAba();
  window.scrollTo(0, 0);
}

function renderAba() {
  ({
    painel: renderPainel, simulacao: renderSimulacao, premissas: renderPremissas, base: renderBase,
    conferencia: renderConferencia, contabil: renderContabil, solicitacoes: renderSolicitacoes, coordenadores: renderCoordenadores, historico: renderHistorico,
  })[E.aba]();
}

function abrirModal({ titulo, sup = '', corpo, rodape = '', largo = false }) {
  const d = $('#modal');
  d.className = `modal${largo ? ' largo' : ''}`;
  d.innerHTML = `
    <header><div>${sup ? `<small>${esc(sup)}</small>` : ''}<h3>${esc(titulo)}</h3></div><button class="btn-ic" data-fechar aria-label="Fechar">✕</button></header>
    <div class="modal-corpo">${corpo}</div>
    ${rodape ? `<footer>${rodape}</footer>` : ''}`;
  d.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => d.close()));
  d.showModal();
  return d;
}

function opcoesMes(sel, comVazio = false) {
  return (comVazio ? '<option value="">—</option>' : '') + MESES.map((m, i) => `<option value="${i + 1}" ${Number(sel) === i + 1 ? 'selected' : ''}>${m}</option>`).join('');
}

function faixaRascunho() {
  const n = Object.keys(E.rascunho).length;
  if (!n) return '';
  const dif = totalDe(E.res).total - totalDe(E.resSalvo).total;
  return `<div class="faixa-rascunho"><span>🧪 <b>Simulação não salva</b> · dissídio alterado em ${n} filial(is) · impacto no ano de <b>${dif >= 0 ? '+' : ''}${brl0.format(dif)}</b></span>
    <span style="margin-left:auto;display:flex;gap:.5rem"><button class="btn btn-claro btn-sm" data-descartar>Descartar</button><button class="btn btn-laranja btn-sm" data-aplicar>Aplicar ao orçamento</button></span></div>`;
}

function ligarFaixa(raiz) {
  raiz.querySelector('[data-descartar]')?.addEventListener('click', descartarRascunho);
  raiz.querySelector('[data-aplicar]')?.addEventListener('click', aplicarRascunho);
}

function descartarRascunho() {
  E.rascunho = {};
  recalcular();
  renderAba();
}

async function aplicarRascunho() {
  const filiais = Object.entries(E.rascunho).map(([filial, r]) => ({ filial, ...r }));
  if (!filiais.length) return;
  try {
    await api('/api/filiais', { method: 'PUT', body: { filiais } });
    E.rascunho = {};
    await carregar();
    renderAba();
    toast(`Dissídio aplicado em ${filiais.length} filial(is).`);
  } catch (e) { toast(e.message, 'erro'); }
}

// ---------- Painel ----------

function renderPainel() {
  const el = painel('painel');
  const ano = E.dados.config.ano;
  const col = E.dados.colaboradores.filter(noFiltro);
  if (!E.dados.colaboradores.length) {
    el.innerHTML = `<div class="cartao vazio"><span>📥</span><h3>Nenhum colaborador na base ainda</h3>
      <p>${E.eu.admin ? 'Comece importando a base em <b>Base de colaboradores</b> (até a coluna salário).' : 'O time de orçamento ainda não carregou a base da sua regional.'}</p>
      ${E.eu.admin ? '<button class="btn btn-laranja" data-ir="base">Importar base</button>' : ''}</div>`;
    el.querySelector('[data-ir]')?.addEventListener('click', () => irPara('base'));
    return;
  }
  const ag = totalDe(E.res);
  const semD = totalDe(E.resSemDissidio);
  const grupos = Motor.porGrupo(ag);
  const somaG = id => grupos[id].reduce((a, b) => a + b, 0);
  const hcMedio = ag.hc.reduce((a, b) => a + b, 0) / 12;
  const colabMes = ag.hc.reduce((a, b) => a + b, 0);
  const vagas = col.filter(c => c.vaga).length;
  const impacto = ag.total - semD.total;
  const fil = filiaisComRascunho();
  const mesesDiss = [...new Set(col.map(c => fil[c.filial]).filter(f => f && f.dissidio_pct).map(f => f.dissidio_mes - 1))].sort((a, b) => a - b);
  const encBen = (somaG('encargos') + somaG('beneficios')) / (ag.total || 1);
  const escopo = E.filtro.filial || E.filtro.regional || (E.eu.admin ? 'Todas as regionais' : E.eu.regionais.join(' · '));
  const nivelCards = E.filtro.filial ? 'cc' : E.filtro.regional ? 'filial' : 'regional';
  const tituloCards = { regional: 'Custo por regional', filial: `Filiais da regional ${E.filtro.regional}`, cc: `Centros de custo · ${E.filtro.filial}` }[nivelCards];

  // Ponte: salário → adicionais e HE → provisões → encargos → benefícios → demais = total
  const salAno = [...ag.porRubrica.slice(0, 12)].reduce((a, b) => a + b, 0);
  const passos = [
    { nome: 'Salários', valor: salAno, cor: '#164d74' },
    { nome: 'Adicionais e HE', valor: somaG('remuneracao') - salAno, cor: COR_GRUPO.remuneracao },
    { nome: 'Provisões', valor: somaG('provisoes'), cor: COR_GRUPO.provisoes },
    { nome: 'Encargos', valor: somaG('encargos'), cor: COR_GRUPO.encargos },
    { nome: 'Benefícios', valor: somaG('beneficios'), cor: COR_GRUPO.beneficios },
    { nome: 'Demais', valor: somaG('demais'), cor: COR_GRUPO.demais },
  ];

  const kpi = (ic, cor, rotulo, valor, nota, id = '') => `<div class="kpi2"><span class="kpi2-ic" style="--c:${cor}">${ic}</span><div><span>${rotulo}</span><strong${id ? ` id="${id}"` : ''}>${valor}</strong><small>${nota}</small></div></div>`;

  el.innerHTML = `
    ${faixaRascunho()}
    <div class="painel-topo">
      <div><small>ORÇAMENTO DE PESSOAL · ${esc(ano)}</small><h1>${esc(escopo)}</h1></div>
      <button class="btn btn-marinho" id="btn-apresentar">▶ Modo apresentação</button>
    </div>
    <section class="hero2">
      <div class="pontilhado"></div>
      <div class="hero2-num">
        <small>CUSTO ANUAL DE PESSOAL</small>
        <div class="hero2-total" id="hero-total">${brl0.format(ag.total)}</div>
        <p>média de <b>${brl0.format(ag.total / 12)}</b> por mês · <b>${num0.format(hcMedio)}</b> colaboradores em média</p>
        <div class="hero2-chips">
          ${impacto ? `<span class="chip-claro">📈 dissídio <b>+${Graficos.curto(impacto)}</b> no ano</span>` : ''}
          ${vagas ? `<span class="chip-claro">🧑‍💼 <b>${vagas}</b> vaga(s) prevista(s)</span>` : ''}
          <span class="chip-claro">🏢 <b>${new Set(col.map(c => c.filial)).size}</b> filiais</span>
        </div>
      </div>
      <div class="hero2-graf"><small>EVOLUÇÃO MÊS A MÊS</small><div id="g-area"></div></div>
    </section>
    <div class="kpis2">
      ${kpi('👥', '#2f6fa3', 'Headcount médio', num0.format(hcMedio), vagas ? `${vagas} vaga(s) no ano` : 'sem vagas previstas')}
      ${kpi('💼', '#8b5fbf', 'Custo médio por colaborador', brl0.format(colabMes ? ag.total / colabMes : 0), 'por mês, com encargos e benefícios')}
      ${kpi('📈', '#ec6b24', 'Impacto do dissídio', `${impacto >= 0 ? '+' : ''}${brl0.format(impacto)}`, semD.total ? `${pctFmt(impacto / semD.total)} sobre o custo sem reajuste` : '–')}
      ${kpi('🧾', '#2a9d8f', 'Encargos + benefícios', pctFmt(encBen), 'do custo total')}
    </div>
    <div class="grade-2">
      <section class="cartao"><h3>Custo mês a mês <small>· por grupo${mesesDiss.length ? ' · meses de dissídio em laranja' : ''}</small></h3><div id="g-meses"></div></section>
      <section class="cartao"><h3>Para onde vai o custo</h3><div id="g-comp"></div></section>
    </div>
    <section class="cartao" style="margin-top:1.2rem"><h3>Do salário ao custo total <small>· quanto cada grupo soma ao ano</small></h3><div id="g-ponte"></div></section>
    <section style="margin-top:1.4rem">
      <h2 class="titulo-bloco">${esc(tituloCards)}</h2>
      <div class="cards-escopo" id="g-cards"></div>
    </section>
    <section class="cartao" style="margin-top:1.2rem" id="g-conf"></section>`;
  ligarFaixa(el);
  $('#btn-apresentar', el).addEventListener('click', alternarApresentacao);
  Graficos.contar($('#hero-total', el), ag.total, v => brl0.format(v));

  Graficos.areaAno($('#g-area', el), [...ag.meses], MESES, { destaque: mesesDiss });
  Graficos.colunasEmpilhadas($('#g-meses', el), {
    rotulos: MESES,
    series: GRUPOS.map(g => ({ nome: g.nome, cor: g.cor, valores: [...grupos[g.id]] })),
    destaque: mesesDiss,
  });
  Graficos.rosca($('#g-comp', el), GRUPOS.map(g => ({ nome: g.nome, cor: g.cor, valor: somaG(g.id) })), { centro: Graficos.curto(ag.total), sub: 'no ano' });
  Graficos.ponte($('#g-ponte', el), passos, { total: ag.total });

  // Cards por regional / filial / centro de custo, com minigráfico do ano
  const chave = { regional: c => c.regional, filial: c => c.filial, cc: c => `${c.cc_cod || '—'} · ${c.cc_nome || 'Sem centro de custo'}` }[nivelCards];
  const itens = [...Motor.agregar(E.res, chave, noFiltro)].sort((a, b) => b[1].total - a[1].total);
  $('#g-cards', el).innerHTML = itens.map(([k, a], i) => {
    const hc = a.hc.reduce((x, y) => x + y, 0);
    const clicavel = nivelCards !== 'cc';
    return `<${clicavel ? 'button' : 'div'} class="card-escopo" ${clicavel ? `data-ir="${esc(k)}"` : ''}>
      <div class="card-escopo-topo"><span class="card-pos">${i + 1}</span><strong title="${esc(k)}">${esc(k)}</strong></div>
      <div class="card-escopo-valor">${brl0.format(a.total)}</div>
      <div class="card-escopo-barra"><i style="width:${(a.total / (ag.total || 1)) * 100}%"></i></div>
      <div class="card-escopo-info"><span>${pctFmt(a.total / (ag.total || 1))} do total</span><span>${num0.format(hc / 12)} colab. · ${brl0.format(hc ? a.total / hc : 0)}/mês</span></div>
      ${Graficos.minilinha([...a.meses], '#ec6b24')}
    </${clicavel ? 'button' : 'div'}>`;
  }).join('');
  $$('#g-cards [data-ir]', el).forEach(b => b.addEventListener('click', () => {
    if (nivelCards === 'regional') { E.filtro.regional = b.dataset.ir; E.filtro.filial = ''; }
    else E.filtro.filial = b.dataset.ir;
    montarFiltros();
    renderPainel();
    desenharBarraApresentacao();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  // Conferência das filiais
  const fils = filiaisDa(E.filtro.regional).filter(f => !E.filtro.filial || f === E.filtro.filial);
  const abertas = E.solic.filter(s => s.status === 'aberta' || s.status === 'em_analise');
  const conferidas = fils.filter(f => E.dados.filiais[f].conferencia === 'conferida').length;
  const frac = fils.length ? conferidas / fils.length : 0;
  const C = 2 * Math.PI * 34;
  $('#g-conf', el).innerHTML = `
    <div class="conf-resumo">
      <svg viewBox="0 0 84 84" class="conf-anel"><circle cx="42" cy="42" r="34" class="trilho"/><circle cx="42" cy="42" r="34" class="carga" stroke-dasharray="${C * frac} ${C}" transform="rotate(-90 42 42)"/>
        <text x="42" y="47" text-anchor="middle">${Math.round(frac * 100)}%</text></svg>
      <div><h3>Conferência pelos coordenadores</h3><p><b>${conferidas}</b> de <b>${fils.length}</b> filiais conferidas · <b>${abertas.filter(s => fils.includes(s.filial)).length}</b> pedido(s) de ajuste em aberto</p></div>
    </div>
    <div class="conf-chips">${fils.map(f => {
      const cfg = E.dados.filiais[f];
      const n = abertas.filter(s => s.filial === f).length;
      const ok = cfg.conferencia === 'conferida';
      return `<span class="conf-chip ${ok ? 'ok' : ''}" title="${ok ? `Conferida por ${esc(cfg.conferida_por || '')}` : 'Pendente'}">${ok ? '✓' : '○'} ${esc(f)}${n ? ` <b>${n}</b>` : ''}</span>`;
    }).join('')}</div>`;
}

// ----- Modo apresentação: tela cheia, sem menus; setas trocam de regional -----

function alternarApresentacao() {
  const ligado = document.body.classList.toggle('apresentacao');
  if (ligado) {
    if (E.aba !== 'painel') irPara('painel');
    document.documentElement.requestFullscreen?.().catch(() => {});
    let barra = $('#barra-apresentacao');
    if (!barra) {
      barra = document.createElement('div');
      barra.id = 'barra-apresentacao';
      document.body.appendChild(barra);
    }
    desenharBarraApresentacao();
  } else {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    $('#barra-apresentacao')?.remove();
  }
  renderPainel();
}

function desenharBarraApresentacao() {
  const barra = $('#barra-apresentacao');
  if (!barra) return;
  const opcoes = ['', ...regionais()];
  const i = opcoes.indexOf(E.filtro.regional);
  barra.innerHTML = `<button data-dir="-1" aria-label="Anterior">◀</button><span>${esc(E.filtro.filial || E.filtro.regional || 'Todas as regionais')}</span><button data-dir="1" aria-label="Próxima">▶</button><small>use ← → para navegar</small><button data-sair aria-label="Sair da apresentação">✕</button>`;
  barra.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => navegarApresentacao(Number(b.dataset.dir))));
  barra.querySelector('[data-sair]').addEventListener('click', alternarApresentacao);
  barra.dataset.pos = i;
}

function navegarApresentacao(dir) {
  const opcoes = ['', ...regionais()];
  const i = opcoes.indexOf(E.filtro.regional);
  E.filtro.regional = opcoes[(i + dir + opcoes.length) % opcoes.length];
  E.filtro.filial = '';
  montarFiltros();
  renderPainel();
  desenharBarraApresentacao();
  window.scrollTo(0, 0);
}

document.addEventListener('keydown', e => {
  if (!document.body.classList.contains('apresentacao')) return;
  if (e.key === 'ArrowRight') navegarApresentacao(1);
  else if (e.key === 'ArrowLeft') navegarApresentacao(-1);
  else if (e.key === 'Escape' && !document.fullscreenElement) alternarApresentacao();
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('apresentacao')) alternarApresentacao();
});

// ---------- Simulação ----------

function linhasSimulacao() {
  const v = E.sim.visao;
  if (v === 'rubricas') {
    const ag = totalDe(E.res);
    const linhas = [];
    for (const g of GRUPOS) {
      const filhos = RUBRICAS.map((r, i) => ({ r, i })).filter(x => x.r.grupo === g.id)
        .map(({ r, i }) => ({ rotulo: r.nome, meses: [...ag.porRubrica.slice(i * 12, i * 12 + 12)] }))
        .filter(l => l.meses.some(x => x));
      const meses = MESES.map((_, m) => filhos.reduce((s, f) => s + f.meses[m], 0));
      linhas.push({ grupo: g.id, rotulo: g.nome, meses, cor: g.cor });
      if (!E.sim.fechados.has(g.id)) filhos.forEach(f => linhas.push({ ...f, filho: true }));
    }
    return { linhas, total: [...ag.meses], comHc: false };
  }
  const chave = {
    filiais: c => c.filial,
    cc: c => `${c.cc_cod || '—'} · ${c.cc_nome || 'Sem centro de custo'}`,
    colaboradores: c => c.id,
  }[v];
  const busca = E.sim.busca.toLowerCase();
  const filtro = c => noFiltro(c) && (!busca || `${c.nome} ${c.matricula} ${c.funcao} ${c.cc_nome}`.toLowerCase().includes(busca));
  const mapa = Motor.agregar(E.res, chave, filtro);
  const porId = new Map(E.dados.colaboradores.map(c => [c.id, c]));
  const linhas = [...mapa].map(([k, a]) => {
    const c = v === 'colaboradores' ? porId.get(k) : null;
    return {
      rotulo: c ? c.nome : k,
      sub: c ? `${c.funcao || ''} · ${c.filial}${c.cc_nome ? ` · ${c.cc_nome}` : ''}` : `${a.n} colaborador(es)`,
      hc: v === 'colaboradores' ? null : Math.max(...a.hc),
      meses: [...a.meses],
      vaga: c?.vaga,
      colab: c ? c.id : null,
      proprias: c ? temProprias(c) : false,
    };
  }).sort((a, b) => b.meses.reduce((s, x) => s + x, 0) - a.meses.reduce((s, x) => s + x, 0));
  const total = MESES.map((_, m) => linhas.reduce((s, l) => s + l.meses[m], 0));
  if (v !== 'colaboradores') return { linhas, total, comHc: true };
  // Uma pessoa só na busca: já abre o detalhe dela.
  if (linhas.length === 1) E.sim.abertos.add(linhas[0].colab);
  const comDetalhe = [];
  for (const l of linhas) {
    l.aberto = E.sim.abertos.has(l.colab);
    comDetalhe.push(l);
    if (l.aberto) comDetalhe.push(...detalheColaborador(l.colab));
  }
  return { linhas: comDetalhe, total, comHc: false };
}

/** Linhas com o que está orçado para um colaborador: subtotal por grupo e cada rubrica, mês a mês. */
function detalheColaborador(id) {
  const i = E.res.colaboradores.findIndex(c => c.id === id);
  if (i < 0) return [];
  const c = E.res.colaboradores[i];
  const out = [];
  for (const g of GRUPOS) {
    const filhos = RUBRICAS.map((r, k) => ({ r, k })).filter(x => x.r.grupo === g.id).map(({ r, k }) => ({
      rotulo: r.nome, meses: MESES.map((_, m) => E.res.valor(i, k, m)), propria: Boolean(c.excecoes?.[r.id]), conta: contaDoItem(c, r),
    })).filter(f => f.meses.some(x => x));
    if (!filhos.length) continue;
    out.push({ rotulo: g.nome, cor: g.cor, meses: MESES.map((_, m) => filhos.reduce((s, f) => s + f.meses[m], 0)), det: 'grupo' });
    filhos.forEach(f => out.push({ ...f, det: 'rubrica' }));
  }
  return out;
}

/** Explica a conta de itens em nº de salários (PPR): salário × target = valor no ano. */
function contaDoItem(c, rub) {
  if (rub.fixa) return '';
  const p = Motor.aplicarExcecao(Motor.premissaDe(E.dados.premissas, c.filial, c.regional, rub.id), c.excecoes?.[rub.id]);
  if (p.metodo !== 'multiplo') return '';
  const mult = Motor.multiploDe(p, c.cargo, E.dados.niveis);
  const quando = p.periodo === 'anual_mes' ? `pago em ${MESES[p.mes - 1]}` : p.periodo === 'anual_diluido' ? 'diluído em 12 meses' : 'todo mês';
  const alvo = `${fmtN(mult)} salário${mult === 1 ? '' : 's'}${p.por_nivel && c.cargo ? ` (${c.cargo})` : ''}`;
  const f = filiaisComRascunho()[c.filial] || {};
  const pct = !p.sem_dissidio && Number(f.dissidio_pct) ? Number(f.dissidio_pct) : 0;
  const sal = c.salario * (1 + pct / 100);
  const base = pct ? `${brl.format(sal)} (salário com dissídio de ${fmtN(pct)}%)` : brl.format(sal);
  return `${base} × ${alvo} = ${brl.format(sal * mult)} no ano · ${quando}`;
}

function tabelaSimulacaoHtml() {
  const { linhas, total, comHc } = linhasSimulacao();
  const totAno = total.reduce((a, b) => a + b, 0) || 1;
  const fil = filiaisComRascunho();
  const fils = filiaisDa(E.filtro.regional).filter(f => !E.filtro.filial || f === E.filtro.filial);
  const mesesDiss = new Set(fils.map(f => fil[f]?.dissidio_pct ? fil[f].dissidio_mes - 1 : null).filter(m => m != null && m > 0));
  if (!linhas.length) return '<div class="vazio"><span>🔍</span>Nada encontrado com esses filtros.</div>';
  const cel = v => `<td class="n${v ? '' : ' zero'}">${v ? fmtVal(v) : '–'}</td>`;
  return `<table class="tabela">
    <thead><tr><th class="fixa">${{ rubricas: 'Rubrica', filiais: 'Filial', cc: 'Centro de custo', colaboradores: 'Colaborador' }[E.sim.visao]}</th>${comHc ? '<th class="n">HC</th>' : ''}
      ${MESES.map((m, i) => `<th class="n"${mesesDiss.has(i) ? ' style="color:var(--laranja)" title="Mês do dissídio"' : ''}>${m}${mesesDiss.has(i) ? ' ▲' : ''}</th>`).join('')}<th class="n">Total ano</th><th class="n">%</th></tr></thead>
    <tbody>${(() => {
      let totColab = 1;
      return linhas.map(l => {
        const t = l.meses.reduce((a, b) => a + b, 0);
        if (l.colab != null) totColab = t || 1;
        if (l.det) {
          // Detalhe do colaborador: % é sobre o custo dele
          return `<tr class="det-${l.det}">
            <td class="fixa" title="${esc(l.rotulo)}">${l.det === 'grupo' ? `<i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${l.cor};margin-right:.4rem"></i>` : ''}${esc(l.rotulo)}${l.propria ? ' <span class="etiqueta azul">valor próprio</span>' : ''}${l.conta ? `<span class="sub conta">${esc(l.conta)}</span>` : ''}</td>
            ${l.meses.map(cel).join('')}<td class="n"><b>${fmtVal(t)}</b></td><td class="n">${pctFmt(t / totColab)}</td></tr>`;
        }
        const cls = l.grupo ? `grupo${E.sim.fechados.has(l.grupo) ? ' fechado' : ''}` : l.filho ? 'filho' : l.colab != null ? `colab${l.aberto ? ' aberto' : ''}${l.vaga ? ' vaga' : ''}` : l.vaga ? 'vaga' : '';
        return `<tr class="${cls}" ${l.grupo ? `data-grupo="${l.grupo}"` : ''}${l.colab != null ? ` data-colab="${l.colab}" title="Clique para ${l.aberto ? 'fechar' : 'ver'} o detalhe"` : ''}>
          <td class="fixa" title="${esc(l.rotulo)}">${l.grupo ? `<i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${l.cor};margin-right:.4rem"></i>` : ''}${esc(l.rotulo)}${l.vaga ? ' <span class="etiqueta pend">vaga</span>' : ''}${l.proprias ? ' <span class="etiqueta azul">condições próprias</span>' : ''}${l.sub ? `<span class="sub">${esc(l.sub)}</span>` : ''}</td>
          ${comHc ? `<td class="n">${l.hc ?? ''}</td>` : ''}${l.meses.map(cel).join('')}<td class="n"><b>${fmtVal(t)}</b></td><td class="n">${pctFmt(t / totAno)}</td></tr>`;
      }).join('');
    })()}</tbody>
    <tfoot><tr class="total"><td class="fixa">Total</td>${comHc ? `<td class="n">${linhas.reduce((s, l) => s + (l.hc || 0), 0) || ''}</td>` : ''}${total.map(v => `<td class="n">${fmtVal(v)}</td>`).join('')}<td class="n">${fmtVal(totAno)}</td><td class="n">100%</td></tr></tfoot>
  </table>`;
}

function simuladorHtml() {
  const fils = filiaisDa(E.filtro.regional).filter(f => !E.filtro.filial || f === E.filtro.filial);
  const fil = filiaisComRascunho();
  const dif = totalDe(E.res).total - totalDe(E.resSalvo).total;
  const n = Object.keys(E.rascunho).length;
  return `
    <h3>Simulador de dissídio</h3>
    <p>Altere o % e o mês da data-base de cada filial e veja o custo mudar na hora. Nada é salvo até você aplicar.</p>
    <div class="sim-todas">Todas: <input class="campo" id="sim-todas-pct" type="number" step="0.01" placeholder="%"> <select class="campo" id="sim-todas-mes" style="width:84px">${opcoesMes(5)}</select><button class="btn btn-claro btn-sm" id="sim-todas">Aplicar</button></div>
    <div class="sim-cab"><span>Filial</span><span>Dissídio %</span><span>A partir de</span></div>
    <div class="sim-lista">${fils.map(f => `
      <div class="sim-filial${E.rascunho[f] ? ' alterada' : ''}" data-filial="${esc(f)}">
        <span title="${esc(f)}">${esc(f)}<small>salvo: ${num2.format(E.dados.filiais[f].dissidio_pct)}% · ${MESES[E.dados.filiais[f].dissidio_mes - 1]}</small></span>
        <input class="campo" type="number" step="0.01" data-campo="dissidio_pct" value="${fil[f].dissidio_pct}" aria-label="Dissídio ${esc(f)}">
        <select class="campo" data-campo="dissidio_mes" aria-label="Mês do dissídio ${esc(f)}">${opcoesMes(fil[f].dissidio_mes)}</select>
      </div>`).join('')}</div>
    <div class="sim-impacto${n ? '' : ' neutro'}" id="sim-impacto">${n ? `Impacto da simulação no ano<strong>${dif >= 0 ? '+' : ''}${brl0.format(dif)}</strong>${n} filial(is) alterada(s)` : 'Sem alterações<strong>Orçamento salvo</strong>'}</div>
    <div class="sim-acoes"><button class="btn btn-claro btn-sm" data-descartar ${n ? '' : 'disabled'}>Descartar</button><button class="btn btn-laranja btn-sm" data-aplicar ${n ? '' : 'disabled'}>Aplicar ao orçamento</button></div>`;
}

function renderSimulacao() {
  const el = painel('simulacao');
  const admin = E.eu.admin;
  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Simulação <em>mês a mês</em></h1>
      <p class="subtitulo">Custo de pessoal por mês com as premissas de cada filial. ${admin ? 'Use o simulador ao lado para testar o dissídio.' : ''}</p></div></div>
    <div id="sim-faixa">${faixaRascunho()}</div>
    <div class="sim-grade${admin ? '' : ' sem-painel'}">
      <div>
        <div class="ferramentas">
          <div class="segmentos" id="sim-visao">${[['rubricas', 'Rubricas'], ['filiais', 'Filiais'], ['cc', 'Centros de custo'], ['colaboradores', 'Colaboradores']].map(([v, r]) => `<button data-v="${v}" class="${E.sim.visao === v ? 'ativo' : ''}">${r}</button>`).join('')}</div>
          ${E.sim.visao !== 'rubricas' ? `<input class="campo" id="sim-busca" placeholder="${E.sim.visao === 'colaboradores' ? 'Buscar nome, matrícula, função…' : 'Buscar…'}" value="${esc(E.sim.busca)}">` : ''}
          ${E.sim.visao === 'colaboradores' ? `<button class="btn btn-claro btn-sm" id="sim-abrir-todos">${E.sim.abertos.size ? 'Fechar detalhes' : 'Abrir detalhe de todos'}</button>` : ''}
          <div class="direita">
            <div class="segmentos" id="sim-unid"><button data-u="0" class="${E.sim.mil ? '' : 'ativo'}">R$</button><button data-u="1" class="${E.sim.mil ? 'ativo' : ''}">R$ mil</button></div>
            <button class="btn btn-marinho btn-sm" id="sim-excel">⬇ Exportar Excel</button>
          </div>
        </div>
        <div class="tabela-wrap alta" id="sim-tabela">${tabelaSimulacaoHtml()}</div>
      </div>
      ${admin ? `<aside class="cartao simulador" id="simulador">${simuladorHtml()}</aside>` : ''}
    </div>`;
  ligarFaixa($('#sim-faixa', el));
  $$('#sim-visao button', el).forEach(b => b.addEventListener('click', () => { E.sim.visao = b.dataset.v; renderSimulacao(); }));
  $$('#sim-unid button', el).forEach(b => b.addEventListener('click', () => { E.sim.mil = b.dataset.u === '1'; renderSimulacao(); }));
  $('#sim-excel', el).addEventListener('click', exportarExcel);
  const busca = $('#sim-busca', el);
  if (busca) busca.addEventListener('input', () => { E.sim.busca = busca.value; atualizarTabelaSim(); });
  $('#sim-abrir-todos', el)?.addEventListener('click', () => {
    if (E.sim.abertos.size) E.sim.abertos.clear();
    else {
      const busca = E.sim.busca.toLowerCase();
      const lista = E.dados.colaboradores.filter(c => noFiltro(c) && (!busca || `${c.nome} ${c.matricula} ${c.funcao} ${c.cc_nome}`.toLowerCase().includes(busca)));
      if (lista.length > 150) return toast(`São ${lista.length} colaboradores. Filtre por filial ou busque um nome para abrir o detalhe de todos (máx. 150).`, 'erro');
      lista.forEach(c => E.sim.abertos.add(c.id));
    }
    renderSimulacao();
  });
  ligarTabelaSim();
  if (admin) ligarSimulador();
}

function ligarTabelaSim() {
  $$('#sim-tabela tr.colab').forEach(tr => tr.addEventListener('click', () => {
    const id = Number(tr.dataset.colab);
    E.sim.abertos.has(id) ? E.sim.abertos.delete(id) : E.sim.abertos.add(id);
    atualizarTabelaSim();
  }));
  $$('#sim-tabela tr.grupo').forEach(tr => tr.addEventListener('click', () => {
    const g = tr.dataset.grupo;
    E.sim.fechados.has(g) ? E.sim.fechados.delete(g) : E.sim.fechados.add(g);
    atualizarTabelaSim();
  }));
}

function atualizarTabelaSim() {
  $('#sim-tabela').innerHTML = tabelaSimulacaoHtml();
  ligarTabelaSim();
}

let _timerSim;
function ligarSimulador() {
  const box = $('#simulador');
  const atualizar = () => {
    clearTimeout(_timerSim);
    _timerSim = setTimeout(() => {
      recalcular();
      atualizarTabelaSim();
      const n = Object.keys(E.rascunho).length;
      const dif = totalDe(E.res).total - totalDe(E.resSalvo).total;
      const imp = $('#sim-impacto');
      imp.className = `sim-impacto${n ? '' : ' neutro'}`;
      imp.innerHTML = n ? `Impacto da simulação no ano<strong>${dif >= 0 ? '+' : ''}${brl0.format(dif)}</strong>${n} filial(is) alterada(s)` : 'Sem alterações<strong>Orçamento salvo</strong>';
      $$('.sim-acoes button', box).forEach(b => { b.disabled = !n; });
      $('#sim-faixa').innerHTML = faixaRascunho();
      ligarFaixa($('#sim-faixa'));
    }, 120);
  };
  const marcar = (f, campo, valor) => {
    const salvo = E.dados.filiais[f];
    const r = { dissidio_pct: salvo.dissidio_pct, dissidio_mes: salvo.dissidio_mes, ...(E.rascunho[f] || {}), [campo]: Number(valor) || 0 };
    if (r.dissidio_pct === salvo.dissidio_pct && r.dissidio_mes === salvo.dissidio_mes) delete E.rascunho[f];
    else E.rascunho[f] = r;
    box.querySelector(`.sim-filial[data-filial="${CSS.escape(f)}"]`)?.classList.toggle('alterada', Boolean(E.rascunho[f]));
  };
  $$('.sim-filial', box).forEach(linha => {
    linha.querySelectorAll('[data-campo]').forEach(inp => inp.addEventListener('input', () => { marcar(linha.dataset.filial, inp.dataset.campo, inp.value); atualizar(); }));
  });
  $('#sim-todas', box).addEventListener('click', () => {
    const pct = $('#sim-todas-pct', box).value;
    const mes = $('#sim-todas-mes', box).value;
    if (pct === '') return toast('Informe o % de dissídio.', 'erro');
    $$('.sim-filial', box).forEach(linha => {
      linha.querySelector('[data-campo="dissidio_pct"]').value = pct;
      linha.querySelector('[data-campo="dissidio_mes"]').value = mes;
      marcar(linha.dataset.filial, 'dissidio_pct', pct);
      marcar(linha.dataset.filial, 'dissidio_mes', mes);
    });
    atualizar();
  });
  box.querySelector('[data-descartar]').addEventListener('click', descartarRascunho);
  box.querySelector('[data-aplicar]').addEventListener('click', aplicarRascunho);
}

function exportarExcel() {
  if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo em instantes.', 'erro');
  const wb = XLSX.utils.book_new();
  const r2 = v => Math.round(v * 100) / 100;
  const ag = totalDe(E.res);

  const resumo = [['Grupo', 'Rubrica', ...MESES, 'Total ano']];
  RUBRICAS.forEach((r, i) => {
    const meses = [...ag.porRubrica.slice(i * 12, i * 12 + 12)].map(r2);
    resumo.push([NOME_GRUPO[r.grupo], r.nome, ...meses, r2(meses.reduce((a, b) => a + b, 0))]);
  });
  resumo.push(['', 'TOTAL', ...[...ag.meses].map(r2), r2(ag.total)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), 'Resumo mensal');

  const porChave = (chave, titulo) => {
    const linhas = [[titulo, 'HC máx.', ...MESES, 'Total ano']];
    for (const [k, a] of Motor.agregar(E.res, chave, noFiltro)) linhas.push([k, Math.max(...a.hc), ...[...a.meses].map(r2), r2(a.total)]);
    return XLSX.utils.aoa_to_sheet(linhas);
  };
  XLSX.utils.book_append_sheet(wb, porChave(c => `${c.regional} · ${c.filial}`, 'Regional · Filial'), 'Por filial');
  XLSX.utils.book_append_sheet(wb, porChave(c => `${c.filial} · ${c.cc_cod || ''} ${c.cc_nome || ''}`.trim(), 'Filial · Centro de custo'), 'Por centro de custo');

  // Formato próximo da planilha BZO: uma linha por colaborador, com o total anual de cada rubrica.
  const fil = filiaisComRascunho();
  const cab = ['Matrícula', 'Funcionário', 'Regional', 'Filial', 'Situação', 'Função', 'Cargo', 'Cód. C. Custo', 'Centro de custo', 'Salário base', 'Dissídio %', 'Mês dissídio', 'Mês início', 'Mês fim', ...RUBRICAS.map(r => `${r.nome} (ano)`), 'Total ano'];
  const linhas = [cab];
  E.res.colaboradores.forEach((c, i) => {
    if (!noFiltro(c)) return;
    const vals = RUBRICAS.map((_, r) => { let s = 0; for (let m = 0; m < 12; m++) s += E.res.valor(i, r, m); return r2(s); });
    linhas.push([c.matricula, c.nome, c.regional, c.filial, c.situacao, c.funcao, c.cargo, c.cc_cod, c.cc_nome, c.salario,
      fil[c.filial]?.dissidio_pct ?? 0, fil[c.filial]?.dissidio_mes ?? '', c.mes_inicio, c.mes_fim, ...vals, r2(vals.reduce((a, b) => a + b, 0))]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), 'Por colaborador');

  const nome = [E.dados.config.ano, E.filtro.regional, E.filtro.filial].filter(Boolean).join('-').replace(/[^\w-]+/g, '_');
  XLSX.writeFile(wb, `Orcamento-Pessoal-${nome}.xlsx`);
}

// ---------- Premissas ----------

const premEscopoRegional = escopo => (escopo.startsWith('R:') ? escopo.slice(2) : E.dados.filiais[escopo]?.regional);

/** Premissa herdada (o que vale se o escopo atual não tiver regra própria). */
function premHerdada(escopo, rub) {
  const P = E.dados.premissas;
  const padrao = RUBRICAS[IDX[rub]].padrao;
  if (escopo === '*') return { p: { ...padrao }, origem: 'padrão do sistema' };
  if (escopo.startsWith('R:')) return P['*']?.[rub] ? { p: { ...padrao, ...P['*'][rub] }, origem: 'regra geral' } : { p: { ...padrao }, origem: 'padrão do sistema' };
  const reg = premEscopoRegional(escopo);
  if (P['R:' + reg]?.[rub]) return { p: { ...padrao, ...P['R:' + reg][rub] }, origem: `regional ${reg}` };
  if (P['*']?.[rub]) return { p: { ...padrao, ...P['*'][rub] }, origem: 'regra geral' };
  return { p: { ...padrao }, origem: 'padrão do sistema' };
}

function premEfetiva(escopo, rub) {
  const ed = E.prem.edits;
  if (rub in ed) return ed[rub] ? { p: ed[rub], propria: true } : { ...premHerdada(escopo, rub), propria: false };
  const propria = E.dados.premissas[escopo]?.[rub];
  if (propria) return { p: { ...RUBRICAS[IDX[rub]].padrao, ...propria }, propria: true };
  return { ...premHerdada(escopo, rub), propria: false };
}

function colabsDoEscopo(escopo) {
  if (escopo === '*') return () => true;
  if (escopo.startsWith('R:')) return c => c.regional === escopo.slice(2);
  return c => c.filial === escopo;
}

/** Recalcula só com as edições pendentes aplicadas, para mostrar o custo de cada rubrica antes de salvar. */
function calcularPrevia() {
  const escopo = E.prem.escopo;
  const premissas = JSON.parse(JSON.stringify(E.dados.premissas));
  premissas[escopo] ||= {};
  for (const [rub, p] of Object.entries(E.prem.edits)) {
    if (p) premissas[escopo][rub] = p;
    else delete premissas[escopo][rub];
  }
  const filiais = { ...E.dados.filiais };
  if (E.dados.filiais[escopo]) filiais[escopo] = { ...filiais[escopo], ...E.prem.filial };
  const filtro = colabsDoEscopo(escopo);
  const colaboradores = E.dados.colaboradores.filter(filtro);
  return Motor.calcular({ colaboradores, filiais, premissas, niveis: E.dados.niveis });
}

function renderPremissas() {
  const el = painel('premissas');
  const { escopo } = E.prem;
  const regs = regionais();
  const proprias = esc => Object.keys(E.dados.premissas[esc] || {}).length;
  const marca = esc => (proprias(esc) ? ' ●' : '');
  const regAtual = escopo === '*' ? '*' : premEscopoRegional(escopo);
  const filtrosHtml = `
    <div class="prem-filtros cartao">
      <label class="rotulo">Regional<select class="campo" id="prem-reg">
        <option value="*" ${regAtual === '*' ? 'selected' : ''}>★ Regra geral (todas as filiais)${marca('*')}</option>
        ${regs.map(r => `<option value="${esc(r)}" ${regAtual === r ? 'selected' : ''}>${esc(r)}${marca('R:' + r)}</option>`).join('')}
      </select></label>
      <label class="rotulo">Filial<select class="campo" id="prem-fil" ${regAtual === '*' ? 'disabled' : ''}>
        ${regAtual === '*' ? '<option>— escolha uma regional —</option>' : `<option value="R:${esc(regAtual)}" ${escopo === 'R:' + regAtual ? 'selected' : ''}>Toda a regional ${esc(regAtual)}${marca('R:' + regAtual)}</option>
        ${filiaisDa(regAtual).map(f => `<option value="${esc(f)}" ${escopo === f ? 'selected' : ''}>${esc(f)}${marca(f)}</option>`).join('')}`}
      </select></label>
      <p>● = tem regras próprias. A filial herda da regional, que herda da regra geral.</p>
    </div>`;

  const ehFilial = Boolean(E.dados.filiais[escopo]);
  const nomeEscopo = escopo === '*' ? 'Regra geral' : escopo.startsWith('R:') ? `Regional ${escopo.slice(2)}` : escopo;
  const colabs = E.dados.colaboradores.filter(colabsDoEscopo(escopo));
  const cfgF = ehFilial ? { ...E.dados.filiais[escopo], ...E.prem.filial } : null;

  const cabecalho = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Premissas e <em>regras</em></h1>
      <p class="subtitulo">Para cada filial, diga se ela <b>tem</b> o item (Sim/Não), <b>como é calculado</b> (% ou R$) e o <b>valor</b>. O que for igual para todas pode ficar na <b>regra geral</b> ou na <b>regional</b> — a filial herda e só muda o que for diferente.</p></div>
      <div class="segmentos" id="prem-visao"><button data-v="filial" class="${E.prem.visao === 'filial' ? 'ativo' : ''}">Editar por filial</button><button data-v="quadro" class="${E.prem.visao === 'quadro' ? 'ativo' : ''}">Quadro de todas as filiais</button></div></div>`;
  const ligarVisao = () => $$('#prem-visao button', el).forEach(b => b.addEventListener('click', () => {
    const pend = Object.keys(E.prem.edits).length + Object.keys(E.prem.filial).length;
    if (pend && !confirm('Há alterações não salvas nesta tela. Descartar?')) return;
    E.prem.edits = {}; E.prem.filial = {};
    E.prem.visao = b.dataset.v;
    renderPremissas();
  }));
  if (E.prem.visao === 'quadro') {
    el.innerHTML = `${cabecalho}<div id="prem-conteudo"></div>`;
    ligarVisao();
    renderQuadro();
    return;
  }

  el.innerHTML = `${cabecalho}
    ${filtrosHtml}
    <div>
      <div>
        <div class="prem-cab">
          <div><small>${escopo === '*' ? 'TODAS AS FILIAIS' : escopo.startsWith('R:') ? 'REGIONAL' : `FILIAL · ${esc(cfgF.regional)}`}</small>
            <h2>${esc(nomeEscopo)}</h2>
            <p>${colabs.length} colaborador(es) · custo anual <b id="prem-total"></b></p></div>
          ${escopo === '*' ? `<label class="rotulo" style="width:150px">Ano do orçamento<input class="campo" id="cfg-ano" type="number" value="${esc(E.dados.config.ano)}"></label>` : ''}
        </div>
        ${ehFilial ? `
        <div class="reajustes">
          <div class="reajuste"><h4>📈 Reajuste salarial (dissídio)</h4>
            <div class="linha-campos"><input class="campo" type="number" step="0.01" data-fcampo="dissidio_pct" value="${cfgF.dissidio_pct}"> % a partir de <select class="campo" data-fcampo="dissidio_mes">${opcoesMes(cfgF.dissidio_mes)}</select></div>
            <p>Os salários sobem neste mês; adicionais, provisões e encargos acompanham.</p></div>
          <div class="reajuste"><h4>🎁 Reajuste de benefícios</h4>
            <div class="linha-campos"><input class="campo" type="number" step="0.01" data-fcampo="reaj_benef_pct" value="${cfgF.reaj_benef_pct}"> % a partir de <select class="campo" data-fcampo="reaj_benef_mes">${opcoesMes(cfgF.reaj_benef_mes)}</select></div>
            <p>Aplicado aos benefícios em R$ (por colaborador ou total da filial).</p></div>
        </div>` : `
        <div class="reajuste" style="margin-bottom:1rem"><h4>📈 Dissídio em lote</h4>
          <div class="linha-campos">Aplicar <input class="campo" type="number" step="0.01" id="lote-pct" placeholder="%"> % a partir de <select class="campo" id="lote-mes">${opcoesMes(5)}</select> em todas as filiais ${escopo === '*' ? 'da empresa' : 'da regional'} <button class="btn btn-claro btn-sm" id="lote-aplicar">Aplicar</button></div>
          <p>Grava direto em cada filial. Depois é possível ajustar filial por filial.</p></div>`}
        <div class="tabela-wrap"><table class="tabela tabela-prem" id="tabela-prem"></table></div>
        <div class="prem-rodape">
          <span class="info" id="prem-info"></span>
          ${ehFilial ? '<button class="btn btn-claro btn-sm" id="prem-copiar">Copiar regras desta filial para…</button>' : ''}
          <button class="btn btn-claro btn-sm" id="prem-descartar">Descartar</button>
          <button class="btn btn-laranja btn-sm" id="prem-salvar">Salvar premissas</button>
        </div>
      </div>
    </div>`;

  ligarVisao();
  $('#prem-reg', el).addEventListener('change', e => trocarEscopo(e.target.value === '*' ? '*' : `R:${e.target.value}`));
  $('#prem-fil', el).addEventListener('change', e => trocarEscopo(e.target.value));
  $$('[data-fcampo]', el).forEach(i => i.addEventListener('input', () => { E.prem.filial[i.dataset.fcampo] = Number(i.value) || 0; atualizarPrevia(); }));
  $('#prem-salvar', el).addEventListener('click', salvarPremissas);
  $('#prem-descartar', el).addEventListener('click', () => { E.prem.edits = {}; E.prem.filial = {}; renderPremissas(); });
  $('#prem-copiar', el)?.addEventListener('click', copiarPremissas);
  $('#lote-aplicar', el)?.addEventListener('click', async () => {
    const pct = $('#lote-pct').value;
    if (pct === '') return toast('Informe o %.', 'erro');
    const alvo = escopo === '*' ? filiaisDa('') : filiaisDa(escopo.slice(2));
    if (!confirm(`Aplicar dissídio de ${pct}% a partir de ${MESES[$('#lote-mes').value - 1]} em ${alvo.length} filial(is)?`)) return;
    await api('/api/filiais', { method: 'PUT', body: { filiais: alvo.map(filial => ({ filial, dissidio_pct: pct, dissidio_mes: $('#lote-mes').value })) } });
    await carregar();
    toast('Dissídio aplicado.');
    renderPremissas();
  });
  $('#cfg-ano', el)?.addEventListener('change', async e => {
    try { await api('/api/config', { method: 'PUT', body: { ano: e.target.value } }); E.dados.config.ano = e.target.value; atualizarAno(); toast('Ano do orçamento atualizado.'); } catch (err) { toast(err.message, 'erro'); }
  });
  desenharTabelaPrem();
}

function trocarEscopo(escopo) {
  const pend = Object.keys(E.prem.edits).length + Object.keys(E.prem.filial).length;
  if (pend && !confirm('Há alterações não salvas nesta tela. Descartar e trocar?')) { renderPremissas(); return; }
  E.prem.escopo = escopo;
  E.prem.edits = {};
  E.prem.filial = {};
  renderPremissas();
  window.scrollTo(0, 0);
}

const TIPOS = { pct: '% sobre base', fixo: 'R$ por colaborador', rateio: 'Total da filial (média por colab.)', multiplo: 'Nº de salários', nivel: 'Nº de salários por nível do cargo' };
// "Por nível do cargo" é o método nº de salários com a tabela de níveis ligada.
const tipoDe = p => (p.metodo === 'multiplo' && p.por_nivel ? 'nivel' : p.metodo);
const fmtN = v => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

function unidadeValor(metodo, periodo) {
  if (metodo === 'rateio') return { anual_diluido: 'R$ total no ano', mensal: 'R$ total por mês', anual_mes: 'R$ no mês' }[periodo] || 'R$ total';
  if (metodo === 'fixo' && periodo === 'anual_mes') return 'R$ / colab. (1x)';
  if (metodo === 'fixo' && periodo === 'anual_diluido') return 'R$ / colab. no ano';
  return { pct: '%', fixo: 'R$ / colab. / mês', multiplo: 'salários' }[metodo] || '';
}

/** Tipo de cobrança usado quando a filial passa de "Não tem" para "Tem". */
function metodoAoLigar(rub, p) {
  if (p.ultimo_metodo && p.ultimo_metodo !== 'nao') return p.ultimo_metodo;
  const padrao = RUBRICAS[IDX[rub]].padrao.metodo;
  if (padrao !== 'nao') return padrao;
  return RUBRICAS[IDX[rub]].adicional ? 'pct' : 'fixo';
}

/** Resumo curto dos detalhes (base, periodicidade, rateio, teto). */
function resumoDetalhes(p) {
  if (p.metodo === 'pct') return `s/ ${BASES[p.base].toLowerCase()}${p.teto ? ` · teto ${brl0.format(p.teto)}` : ''}`;
  const per = { mensal: 'todo mês', anual_mes: `1x no ano · ${MESES[p.mes - 1]}`, anual_diluido: 'anual ÷ 12' }[p.periodo];
  if (p.metodo === 'rateio') return `${{ mensal: 'total do mês', anual_mes: `total em ${MESES[p.mes - 1]}`, anual_diluido: 'total do ano ÷ 12' }[p.periodo]} · ${p.rateio === 'salario' ? 'proporcional ao salário' : 'média por colaborador'}`;
  if (p.metodo === 'multiplo') return per;
  return per;
}

/** Valor curto para o quadro de filiais e para o Excel de premissas. */
function textoCurto(p) {
  switch (p.metodo) {
    case 'pct': return `${fmtN(p.valor)}%`;
    case 'fixo': return `R$ ${fmtN(p.valor)}`;
    case 'rateio': return `R$ ${fmtN(p.valor)} total${p.periodo === 'anual_diluido' ? '/ano' : p.periodo === 'mensal' ? '/mês' : ''}`;
    case 'multiplo': return p.por_nivel ? 'nível' : `${fmtN(p.valor)} sal`;
    default: return 'Não';
  }
}

function linhaPremHtml(rub, previa) {
  const { escopo } = E.prem;
  const { p, propria, origem } = premEfetiva(escopo, rub.id);
  const r = IDX[rub.id];
  let anual = 0;
  for (let i = 0; i < previa.n; i++) for (let m = 0; m < 12; m++) anual += previa.valor(i, r, m);
  const tem = p.metodo !== 'nao';
  const tipo = tem ? tipoDe(p) : metodoAoLigar(rub.id, p);
  const tipos = rub.adicional ? { pct: TIPOS.pct, fixo: TIPOS.fixo, rateio: TIPOS.rateio } : TIPOS;
  const nNiveis = Object.keys(p.niveis || {}).length;
  const valorHtml = tipo === 'nivel'
    ? `<button class="btn-detalhe btn-niveis" data-niveis title="Target de salários por nível do cargo">📋 Tabela por nível · ${nNiveis ? `${nNiveis} nível(is)` : 'preencher'}</button>`
    : `<span class="valor-un"><input class="campo" type="number" step="any" data-campo="valor" value="${p.valor ?? 0}"><small>${unidadeValor(tipo, p.periodo)}</small></span>`;
  const desab = tem ? '' : ' desab';
  return `<tr class="${propria ? 'propria' : 'herdada'}${tem ? '' : ' nao-tem'}" data-rub="${rub.id}">
    <td class="rub fixa">${esc(rub.nome)}<small>${propria ? (escopo === '*' ? 'regra geral' : escopo.startsWith('R:') ? 'regra da regional' : 'regra desta filial') : `herdada · ${esc(origem)}`}</small></td>
    <td><label class="chave" title="A filial tem este item?"><input type="checkbox" data-tem ${tem ? 'checked' : ''}><span></span><b>${tem ? 'Sim' : 'Não'}</b></label></td>
    <td class="${desab}"><select class="campo" data-campo="metodo">${Object.entries(tipos).map(([k, v]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
    <td class="${desab}">${valorHtml}</td>
    <td class="${desab}"><button class="btn-detalhe" data-detalhes title="Base, periodicidade, rateio e teto">⚙ ${esc(resumoDetalhes({ ...p, metodo: tipo }))}</button></td>
    <td class="${desab}"><button class="btn-detalhe" data-quem title="Quem recebe esta rubrica">👥 ${p.quem?.length ? `${p.quem.length} grupo(s)` : 'Todos'}</button></td>
    <td class="n" data-anual>${anual ? brl0.format(anual) : '–'}</td>
    <td><span class="acoes">${anual ? '<button class="btn-ic" data-ver title="Ver distribuição por centro de custo e colaborador">🔍</button>' : ''}${propria ? `<button class="btn-ic" data-reset title="${escopo === '*' ? 'Voltar ao padrão do sistema' : 'Remover regra própria (volta a herdar)'}">↺</button>` : ''}</span></td>
  </tr>`;
}

function desenharTabelaPrem() {
  const previa = calcularPrevia();
  const t = $('#tabela-prem');
  t.innerHTML = `<thead><tr><th class="fixa">Item</th><th>Tem?</th><th>Como é calculado</th><th>Valor</th><th>Detalhes</th><th>Quem recebe</th><th class="n">Custo anual</th><th></th></tr></thead>
    <tbody>${GRUPOS.map(g => `<tr class="grupo"><td class="fixa" colspan="8"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${g.cor};margin-right:.4rem"></i>${g.nome}</td></tr>
      ${RUBRICAS.filter(r => r.grupo === g.id && !r.fixa).map(r => linhaPremHtml(r, previa)).join('')}`).join('')}</tbody>`;
  $$('tr[data-rub]', t).forEach(tr => {
    const rub = tr.dataset.rub;
    const atual = () => ({ ...premEfetiva(E.prem.escopo, rub).p });
    tr.querySelector('[data-tem]').addEventListener('change', e => {
      const p = atual();
      E.prem.edits[rub] = e.target.checked
        ? { ...p, metodo: metodoAoLigar(rub, p) }
        : { ...p, metodo: 'nao', ultimo_metodo: p.metodo !== 'nao' ? p.metodo : p.ultimo_metodo };
      desenharTabelaPrem();
    });
    tr.querySelector('[data-campo="metodo"]').addEventListener('change', e => {
      const v = e.target.value;
      E.prem.edits[rub] = v === 'nivel' ? { ...atual(), metodo: 'multiplo', por_nivel: true } : { ...atual(), metodo: v, por_nivel: false };
      desenharTabelaPrem();
      if (v === 'nivel' && !Object.keys(E.prem.edits[rub].niveis || {}).length) editarNiveis(rub);
    });
    tr.querySelector('[data-niveis]')?.addEventListener('click', () => editarNiveis(rub));
    tr.querySelector('[data-campo="valor"]')?.addEventListener('input', e => {
      E.prem.edits[rub] = { ...atual(), valor: Number(e.target.value) || 0 };
      atualizarPrevia();
    });
    tr.querySelector('[data-detalhes]').addEventListener('click', () => editarDetalhes(rub));
    tr.querySelector('[data-quem]').addEventListener('click', () => escolherQuem(rub));
    tr.querySelector('[data-reset]')?.addEventListener('click', () => { E.prem.edits[rub] = null; desenharTabelaPrem(); });
    tr.querySelector('[data-ver]')?.addEventListener('click', () => verDistribuicao(rub));
  });
  atualizarRodapePrem(previa);
}

/** Detalhes da regra: base do %, teto, periodicidade, mês, forma de rateio e PPR por nível. */
function editarDetalhes(rub) {
  const p = { ...premEfetiva(E.prem.escopo, rub).p };
  const rubrica = RUBRICAS[IDX[rub]];
  const m = p.metodo === 'nao' ? metodoAoLigar(rub, p) : p.metodo;
  const sel = (nome, opcoes, valor) => `<select class="campo" name="${nome}">${Object.entries(opcoes).map(([k, v]) => `<option value="${k}" ${String(k) === String(valor) ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  const bases = rubrica.adicional ? { salario: BASES.salario } : BASES;
  const d = abrirModal({
    titulo: rubrica.nome, sup: `DETALHES · ${TIPOS[tipoDe({ ...p, metodo: m })].toUpperCase()}`,
    corpo: `<form class="form-grade" id="form-detalhes">
      ${m === 'pct' ? `
        <label class="rotulo">% calculado sobre${sel('base', bases, p.base)}<small>Remuneração = salário + adicionais. Folha = remuneração + horas extras.</small></label>
        <label class="rotulo">Teto mensal (R$) <small>opcional</small><input class="campo" name="teto" type="number" step="any" value="${p.teto ?? ''}" placeholder="sem teto"></label>`
      : `
        <label class="rotulo">Quando é pago${sel('periodo', PERIODOS, p.periodo)}<small>“Uma vez no ano” lança o valor inteiro no mês escolhido (ex.: cesta natalina em dezembro).</small></label>
        <label class="rotulo">Mês (se for uma vez no ano)<select class="campo" name="mes">${opcoesMes(p.mes)}</select></label>`}
      ${m === 'multiplo' ? `<label class="check inteiro"><input type="checkbox" name="sem_dissidio" ${p.sem_dissidio ? 'checked' : ''}> Ignorar o dissídio (usar o salário da base)</label>
        <p class="inteiro" style="margin:0;font-size:.8rem;color:var(--texto-suave)">Padrão: novo salário (com o dissídio da filial) × nº de salários. Ex.: R$ 13.780 com dissídio de 5% = R$ 14.469 × 2 = R$ 28.938 no ano, lançado inteiro no mês escolhido ou diluído em 12 meses.</p>` : ''}
      ${m === 'rateio' ? `<label class="rotulo inteiro">Como dividir o total entre os colaboradores${sel('rateio', { hc: 'Igual por pessoa (headcount)', salario: 'Proporcional ao salário' }, p.rateio)}</label>` : ''}
    </form>`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="ok-detalhes">Aplicar</button>',
  });
  $('#ok-detalhes', d).addEventListener('click', () => {
    const f = $('#form-detalhes', d);
    const novo = { ...p };
    if (f.base) novo.base = f.base.value;
    if (f.teto) novo.teto = f.teto.value === '' ? null : Number(f.teto.value);
    if (f.periodo) novo.periodo = f.periodo.value;
    if (f.mes) novo.mes = Number(f.mes.value);
    if (f.rateio) novo.rateio = f.rateio.value;
    if (f.sem_dissidio) novo.sem_dissidio = f.sem_dissidio.checked;
    E.prem.edits[rub] = novo;
    d.close();
    desenharTabelaPrem();
  });
}

/** Tabela de nº de salários (target) por nível do cargo, guardada na própria regra — ex.: Holding/matriz. */
function editarNiveis(rub) {
  const p = { ...premEfetiva(E.prem.escopo, rub).p };
  const colabs = E.dados.colaboradores.filter(colabsDoEscopo(E.prem.escopo));
  const tabela = { ...(p.niveis || {}) };
  const todos = () => [...new Set([...E.dados.colaboradores.map(c => c.cargo).filter(Boolean), ...Object.keys(tabela)])].sort();
  const nomeEscopo = E.prem.escopo === '*' ? 'Regra geral' : E.prem.escopo.startsWith('R:') ? `Regional ${E.prem.escopo.slice(2)}` : E.prem.escopo;
  const d = abrirModal({
    titulo: `${RUBRICAS[IDX[rub]].nome} por nível do cargo · ${nomeEscopo}`, sup: 'TARGET DE SALÁRIOS', largo: true,
    corpo: `
      <div class="niveis-grade">
        <div>
          <div class="tabela-wrap" style="max-height:52vh"><table class="tabela"><thead><tr><th>Nível do cargo</th><th class="n">Colaboradores aqui</th><th>Nº de salários</th></tr></thead><tbody id="niveis-corpo"></tbody></table></div>
          <label class="rotulo" style="margin-top:.8rem;max-width:340px">Níveis sem valor na tabela recebem<span class="valor-un"><input class="campo" type="number" step="any" id="niveis-padrao" value="${p.valor ?? 1}"><small>salário(s)</small></span></label>
        </div>
        <div class="niveis-colar">
          <h4>📋 Colar do Excel</h4>
          <p>Copie as duas colunas da sua planilha (<b>NÍVEL CARGO</b> e <b>TARGET</b>) e cole aqui. Pode incluir o cabeçalho.</p>
          <textarea class="campo" id="niveis-texto" rows="9" placeholder="07-Supervisores&#9;2&#10;09-Administrativo&#9;1&#10;06-Coordenação&#9;3&#10;05-Gerentes&#9;5"></textarea>
          <button type="button" class="btn btn-marinho btn-sm" id="niveis-aplicar-colado">Preencher a tabela</button>
          <small id="niveis-msg"></small>
        </div>
      </div>`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="ok-niveis">Aplicar</button>',
  });
  const desenhar = () => {
    $('#niveis-corpo', d).innerHTML = todos().map(n => `<tr><td>${esc(n)}</td><td class="n">${colabs.filter(c => c.cargo === n).length}</td>
      <td><input class="campo" style="width:90px;padding:.35rem .5rem" type="number" step="any" data-nivel="${esc(n)}" value="${tabela[n] ?? ''}" placeholder="${esc($('#niveis-padrao', d)?.value ?? '')}"></td></tr>`).join('')
      || '<tr><td colspan="3" class="vazio">Importe a base ou cole a tabela ao lado.</td></tr>';
    $$('[data-nivel]', d).forEach(i => i.addEventListener('input', () => { if (i.value === '') delete tabela[i.dataset.nivel]; else tabela[i.dataset.nivel] = Number(i.value); }));
  };
  desenhar();
  $('#niveis-padrao', d).addEventListener('input', () => $$('[data-nivel]', d).forEach(i => { i.placeholder = $('#niveis-padrao', d).value; }));
  $('#niveis-aplicar-colado', d).addEventListener('click', () => {
    const existentes = new Map(todos().map(n => [normCab(n), n]));
    let ok = 0;
    for (const linha of $('#niveis-texto', d).value.split(/\r?\n/)) {
      const m = linha.trim().match(/^(.+?)[\t;]+\s*([\d.,]+)\s*$/) || linha.trim().match(/^(.+?)\s+([\d.,]+)\s*$/);
      if (!m) continue;
      const nome = existentes.get(normCab(m[1])) || m[1].trim();
      tabela[nome] = Number(m[2].replace(',', '.')) || 0;
      ok++;
    }
    $('#niveis-msg', d).textContent = ok ? `✓ ${ok} nível(is) preenchido(s).` : 'Não reconheci nenhuma linha. Use “nível” e “target” separados por tabulação.';
    desenhar();
  });
  $('#ok-niveis', d).addEventListener('click', () => {
    E.prem.edits[rub] = { ...p, metodo: 'multiplo', por_nivel: true, niveis: { ...tabela }, valor: Number($('#niveis-padrao', d).value) || 0 };
    d.close();
    desenharTabelaPrem();
  });
}

// ----- Quadro de todas as filiais -----

function renderQuadro() {
  const el = $('#prem-conteudo');
  const fils = Object.values(E.dados.filiais).filter(f => !E.prem.quadroReg || f.regional === E.prem.quadroReg)
    .sort((a, b) => a.regional.localeCompare(b.regional) || a.filial.localeCompare(b.filial));
  const rubs = RUBRICAS.filter(r => !r.fixa);
  const efet = (f, r) => Motor.premissaDe(E.dados.premissas, f.filial, f.regional, r.id);
  const visiveis = E.prem.ocultarVazios ? rubs.filter(r => fils.some(f => efet(f, r).metodo !== 'nao')) : rubs;
  el.innerHTML = `
    <div class="ferramentas">
      <select class="campo" id="q-reg" aria-label="Regional"><option value="">Todas as regionais</option>${regionais().map(r => `<option ${r === E.prem.quadroReg ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" id="q-ocultar" ${E.prem.ocultarVazios ? 'checked' : ''}> Ocultar itens que nenhuma filial tem</label>
      <span class="legenda-quadro"><span class="propria">desta filial</span><span>herdado (regional/geral)</span><span class="nao">não tem</span></span>
      <span class="direita">
        <button class="btn btn-claro btn-sm" id="q-exportar">⬇ Exportar quadro (Excel)</button>
        <label class="btn btn-marinho btn-sm" style="cursor:pointer">⬆ Importar quadro<input type="file" id="q-importar" accept=".xlsx,.xls" hidden></label>
      </span>
    </div>
    ${fils.length ? `<div class="tabela-wrap alta"><table class="tabela quadro">
      <thead><tr><th class="fixa">Filial</th><th>Dissídio</th>${visiveis.map(r => `<th title="${esc(NOME_GRUPO[r.grupo])}" style="box-shadow:inset 0 3px 0 ${COR_GRUPO[r.grupo]}">${esc(r.nome)}</th>`).join('')}</tr></thead>
      <tbody>${fils.map((f, k) => `${k === 0 || fils[k - 1].regional !== f.regional ? `<tr class="grupo"><td class="fixa" colspan="${visiveis.length + 2}">${esc(f.regional)}</td></tr>` : ''}
        <tr><td class="fixa"><button class="btn-link" data-ir="${esc(f.filial)}">${esc(f.filial)}</button></td>
        <td>${fmtN(f.dissidio_pct)}% · ${MESES[f.dissidio_mes - 1]}</td>
        ${visiveis.map(r => {
          const p = efet(f, r);
          const propria = Boolean(E.dados.premissas[f.filial]?.[r.id]);
          return `<td class="${p.metodo === 'nao' ? 'nao' : ''}${propria ? ' propria' : ''}" data-ir="${esc(f.filial)}" title="${esc(r.nome)} · ${esc(f.filial)}${p.metodo !== 'nao' ? ` · ${esc(resumoDetalhes(p))}` : ''}">${p.metodo === 'nao' ? '—' : esc(textoCurto(p))}${p.quem?.length && p.metodo !== 'nao' ? ' 👥' : ''}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="cartao vazio"><span>📥</span>Importe a base de colaboradores para listar as filiais.</div>'}`;
  $('#q-reg', el).addEventListener('change', e => { E.prem.quadroReg = e.target.value; renderQuadro(); });
  $('#q-ocultar', el).addEventListener('change', e => { E.prem.ocultarVazios = e.target.checked; renderQuadro(); });
  $$('[data-ir]', el).forEach(c => c.addEventListener('click', () => { E.prem.visao = 'filial'; trocarEscopo(c.dataset.ir); }));
  $('#q-exportar', el).addEventListener('click', exportarQuadro);
  $('#q-importar', el).addEventListener('change', e => e.target.files[0] && importarQuadro(e.target.files[0]));
}

const COLS_FIXAS = ['REGIONAL', 'FILIAL', 'DISSÍDIO %', 'MÊS DISSÍDIO', 'REAJ. BENEFÍCIOS %', 'MÊS REAJ. BENEFÍCIOS'];

function exportarQuadro() {
  if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo.', 'erro');
  const rubs = RUBRICAS.filter(r => !r.fixa);
  const fils = Object.values(E.dados.filiais).sort((a, b) => a.regional.localeCompare(b.regional) || a.filial.localeCompare(b.filial));
  const linhas = [[...COLS_FIXAS, ...rubs.map(r => r.nome)]];
  for (const f of fils) {
    linhas.push([f.regional, f.filial, f.dissidio_pct, MESES[f.dissidio_mes - 1], f.reaj_benef_pct, MESES[f.reaj_benef_mes - 1],
      ...rubs.map(r => {
        const p = Motor.premissaDe(E.dados.premissas, f.filial, f.regional, r.id);
        return p.metodo === 'fixo' ? Number(p.valor) : textoCurto(p);
      })]);
  }
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws['!cols'] = linhas[0].map((_, i) => ({ wch: i < 2 ? 24 : 14 }));
  ws['!freeze'] = { xSplit: 2, ySplit: 1 };
  const ajuda = XLSX.utils.aoa_to_sheet([
    ['Como preencher o quadro de premissas'],
    [''],
    ['Uma linha por filial e uma coluna por item. Em cada célula escreva o que a filial tem:'],
    ['Exemplo na célula', 'Significa'],
    ['30%', 'Percentual (sobre o salário, ou a base definida na ferramenta)'],
    ['1480  ou  R$ 1480', 'Valor em R$ por colaborador'],
    ['96000 total/ano', 'Custo total do ano da filial; vira média mensal por colaborador (ex.: horas extras)'],
    ['8000 total/mês', 'Custo total por mês da filial, dividido entre os colaboradores'],
    ['2,4 sal', 'Número de salários (ex.: PPR)'],
    ['nível', 'PPR pela tabela de nível do cargo'],
    ['Não', 'A filial não tem este item'],
    ['(vazio)', 'Usa a regra da regional / regra geral'],
    [''],
    ['Periodicidade (todo mês, uma vez no ano, anual ÷ 12), base do %, teto, rateio e "quem recebe" continuam valendo como estão na ferramenta.'],
    ['Os meses podem ser escritos como número (5) ou nome (Mai).'],
  ]);
  ajuda['!cols'] = [{ wch: 22 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Premissas');
  XLSX.utils.book_append_sheet(wb, ajuda, 'Como preencher');
  XLSX.writeFile(wb, `Premissas-por-filial-${E.dados.config.ano}.xlsx`);
}

const chaveNome = s => normCab(s).replace(/[^A-Z0-9%]/g, '');
// Nomes das colunas nas planilhas antigas (BZO), para aceitar também esses cabeçalhos.
const APELIDOS = {
  va: ['VA/VR', 'VA', 'VR'], va_natal: ['VA NATAL (DEZEMBRO)', '13° VR', '13º VR'], vt: ['VT'], assist_medica: ['ASSIST. MÉDICA', 'ASSIST. MÉDICA (EMPRESA)'],
  assist_odonto: ['ASSIST. ODONTO', 'ASSIST. ODONTO (EMPRESA)'], aux_creche: ['AUXÍLIO CRECHÊ', 'AUXÍLIO CRECHE'], adic_turno: ['ADICIONAIS DE TURNO (INCLUSOS ADIC. INTRAJORNADA E PASSAGEM DE TURNO)'],
  decimo: ['13° SALÁRIO'], coparticipacao: ['COPARTICIPAÇÃO CONVÊNIO MÉDICO'], educacional: ['EDUCACIONAL'], farmacia: ['FARMACIA'],
};

function lerCelulaPremissa(v) {
  if (v == null || String(v).trim() === '') return null;
  if (typeof v === 'number') return v ? { metodo: 'fixo', valor: v } : { metodo: 'nao' };
  const t = String(v).trim().toLowerCase();
  if (/^(n|nao|não|-|—|0)$/.test(t)) return { metodo: 'nao' };
  if (/^(nivel|nível)/.test(t)) return { metodo: 'multiplo', por_nivel: true };
  const n = Number((t.match(/-?[\d.,]+/) || ['0'])[0].replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0;
  if (t.includes('%')) return { metodo: 'pct', valor: n };
  if (t.includes('sal')) return { metodo: 'multiplo', valor: n, por_nivel: false };
  if (t.includes('total') || t.includes('rateio')) {
    const periodo = /ano/.test(t) ? 'anual_diluido' : /m[eê]s/.test(t) ? 'mensal' : undefined;
    return periodo ? { metodo: 'rateio', valor: n, periodo } : { metodo: 'rateio', valor: n };
  }
  if (/^sim$/.test(t)) return { sim: true };
  return n ? { metodo: 'fixo', valor: n } : { metodo: 'nao' };
}

const mesDe = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (n >= 1 && n <= 12) return n;
  const i = MESES.findIndex(m => normCab(m) === normCab(v).slice(0, 3));
  return i >= 0 ? i + 1 : null;
};

const CAMPOS_REGRA = ['metodo', 'valor', 'base', 'periodo', 'mes', 'rateio', 'teto', 'por_nivel', 'quem'];
const mesmaRegra = (a, b) => CAMPOS_REGRA.every(k => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));

async function importarQuadro(arquivo) {
  if (!window.XLSX) return toast('Carregando o leitor de Excel… tente de novo.', 'erro');
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
  const aba = wb.SheetNames.find(n => normCab(n) === 'PREMISSAS') || wb.SheetNames[0];
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null });
  const h = linhas.findIndex(l => (l || []).some(c => normCab(c) === 'FILIAL'));
  if (h < 0) return toast('Não encontrei a coluna FILIAL na planilha.', 'erro');
  const cab = linhas[h].map(c => chaveNome(c));
  const col = nome => cab.indexOf(chaveNome(nome));
  const rubCol = {};
  for (const r of RUBRICAS.filter(x => !x.fixa)) {
    const i = [r.nome, ...(APELIDOS[r.id] || [])].map(col).find(x => x >= 0);
    if (i != null) rubCol[r.id] = i;
  }
  const iFil = col('FILIAL');
  const iReg = col('REGIONAL');
  const itens = [];
  const novas = [];
  let mudancas = 0;
  for (const l of linhas.slice(h + 1)) {
    const filial = String(l?.[iFil] ?? '').trim().toUpperCase();
    if (!filial) continue;
    const cfg = E.dados.filiais[filial];
    const regional = cfg?.regional || String(l[iReg] ?? '').trim().toUpperCase();
    if (!cfg) novas.push(filial);
    const rubricas = {};
    for (const [rub, i] of Object.entries(rubCol)) {
      const lido = lerCelulaPremissa(l[i]);
      const padrao = RUBRICAS[IDX[rub]].padrao;
      const propriaAtual = E.dados.premissas[filial]?.[rub];
      const herdada = premHerdadaDe(filial, regional, rub);
      if (!lido) { if (propriaAtual) { rubricas[rub] = null; mudancas++; } continue; }
      const efetiva = propriaAtual ? { ...padrao, ...propriaAtual } : herdada;
      let novo;
      if (lido.sim) novo = efetiva.metodo !== 'nao' ? efetiva : { ...efetiva, metodo: metodoAoLigar(rub, efetiva) };
      else if (lido.metodo === 'nao') novo = { ...efetiva, metodo: 'nao', ultimo_metodo: efetiva.metodo !== 'nao' ? efetiva.metodo : efetiva.ultimo_metodo };
      else novo = { ...(efetiva.metodo === lido.metodo ? efetiva : herdada.metodo === lido.metodo ? herdada : padrao), ...lido };
      if (mesmaRegra(novo, herdada)) { if (propriaAtual) { rubricas[rub] = null; mudancas++; } }
      else if (!propriaAtual || !mesmaRegra(novo, { ...padrao, ...propriaAtual })) { rubricas[rub] = novo; mudancas++; }
    }
    const filialCfg = {};
    const val = nome => { const i = col(nome); return i >= 0 ? l[i] : null; };
    if (val('DISSÍDIO %') != null && val('DISSÍDIO %') !== '') filialCfg.dissidio_pct = Number(String(val('DISSÍDIO %')).replace('%', '').replace(',', '.')) || 0;
    if (mesDe(val('MÊS DISSÍDIO'))) filialCfg.dissidio_mes = mesDe(val('MÊS DISSÍDIO'));
    if (val('REAJ. BENEFÍCIOS %') != null && val('REAJ. BENEFÍCIOS %') !== '') filialCfg.reaj_benef_pct = Number(String(val('REAJ. BENEFÍCIOS %')).replace('%', '').replace(',', '.')) || 0;
    if (mesDe(val('MÊS REAJ. BENEFÍCIOS'))) filialCfg.reaj_benef_mes = mesDe(val('MÊS REAJ. BENEFÍCIOS'));
    itens.push({ escopo: filial, rubricas, filial: cfg && Object.keys(filialCfg).length ? filialCfg : null });
  }
  const faltando = RUBRICAS.filter(r => !r.fixa && !(r.id in rubCol)).map(r => r.nome);
  const d = abrirModal({
    titulo: arquivo.name, sup: 'IMPORTAR QUADRO DE PREMISSAS',
    corpo: `<p style="margin:0"><b>${itens.length}</b> filial(is) na planilha · <b>${mudancas}</b> regra(s) a alterar · <b>${Object.keys(rubCol).length}</b> itens reconhecidos.</p>
      ${novas.length ? `<p style="margin:0;color:#b54d12">⚠ ${novas.length} filial(is) ainda não estão na base de colaboradores: ${esc(novas.join(', '))}. As regras ficam guardadas e passam a valer quando a base for importada (o dissídio delas é ignorado).</p>` : ''}
      ${faltando.length ? `<p style="margin:0;color:var(--texto-suave)">Colunas não encontradas (continuam como estão): ${esc(faltando.join(', '))}.</p>` : ''}
      <p style="margin:0;color:var(--texto-suave)">Valores iguais à regra da regional/geral ficam como herdados, sem criar exceção na filial.</p>`,
    rodape: `<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="ok-quadro" ${itens.length ? '' : 'disabled'}>Importar</button>`,
  });
  $('#ok-quadro', d).addEventListener('click', async () => {
    try {
      await api('/api/premissas/lote', { method: 'PUT', body: { itens } });
      d.close();
      await carregar();
      renderPremissas();
      toast(`Quadro importado: ${mudancas} regra(s) alterada(s).`);
    } catch (e) { toast(e.message, 'erro'); }
  });
}

/** Regra herdada por uma filial (regional → geral → padrão), sem olhar a regra própria dela. */
function premHerdadaDe(filial, regional, rub) {
  const P = E.dados.premissas;
  const padrao = RUBRICAS[IDX[rub]].padrao;
  return { ...padrao, ...(P['R:' + regional]?.[rub] || P['*']?.[rub] || {}) };
}

let _timerPrev;
function atualizarPrevia() {
  clearTimeout(_timerPrev);
  _timerPrev = setTimeout(() => {
    const previa = calcularPrevia();
    $$('#tabela-prem tr[data-rub]').forEach(tr => {
      const r = IDX[tr.dataset.rub];
      let anual = 0;
      for (let i = 0; i < previa.n; i++) for (let m = 0; m < 12; m++) anual += previa.valor(i, r, m);
      tr.querySelector('[data-anual]').textContent = anual ? brl0.format(anual) : '–';
      tr.classList.add('propria');
      if (!(tr.dataset.rub in E.prem.edits) && !E.dados.premissas[E.prem.escopo]?.[tr.dataset.rub]) tr.classList.remove('propria');
    });
    atualizarRodapePrem(previa);
  }, 150);
}

function atualizarRodapePrem(previa) {
  let total = 0;
  for (let k = 0; k < previa.valores.length; k++) total += previa.valores[k];
  $('#prem-total').textContent = brl0.format(total);
  const salvo = totalDe(E.resSalvo, colabsDoEscopo(E.prem.escopo)).total;
  const pend = Object.keys(E.prem.edits).length + Object.keys(E.prem.filial).length;
  const dif = total - salvo;
  $('#prem-info').innerHTML = pend ? `<b>${pend}</b> alteração(ões) não salva(s) · impacto <b style="color:${dif > 0 ? '#b54d12' : '#177a44'}">${dif >= 0 ? '+' : ''}${brl0.format(dif)}</b> no ano` : 'Tudo salvo';
}

/** Filtro "quem recebe": marca centros de custo e/ou níveis de cargo do escopo atual. */
function escolherQuem(rub) {
  const atual = { ...premEfetiva(E.prem.escopo, rub).p };
  const marcados = new Set(atual.quem || []);
  const colabs = E.dados.colaboradores.filter(colabsDoEscopo(E.prem.escopo));
  const contar = (campo, v) => colabs.filter(c => (c[campo] || '') === v).length;
  const ccs = [...new Map(colabs.map(c => [c.cc_cod || '', c.cc_nome || ''])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const cargos = [...new Set(colabs.map(c => c.cargo || ''))].sort();
  // Também mantém marcações que não aparecem neste escopo (vindas de outra filial), para não perdê-las ao salvar.
  const lista = (titulo, itens) => `<div><b style="color:var(--marinho)">${titulo}</b><div style="display:grid;gap:.3rem;margin-top:.5rem;max-height:260px;overflow-y:auto">${itens}</div></div>`;
  const d = abrirModal({
    titulo: `Quem recebe: ${RUBRICAS[IDX[rub]].nome}`, sup: 'PREMISSA', largo: true,
    corpo: `<p class="subtitulo" style="margin:0">Sem nada marcado, a rubrica vale para <b>todos</b>. Marcando centros de custo e/ou níveis de cargo, vale só para quem estiver em algum deles — inclusive no rateio do total da filial (ex.: horas extras só para Operação e Manutenção).</p>
      <div class="grade-2-igual" style="margin-top:0">
        ${lista('Centros de custo', ccs.map(([cod, nome]) => `<label class="check"><input type="checkbox" value="cc:${esc(cod)}" ${marcados.has('cc:' + cod) ? 'checked' : ''}> ${esc(cod)} · ${esc(nome || 'Sem nome')} <small class="sub" style="display:inline">(${contar('cc_cod', cod)})</small></label>`).join(''))}
        ${lista('Níveis de cargo', cargos.map(c => `<label class="check"><input type="checkbox" value="cargo:${esc(c)}" ${marcados.has('cargo:' + c) ? 'checked' : ''}> ${esc(c || 'Sem nível')} <small class="sub" style="display:inline">(${contar('cargo', c)})</small></label>`).join(''))}
      </div>`,
    rodape: '<button class="btn btn-claro" id="quem-todos">Todos recebem</button><button class="btn btn-laranja" id="quem-ok">Aplicar</button>',
  });
  const aplicar = quem => { E.prem.edits[rub] = { ...atual, quem }; d.close(); desenharTabelaPrem(); };
  $('#quem-todos', d).addEventListener('click', () => aplicar([]));
  $('#quem-ok', d).addEventListener('click', () => {
    const visiveis = new Set($$('input[type=checkbox]', d).map(i => i.value));
    const fora = [...marcados].filter(q => !visiveis.has(q));
    aplicar([...fora, ...$$('input:checked', d).map(i => i.value)]);
  });
}

function verDistribuicao(rub) {
  const previa = calcularPrevia();
  const r = IDX[rub];
  const porCC = new Map();
  const pessoas = [];
  for (let i = 0; i < previa.n; i++) {
    const c = previa.colaboradores[i];
    let anual = 0;
    let mesesAtivos = 0;
    for (let m = 0; m < 12; m++) { anual += previa.valor(i, r, m); if (m + 1 >= c.mes_inicio && m + 1 <= c.mes_fim) mesesAtivos++; }
    if (!anual) continue;
    const k = `${c.filial} · ${c.cc_cod || '—'} ${c.cc_nome || ''}`;
    const a = porCC.get(k) || { hc: 0, anual: 0 };
    a.hc++; a.anual += anual;
    porCC.set(k, a);
    pessoas.push({ c, anual, media: anual / (mesesAtivos || 1) });
  }
  pessoas.sort((a, b) => b.anual - a.anual);
  abrirModal({
    titulo: RUBRICAS[r].nome, sup: 'DISTRIBUIÇÃO DA RUBRICA', largo: true,
    corpo: `
      <h4>Por centro de custo</h4>
      <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Filial · Centro de custo</th><th class="n">HC</th><th class="n">Total ano</th><th class="n">Média / mês</th><th class="n">Média / colab. / mês</th></tr></thead>
      <tbody>${[...porCC].sort((a, b) => b[1].anual - a[1].anual).map(([k, a]) => `<tr><td>${esc(k)}</td><td class="n">${a.hc}</td><td class="n">${brl.format(a.anual)}</td><td class="n">${brl.format(a.anual / 12)}</td><td class="n">${brl.format(a.anual / 12 / a.hc)}</td></tr>`).join('')}</tbody></table></div>
      <h4>Por colaborador</h4>
      <div class="tabela-wrap" style="max-height:340px"><table class="tabela"><thead><tr><th>Colaborador</th><th>Centro de custo</th><th class="n">Média / mês</th><th class="n">Total ano</th></tr></thead>
      <tbody>${pessoas.map(p => `<tr><td>${esc(p.c.nome)}<span class="sub">${esc(p.c.funcao || '')}</span></td><td>${esc(p.c.cc_nome || '')}</td><td class="n">${brl.format(p.media)}</td><td class="n">${brl.format(p.anual)}</td></tr>`).join('')}</tbody></table></div>`,
  });
}

async function salvarPremissas() {
  const { escopo, edits, filial } = E.prem;
  try {
    if (Object.keys(edits).length) await api('/api/premissas', { method: 'PUT', body: { escopo, rubricas: edits } });
    if (Object.keys(filial).length) await api('/api/filiais', { method: 'PUT', body: { filiais: [{ filial: escopo, ...filial }] } });
    E.prem.edits = {};
    E.prem.filial = {};
    await carregar();
    renderPremissas();
    toast('Premissas salvas.');
  } catch (e) { toast(e.message, 'erro'); }
}

function copiarPremissas() {
  if (Object.keys(E.prem.edits).length) return toast('Salve as alterações antes de copiar.', 'erro');
  const de = E.prem.escopo;
  const d = abrirModal({
    titulo: `Copiar regras de ${de}`, sup: 'PREMISSAS',
    corpo: `<p class="subtitulo" style="margin:0">As regras próprias de <b>${esc(de)}</b> substituirão as regras próprias das filiais marcadas. O dissídio não é copiado.</p>
      ${regionais().map(r => `<div><b style="color:var(--marinho)">${esc(r)}</b><div class="regionais-check" style="margin-top:.4rem">${filiaisDa(r).filter(f => f !== de).map(f => `<label class="check"><input type="checkbox" value="${esc(f)}"> ${esc(f)}</label>`).join('')}</div></div>`).join('')}`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="confirmar-copia">Copiar</button>',
  });
  $('#confirmar-copia', d).addEventListener('click', async () => {
    const para = $$('input:checked', d).map(i => i.value);
    if (!para.length) return toast('Marque ao menos uma filial.', 'erro');
    await api('/api/premissas/copiar', { method: 'POST', body: { de, para } });
    d.close();
    await carregar();
    renderPremissas();
    toast(`Regras copiadas para ${para.length} filial(is).`);
  });
}

// ---------- Base de colaboradores ----------

const ALIASES = {
  matricula: ['CHAPA', 'MATRICULA', 'MATRICULA/CHAPA'],
  nome: ['FUNCIONARIO', 'NOME', 'COLABORADOR'],
  regional: ['REGIONAL'],
  filial: ['FILIAL'],
  situacao: ['DSITUACAO', 'SITUACAO'],
  funcao: ['FUNCAO'],
  cargo: ['CARGO', 'GP. FUNCAO', 'NIVEL CARGO', 'NIVEL DO CARGO'],
  cc_cod: ['CODCCUSTORED', 'COD. C. CUSTO', 'COD. CENTRO DE CUSTO', 'CODIGO CENTRO DE CUSTO'],
  cc_nome: ['NOMECCUSTO', 'DESCRICAO CENTRO DE CUSTO', 'DESCRICAO - CENTRO DE CUSTO', 'CENTRO DE CUSTO'],
  salario: ['SALARIO S/PROV DISSIDIO', 'SALARIO S/ PROV DISSIDIO', 'SALARIO BASE', 'SALARIO'],
  mes_inicio: ['MES INICIO', 'MES DE INICIO', 'MES ADMISSAO', 'MES DE ADMISSAO'],
  mes_fim: ['MES FIM', 'MES DESLIGAMENTO', 'MES DE DESLIGAMENTO'],
};
const ROTULO_CAMPO = { matricula: 'Matrícula', nome: 'Funcionário', regional: 'Regional', filial: 'Filial', situacao: 'Situação', funcao: 'Função', cargo: 'Cargo / nível', cc_cod: 'Cód. centro de custo', cc_nome: 'Centro de custo', salario: 'Salário', mes_inicio: 'Mês início', mes_fim: 'Mês fim' };
const normCab = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Lê as planilhas: acha a linha de cabeçalho (com FUNCIONÁRIO/NOME e SALÁRIO) e mapeia as colunas até o salário. */
function lerPlanilha(wb) {
  const nomes = [...wb.SheetNames].sort((a, b) => (normCab(b) === 'BZO') - (normCab(a) === 'BZO'));
  for (const nomeAba of nomes) {
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, raw: true, defval: null });
    for (let h = 0; h < Math.min(linhas.length, 60); h++) {
      const cab = (linhas[h] || []).map(normCab);
      const achar = campo => {
        for (const a of ALIASES[campo]) { const i = cab.indexOf(a); if (i >= 0) return i; }
        return -1;
      };
      const mapa = Object.fromEntries(Object.keys(ALIASES).map(k => [k, achar(k)]));
      if (mapa.nome < 0 || mapa.salario < 0 || mapa.filial < 0) continue;
      if (mapa.cc_nome === mapa.cc_cod) mapa.cc_nome = -1;
      const out = [];
      for (let i = h + 1; i < linhas.length; i++) {
        const l = linhas[i] || [];
        const v = k => (mapa[k] >= 0 ? l[mapa[k]] : null);
        if (!v('nome') || !v('filial')) continue;
        const situacao = String(v('situacao') ?? '').trim();
        out.push({
          matricula: v('matricula') != null ? String(v('matricula')).trim() : '',
          nome: String(v('nome')).trim(), regional: String(v('regional') ?? '').trim(), filial: String(v('filial')).trim(),
          situacao, funcao: v('funcao') ?? '', cargo: v('cargo') ?? '', cc_cod: v('cc_cod') != null ? String(v('cc_cod')).trim() : '', cc_nome: v('cc_nome') ?? '',
          salario: typeof v('salario') === 'number' ? v('salario') : Number(String(v('salario') ?? '0').replace(/\./g, '').replace(',', '.')) || 0,
          mes_inicio: v('mes_inicio') ?? 1, mes_fim: v('mes_fim') ?? 12,
          vaga: /vaga/i.test(situacao) || /vaga/i.test(String(v('nome'))),
        });
      }
      return { aba: nomeAba, mapa, linhas: out };
    }
  }
  return null;
}

function renderBase() {
  const el = painel('base');
  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Base de <em>colaboradores</em></h1>
      <p class="subtitulo">Suba só os dados cadastrais e o <b>salário</b> (sem dissídio) de cada colaborador. Periculosidade, horas extras, benefícios, encargos e provisões <b>não vêm da planilha</b>: a ferramenta calcula tudo pelas premissas de cada filial.</p></div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn btn-claro" id="nova-vaga">+ Nova vaga</button><button class="btn btn-claro" id="novo-colab">+ Colaborador</button></div></div>
    <section class="cartao importar">
      <h3>Importar base <small>· .xlsx ou .csv · pode ser uma planilha por regional ou todas juntas</small></h3>
      <div class="passos-modelo">
        <div><b>1</b><span>Baixe o modelo — são só <b>12 colunas</b>, até o salário.</span><button class="btn btn-marinho btn-sm" id="baixar-modelo">⬇ Baixar modelo (Excel)</button></div>
        <div><b>2</b><span>Cole os colaboradores (uma linha por pessoa). Vagas: situação “Nova Vaga” e o mês de admissão em <i>Mês início</i>.</span></div>
        <div><b>3</b><span>Suba o arquivo aqui embaixo e confira a prévia antes de importar.</span></div>
      </div>
      <label class="zona-arquivo" id="zona"><input type="file" id="arquivo" accept=".xlsx,.xls,.csv" multiple hidden>
        <strong>Clique ou arraste a planilha aqui</strong>Matrícula · Funcionário · Regional · Filial · Situação · Função · Cargo · Cód. C. Custo · Centro de custo · Salário · Mês início · Mês fim
        <br><small>Colunas a mais na planilha são ignoradas.</small></label>
      <div id="previa" class="previa"></div>
    </section>
    <section class="cartao" style="margin-top:1.2rem">
      <div class="ferramentas">
        <input class="campo" id="base-busca" placeholder="Buscar nome, matrícula, função…" value="${esc(E.base.busca)}" style="min-width:260px">
        <label class="check"><input type="checkbox" id="base-vagas" ${E.base.soVagas ? 'checked' : ''}> só vagas</label>
        <label class="check"><input type="checkbox" id="base-proprias" ${E.base.soProprias ? 'checked' : ''}> só com condições próprias</label>
        <span class="direita" id="base-resumo"></span>
      </div>
      <div class="tabela-wrap alta" id="base-tabela"></div>
    </section>`;
  const inp = $('#arquivo', el);
  const zona = $('#zona', el);
  inp.addEventListener('change', () => previaImportacao([...inp.files]));
  zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('sobre'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
  zona.addEventListener('drop', e => { e.preventDefault(); zona.classList.remove('sobre'); previaImportacao([...e.dataTransfer.files]); });
  $('#base-busca', el).addEventListener('input', e => { E.base.busca = e.target.value; desenharBase(); });
  $('#base-vagas', el).addEventListener('change', e => { E.base.soVagas = e.target.checked; desenharBase(); });
  $('#base-proprias', el).addEventListener('change', e => { E.base.soProprias = e.target.checked; desenharBase(); });
  $('#baixar-modelo', el).addEventListener('click', baixarModeloBase);
  $('#nova-vaga', el).addEventListener('click', () => editarColaborador(null, { vaga: true }));
  $('#novo-colab', el).addEventListener('click', () => editarColaborador(null, {}));
  desenharBase();
}

/** Aba opcional "Condições próprias": MATRÍCULA | ITEM | VALOR → exceções por colaborador (ex.: sucedidos). */
function aplicarCondicoesProprias(wb, lido) {
  const aba = wb.SheetNames.find(n => /^(CONDICOES|EXCECOES|SUCEDIDOS)/.test(normCab(n).replace(/[^A-Z]/g, '')));
  if (!aba) return;
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null });
  const h = linhas.findIndex(l => (l || []).some(c => normCab(c).startsWith('MATRICULA') || normCab(c) === 'CHAPA'));
  if (h < 0) return;
  const cab = linhas[h].map(normCab);
  const iMat = cab.findIndex(c => c.startsWith('MATRICULA') || c === 'CHAPA');
  const iItem = cab.findIndex(c => c === 'ITEM' || c === 'BENEFICIO' || c === 'RUBRICA');
  const iVal = cab.findIndex(c => c === 'VALOR');
  const porNome = new Map();
  RUBRICAS.filter(r => !r.fixa).forEach(r => [r.nome, ...(APELIDOS[r.id] || [])].forEach(n => porNome.set(chaveNome(n), r.id)));
  const porMat = new Map(lido.linhas.filter(l => l.matricula).map(l => [String(l.matricula), l]));
  lido.avisosCond = [];
  for (const l of linhas.slice(h + 1)) {
    if (!l || l[iMat] == null || l[iMat] === '') continue;
    const mat = String(l[iMat]).trim();
    const rub = porNome.get(chaveNome(l[iItem]));
    const colab = porMat.get(mat);
    if (!colab) { lido.avisosCond.push(`Condições próprias: matrícula ${mat} não está na aba de colaboradores.`); continue; }
    if (!rub) { lido.avisosCond.push(`Condições próprias: item “${l[iItem]}” não reconhecido (matrícula ${mat}).`); continue; }
    const v = lerCelulaPremissa(l[iVal]);
    if (!v || v.sim) continue;
    (colab.excecoes ||= {})[rub] = { metodo: v.metodo === 'rateio' ? 'fixo' : v.metodo, valor: v.valor || 0 };
  }
  lido.avisosCond = lido.avisosCond.slice(0, 8);
}

function baixarModeloBase() {
  if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo.', 'erro');
  const cab = ['MATRÍCULA', 'FUNCIONÁRIO', 'REGIONAL', 'FILIAL', 'SITUAÇÃO', 'FUNÇÃO', 'CARGO', 'CÓD. C. CUSTO', 'CENTRO DE CUSTO', 'SALÁRIO', 'MÊS INÍCIO', 'MÊS FIM'];
  const ws = XLSX.utils.aoa_to_sheet([
    cab,
    ['10001', 'NOME DO COLABORADOR', 'NORTE', 'APARECIDA', 'Ativo', 'Operador I', '15-Operação - Produção', '17150', 'OPERAÇÃO', 4175.6, 1, 12],
    ['', 'NOVA VAGA - OPERADOR I', 'NORTE', 'APARECIDA', 'Nova Vaga', 'Operador I', '15-Operação - Produção', '17150', 'OPERAÇÃO', 4000, 4, 12],
  ]);
  ws['!cols'] = [12, 34, 16, 22, 14, 28, 26, 14, 26, 12, 11, 10].map(wch => ({ wch }));
  const ajuda = XLSX.utils.aoa_to_sheet([
    ['Coluna', 'O que colocar'],
    ['MATRÍCULA', 'Chapa/matrícula (pode ficar vazia para vagas)'],
    ['FUNCIONÁRIO', 'Nome do colaborador ou descrição da vaga'],
    ['REGIONAL / FILIAL', 'Iguais em todas as linhas da mesma unidade (ex.: NORTE / APARECIDA)'],
    ['SITUAÇÃO', 'Ativo, Férias, Afastado… Use "Nova Vaga" para vagas previstas'],
    ['FUNÇÃO / CARGO', 'Cargo = nível do cargo (ex.: 07-Supervisores), usado no PPR por nível e no filtro "quem recebe"'],
    ['CÓD. C. CUSTO / CENTRO DE CUSTO', 'Código e nome do centro de custo'],
    ['SALÁRIO', 'Salário mensal atual, SEM o dissídio (o reajuste é aplicado pela ferramenta no mês da data-base)'],
    ['MÊS INÍCIO', 'Opcional. 1 a 12 — para vagas, o mês de admissão. Vazio = janeiro'],
    ['MÊS FIM', 'Opcional. 1 a 12 — desligamento previsto. Vazio = dezembro'],
    [''],
    ['Não inclua periculosidade, horas extras, benefícios, encargos ou provisões: eles são calculados pelas premissas de cada filial.'],
    [''],
    ['ABA "Condições próprias" (opcional)', 'Só para quem tem benefício diferente da regra da filial (ex.: sucedidos). Uma linha por colaborador e item:'],
    ['MATRÍCULA', 'A mesma da aba Base'],
    ['ITEM', 'Nome do item como aparece na ferramenta (ex.: VA / VR, Assistência médica, Farmácia, Vale-transporte, PPR)'],
    ['VALOR', '1850 = R$ por mês · 20% = percentual · 3 sal = nº de salários · Não = não recebe'],
  ]);
  ajuda['!cols'] = [{ wch: 34 }, { wch: 100 }];
  const cond = XLSX.utils.aoa_to_sheet([
    ['MATRÍCULA', 'ITEM', 'VALOR'],
    ['10001', 'VA / VR', 1850],
    ['10001', 'Farmácia', 300],
    ['10001', 'Vale-transporte', 'Não'],
  ]);
  cond['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Base');
  XLSX.utils.book_append_sheet(wb, cond, 'Condições próprias');
  XLSX.utils.book_append_sheet(wb, ajuda, 'Como preencher');
  XLSX.writeFile(wb, 'Modelo-base-orcamento.xlsx');
}

async function previaImportacao(arquivos) {
  const prev = $('#previa');
  if (!window.XLSX) return toast('Carregando leitor de Excel… tente de novo.', 'erro');
  prev.innerHTML = '<p>Lendo planilhas…</p>';
  const lidas = [];
  for (const arq of arquivos) {
    try {
      // CSV: lê como texto (UTF-8) e sem conversão automática, para não transformar "4175,60" em 417560.
      const wb = /\.csv$/i.test(arq.name)
        ? XLSX.read((await arq.text()).replace(/^\uFEFF/, ''), { type: 'string', raw: true })
        : XLSX.read(await arq.arrayBuffer(), { type: 'array' });
      const r = lerPlanilha(wb);
      if (r) aplicarCondicoesProprias(wb, r);
      lidas.push({ arquivo: arq.name, ...(r || { erro: true }) });
    } catch { lidas.push({ arquivo: arq.name, erro: true }); }
  }
  const linhas = lidas.flatMap(l => l.linhas || []);
  const semRegional = linhas.filter(l => !l.regional).length;
  const porReg = {};
  linhas.forEach(l => { (porReg[l.regional || '?'] ||= new Set()).add(l.filial); });
  const totalSal = linhas.reduce((s, l) => s + l.salario, 0);
  prev.innerHTML = `
    ${lidas.map(l => l.erro ? `<p>❌ <b>${esc(l.arquivo)}</b>: não encontrei uma linha de cabeçalho com Funcionário, Filial e Salário.</p>`
      : `<div><b>📄 ${esc(l.arquivo)}</b> · aba “${esc(l.aba)}” · ${l.linhas.length} linha(s)<div class="chips" style="margin-top:.35rem">${Object.entries(l.mapa).map(([k, i]) => `<span class="chip ${i >= 0 ? 'ok' : 'falta'}">${i >= 0 ? '✓' : '–'} ${ROTULO_CAMPO[k]}</span>`).join('')}</div></div>`).join('')}
    ${linhas.length ? `
      <div><b>${linhas.length}</b> colaboradores · <b>${linhas.filter(l => l.vaga).length}</b> vaga(s) · folha base de <b>${brl0.format(totalSal)}</b>/mês${linhas.some(l => l.excecoes) ? ` · <b>${linhas.filter(l => l.excecoes).length}</b> com condições próprias` : ''}</div>
      ${lidas.flatMap(l => l.avisosCond || []).map(a => `<p style="color:#b54d12;margin:0">⚠ ${esc(a)}</p>`).join('')}
      <div class="chips">${Object.entries(porReg).map(([r, f]) => `<span class="chip">${esc(r)} · ${f.size} filiais</span>`).join('')}</div>
      ${semRegional ? `<p style="color:#b54d12">⚠ ${semRegional} linha(s) sem regional — serão ignoradas.</p>` : ''}
      <div class="linha">
        <label class="check"><input type="radio" name="modo" value="substituir" checked> Substituir a base das regionais do arquivo</label>
        <label class="check"><input type="radio" name="modo" value="adicionar"> Adicionar à base atual</label>
        <button class="btn btn-laranja" id="confirmar-import" style="margin-left:auto">Importar ${linhas.length} linhas</button>
      </div>` : ''}`;
  $('#confirmar-import')?.addEventListener('click', async () => {
    const modo = $('input[name="modo"]:checked').value;
    try {
      const r = await api('/api/colaboradores/importar', { method: 'POST', body: { modo, linhas: linhas.filter(l => l.regional) } });
      await carregar();
      toast(`${r.importados} colaboradores importados (${r.regionais.join(', ')}).`);
      renderBase();
    } catch (e) { toast(e.message, 'erro'); }
  });
}

function desenharBase() {
  const busca = E.base.busca.toLowerCase();
  const idx = new Map(E.res.colaboradores.map((c, i) => [c.id, i]));
  const lista = E.dados.colaboradores.filter(c => noFiltro(c) && (!E.base.soVagas || c.vaga) && (!E.base.soProprias || temProprias(c)) &&
    (!busca || `${c.nome} ${c.matricula} ${c.funcao} ${c.cc_nome} ${c.cc_cod}`.toLowerCase().includes(busca)));
  const anual = c => { const i = idx.get(c.id); let s = 0; for (let k = 0; k < RN * 12; k++) s += E.res.valores[i * RN * 12 + k]; return s; };
  $('#base-resumo').innerHTML = `<span class="etiqueta azul">${lista.length} registro(s)</span><span class="etiqueta pend">${lista.filter(c => c.vaga).length} vaga(s)</span>`;
  $('#base-tabela').innerHTML = lista.length ? `<table class="tabela">
    <thead><tr><th class="fixa">Colaborador</th><th>Filial</th><th>Função / cargo</th><th>Centro de custo</th><th class="n">Salário</th><th>Período</th><th class="n">Custo anual</th><th></th></tr></thead>
    <tbody>${lista.slice(0, 1500).map(c => `<tr class="${c.vaga ? 'vaga' : ''}">
      <td class="fixa">${esc(c.nome)}${c.vaga ? ' <span class="etiqueta pend">vaga</span>' : ''}${etiquetaProprias(c)}<span class="sub">${esc(c.matricula || '')} · ${esc(c.situacao || '')}</span></td>
      <td>${esc(c.filial)}<span class="sub">${esc(c.regional)}</span></td>
      <td>${esc(c.funcao || '')}<span class="sub">${esc(c.cargo || '')}</span></td>
      <td>${esc(c.cc_cod || '')}<span class="sub">${esc(c.cc_nome || '')}</span></td>
      <td class="n">${brl.format(c.salario)}</td>
      <td>${c.mes_inicio === 1 && c.mes_fim === 12 ? 'Ano todo' : `${MESES[c.mes_inicio - 1]} – ${MESES[c.mes_fim - 1]}`}</td>
      <td class="n">${brl0.format(anual(c))}</td>
      <td><span class="acoes"><button class="btn-ic" data-editar="${c.id}" title="Editar">✎</button><button class="btn-ic" data-remover="${c.id}" title="Remover">🗑</button></span></td>
    </tr>`).join('')}</tbody></table>` : '<div class="vazio"><span>👥</span>Nenhum colaborador com esses filtros.</div>';
  $$('[data-editar]').forEach(b => b.addEventListener('click', () => editarColaborador(Number(b.dataset.editar))));
  $$('[data-remover]').forEach(b => b.addEventListener('click', async () => {
    const c = E.dados.colaboradores.find(x => x.id === Number(b.dataset.remover));
    if (!confirm(`Remover ${c.nome} da base do orçamento?`)) return;
    await api(`/api/colaboradores/${c.id}`, { method: 'DELETE' });
    await carregar();
    desenharBase();
    toast('Removido.');
  }));
}

function editarColaborador(id, padrao = {}) {
  const c = id ? E.dados.colaboradores.find(x => x.id === id) : { regional: E.filtro.regional, filial: E.filtro.filial, mes_inicio: 1, mes_fim: 12, salario: 0, ...padrao };
  if (!c) return toast('Colaborador não encontrado (pode ter sido removido).', 'erro');
  const campo = (k, rot, tipo = 'text', extra = '') => `<label class="rotulo">${rot}<input class="campo" name="${k}" type="${tipo}" value="${esc(c[k] ?? '')}" ${extra}></label>`;
  const dl = (idL, valores) => `<datalist id="${idL}">${[...new Set(valores.filter(Boolean))].sort().map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
  const d = abrirModal({
    titulo: id ? c.nome : c.vaga ? 'Nova vaga' : 'Novo colaborador', sup: c.vaga ? 'VAGA PREVISTA' : 'COLABORADOR',
    corpo: `<form class="form-grade" id="form-colab">
      ${campo('nome', c.vaga ? 'Descrição da vaga' : 'Nome', 'text', 'required')}
      ${campo('matricula', 'Matrícula')}
      <label class="rotulo">Regional<input class="campo" name="regional" list="dl-reg" value="${esc(c.regional || '')}" required></label>
      <label class="rotulo">Filial<input class="campo" name="filial" list="dl-fil" value="${esc(c.filial || '')}" required></label>
      ${campo('funcao', 'Função')}
      <label class="rotulo">Cargo / nível<input class="campo" name="cargo" list="dl-cargo" value="${esc(c.cargo || '')}"></label>
      ${campo('cc_cod', 'Cód. centro de custo')}
      ${campo('cc_nome', 'Centro de custo')}
      ${campo('salario', 'Salário (sem dissídio)', 'number', 'step="0.01" min="0" required')}
      ${campo('situacao', 'Situação')}
      <label class="rotulo">${c.vaga ? 'Mês de admissão' : 'Mês de início'}<select class="campo" name="mes_inicio">${opcoesMes(c.mes_inicio)}</select></label>
      <label class="rotulo">Mês de saída <small>(desligamento previsto)</small><select class="campo" name="mes_fim">${opcoesMes(c.mes_fim)}</select></label>
      <label class="check inteiro"><input type="checkbox" name="vaga" ${c.vaga ? 'checked' : ''}> É uma vaga prevista (ainda não preenchida)</label>
      <div class="inteiro proprias">
        <h4>Condições próprias deste colaborador <small>· ex.: sucedidos com benefício diferente da regra da filial</small></h4>
        <div id="lista-proprias"></div>
        <button type="button" class="btn btn-claro btn-sm" id="add-propria">+ Adicionar item com valor próprio</button>
      </div>
      ${dl('dl-reg', regionais())}${dl('dl-fil', filiaisDa(''))}${dl('dl-cargo', E.dados.colaboradores.map(x => x.cargo))}
    </form>`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="salvar-colab">Salvar</button>',
  });
  montarProprias(d, c);
  $('#salvar-colab', d).addEventListener('click', async () => {
    const f = $('#form-colab', d);
    if (!f.reportValidity()) return;
    const body = Object.fromEntries(new FormData(f));
    body.vaga = f.vaga.checked;
    body.excecoes = lerProprias(d);
    if (body.excecoes === null) return;
    if (Number(body.mes_fim) < Number(body.mes_inicio)) return toast('O mês de saída deve ser depois do início.', 'erro');
    try {
      await api(id ? `/api/colaboradores/${id}` : '/api/colaboradores', { method: id ? 'PUT' : 'POST', body });
      d.close();
      await carregar();
      renderAba();
      toast('Salvo.');
    } catch (e) { toast(e.message, 'erro'); }
  });
}

// ----- Condições próprias (exceções por colaborador) -----

const TIPOS_PROPRIA = { fixo: 'R$ por mês', pct: '%', multiplo: 'Nº de salários', nao: 'Não recebe' };
const temProprias = c => Boolean(c.excecoes && Object.keys(c.excecoes).length);
const etiquetaProprias = c => (temProprias(c) ? ` <span class="etiqueta azul" title="${esc(Object.entries(c.excecoes).map(([r, e]) => `${RUBRICAS[IDX[r]].nome}: ${textoCurto({ ...e, periodo: 'mensal' })}`).join(' · '))}">condições próprias</span>` : '');

function montarProprias(d, c) {
  const box = $('#lista-proprias', d);
  const regra = rub => {
    if (!c.filial) return '';
    const p = Motor.premissaDe(E.dados.premissas, c.filial, c.regional || E.dados.filiais[c.filial]?.regional, rub);
    return p.metodo === 'nao' ? 'filial não tem' : `regra da filial: ${textoCurto(p)}`;
  };
  const linha = (rub = '', e = { metodo: 'fixo', valor: '' }) => {
    const div = document.createElement('div');
    div.className = 'propria-linha';
    div.innerHTML = `
      <select class="campo" data-p="rub"><option value="">Escolha o item…</option>${GRUPOS.filter(g => g.id !== 'provisoes' && g.id !== 'encargos').map(g => `<optgroup label="${g.nome}">${RUBRICAS.filter(r => r.grupo === g.id && !r.fixa).map(r => `<option value="${r.id}" ${r.id === rub ? 'selected' : ''}>${esc(r.nome)}</option>`).join('')}</optgroup>`).join('')}</select>
      <select class="campo" data-p="metodo">${Object.entries(TIPOS_PROPRIA).map(([k, v]) => `<option value="${k}" ${k === e.metodo ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input class="campo" type="number" step="any" data-p="valor" value="${e.valor ?? ''}" placeholder="valor" ${e.metodo === 'nao' ? 'disabled' : ''}>
      <button type="button" class="btn-ic" data-p="rem" title="Remover">✕</button>
      <small data-p="regra">${rub ? esc(regra(rub)) : ''}</small>`;
    div.querySelector('[data-p=rub]').addEventListener('change', ev => { div.querySelector('[data-p=regra]').textContent = ev.target.value ? regra(ev.target.value) : ''; });
    div.querySelector('[data-p=metodo]').addEventListener('change', ev => { div.querySelector('[data-p=valor]').disabled = ev.target.value === 'nao'; });
    div.querySelector('[data-p=rem]').addEventListener('click', () => div.remove());
    box.appendChild(div);
  };
  Object.entries(c.excecoes || {}).forEach(([rub, e]) => linha(rub, e));
  $('#add-propria', d).addEventListener('click', () => linha());
}

/** Lê as condições próprias do formulário; null se houver item repetido. */
function lerProprias(d) {
  const out = {};
  for (const div of $$('.propria-linha', d)) {
    const rub = div.querySelector('[data-p=rub]').value;
    if (!rub) continue;
    if (out[rub]) { toast(`O item ${RUBRICAS[IDX[rub]].nome} aparece duas vezes.`, 'erro'); return null; }
    const metodo = div.querySelector('[data-p=metodo]').value;
    out[rub] = { metodo, valor: metodo === 'nao' ? 0 : Number(div.querySelector('[data-p=valor]').value) || 0 };
  }
  return out;
}

// ---------- Conferência (coordenadores) ----------

function descreverPremissa(p) {
  const v = Number(p.valor) || 0;
  const per = p.periodo === 'anual_mes' ? ` · em ${MESES[p.mes - 1]}` : p.periodo === 'anual_diluido' ? ' · anual ÷ 12' : '';
  switch (p.metodo) {
    case 'pct': return `${num2.format(v)}% s/ ${BASES[p.base].split(' (')[0].toLowerCase()}${p.teto ? ` · teto ${brl.format(p.teto)}` : ''}`;
    case 'fixo': return `${brl.format(v)} por colaborador${per}`;
    case 'rateio': return `${brl.format(v)} total da filial · rateio ${p.rateio === 'salario' ? 'pelo salário' : 'por HC'}${per}`;
    case 'multiplo': return `${p.por_nivel ? 'pela tabela de nível' : `${num2.format(v)} salário(s)`}${per}`;
    default: return 'Não se aplica';
  }
}
const descreverComQuem = p => `${descreverPremissa(p)}${p.quem?.length ? ' · só para alguns CCs/cargos' : ''}`;

function renderConferencia() {
  const el = painel('conferencia');
  const fils = filiaisDa(E.filtro.regional).filter(f => !E.filtro.filial || f === E.filtro.filial);
  if (!fils.includes(E.conf.filial)) E.conf.filial = fils[0] || '';
  const porFilial = Motor.agregar(E.res, c => c.filial, c => fils.includes(c.filial));
  const abertas = E.solic.filter(s => s.status === 'aberta' || s.status === 'em_analise');
  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Conferência do <em>orçamento</em></h1>
      <p class="subtitulo">Confira colaboradores, salários, vagas e premissas de cada filial. Encontrou algo errado? Use os botões <b>✏️ Ajustar</b> nas premissas ou marque os colaboradores na tabela — o pedido vai direto para o time de orçamento.</p></div></div>
    ${fils.length ? `<div class="filiais-cards">${fils.map(f => {
      const a = porFilial.get(f);
      const cfg = E.dados.filiais[f];
      const n = abertas.filter(s => s.filial === f).length;
      return `<button class="filial-card${f === E.conf.filial ? ' ativo' : ''}" data-filial="${esc(f)}">
        <strong>${esc(f)}</strong><span class="valor">${brl0.format(a?.total || 0)}</span>
        <small>${a?.n || 0} colaborador(es) · dissídio ${num2.format(cfg.dissidio_pct)}% em ${MESES[cfg.dissidio_mes - 1]}</small>
        <span>${cfg.conferencia === 'conferida' ? '<span class="etiqueta ok">✓ Conferida</span>' : '<span class="etiqueta neutra">Pendente</span>'} ${n ? `<span class="etiqueta pend">${n} pedido(s)</span>` : ''}</span>
      </button>`;
    }).join('')}</div><div id="conf-detalhe"></div>` : '<div class="cartao vazio"><span>📭</span>Nenhuma filial disponível para você.</div>'}`;
  $$('.filial-card', el).forEach(b => b.addEventListener('click', () => { E.conf.filial = b.dataset.filial; E.conf.sel.clear(); renderConferencia(); }));
  if (E.conf.filial) detalheConferencia();
}

function detalheConferencia() {
  const f = E.conf.filial;
  const cfg = E.dados.filiais[f];
  const el = $('#conf-detalhe');
  const idx = new Map(E.res.colaboradores.map((c, i) => [c.id, i]));
  const colabs = E.dados.colaboradores.filter(c => c.filial === f);
  const anualRub = (c, r) => { const i = idx.get(c.id); let s = 0; for (let m = 0; m < 12; m++) s += E.res.valor(i, r, m); return s; };
  const mesesAtivos = c => c.mes_fim - c.mes_inicio + 1;
  // Uma coluna por item que alguém da filial tem (como na planilha BZO); o salário base fica em coluna própria.
  const cols = RUBRICAS.map((r, k) => ({ r, k })).filter(({ k }) => colabs.some(c => anualRub(c, k)));
  const porMes = E.conf.modo === 'mes';
  const valorCel = (c, k) => { const a = anualRub(c, k); return porMes ? a / mesesAtivos(c) : a; };
  const totalColab = c => cols.reduce((s, { k }) => s + anualRub(c, k), 0);
  const somaCol = k => colabs.reduce((s, c) => s + (porMes ? anualRub(c, k) / 12 : anualRub(c, k)), 0);
  E.conf.valoresColab = c => Object.fromEntries([[RUBRICAS[0].nome, brl.format(anualRub(c, 0) / mesesAtivos(c))], ...cols.map(({ r, k }) => [r.nome, `${brl.format(anualRub(c, k) / mesesAtivos(c))} / mês`])]);
  const ativas = RUBRICAS.filter(r => !r.fixa).map(r => ({ r, p: Motor.premissaDe(E.dados.premissas, f, cfg.regional, r.id) })).filter(x => x.p.metodo !== 'nao');
  el.innerHTML = `
    <section class="cartao">
      <div class="prem-cab">
        <div><small>${esc(cfg.regional)}</small><h2>${esc(f)}</h2>
          <p>${cfg.conferencia === 'conferida' ? `✓ Conferida por ${esc(cfg.conferida_por || '')} em ${esc(dataBr(cfg.conferida_em))}` : 'Ainda não conferida'}</p></div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <button class="btn btn-claro btn-sm" id="conf-geral">✏️ Outro ajuste</button>
          <button class="btn btn-claro btn-sm" id="conf-vaga">+ Solicitar vaga</button>
          ${cfg.conferencia === 'conferida' ? '<button class="btn btn-claro btn-sm" id="conf-status" data-s="pendente">Reabrir conferência</button>' : '<button class="btn btn-laranja btn-sm" id="conf-status" data-s="conferida">✓ Marcar como conferida</button>'}
        </div>
      </div>
      <h3 style="margin:.4rem 0 .7rem;font-size:.95rem">Premissas aplicadas</h3>
      <div class="resumo-prem">
        <div><span>Dissídio</span><b>${num2.format(cfg.dissidio_pct)}% a partir de ${MESES[cfg.dissidio_mes - 1]}</b><button class="btn-ajustar" data-pedir-prem="dissidio">✏️ Ajustar</button></div>
        <div><span>Reajuste de benefícios</span><b>${num2.format(cfg.reaj_benef_pct)}% a partir de ${MESES[cfg.reaj_benef_mes - 1]}</b><button class="btn-ajustar" data-pedir-prem="reaj_benef">✏️ Ajustar</button></div>
        ${ativas.map(({ r, p }) => `<div><span>${esc(r.nome)}</span><b>${esc(descreverComQuem(p))}</b><button class="btn-ajustar" data-pedir-prem="${r.id}">✏️ Ajustar</button></div>`).join('')}
      </div>
      <div class="ferramentas" style="margin:1.4rem 0 .7rem">
        <h3 style="margin:0;font-size:.95rem">Colaboradores e vagas <small>· ${colabs.length} · ${porMes ? 'valores por mês (média dos meses no ano)' : 'valores do ano'}</small></h3>
        <span class="direita">
          <div class="segmentos" id="conf-modo"><button data-m="mes" class="${porMes ? 'ativo' : ''}">Por mês</button><button data-m="ano" class="${porMes ? '' : 'ativo'}">No ano</button></div>
          <button class="btn btn-marinho btn-sm" id="conf-excel">⬇ Excel</button>
        </span>
      </div>
      <div class="aviso-ajuste">☑️ <b>Algo errado com algum colaborador?</b> Marque a caixa ao lado do nome (pode marcar vários) e clique em <b>Solicitar ajuste</b>.</div>
      <div class="tabela-wrap alta"><table class="tabela tabela-conf">
        <thead>
          <tr class="cab-grupos"><th class="fixa" rowspan="2"><label class="marcar"><input type="checkbox" id="conf-todos" title="Marcar todos"> Colaborador</label></th><th rowspan="2">Período</th><th class="n" rowspan="2">Salário base<br><small>(sem dissídio)</small></th>
            ${GRUPOS.map(g => { const n = cols.filter(x => x.r.grupo === g.id).length; return n ? `<th colspan="${n}" class="cab-grupo" style="--c:${g.cor}">${g.nome}</th>` : ''; }).join('')}
            <th class="n" rowspan="2">Total ${porMes ? '/ mês' : 'ano'}</th></tr>
          <tr>${cols.map(({ r }) => `<th class="n" style="box-shadow:inset 0 3px 0 ${COR_GRUPO[r.grupo]}">${esc(r.id === 'salario' ? 'Salário c/ dissídio' : r.nome)}</th>`).join('')}</tr>
        </thead>
        <tbody>${colabs.map(c => {
          const meses = mesesAtivos(c);
          const tot = totalColab(c);
          return `<tr class="linha-sel${c.vaga ? ' vaga' : ''}${E.conf.sel.has(c.id) ? ' marcada' : ''}" data-sel="${c.id}"><td class="fixa"><input type="checkbox" class="marca" data-marca="${c.id}" ${E.conf.sel.has(c.id) ? 'checked' : ''} aria-label="Selecionar ${esc(c.nome)} para ajuste"> ${esc(c.nome)}${c.vaga ? ' <span class="etiqueta pend">vaga</span>' : ''}${etiquetaProprias(c)}<span class="sub" title="${esc(`${[c.matricula, c.funcao, c.cargo].filter(Boolean).join(' · ')} — CC ${[c.cc_cod, c.cc_nome].filter(Boolean).join(' · ')}`)}">${esc([c.funcao, c.cc_cod ? `CC ${c.cc_cod} ${c.cc_nome || ''}` : ''].filter(Boolean).join(' · '))}</span></td>
            <td>${meses === 12 ? 'Ano todo' : `${MESES[c.mes_inicio - 1]} – ${MESES[c.mes_fim - 1]}`}</td>
            <td class="n">${brl.format(c.salario)}</td>
            ${cols.map(({ k }) => { const v = valorCel(c, k); return `<td class="n${v ? '' : ' zero'}${c.excecoes?.[RUBRICAS[k].id] ? ' propria-cel' : ''}">${v ? num2.format(v) : '–'}</td>`; }).join('')}
            <td class="n"><b>${num2.format(porMes ? tot / meses : tot)}</b></td></tr>`;
        }).join('')}</tbody>
        <tfoot><tr class="total"><td class="fixa">Total da filial${porMes ? ' / mês' : ''}</td><td></td><td class="n">${num2.format(colabs.reduce((s, c) => s + c.salario, 0))}</td>
          ${cols.map(({ k }) => `<td class="n">${num2.format(somaCol(k))}</td>`).join('')}
          <td class="n">${num2.format(colabs.reduce((s, c) => s + totalColab(c), 0) / (porMes ? 12 : 1))}</td></tr></tfoot>
      </table></div>
      <p class="subtitulo" style="margin:.6rem 0 0;font-size:.8rem">“Salário c/ dissídio” já considera o reajuste a partir do mês da data-base; no modo “Por mês” é a média dos meses. Valores em azul são condições próprias do colaborador.</p>
      <div class="barra-selecao" id="barra-selecao" hidden></div>
    </section>`;
  $$('#conf-modo button', el).forEach(b => b.addEventListener('click', () => { E.conf.modo = b.dataset.m; detalheConferencia(); }));
  $('#conf-excel', el).addEventListener('click', () => {
    if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo.', 'erro');
    const cab = ['Matrícula', 'Colaborador', 'Função', 'Cargo', 'Cód. C. Custo', 'Centro de custo', 'Mês início', 'Mês fim', 'Salário base', ...cols.map(({ r }) => r.nome), `Total ${porMes ? '/ mês' : 'ano'}`];
    const r2 = v => Math.round(v * 100) / 100;
    const aoa = [cab, ...colabs.map(c => [c.matricula, c.nome, c.funcao, c.cargo, c.cc_cod, c.cc_nome, c.mes_inicio, c.mes_fim, c.salario,
      ...cols.map(({ k }) => r2(valorCel(c, k))), r2(porMes ? totalColab(c) / mesesAtivos(c) : totalColab(c))])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = cab.map((_, i) => ({ wch: i === 1 ? 34 : 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, porMes ? 'Por mês' : 'No ano');
    XLSX.writeFile(wb, `Conferencia-${f.replace(/[^\w-]+/g, '_')}-${porMes ? 'mensal' : 'anual'}.xlsx`);
  });
  $('#conf-status', el).addEventListener('click', async e => {
    await api(`/api/filiais/${encodeURIComponent(f)}/conferencia`, { method: 'PUT', body: { status: e.target.dataset.s } });
    await carregar();
    renderConferencia();
    toast(e.target.dataset.s === 'conferida' ? 'Filial marcada como conferida.' : 'Conferência reaberta.');
  });
  $('#conf-geral', el).addEventListener('click', () => pedirAjuste({ tipo: 'geral', filial: f, regional: cfg.regional, alvo_desc: `Filial ${f}` }));
  $('#conf-vaga', el).addEventListener('click', () => pedirAjuste({ tipo: 'vaga', filial: f, regional: cfg.regional, alvo_desc: `Nova vaga · ${f}` }));
  $$('[data-pedir-prem]', el).forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.pedirPrem;
    const nome = id === 'dissidio' ? 'Dissídio' : id === 'reaj_benef' ? 'Reajuste de benefícios' : RUBRICAS[IDX[id]].nome;
    const atual = b.parentElement.querySelector('b').textContent;
    pedirAjuste({ tipo: id === 'dissidio' || id === 'reaj_benef' ? 'dissidio' : 'premissa', filial: f, regional: cfg.regional, alvo_id: id, alvo_desc: `${nome} · ${f}`, campo: nome, valor_atual: atual });
  }));
  // Seleção de colaboradores para ajuste: caixa na linha (ou clique em qualquer ponto da linha) + barra com o botão.
  const atualizarBarra = () => {
    const n = E.conf.sel.size;
    const barra = $('#barra-selecao', el);
    barra.hidden = !n;
    barra.innerHTML = n ? `<span><b>${n}</b> colaborador${n > 1 ? 'es' : ''} selecionado${n > 1 ? 's' : ''}</span>
      <button class="btn btn-claro btn-sm" id="sel-limpar">Limpar seleção</button>
      <button class="btn btn-laranja" id="sel-ajustar">✏️ Solicitar ajuste</button>` : '';
    if (!n) return;
    $('#sel-limpar', barra).addEventListener('click', () => { E.conf.sel.clear(); detalheConferencia(); });
    $('#sel-ajustar', barra).addEventListener('click', () => pedirAjusteColaboradores(colabs.filter(c => E.conf.sel.has(c.id)), cfg));
  };
  const marcar = (id, on) => {
    on ? E.conf.sel.add(id) : E.conf.sel.delete(id);
    const tr = el.querySelector(`tr[data-sel="${id}"]`);
    tr?.classList.toggle('marcada', on);
    const cb = tr?.querySelector('[data-marca]');
    if (cb) cb.checked = on;
    $('#conf-todos', el).checked = colabs.length > 0 && colabs.every(c => E.conf.sel.has(c.id));
    atualizarBarra();
  };
  $$('tr[data-sel]', el).forEach(tr => tr.addEventListener('click', e => {
    const id = Number(tr.dataset.sel);
    if (e.target.matches('[data-marca]')) marcar(id, e.target.checked);
    else marcar(id, !E.conf.sel.has(id));
  }));
  $('#conf-todos', el).checked = colabs.length > 0 && colabs.every(c => E.conf.sel.has(c.id));
  $('#conf-todos', el).addEventListener('change', e => colabs.forEach(c => marcar(c.id, e.target.checked)));
  atualizarBarra();
}

/** Formulário de ajuste para os colaboradores marcados: um bloco por pessoa + explicação opcional para todos. */
function pedirAjusteColaboradores(lista, cfg) {
  const blocos = lista.map(c => {
    const campos = camposDoColab(c, E.conf.valoresColab(c));
    return `<fieldset class="ajuste-pessoa" data-id="${c.id}">
      <legend>${esc(c.nome)} <small>${esc([c.funcao, c.cc_cod && `CC ${c.cc_cod}`].filter(Boolean).join(' · '))}</small></legend>
      <div class="form-grade">
        <label class="rotulo">O que precisa mudar?<select class="campo" name="campo">${Object.keys(campos).map(k => `<option>${esc(k)}</option>`).join('')}</select></label>
        <label class="rotulo">Como está hoje<input class="campo" name="valor_atual" readonly value="${esc(campos['Salário'])}"></label>
        <label class="rotulo">Como deveria ser<input class="campo" name="valor_sugerido" placeholder="ex.: R$ 5.300,00"></label>
        <label class="rotulo">Motivo <small>(se for diferente do geral)</small><input class="campo" name="mensagem" placeholder="ex.: promoção em setembro"></label>
      </div>
    </fieldset>`;
  }).join('');
  const d = abrirModal({
    titulo: lista.length === 1 ? lista[0].nome : `${lista.length} colaboradores`, sup: 'SOLICITAR AJUSTE', largo: lista.length > 1,
    corpo: `
      <p style="margin:0;color:var(--texto-suave);font-size:.9rem">Para cada pessoa, escolha <b>o que precisa mudar</b> e diga <b>como deveria ser</b>. O pedido vai para o time de orçamento, e a resposta aparece em <b>Meus pedidos</b>.</p>
      ${lista.length > 1 ? '<label class="rotulo">Motivo geral <small>(vale para todos que não tiverem um motivo próprio)</small><textarea class="campo" id="motivo-geral" rows="2" placeholder="ex.: dados desatualizados na base"></textarea></label>' : ''}
      ${blocos}`,
    rodape: `<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="enviar-ajustes">Enviar ${lista.length > 1 ? `${lista.length} pedidos` : 'pedido'}</button>`,
  });
  $$('.ajuste-pessoa', d).forEach(fs => {
    const c = lista.find(x => x.id === Number(fs.dataset.id));
    const campos = camposDoColab(c, E.conf.valoresColab(c));
    fs.querySelector('[name=campo]').addEventListener('change', e => { fs.querySelector('[name=valor_atual]').value = campos[e.target.value]; });
  });
  $('#enviar-ajustes', d).addEventListener('click', async () => {
    const geral = $('#motivo-geral', d)?.value.trim() || '';
    const pedidos = $$('.ajuste-pessoa', d).map(fs => {
      const c = lista.find(x => x.id === Number(fs.dataset.id));
      const v = n => fs.querySelector(`[name=${n}]`).value.trim();
      return { c, campo: v('campo'), valor_atual: v('valor_atual'), valor_sugerido: v('valor_sugerido'), mensagem: v('mensagem') || geral };
    });
    const faltando = pedidos.filter(p => !p.mensagem && !p.valor_sugerido);
    if (faltando.length) return toast(`Preencha "Como deveria ser" ou o motivo de: ${faltando.map(p => p.c.nome).join(', ')}.`, 'erro');
    const btn = $('#enviar-ajustes', d);
    btn.disabled = true;
    try {
      for (const p of pedidos) {
        await api('/api/solicitacoes', { method: 'POST', body: {
          tipo: 'colaborador', filial: p.c.filial, regional: cfg.regional, alvo_id: String(p.c.id), alvo_desc: `${p.c.nome} · ${p.c.funcao || ''}`,
          campo: p.campo, valor_atual: p.valor_atual, valor_sugerido: p.valor_sugerido, mensagem: p.mensagem || `${p.campo}: ${p.valor_sugerido}`,
        } });
      }
      d.close();
      E.conf.sel.clear();
      await carregarSolicitacoes();
      renderConferencia();
      toast(pedidos.length > 1 ? `${pedidos.length} pedidos enviados ao time de orçamento.` : 'Pedido enviado ao time de orçamento.');
    } catch (e) { btn.disabled = false; toast(e.message, 'erro'); }
  });
}

/** Opções de "o que precisa mudar" para um colaborador, com o valor atual de cada uma. */
function camposDoColab(c, itens = {}) {
  return {
    'Salário': brl.format(c.salario), 'Centro de custo': `${c.cc_cod || ''} ${c.cc_nome || ''}`.trim(), 'Função / cargo': `${c.funcao || ''} · ${c.cargo || ''}`,
    'Desligamento previsto': c.mes_fim === 12 ? 'Sem previsão' : MESES[c.mes_fim - 1], 'Transferência de filial': c.filial,
    ...Object.fromEntries(Object.entries(itens).filter(([k]) => k !== 'Salário')),
    'Excluir do orçamento': '', 'Outro': '',
  };
}

function pedirAjuste(ctx) {
  const c = ctx.colab;
  const camposColab = c ? camposDoColab(c, ctx.itens) : null;
  const d = abrirModal({
    titulo: ctx.alvo_desc, sup: 'SOLICITAR AJUSTE',
    corpo: `<form class="form-grade" id="form-pedido">
      ${camposColab ? `<label class="rotulo">O que precisa mudar?<select class="campo" name="campo">${Object.keys(camposColab).map(k => `<option>${k}</option>`).join('')}</select></label>
        <label class="rotulo">Valor atual<input class="campo" name="valor_atual" readonly value="${esc(camposColab['Salário'])}"></label>`
        : ctx.campo ? `<label class="rotulo">Item<input class="campo" name="campo" readonly value="${esc(ctx.campo)}"></label><label class="rotulo">Valor atual<input class="campo" name="valor_atual" readonly value="${esc(ctx.valor_atual || '')}"></label>` : ''}
      <label class="rotulo inteiro">${ctx.tipo === 'vaga' ? 'Vaga (função, salário, centro de custo e mês de admissão)' : 'Valor correto / sugestão'}<input class="campo" name="valor_sugerido" placeholder="${ctx.tipo === 'vaga' ? 'ex.: Operador I · R$ 4.200 · 17150 Operação · a partir de Mar' : 'ex.: R$ 5.300,00'}"></label>
      <label class="rotulo inteiro">Explique o ajuste<textarea class="campo" name="mensagem" rows="4" required placeholder="Descreva o que está errado e o motivo."></textarea></label>
    </form>`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="enviar-pedido">Enviar pedido</button>',
  });
  const sel = $('select[name="campo"]', d);
  if (sel) sel.addEventListener('change', () => { $('input[name="valor_atual"]', d).value = camposColab[sel.value]; });
  $('#enviar-pedido', d).addEventListener('click', async () => {
    const f = $('#form-pedido', d);
    if (!f.reportValidity()) return;
    const body = { ...ctx, ...Object.fromEntries(new FormData(f)) };
    delete body.colab;
    try {
      await api('/api/solicitacoes', { method: 'POST', body });
      d.close();
      await carregarSolicitacoes();
      if (E.aba === 'conferencia') renderConferencia();
      toast('Pedido enviado ao time de orçamento.');
    } catch (e) { toast(e.message, 'erro'); }
  });
}

// ---------- Pedidos de ajuste ----------

const dataBr = s => (s ? new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

async function carregarSolicitacoes() {
  E.solic = await api('/api/solicitacoes');
  const pend = E.solic.filter(s => (E.eu.admin ? s.status === 'aberta' : s.status === 'aberta' || s.status === 'em_analise')).length;
  const q = $('#qtd-solic');
  q.hidden = !pend;
  q.textContent = pend;
}

function renderSolicitacoes() {
  const el = painel('solicitacoes');
  const admin = E.eu.admin;
  const filtros = { pendentes: s => s.status === 'aberta' || s.status === 'em_analise', ajustada: s => s.status === 'ajustada', recusada: s => s.status === 'recusada', todas: () => true };
  const lista = E.solic.filter(filtros[E.solicFiltro]);
  const conta = k => E.solic.filter(filtros[k]).length;
  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Pedidos de <em>ajuste</em></h1>
      <p class="subtitulo">${admin ? 'Pedidos enviados pelos coordenadores. Abra o item, ajuste e responda — o coordenador vê a resposta na hora.' : 'Acompanhe os pedidos que você enviou e as respostas do time de orçamento.'}</p></div></div>
    <div class="ferramentas"><div class="segmentos" id="solic-filtro">${[['pendentes', 'Em aberto'], ['ajustada', 'Ajustadas'], ['recusada', 'Recusadas'], ['todas', 'Todas']].map(([k, r]) => `<button data-f="${k}" class="${E.solicFiltro === k ? 'ativo' : ''}">${r} (${conta(k)})</button>`).join('')}</div></div>
    <div class="solic-lista">${lista.length ? lista.map(s => `
      <article class="solic ${s.status}" data-id="${s.id}">
        <div>
          <div class="solic-topo"><span class="etiqueta ${STATUS[s.status][1]}">${STATUS[s.status][0]}</span><span>#${s.id}</span><span>·</span><span>${esc(s.regional)}${s.filial ? ` / ${esc(s.filial)}` : ''}</span><span>·</span><span>${esc(s.autor)}</span><span>·</span><span>${dataBr(s.criado_em)}</span></div>
          <h4>${esc(s.alvo_desc || 'Pedido geral')}</h4>
          ${s.campo || s.valor_sugerido ? `<div class="sugestao">${s.campo ? `<b>${esc(s.campo)}</b>: ` : ''}${s.valor_atual ? `${esc(s.valor_atual)} → ` : ''}<b>${esc(s.valor_sugerido || '—')}</b></div>` : ''}
          <p style="margin-top:.5rem">${esc(s.mensagem)}</p>
          ${s.resposta ? `<div class="resposta" style="margin-top:.5rem">💬 <b>Resposta:</b> ${esc(s.resposta)}</div>` : ''}
        </div>
        <div class="solic-acoes">${admin ? `
          <button class="btn btn-marinho btn-sm" data-abrir>Abrir item</button>
          <select class="campo" data-status>${Object.entries(STATUS).map(([k, [r]]) => `<option value="${k}" ${k === s.status ? 'selected' : ''}>${r}</option>`).join('')}</select>
          <textarea class="campo" data-resposta rows="2" placeholder="Resposta ao coordenador">${esc(s.resposta || '')}</textarea>
          <button class="btn btn-laranja btn-sm" data-salvar>Salvar</button>`
          : s.status === 'aberta' ? '<button class="btn btn-perigo btn-sm" data-cancelar>Cancelar pedido</button>' : ''}</div>
      </article>`).join('') : '<div class="cartao vazio"><span>✨</span>Nenhum pedido aqui.</div>'}</div>`;
  $$('#solic-filtro button', el).forEach(b => b.addEventListener('click', () => { E.solicFiltro = b.dataset.f; renderSolicitacoes(); }));
  $$('.solic', el).forEach(card => {
    const s = E.solic.find(x => x.id === Number(card.dataset.id));
    card.querySelector('[data-salvar]')?.addEventListener('click', async () => {
      await api(`/api/solicitacoes/${s.id}`, { method: 'PUT', body: { status: card.querySelector('[data-status]').value, resposta: card.querySelector('[data-resposta]').value } });
      await carregarSolicitacoes();
      renderSolicitacoes();
      toast('Pedido atualizado.');
    });
    card.querySelector('[data-cancelar]')?.addEventListener('click', async () => {
      if (!confirm('Cancelar este pedido?')) return;
      await api(`/api/solicitacoes/${s.id}`, { method: 'PUT', body: {} });
      await carregarSolicitacoes();
      renderSolicitacoes();
    });
    card.querySelector('[data-abrir]')?.addEventListener('click', async () => {
      if (s.status === 'aberta') {
        await api(`/api/solicitacoes/${s.id}`, { method: 'PUT', body: { status: 'em_analise' } });
        await carregarSolicitacoes();
      }
      abrirItem(s);
    });
  });
}

function abrirItem(s) {
  if (s.tipo === 'colaborador') return editarColaborador(Number(s.alvo_id));
  if (s.tipo === 'vaga') return editarColaborador(null, { vaga: true, regional: s.regional, filial: s.filial || '', nome: 'Nova vaga' });
  if (s.filial && E.dados.filiais[s.filial]) {
    E.prem.escopo = s.filial;
    E.prem.edits = {};
    E.prem.filial = {};
    irPara('premissas');
    const linha = s.alvo_id && $(`#tabela-prem tr[data-rub="${CSS.escape(s.alvo_id)}"]`);
    if (linha) { linha.scrollIntoView({ block: 'center' }); linha.style.outline = '2px solid var(--laranja)'; }
    return;
  }
  irPara('premissas');
}

// ---------- Relatório contábil ----------

// Vínculo sugerido item → conta contábil (pelo código da conta); pode ser trocado na tela.
const CONTA_SUGERIDA = {
  salario: '218 - SALÁRIOS E ORDENADOS', periculosidade: '1833725 - INSALUBRIDADE / PERICULOSIDADE', insalubridade: '1833725 - INSALUBRIDADE / PERICULOSIDADE',
  penosidade: '1833725 - INSALUBRIDADE / PERICULOSIDADE', adic_turno: '1833726 - ADICIONAL NOTURNO', horas_extras: '219 - HORAS EXTRAS',
  ferias: '223 - PROV.TRABALHISTAS-FÉRIAS', decimo: '118516 - PROV.TRABALHISTAS-13º SALÁRIO', rescisao: '220 - DESPESAS COM RESCISÃO DE FUNCIONÁRIOS',
  fgts: '221 - F.G.T.S.', fgts_ferias: '118519 - PROV.TRABALHISTAS-FGTS S/FÉRIAS', fgts_13: '118520 - PROV.TRABALHISTAS-FGTS S/13º SALÁRIO',
  inss: '222 - I.N.S.S.', inss_ferias: '118517 - PROV.TRABALHISTAS-INSS S/FÉRIAS', inss_13: '118518 - PROV.TRABALHISTAS-INSS S/13º SALÁRIO',
  ppr: '2821595 - PROVISÃO PARA PARTICIPAÇÃO NOS RESULTADOS', va: '255 - PAT-PROGRAMA ALIMENTAÇÃO TRABALHADOR', va_natal: '247 - CESTAS BÁSICAS/TICKETS',
  vt: '236 - VALE TRANSPORTE', aux_creche: '67994 - DESPESAS COM CRECHES E LAZER', educacional: '3447914 - OUTROS BENEFICIOS SOCIAIS',
  material_escolar: '3447914 - OUTROS BENEFICIOS SOCIAIS', aux_oculos: '3447914 - OUTROS BENEFICIOS SOCIAIS', oftalmo: '67996 - DESPESAS MÉDICAS/HOSPITALARES/ODONTOLÓGICAS',
  assist_medica: '147480 - PLANO DE SAUDE', coparticipacao: '147480 - PLANO DE SAUDE', assist_odonto: '67996 - DESPESAS MÉDICAS/HOSPITALARES/ODONTOLÓGICAS',
  farmacia: '163562 - MEDICAMENTOS', seguro_vida: '78061 - SEGUROS DE FUNCIONÁRIOS', refeitorio: '1291020 - ALIMENTOS PARA REFEITÓRIO',
  fretado: '67975 - TRANSPORTE CONTRATADO/PRÓPRIO', fretado_overall: '67975 - TRANSPORTE CONTRATADO/PRÓPRIO', cesta_natalina: '67993 - CESTAS NATALINAS',
  saude_ocupacional: '67980 - EXAMES PERIÓDICOS', endomarketing: '105278 - ENDOMARKETING', treinamento: '246 - CURSOS E TREINAMENTOS DE PESSOAL',
  viagens: '68420 - DIÁRIAS', confraternizacoes: '251 - CONFRATERNIZAÇÕES',
};
// Pacote de cada item no arquivo da contabilidade (editável na tela).
const PROVISOES_TRAB = new Set(['ferias', 'decimo', 'fgts_ferias', 'fgts_13', 'inss_ferias', 'inss_13']);
function pacoteDoItem(cfg, rub) {
  if (cfg.mapa_pacotes?.[rub]) return cfg.mapa_pacotes[rub];
  const [pessoal, beneficios, provisoes] = cfg.pacotes;
  if (PROVISOES_TRAB.has(rub)) return provisoes;
  const grupo = RUBRICAS[IDX[rub]].grupo;
  if (grupo === 'beneficios' && rub !== 'ppr') return beneficios;
  if (grupo === 'demais') return beneficios;
  return pessoal;
}

const codigoDe = rotulo => String(rotulo || '').split(' - ')[0].trim();

/** Conta contábil de um item: escolhida na tela → sugerida (achando na lista pelo código). */
function contaDoItem2(cfg, rub) {
  if (cfg.mapa_rubricas[rub] === '-') return '';
  if (cfg.mapa_rubricas[rub]) return cfg.mapa_rubricas[rub];
  const sug = CONTA_SUGERIDA[rub];
  if (!sug) return '';
  return cfg.contas.find(c => codigoDe(c) === codigoDe(sug)) || sug;
}

/** Centro de custo contábil de um CÓD. C. CUSTO da base: escolhido → mesmo código na lista → padrão. */
function ccContabil(cfg, cod) {
  if (cfg.mapa_cc[cod]) return { cc: cfg.mapa_cc[cod], como: 'manual' };
  const achado = cod && cfg.ccs.find(c => codigoDe(c) === String(cod).trim());
  if (achado) return { cc: achado, como: 'auto' };
  return { cc: cfg.cc_padrao || 'N/A Centro de Custo', como: 'sem' };
}

/** Linhas do relatório: Pacote · Centro de custo contábil · Conta contábil · Terceiro · 12 meses. */
function linhasContabeis(cfg) {
  const porChave = new Map();
  E.res.colaboradores.forEach((c, i) => {
    if (!noFiltro(c)) return;
    const cc = ccContabil(cfg, c.cc_cod).cc;
    RUBRICAS.forEach((r, k) => {
      const conta = contaDoItem2(cfg, r.id);
      if (!conta) return;
      const pacote = pacoteDoItem(cfg, r.id);
      const chave = `${pacote}\u0000${cc}\u0000${conta}`;
      if (!porChave.has(chave)) porChave.set(chave, { pacote, cc, conta, meses: new Float64Array(12) });
      const l = porChave.get(chave);
      for (let m = 0; m < 12; m++) l.meses[m] += E.res.valor(i, k, m);
    });
  });
  const ordemConta = new Map(cfg.contas.map((c, i) => [c, i]));
  return [...porChave.values()]
    .filter(l => E.contabil.zeradas || l.meses.some(v => Math.abs(v) >= 0.005))
    .sort((a, b) => cfg.pacotes.indexOf(a.pacote) - cfg.pacotes.indexOf(b.pacote) || a.cc.localeCompare(b.cc, 'pt-BR', { numeric: true }) || (ordemConta.get(a.conta) ?? 999) - (ordemConta.get(b.conta) ?? 999) || a.conta.localeCompare(b.conta));
}

async function renderContabil() {
  const el = painel('contabil');
  if (!E.contabil.cfg) E.contabil.cfg = await api('/api/contabil');
  const cfg = E.contabil.cfg;
  const ano = String(E.dados.config.ano);
  const meses = MESES.map(m => `${m}/${ano.slice(-2)}`);
  const linhas = linhasContabeis(cfg);
  const colabs = E.dados.colaboradores.filter(noFiltro);
  const ccsBase = [...new Map(E.dados.colaboradores.map(c => [String(c.cc_cod || ''), c.cc_nome || ''])).entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }));
  const semCc = ccsBase.filter(([cod]) => ccContabil(cfg, cod).como === 'sem');
  const opcoes = (lista, sel, vazio) => `<option value="">${vazio}</option>${[...new Set([...lista, sel].filter(Boolean))].map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('')}`;
  const anualRub = k => { let s = 0; E.res.colaboradores.forEach((c, i) => { if (noFiltro(c)) for (let m = 0; m < 12; m++) s += E.res.valor(i, k, m); }); return s; };
  const escopo = E.filtro.filial || E.filtro.regional || 'Todas as regionais';

  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Relatório <em>contábil</em></h1>
      <p class="subtitulo">Gera o arquivo no formato da contabilidade (Pacote · Centro de Custo · Conta Contábil · Terceiro · meses). Cada item do orçamento vai para uma conta contábil e cada CÓD. C. CUSTO da base vai para o centro de custo contábil.</p></div>
      <button class="btn btn-laranja" id="ct-baixar">⬇ Baixar relatório (Excel)</button></div>

    <div class="contabil-passos">
      <section class="cartao">
        <h3>1 · Listas da contabilidade</h3>
        <p class="subtitulo" style="margin:0 0 .8rem">Suba a planilha com as abas <b>Conta contabil</b> e <b>Centro de Custo Contabil</b>.</p>
        <label class="btn btn-marinho btn-sm" style="cursor:pointer">⬆ Importar listas (Excel)<input type="file" id="ct-listas" accept=".xlsx,.xls" hidden></label>
        <div class="chips" style="margin-top:.7rem"><span class="chip ${cfg.contas.length ? 'ok' : 'falta'}">${cfg.contas.length} contas contábeis</span><span class="chip ${cfg.ccs.length ? 'ok' : 'falta'}">${cfg.ccs.length} centros de custo</span></div>
        <div class="form-grade" style="margin-top:.9rem">
          <label class="rotulo inteiro">Pacotes <small>(separados por vírgula)</small><input class="campo" id="ct-pacotes" value="${esc(cfg.pacotes.join(', '))}"></label>
          <label class="rotulo">Terceiro<input class="campo" id="ct-terceiro" value="${esc(cfg.terceiro)}"></label>
        </div>
      </section>
      <section class="cartao">
        <h3>2 · Centros de custo <small>· ${ccsBase.length} na base · ${semCc.length ? `<b style="color:#b54d12">${semCc.length} sem vínculo</b>` : 'todos vinculados'}</small></h3>
        <p class="subtitulo" style="margin:0 0 .8rem">O vínculo é automático pelo código (ex.: 17093 → “17093 - RECURSOS HUMANOS”). Ajuste só o que não bater.</p>
        <div class="tabela-wrap" style="max-height:300px"><table class="tabela"><thead><tr><th>CÓD. C. CUSTO da base</th><th class="n">Colab.</th><th>Centro de custo contábil</th></tr></thead>
        <tbody>${ccsBase.map(([cod, nome]) => {
          const v = ccContabil(cfg, cod);
          return `<tr class="${v.como === 'sem' ? 'sem-vinculo' : ''}"><td>${esc(cod || '—')}<span class="sub">${esc(nome)}</span></td><td class="n">${E.dados.colaboradores.filter(c => String(c.cc_cod || '') === cod).length}</td>
            <td><select class="campo" data-cc="${esc(cod)}">${opcoes(cfg.ccs, cfg.mapa_cc[cod] || '', v.como === 'auto' ? `Automático: ${esc(v.cc)}` : `— ${esc(cfg.cc_padrao)} —`)}</select></td></tr>`;
        }).join('')}</tbody></table></div>
      </section>
    </div>

    <section class="cartao" style="margin-top:1.2rem">
      <h3>3 · Item do orçamento → Conta contábil <small>· sugestão inicial pelo nome da conta; troque o que precisar</small></h3>
      <div class="tabela-wrap" style="max-height:420px"><table class="tabela contabil-itens"><thead><tr><th>Item</th><th class="n">Custo anual (${esc(escopo)})</th><th>Pacote</th><th>Conta contábil</th></tr></thead>
      <tbody>${GRUPOS.map(g => `<tr class="grupo"><td colspan="4" style="cursor:default">${g.nome}</td></tr>${RUBRICAS.map((r, k) => ({ r, k })).filter(x => x.r.grupo === g.id).map(({ r, k }) => `
        <tr><td>${esc(r.nome)}</td><td class="n">${brl0.format(anualRub(k))}</td>
        <td><select class="campo" data-pacote="${r.id}">${cfg.pacotes.map(pc => `<option ${pc === pacoteDoItem(cfg, r.id) ? 'selected' : ''}>${esc(pc)}</option>`).join('')}</select></td>
        <td><select class="campo" data-rub="${r.id}">${opcoes(cfg.contas.length ? cfg.contas : Object.values(CONTA_SUGERIDA), contaDoItem2(cfg, r.id), '— não enviar —')}</select></td></tr>`).join('')}`).join('')}</tbody></table></div>
    </section>

    <section class="cartao" style="margin-top:1.2rem">
      <div class="ferramentas" style="margin-bottom:.8rem"><h3 style="margin:0">Prévia · ${esc(escopo)} <small>· ${linhas.length} linha(s) · ${colabs.length} colaborador(es)</small></h3>
        <span class="direita"><label class="check"><input type="checkbox" id="ct-zeradas" ${E.contabil.zeradas ? 'checked' : ''}> incluir linhas zeradas</label></span></div>
      <div class="tabela-wrap alta"><table class="tabela tabela-contabil"><thead><tr><th>Pacote</th><th>Centro de Custo</th><th>Conta Contábil</th><th>Terceiro</th>${meses.map(m => `<th class="n">${m}</th>`).join('')}</tr></thead>
      <tbody>${linhas.slice(0, 400).map(l => `<tr><td>${esc(l.pacote)}</td><td>${esc(l.cc)}</td><td>${esc(l.conta)}</td><td>${esc(cfg.terceiro)}</td>${[...l.meses].map(v => `<td class="n">${Math.round(v) ? num0.format(Math.round(v)) : '-'}</td>`).join('')}</tr>`).join('')
        || '<tr><td colspan="16" class="vazio">Nada para mostrar com esses filtros.</td></tr>'}</tbody></table></div>
      ${linhas.length > 400 ? `<p class="subtitulo" style="margin:.6rem 0 0">Mostrando 400 de ${linhas.length} linhas — o Excel traz todas.</p>` : ''}
    </section>`;

  const salvar = async parcial => {
    try { E.contabil.cfg = await api('/api/contabil', { method: 'PUT', body: parcial }); renderContabil(); } catch (e) { toast(e.message, 'erro'); }
  };
  $('#ct-pacotes', el).addEventListener('change', e => {
    const pacotes = e.target.value.split(',').map(x => x.trim()).filter(Boolean);
    if (pacotes.length < 3) return toast('Informe os três pacotes: pessoal, benefícios e provisões trabalhistas.', 'erro');
    salvar({ pacotes });
  });
  $$('[data-pacote]', el).forEach(s => s.addEventListener('change', () => salvar({ mapa_pacotes: { ...cfg.mapa_pacotes, [s.dataset.pacote]: s.value } })));
  $('#ct-terceiro', el).addEventListener('change', e => salvar({ terceiro: e.target.value }));
  $('#ct-zeradas', el).addEventListener('change', e => { E.contabil.zeradas = e.target.checked; renderContabil(); });
  $$('[data-cc]', el).forEach(s => s.addEventListener('change', () => {
    const mapa = { ...cfg.mapa_cc };
    if (s.value) mapa[s.dataset.cc] = s.value; else delete mapa[s.dataset.cc];
    salvar({ mapa_cc: mapa });
  }));
  $$('[data-rub]', el).forEach(s => s.addEventListener('change', () => {
    const mapa = { ...cfg.mapa_rubricas };
    // "não enviar" fica guardado como '-' para não voltar à sugestão automática
    mapa[s.dataset.rub] = s.value || '-';
    salvar({ mapa_rubricas: mapa });
  }));
  $('#ct-listas', el).addEventListener('change', e => e.target.files[0] && importarListasContabeis(e.target.files[0]));
  $('#ct-baixar', el).addEventListener('click', () => baixarContabil(cfg));
}

async function importarListasContabeis(arquivo) {
  if (!window.XLSX) return toast('Carregando o leitor de Excel… tente de novo.', 'erro');
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
  const coluna = teste => {
    const aba = wb.SheetNames.find(n => teste(normCab(n)));
    if (!aba) return null;
    return XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: false, defval: null }).map(l => String(l?.[0] ?? '').trim())
      .filter(v => v && !/^(CONTA CONTABIL|CENTRO DE CUSTO)$/.test(normCab(v)));
  };
  const contas = coluna(n => n.startsWith('CONTA'));
  const ccs = coluna(n => n.startsWith('CENTRO'));
  if (!contas && !ccs) return toast('Não encontrei as abas "Conta contabil" e "Centro de Custo Contabil".', 'erro');
  const body = {};
  if (contas) body.contas = contas;
  if (ccs) {
    body.ccs = ccs;
    const na = ccs.find(c => /^N\/?A/i.test(c));
    if (na) body.cc_padrao = na;
  }
  E.contabil.cfg = await api('/api/contabil', { method: 'PUT', body });
  toast(`Listas importadas: ${contas?.length ?? 0} contas e ${ccs?.length ?? 0} centros de custo.`);
  renderContabil();
}

function baixarContabil(cfg) {
  if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo.', 'erro');
  const ano = String(E.dados.config.ano);
  const meses = MESES.map(m => `${m}/${ano.slice(-2)}`);
  const linhas = linhasContabeis(cfg);
  const aoa = [['Pacote', 'Centro de Custo', 'Conta Contábil', 'Terceiro', ...meses],
    ...linhas.map(l => [l.pacote, l.cc, l.conta, cfg.terceiro, ...[...l.meses].map(v => Math.round(v * 100) / 100)])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Formato da contabilidade: milhar sem centavos e "-" no zero
  for (let r = 1; r < aoa.length; r++) for (let c = 4; c < 16; c++) {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (ws[ref]) ws[ref].z = '#,##0;-#,##0;"-"';
  }
  ws['!cols'] = [{ wch: 12 }, { wch: 46 }, { wch: 56 }, { wch: 14 }, ...meses.map(() => ({ wch: 12 }))];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: 15 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pessoal');
  const nome = [ano, E.filtro.regional, E.filtro.filial].filter(Boolean).join('-').replace(/[^\w-]+/g, '_');
  XLSX.writeFile(wb, `Orcamento-Contabil-${nome}.xlsx`);
}

// ---------- Coordenadores ----------

async function renderCoordenadores() {
  const el = painel('coordenadores');
  const usuarios = await api('/api/usuarios');
  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Acessos dos <em>coordenadores</em></h1>
      <p class="subtitulo">Cada coordenador entra em <b>${esc(location.origin)}</b> com o login e a senha criados aqui e vê apenas as regionais liberadas: painel, simulação e conferência, sem poder alterar valores.</p></div>
      <button class="btn btn-laranja" id="novo-usuario">+ Novo acesso</button></div>
    <section class="cartao"><div class="tabela-wrap"><table class="tabela">
      <thead><tr><th>Nome</th><th>Login</th><th>Regionais</th><th>Último acesso</th><th>Status</th><th></th></tr></thead>
      <tbody>${usuarios.map(u => `<tr><td><b>${esc(u.nome)}</b></td><td>${esc(u.login)}</td><td>${u.regionais.map(r => `<span class="chip">${esc(r)}</span>`).join(' ')}</td>
        <td>${u.ultimo_acesso ? dataBr(u.ultimo_acesso) : '<span class="sub" style="display:inline">nunca</span>'}</td>
        <td>${u.ativo ? '<span class="etiqueta ok">Ativo</span>' : '<span class="etiqueta neutra">Bloqueado</span>'}</td>
        <td><span class="acoes"><button class="btn-ic" data-editar="${u.id}" title="Editar">✎</button><button class="btn-ic" data-remover="${u.id}" title="Remover">🗑</button></span></td></tr>`).join('')
        || '<tr><td colspan="6"><div class="vazio"><span>🔑</span>Nenhum coordenador cadastrado ainda.</div></td></tr>'}</tbody></table></div></section>`;
  $('#novo-usuario', el).addEventListener('click', () => editarUsuario(null));
  $$('[data-editar]', el).forEach(b => b.addEventListener('click', () => editarUsuario(usuarios.find(u => u.id === Number(b.dataset.editar)))));
  $$('[data-remover]', el).forEach(b => b.addEventListener('click', async () => {
    const u = usuarios.find(x => x.id === Number(b.dataset.remover));
    if (!confirm(`Remover o acesso de ${u.nome}? Os pedidos enviados por ele continuam no histórico.`)) return;
    await api(`/api/usuarios/${u.id}`, { method: 'DELETE' });
    renderCoordenadores();
  }));
}

function editarUsuario(u) {
  const regs = [...new Set([...regionais(), ...(u?.regionais || [])])];
  const d = abrirModal({
    titulo: u ? u.nome : 'Novo acesso de coordenador', sup: 'ACESSO',
    corpo: `<form class="form-grade" id="form-usuario">
      <label class="rotulo">Nome<input class="campo" name="nome" required value="${esc(u?.nome || '')}"></label>
      <label class="rotulo">Login<input class="campo" name="login" required value="${esc(u?.login || '')}" ${u ? 'readonly' : ''} placeholder="ex.: joao.silva"></label>
      <label class="rotulo inteiro">${u ? 'Nova senha <small>(deixe em branco para manter)</small>' : 'Senha inicial <small>(mín. 6 caracteres)</small>'}<input class="campo" name="senha" type="text" ${u ? '' : 'required minlength="6"'} autocomplete="new-password"></label>
      <div class="inteiro rotulo">Regionais que pode ver<div class="regionais-check">${regs.map(r => `<label class="check"><input type="checkbox" name="regionais" value="${esc(r)}" ${u?.regionais.includes(r) ? 'checked' : ''}> ${esc(r)}</label>`).join('') || '<small>Importe a base para listar as regionais.</small>'}</div></div>
      ${u ? `<label class="check inteiro"><input type="checkbox" name="ativo" ${u.ativo ? 'checked' : ''}> Acesso ativo</label>` : ''}
    </form>`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="salvar-usuario">Salvar</button>',
  });
  $('#salvar-usuario', d).addEventListener('click', async () => {
    const f = $('#form-usuario', d);
    if (!f.reportValidity()) return;
    const body = { nome: f.nome.value, login: f.login.value, senha: f.senha.value, regionais: $$('input[name="regionais"]:checked', f).map(i => i.value) };
    if (!body.regionais.length) return toast('Marque ao menos uma regional.', 'erro');
    if (u) body.ativo = f.ativo.checked;
    try {
      await api(u ? `/api/usuarios/${u.id}` : '/api/usuarios', { method: u ? 'PUT' : 'POST', body });
      d.close();
      renderCoordenadores();
      toast(u ? 'Acesso atualizado.' : `Acesso criado. Envie ao coordenador: login “${body.login}” e a senha definida.`);
    } catch (e) { toast(e.message, 'erro'); }
  });
}

// ---------- Histórico ----------

async function renderHistorico() {
  const el = painel('historico');
  const hist = await api('/api/historico');
  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Histórico de <em>alterações</em></h1>
      <p class="subtitulo">Últimas 300 ações registradas na ferramenta.</p></div><a class="btn btn-claro" href="/api/backup">⬇ Backup do banco</a></div>
    <section class="cartao"><div class="tabela-wrap alta"><table class="tabela">
      <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhe</th></tr></thead>
      <tbody>${hist.map(h => `<tr><td>${dataBr(h.quando)}</td><td>${esc(h.quem)}</td><td><b>${esc(h.acao)}</b></td><td style="white-space:normal">${esc(h.detalhe || '')}</td></tr>`).join('')}</tbody>
    </table></div></section>`;
}

// ---------- início ----------

function atualizarAno() {
  const ano = E.dados.config.ano;
  $('#grupo-ano').textContent = `ORÇAMENTO ${ano}`;
  $('#barra-ano').textContent = `ORÇAMENTO DE PESSOAL · ${ano}`;
  document.title = `Orçamento ${ano} · Âmbar`;
}

async function iniciar() {
  try {
    E.eu = await api('/api/eu');
  } catch {
    location.replace('index.html');
    return;
  }
  $$('.so-admin').forEach(x => { x.hidden = !E.eu.admin; });
  $$('.so-coord').forEach(x => { x.hidden = E.eu.admin; });
  $('#u-nome').textContent = E.eu.nome;
  $('#u-papel').textContent = E.eu.admin ? 'Administrador' : `Coordenador · ${E.eu.regionais.join(', ')}`;
  $('#u-avatar').textContent = E.eu.nome.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  if (!E.eu.admin) $('#rot-solic').textContent = 'Meus pedidos';

  await Promise.all([carregar(), carregarSolicitacoes()]);
  atualizarAno();

  $$('.lateral-item[data-aba]').forEach(b => b.addEventListener('click', () => irPara(b.dataset.aba)));
  $('#btn-menu').addEventListener('click', () => $('#lateral').classList.toggle('aberta'));
  $('#sair').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); location.replace('index.html'); });
  $('#f-regional').addEventListener('change', e => { E.filtro.regional = e.target.value; E.filtro.filial = ''; montarFiltros(); renderAba(); });
  $('#f-filial').addEventListener('change', e => { E.filtro.filial = e.target.value; renderAba(); });
  window.addEventListener('beforeunload', e => {
    if (Object.keys(E.rascunho).length || Object.keys(E.prem.edits).length) { e.preventDefault(); e.returnValue = ''; }
  });

  const inicial = location.hash.slice(1);
  const permitido = b => b && !b.hidden;
  irPara(permitido($(`.lateral-item[data-aba="${inicial}"]`)) ? inicial : 'painel');
}

iniciar();
