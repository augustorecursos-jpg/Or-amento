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
  sim: { visao: 'rubricas', mil: false, fechados: new Set(), busca: '' },
  prem: { escopo: '*', edits: {}, filial: {}, busca: '' },
  base: { busca: '', soVagas: false },
  conf: { filial: '' },
  solic: [],
  solicFiltro: 'pendentes',
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
  conferencia: 'Conferência', solicitacoes: 'Pedidos de ajuste', coordenadores: 'Acessos dos coordenadores', historico: 'Histórico',
};

function irPara(aba) {
  E.aba = aba;
  $$('.lateral-item[data-aba]').forEach(b => b.classList.toggle('ativo', b.dataset.aba === aba));
  $$('[data-painel]').forEach(s => { s.hidden = s.dataset.painel !== aba; });
  $('#barra-pagina').textContent = TITULOS[aba];
  $('#barra-filtros').style.visibility = ['painel', 'simulacao', 'base', 'conferencia'].includes(aba) ? '' : 'hidden';
  $('#lateral').classList.remove('aberta');
  history.replaceState(null, '', `#${aba}`);
  renderAba();
  window.scrollTo(0, 0);
}

function renderAba() {
  ({
    painel: renderPainel, simulacao: renderSimulacao, premissas: renderPremissas, base: renderBase,
    conferencia: renderConferencia, solicitacoes: renderSolicitacoes, coordenadores: renderCoordenadores, historico: renderHistorico,
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
      <p>${E.eu.admin ? 'Comece importando as planilhas das regionais em <b>Base de colaboradores</b> (até a coluna salário).' : 'O time de orçamento ainda não carregou a base da sua regional.'}</p>
      ${E.eu.admin ? '<button class="btn btn-laranja" data-ir="base">Importar base</button>' : ''}</div>`;
    el.querySelector('[data-ir]')?.addEventListener('click', () => irPara('base'));
    return;
  }
  const ag = totalDe(E.res);
  const semD = totalDe(E.resSemDissidio);
  const grupos = Motor.porGrupo(ag);
  const hcMedio = ag.hc.reduce((a, b) => a + b, 0) / 12;
  const colabMes = ag.hc.reduce((a, b) => a + b, 0);
  const vagas = col.filter(c => c.vaga).length;
  const impacto = ag.total - semD.total;
  const fil = filiaisComRascunho();
  const mesesDiss = [...new Set(col.map(c => fil[c.filial]).filter(f => f && f.dissidio_pct).map(f => f.dissidio_mes - 1))];
  const encBen = (Motor.porGrupo(ag).encargos.reduce((a, b) => a + b, 0) + grupos.beneficios.reduce((a, b) => a + b, 0)) / (ag.total || 1);
  const escopo = E.filtro.filial || E.filtro.regional || (E.eu.admin ? 'Todas as regionais' : E.eu.regionais.join(', '));

  el.innerHTML = `
    ${faixaRascunho()}
    <div class="hero">
      <div class="pontilhado"></div>
      <div>
        <small>ORÇAMENTO ${esc(ano)} · ${esc(escopo.toUpperCase())}</small>
        <div class="hero-total">${brl0.format(ag.total)}</div>
        <div class="hero-sub">custo anual de pessoal · média de <b>${brl0.format(ag.total / 12)}</b> por mês</div>
      </div>
      <div class="hero-kpis">
        <div class="hero-kpi"><span>Headcount médio</span><strong>${num0.format(hcMedio)}</strong><em>${vagas ? `${vagas} vaga(s) prevista(s)` : 'sem vagas previstas'}</em></div>
        <div class="hero-kpi"><span>Custo médio / colaborador</span><strong>${brl0.format(colabMes ? ag.total / colabMes : 0)}</strong><em>por mês</em></div>
        <div class="hero-kpi"><span>Impacto do dissídio</span><strong>${impacto >= 0 ? '+' : ''}${brl0.format(impacto)}</strong><em>${semD.total ? pctFmt(impacto / semD.total) : '–'} no ano</em></div>
        <div class="hero-kpi"><span>Encargos + benefícios</span><strong>${pctFmt(encBen)}</strong><em>do custo total</em></div>
      </div>
    </div>
    <div class="grade-2">
      <section class="cartao"><h3>Custo mês a mês <small>· por grupo de rubricas${mesesDiss.length ? ' · mês do dissídio em laranja' : ''}</small></h3><div id="g-meses"></div></section>
      <section class="cartao"><h3>Composição do custo anual</h3><div id="g-comp"></div></section>
    </div>
    <div class="grade-2-igual">
      <section class="cartao"><h3>${E.filtro.filial ? 'Custo anual por centro de custo' : 'Custo anual por filial'}</h3><div id="g-ranking"></div></section>
      <section class="cartao"><h3>Conferência das filiais <small>· status informado pelos coordenadores</small></h3><div id="g-conf"></div></section>
    </div>`;
  ligarFaixa(el);

  Graficos.colunasEmpilhadas($('#g-meses', el), {
    rotulos: MESES,
    series: GRUPOS.map(g => ({ nome: g.nome, cor: g.cor, valores: [...grupos[g.id]] })),
    destaque: mesesDiss,
  });
  Graficos.composicao($('#g-comp', el), GRUPOS.map(g => ({ nome: g.nome, cor: g.cor, valor: grupos[g.id].reduce((a, b) => a + b, 0) })));

  const chave = E.filtro.filial ? c => `${c.cc_cod || '—'} · ${c.cc_nome || 'Sem centro de custo'}` : c => c.filial;
  const porChave = Motor.agregar(E.res, chave, noFiltro);
  Graficos.barras($('#g-ranking', el), [...porChave].map(([k, a]) => ({ rotulo: k, valor: a.total, sub: `${a.n} colaborador(es) · ${brl0.format(a.total / 12)}/mês` })).sort((a, b) => b.valor - a.valor));

  const fils = filiaisDa(E.filtro.regional).filter(f => !E.filtro.filial || f === E.filtro.filial);
  const abertas = E.solic.filter(s => s.status === 'aberta' || s.status === 'em_analise');
  const conferidas = fils.filter(f => E.dados.filiais[f].conferencia === 'conferida').length;
  $('#g-conf', el).innerHTML = `
    <p class="subtitulo" style="margin:0 0 .8rem"><b>${conferidas}</b> de <b>${fils.length}</b> filiais conferidas · <b>${abertas.length}</b> pedido(s) de ajuste em aberto</p>
    <div class="status-lista">${fils.map(f => {
      const cfg = E.dados.filiais[f];
      const n = abertas.filter(s => s.filial === f).length;
      return `<div class="status-item"><span title="${esc(f)}">${esc(f)}</span>${n ? `<span class="etiqueta pend" style="flex:none">${n} pedido(s)</span>` : ''}
        ${cfg.conferencia === 'conferida' ? `<span class="etiqueta ok" style="flex:none" title="${esc(cfg.conferida_por || '')}">✓ Conferida</span>` : '<span class="etiqueta neutra" style="flex:none">Pendente</span>'}</div>`;
    }).join('')}</div>`;
}

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
      sub: c ? `${c.funcao || ''} · ${c.filial}` : `${a.n} colaborador(es)`,
      hc: v === 'colaboradores' ? null : Math.max(...a.hc),
      meses: [...a.meses],
      vaga: c?.vaga,
    };
  }).sort((a, b) => b.meses.reduce((s, x) => s + x, 0) - a.meses.reduce((s, x) => s + x, 0));
  const total = MESES.map((_, m) => linhas.reduce((s, l) => s + l.meses[m], 0));
  return { linhas, total, comHc: v !== 'colaboradores' };
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
    <tbody>${linhas.map(l => {
      const t = l.meses.reduce((a, b) => a + b, 0);
      const cls = l.grupo ? `grupo${E.sim.fechados.has(l.grupo) ? ' fechado' : ''}` : l.filho ? 'filho' : l.vaga ? 'vaga' : '';
      return `<tr class="${cls}" ${l.grupo ? `data-grupo="${l.grupo}"` : ''}>
        <td class="fixa" title="${esc(l.rotulo)}">${l.grupo ? `<i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${l.cor};margin-right:.4rem"></i>` : ''}${esc(l.rotulo)}${l.vaga ? ' <span class="etiqueta pend">vaga</span>' : ''}${l.sub ? `<span class="sub">${esc(l.sub)}</span>` : ''}</td>
        ${comHc ? `<td class="n">${l.hc ?? ''}</td>` : ''}${l.meses.map(cel).join('')}<td class="n"><b>${fmtVal(t)}</b></td><td class="n">${pctFmt(t / totAno)}</td></tr>`;
    }).join('')}</tbody>
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
          ${E.sim.visao !== 'rubricas' ? `<input class="campo" id="sim-busca" placeholder="Buscar…" value="${esc(E.sim.busca)}">` : ''}
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
  ligarTabelaSim();
  if (admin) ligarSimulador();
}

function ligarTabelaSim() {
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
  const busca = E.prem.busca.toLowerCase();
  const lista = [`<button class="escopo geral${escopo === '*' ? ' ativo' : ''}" data-escopo="*"><span>★ Regra geral (todas)</span></button>`];
  for (const r of regs) {
    const fils = filiaisDa(r).filter(f => !busca || f.toLowerCase().includes(busca) || r.toLowerCase().includes(busca));
    if (busca && !fils.length) continue;
    lista.push(`<button class="escopo regional${escopo === 'R:' + r ? ' ativo' : ''}" data-escopo="R:${esc(r)}"><span>${esc(r)}</span>${proprias('R:' + r) ? '<i class="pontinho" title="Tem regras próprias"></i>' : ''}</button>`);
    fils.forEach(f => lista.push(`<button class="escopo filial${escopo === f ? ' ativo' : ''}" data-escopo="${esc(f)}"><span>${esc(f)}</span>${proprias(f) ? '<i class="pontinho" title="Tem regras próprias"></i>' : ''}</button>`));
  }

  const ehFilial = Boolean(E.dados.filiais[escopo]);
  const nomeEscopo = escopo === '*' ? 'Regra geral' : escopo.startsWith('R:') ? `Regional ${escopo.slice(2)}` : escopo;
  const colabs = E.dados.colaboradores.filter(colabsDoEscopo(escopo));
  const cfgF = ehFilial ? { ...E.dados.filiais[escopo], ...E.prem.filial } : null;

  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Premissas e <em>regras</em></h1>
      <p class="subtitulo">Defina as regras uma vez na <b>regra geral</b>, ajuste o que for diferente na <b>regional</b> e só o que for exceção na <b>filial</b>. Cada nível herda do nível acima.</p></div></div>
    <div class="prem-grade">
      <aside class="cartao escopos">
        <input class="campo" id="prem-busca" placeholder="Buscar filial…" value="${esc(E.prem.busca)}">
        <div class="escopos-lista">${lista.join('')}</div>
      </aside>
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
        ${escopo === '*' ? '<section class="cartao" style="margin-top:1rem" id="ppr-niveis"></section>' : ''}
        <div class="prem-rodape">
          <span class="info" id="prem-info"></span>
          ${ehFilial ? '<button class="btn btn-claro btn-sm" id="prem-copiar">Copiar regras desta filial para…</button>' : ''}
          <button class="btn btn-claro btn-sm" id="prem-descartar">Descartar</button>
          <button class="btn btn-laranja" id="prem-salvar">Salvar premissas</button>
        </div>
      </div>
    </div>`;

  $$('.escopo', el).forEach(b => b.addEventListener('click', () => trocarEscopo(b.dataset.escopo)));
  const buscaEl = $('#prem-busca', el);
  buscaEl.addEventListener('input', () => { E.prem.busca = buscaEl.value; renderPremissas(); $('#prem-busca').focus(); $('#prem-busca').setSelectionRange(buscaEl.value.length, buscaEl.value.length); });
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
  if (escopo === '*') renderNiveis();
}

function trocarEscopo(escopo) {
  const pend = Object.keys(E.prem.edits).length + Object.keys(E.prem.filial).length;
  if (pend && !confirm('Há alterações não salvas nesta tela. Descartar e trocar?')) return;
  E.prem.escopo = escopo;
  E.prem.edits = {};
  E.prem.filial = {};
  renderPremissas();
  window.scrollTo(0, 0);
}

function unidadeValor(metodo) {
  return { pct: '%', fixo: 'R$/colab.', rateio: 'R$ total', multiplo: '× salário' }[metodo] || '';
}

function linhaPremHtml(rub, previa) {
  const { escopo } = E.prem;
  const { p, propria, origem } = premEfetiva(escopo, rub.id);
  const r = IDX[rub.id];
  let anual = 0;
  for (let i = 0; i < previa.n; i++) for (let m = 0; m < 12; m++) anual += previa.valor(i, r, m);
  const m = p.metodo;
  const sel = (campo, opcoes, valor, extra = '') => `<select class="campo" data-campo="${campo}" ${extra}>${Object.entries(opcoes).map(([k, v]) => `<option value="${k}" ${k === valor ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  const desab = cond => (cond ? '' : ' desab');
  const bases = rub.adicional ? { salario: BASES.salario } : BASES;
  return `<tr class="${propria ? 'propria' : 'herdada'}" data-rub="${rub.id}">
    <td class="rub fixa">${esc(rub.nome)}<small>${propria ? (escopo === '*' ? 'regra geral' : 'regra própria') : `herdada · ${esc(origem)}`}</small></td>
    <td class="n" data-anual>${anual ? brl0.format(anual) : '–'}</td>
    <td>${sel('metodo', METODOS, m)}</td>
    <td class="${desab(m !== 'nao')}"><button class="btn btn-claro btn-sm" data-quem title="Quem recebe esta rubrica">👥 ${p.quem?.length ? `${p.quem.length} grupo(s)` : 'Todos'}</button></td>
    <td class="${desab(m !== 'nao')}"><input class="campo" type="number" step="any" data-campo="valor" value="${p.valor ?? 0}" title="${unidadeValor(m)}"> <small class="sub" style="display:inline">${unidadeValor(m)}</small></td>
    <td class="${desab(m === 'pct')}">${sel('base', bases, p.base)}</td>
    <td class="${desab(['fixo', 'rateio', 'multiplo'].includes(m))}">${sel('periodo', PERIODOS, p.periodo)}</td>
    <td class="${desab(['fixo', 'rateio', 'multiplo'].includes(m) && p.periodo === 'anual_mes')}"><select class="campo" data-campo="mes">${opcoesMes(p.mes)}</select></td>
    <td>${m === 'rateio' ? sel('rateio', { hc: 'Por headcount', salario: 'Proporcional ao salário' }, p.rateio)
      : m === 'multiplo' ? `<label class="check"><input type="checkbox" data-campo="por_nivel" ${p.por_nivel ? 'checked' : ''}> pela tabela de nível</label>`
      : m === 'pct' ? `<input class="campo curto" type="number" step="any" data-campo="teto" value="${p.teto ?? ''}" placeholder="teto R$">` : ''}</td>
    <td><span class="acoes">${anual ? `<button class="btn-ic" data-ver title="Ver distribuição por centro de custo e colaborador">🔍</button>` : ''}${propria ? `<button class="btn-ic" data-reset title="${escopo === '*' ? 'Voltar ao padrão do sistema' : 'Remover regra própria (volta a herdar)'}">↺</button>` : ''}</span></td>
  </tr>`;
}

function desenharTabelaPrem() {
  const previa = calcularPrevia();
  const t = $('#tabela-prem');
  t.innerHTML = `<thead><tr><th class="fixa">Rubrica</th><th class="n">Custo anual</th><th>Método</th><th>Quem recebe</th><th>Valor</th><th>Base</th><th>Periodicidade</th><th>Mês</th><th>Rateio / teto</th><th></th></tr></thead>
    <tbody>${GRUPOS.map(g => `<tr class="grupo"><td class="fixa" colspan="10" style="cursor:default"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${g.cor};margin-right:.4rem"></i>${g.nome}</td></tr>
      ${RUBRICAS.filter(r => r.grupo === g.id && !r.fixa).map(r => linhaPremHtml(r, previa)).join('')}`).join('')}</tbody>`;
  $$('tr[data-rub]', t).forEach(tr => {
    const rub = tr.dataset.rub;
    tr.querySelectorAll('[data-campo]').forEach(inp => inp.addEventListener(inp.tagName === 'SELECT' || inp.type === 'checkbox' ? 'change' : 'input', () => {
      const atual = { ...premEfetiva(E.prem.escopo, rub).p };
      const campo = inp.dataset.campo;
      atual[campo] = inp.type === 'checkbox' ? inp.checked : inp.tagName === 'SELECT' && campo !== 'mes' ? inp.value : inp.value === '' && campo === 'teto' ? null : Number(inp.value);
      E.prem.edits[rub] = atual;
      if (inp.tagName === 'SELECT' || inp.type === 'checkbox') desenharTabelaPrem();
      else atualizarPrevia();
    }));
    tr.querySelector('[data-reset]')?.addEventListener('click', () => { E.prem.edits[rub] = null; desenharTabelaPrem(); });
    tr.querySelector('[data-ver]')?.addEventListener('click', () => verDistribuicao(rub));
    tr.querySelector('[data-quem]').addEventListener('click', () => escolherQuem(rub));
  });
  atualizarRodapePrem(previa);
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

function renderNiveis() {
  const el = $('#ppr-niveis');
  const niveis = { ...E.dados.niveis };
  const cargos = [...new Set(E.dados.colaboradores.map(c => c.cargo).filter(Boolean))].sort();
  cargos.forEach(c => { if (!(c in niveis)) niveis[c] = ''; });
  el.innerHTML = `<h3>PPR por nível do cargo <small>· usado quando a regra do PPR estiver marcada “pela tabela de nível”. Em branco = usa o nº de salários da regra.</small></h3>
    <div class="tabela-wrap" style="max-height:320px"><table class="tabela"><thead><tr><th>Nível do cargo</th><th class="n">Colaboradores</th><th>Nº de salários</th></tr></thead>
    <tbody>${Object.keys(niveis).sort().map(n => `<tr><td>${esc(n)}</td><td class="n">${E.dados.colaboradores.filter(c => c.cargo === n).length}</td><td><input class="campo" style="width:90px;padding:.35rem .5rem" type="number" step="any" data-nivel="${esc(n)}" value="${niveis[n]}"></td></tr>`).join('') || '<tr><td colspan="3" class="vazio">Importe a base para listar os níveis.</td></tr>'}</tbody></table></div>
    <div style="display:flex;justify-content:flex-end;margin-top:.8rem"><button class="btn btn-marinho btn-sm" id="salvar-niveis">Salvar tabela de PPR</button></div>`;
  $('#salvar-niveis', el).addEventListener('click', async () => {
    const out = {};
    $$('[data-nivel]', el).forEach(i => { if (i.value !== '') out[i.dataset.nivel] = Number(i.value); });
    await api('/api/niveis', { method: 'PUT', body: { niveis: out } });
    await carregar();
    renderPremissas();
    toast('Tabela de PPR salva.');
  });
}

// ---------- Base de colaboradores ----------

const ALIASES = {
  matricula: ['CHAPA', 'MATRICULA'],
  nome: ['FUNCIONARIO', 'NOME', 'COLABORADOR'],
  regional: ['REGIONAL'],
  filial: ['FILIAL'],
  situacao: ['DSITUACAO', 'SITUACAO'],
  funcao: ['FUNCAO'],
  cargo: ['CARGO', 'GP. FUNCAO', 'NIVEL CARGO', 'NIVEL DO CARGO'],
  cc_cod: ['CODCCUSTORED', 'COD. C. CUSTO', 'COD. CENTRO DE CUSTO', 'CODIGO CENTRO DE CUSTO'],
  cc_nome: ['NOMECCUSTO', 'DESCRICAO CENTRO DE CUSTO', 'DESCRICAO - CENTRO DE CUSTO', 'CENTRO DE CUSTO'],
  salario: ['SALARIO S/PROV DISSIDIO', 'SALARIO S/ PROV DISSIDIO', 'SALARIO BASE', 'SALARIO'],
  mes_inicio: ['MES INICIO', 'MES ADMISSAO', 'MES DE ADMISSAO'],
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
      <p class="subtitulo">Suba a planilha de cada regional como está hoje — a ferramenta lê até a coluna <b>salário</b> e calcula o resto pelas premissas.</p></div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn btn-claro" id="nova-vaga">+ Nova vaga</button><button class="btn btn-claro" id="novo-colab">+ Colaborador</button></div></div>
    <section class="cartao importar">
      <h3>Importar planilhas <small>· .xlsx ou .csv · pode selecionar várias regionais de uma vez</small></h3>
      <label class="zona-arquivo" id="zona"><input type="file" id="arquivo" accept=".xlsx,.xls,.csv" multiple hidden>
        <strong>Clique ou arraste as planilhas aqui</strong>Colunas lidas: Chapa · Funcionário · Regional · Filial · Situação · Função · Cargo · Centro de custo · Salário
        <br><a href="exemplos/base-modelo.csv" download onclick="event.stopPropagation()">Baixar modelo em branco</a></label>
      <div id="previa" class="previa"></div>
    </section>
    <section class="cartao" style="margin-top:1.2rem">
      <div class="ferramentas">
        <input class="campo" id="base-busca" placeholder="Buscar nome, matrícula, função…" value="${esc(E.base.busca)}" style="min-width:260px">
        <label class="check"><input type="checkbox" id="base-vagas" ${E.base.soVagas ? 'checked' : ''}> só vagas</label>
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
  $('#nova-vaga', el).addEventListener('click', () => editarColaborador(null, { vaga: true }));
  $('#novo-colab', el).addEventListener('click', () => editarColaborador(null, {}));
  desenharBase();
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
      <div><b>${linhas.length}</b> colaboradores · <b>${linhas.filter(l => l.vaga).length}</b> vaga(s) · folha base de <b>${brl0.format(totalSal)}</b>/mês</div>
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
  const lista = E.dados.colaboradores.filter(c => noFiltro(c) && (!E.base.soVagas || c.vaga) &&
    (!busca || `${c.nome} ${c.matricula} ${c.funcao} ${c.cc_nome} ${c.cc_cod}`.toLowerCase().includes(busca)));
  const anual = c => { const i = idx.get(c.id); let s = 0; for (let k = 0; k < RN * 12; k++) s += E.res.valores[i * RN * 12 + k]; return s; };
  $('#base-resumo').innerHTML = `<span class="etiqueta azul">${lista.length} registro(s)</span><span class="etiqueta pend">${lista.filter(c => c.vaga).length} vaga(s)</span>`;
  $('#base-tabela').innerHTML = lista.length ? `<table class="tabela">
    <thead><tr><th class="fixa">Colaborador</th><th>Filial</th><th>Função / cargo</th><th>Centro de custo</th><th class="n">Salário</th><th>Período</th><th class="n">Custo anual</th><th></th></tr></thead>
    <tbody>${lista.slice(0, 1500).map(c => `<tr class="${c.vaga ? 'vaga' : ''}">
      <td class="fixa">${esc(c.nome)}${c.vaga ? ' <span class="etiqueta pend">vaga</span>' : ''}<span class="sub">${esc(c.matricula || '')} · ${esc(c.situacao || '')}</span></td>
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
      ${dl('dl-reg', regionais())}${dl('dl-fil', filiaisDa(''))}${dl('dl-cargo', E.dados.colaboradores.map(x => x.cargo))}
    </form>`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="salvar-colab">Salvar</button>',
  });
  $('#salvar-colab', d).addEventListener('click', async () => {
    const f = $('#form-colab', d);
    if (!f.reportValidity()) return;
    const body = Object.fromEntries(new FormData(f));
    body.vaga = f.vaga.checked;
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
      <p class="subtitulo">Confira colaboradores, salários, vagas e premissas de cada filial. Encontrou algo errado? Clique em <b>💬 Solicitar ajuste</b> — o pedido vai direto para o time de orçamento.</p></div></div>
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
  $$('.filial-card', el).forEach(b => b.addEventListener('click', () => { E.conf.filial = b.dataset.filial; renderConferencia(); }));
  if (E.conf.filial) detalheConferencia();
}

function detalheConferencia() {
  const f = E.conf.filial;
  const cfg = E.dados.filiais[f];
  const el = $('#conf-detalhe');
  const idx = new Map(E.res.colaboradores.map((c, i) => [c.id, i]));
  const colabs = E.dados.colaboradores.filter(c => c.filial === f);
  const anual = c => { const i = idx.get(c.id); let s = 0; for (let k = 0; k < RN * 12; k++) s += E.res.valores[i * RN * 12 + k]; return s; };
  const ativas = RUBRICAS.filter(r => !r.fixa).map(r => ({ r, p: Motor.premissaDe(E.dados.premissas, f, cfg.regional, r.id) })).filter(x => x.p.metodo !== 'nao');
  el.innerHTML = `
    <section class="cartao">
      <div class="prem-cab">
        <div><small>${esc(cfg.regional)}</small><h2>${esc(f)}</h2>
          <p>${cfg.conferencia === 'conferida' ? `✓ Conferida por ${esc(cfg.conferida_por || '')} em ${esc(dataBr(cfg.conferida_em))}` : 'Ainda não conferida'}</p></div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <button class="btn btn-claro btn-sm" id="conf-geral">💬 Pedido geral</button>
          <button class="btn btn-claro btn-sm" id="conf-vaga">+ Solicitar vaga</button>
          ${cfg.conferencia === 'conferida' ? '<button class="btn btn-claro btn-sm" id="conf-status" data-s="pendente">Reabrir conferência</button>' : '<button class="btn btn-laranja btn-sm" id="conf-status" data-s="conferida">✓ Marcar como conferida</button>'}
        </div>
      </div>
      <h3 style="margin:.4rem 0 .7rem;font-size:.95rem">Premissas aplicadas</h3>
      <div class="resumo-prem">
        <div><span>Dissídio</span><b>${num2.format(cfg.dissidio_pct)}% a partir de ${MESES[cfg.dissidio_mes - 1]}</b><button class="btn-ic" data-pedir-prem="dissidio" title="Solicitar ajuste">💬</button></div>
        <div><span>Reajuste de benefícios</span><b>${num2.format(cfg.reaj_benef_pct)}% a partir de ${MESES[cfg.reaj_benef_mes - 1]}</b><button class="btn-ic" data-pedir-prem="reaj_benef" title="Solicitar ajuste">💬</button></div>
        ${ativas.map(({ r, p }) => `<div><span>${esc(r.nome)}</span><b>${esc(descreverComQuem(p))}</b><button class="btn-ic" data-pedir-prem="${r.id}" title="Solicitar ajuste">💬</button></div>`).join('')}
      </div>
      <h3 style="margin:1.4rem 0 .7rem;font-size:.95rem">Colaboradores e vagas <small>· ${colabs.length}</small></h3>
      <div class="tabela-wrap alta"><table class="tabela">
        <thead><tr><th class="fixa">Colaborador</th><th>Função</th><th>Centro de custo</th><th class="n">Salário</th><th>Período</th><th class="n">Custo médio / mês</th><th class="n">Custo anual</th><th></th></tr></thead>
        <tbody>${colabs.map(c => {
          const a = anual(c);
          const meses = c.mes_fim - c.mes_inicio + 1;
          return `<tr class="${c.vaga ? 'vaga' : ''}"><td class="fixa">${esc(c.nome)}${c.vaga ? ' <span class="etiqueta pend">vaga</span>' : ''}<span class="sub">${esc(c.matricula || '')}</span></td>
            <td>${esc(c.funcao || '')}<span class="sub">${esc(c.cargo || '')}</span></td><td>${esc(c.cc_cod || '')}<span class="sub">${esc(c.cc_nome || '')}</span></td>
            <td class="n">${brl.format(c.salario)}</td><td>${meses === 12 ? 'Ano todo' : `${MESES[c.mes_inicio - 1]} – ${MESES[c.mes_fim - 1]}`}</td>
            <td class="n">${brl0.format(a / meses)}</td><td class="n">${brl0.format(a)}</td>
            <td><button class="btn btn-claro btn-sm" data-pedir-colab="${c.id}">💬 Ajuste</button></td></tr>`;
        }).join('')}</tbody></table></div>
    </section>`;
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
  $$('[data-pedir-colab]', el).forEach(b => b.addEventListener('click', () => {
    const c = colabs.find(x => x.id === Number(b.dataset.pedirColab));
    pedirAjuste({ tipo: 'colaborador', filial: f, regional: cfg.regional, alvo_id: String(c.id), alvo_desc: `${c.nome} · ${c.funcao || ''}`, colab: c });
  }));
}

function pedirAjuste(ctx) {
  const c = ctx.colab;
  const camposColab = c ? {
    'Salário': brl.format(c.salario), 'Centro de custo': `${c.cc_cod || ''} ${c.cc_nome || ''}`.trim(), 'Função / cargo': `${c.funcao || ''} · ${c.cargo || ''}`,
    'Desligamento previsto': c.mes_fim === 12 ? 'Sem previsão' : MESES[c.mes_fim - 1], 'Transferência de filial': c.filial, 'Excluir do orçamento': '', 'Outro': '',
  } : null;
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
