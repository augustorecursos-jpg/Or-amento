// Memória de cálculo: o que foi considerado em cada conta, por grupo (pacotes do relatório contábil), com a premissa
// aplicada no escopo dos filtros do topo e os totais do ano anterior e do orçamento.
/* global E, RUBRICAS, GRUPOS, MESES, Motor, esc, brl0, num0, totalDe, somaRub, anoAnt, regraDaRubrica, filiaisVisiveis,
   filiaisComRascunho, textoReajuste, notaProjecao, notaRealizadoAnt, escopoFiltro, ccFiltrado, nomeContaFiltro, contaNoFiltro,
   deltaFmt, deltaPct, clsDelta, painel, toast, FORA_CMP, FORA_CMP_TXT, CONTA_SUGERIDA, noFiltro */

const REMUN_TXT = 'remuneração do mês (salário + adicionais, horas extras, banco de horas e promoções)';

const MEMORIA_GRUPO = {
  pessoal: 'Tudo o que é pago como remuneração na folha, mais os encargos do mês (FGTS e INSS), as rescisões e a PPR. A remuneração (salário + adicionais, horas extras, banco de horas e promoções) é a base sobre a qual são calculados férias, 13º, FGTS e INSS.',
  provisoes: 'Valores reservados todo mês para pagar férias e 13º salário no futuro, com o FGTS e o INSS que incidem sobre eles. São calculados mês a mês sobre a remuneração de cada colaborador, por isso acompanham dissídio, promoções e movimentações do quadro.',
  beneficios: 'Benefícios oferecidos aos colaboradores e as despesas gerais de pessoal (exames, endomarketing, treinamento, viagens, confraternizações e terceiros). Cada filial define se tem o item, como é calculado, o valor e quem recebe; o reajuste de benefícios da filial entra a partir da data-base. As despesas gerais ficam fora do comparativo com o ano anterior.',
};

// [o que é, como calculamos]
const MEMORIA_CONTA = {
  salario: ['Salário-base de cada colaborador da base e das vagas previstas.', 'Salário da base × meses ativos (da admissão ou abertura da vaga até o desligamento previsto). O dissídio do ano anterior entra o ano todo, se a base ainda não o tem; o dissídio do orçamento entra a partir da data-base. Promoção projetada troca o salário a partir do mês informado. No ano anterior: salário pago em cada mês (histórico da folha).'],
  periculosidade: ['Adicional pago a quem trabalha em área de risco (padrão 30% do salário).', '% sobre o salário de quem recebe (todos ou grupos por cargo, função ou centro de custo), ou o valor do colaborador na planilha da base. Acompanha o dissídio.'],
  insalubridade: ['Adicional por exposição a agentes nocivos à saúde.', '% sobre a base definida na premissa para quem recebe, ou o valor do colaborador na planilha da base.'],
  penosidade: ['Adicional por atividade penosa previsto em acordo coletivo.', '% sobre a base definida na premissa para quem recebe, ou o valor do colaborador na planilha da base.'],
  adic_turno: ['Adicionais de turno, intrajornada e passagem de turno.', '% sobre o salário, R$ por colaborador ou o valor do colaborador na planilha da base, para quem recebe.'],
  adic_noturno: ['Adicional pelas horas trabalhadas no período noturno.', 'Total da filial dividido entre os colaboradores ativos no mês, % sobre o salário ou o valor do colaborador na planilha da base.'],
  horas_extras: ['Horas trabalhadas além da jornada.', 'Total da filial (normalmente a média do histórico) no período definido, dividido entre os colaboradores ativos no mês: média por colaborador ou proporcional ao salário. Pode ter valor diferente em cada mês.'],
  banco_horas: ['Pagamento de saldo de banco de horas.', 'Total da filial, R$ por colaborador ou %, nos meses definidos. Entra na base de férias, 13º, FGTS e INSS.'],
  promocoes: ['Budget de aumentos por promoção e mérito.', '% sobre o salário a partir do mês definido (com um 2º aumento opcional, cumulativo) ou total da filial. No modo provisão, aparece só nos meses do aumento e depois o valor acumulado passa a compor o salário da filial, com os encargos.'],
  rescisao: ['Custos de desligamentos (verbas rescisórias).', 'R$ por colaborador, % ou total da filial, conforme a premissa, ou o valor do colaborador na planilha da base.'],
  fgts: ['FGTS do mês.', `% da premissa (padrão 8%) sobre a ${REMUN_TXT}.`],
  inss: ['Contribuição previdenciária patronal do mês.', `% total da premissa (padrão 29%) sobre a ${REMUN_TXT}.`],
  ppr: ['Participação nos resultados.', 'Nº de salários (target da filial ou por nível do cargo) × salário de dezembro com dissídio e promoção, provisionado ÷ 12 ou pago no mês definido. Pode também ser % da folha.'],
  ferias: ['Provisão de férias + 1/3.', `${REMUN_TXT.charAt(0).toUpperCase()}${REMUN_TXT.slice(1)} ÷ 12 + 1/3 = remuneração ÷ 9 (11,11% ao mês).`],
  decimo: ['Provisão do 13º salário.', `${REMUN_TXT.charAt(0).toUpperCase()}${REMUN_TXT.slice(1)} ÷ 12 (8,33% ao mês).`],
  fgts_ferias: ['FGTS sobre a provisão de férias.', '% da premissa (padrão 8%) sobre a provisão de férias + 1/3 do mês.'],
  fgts_13: ['FGTS sobre a provisão de 13º.', '% da premissa (padrão 8%) sobre a provisão de 13º do mês.'],
  inss_ferias: ['INSS patronal sobre a provisão de férias.', '% da premissa (padrão 29%) sobre a provisão de férias + 1/3 do mês.'],
  inss_13: ['INSS patronal sobre a provisão de 13º.', '% da premissa sobre a provisão de 13º do mês, nas filiais em que o item está ativo.'],
  va: ['Vale-alimentação / vale-refeição (PAT).', 'R$ por colaborador por mês (ou o valor do colaborador na planilha da base), para quem recebe, com o reajuste de benefícios a partir da data-base.'],
  va_natal: ['Crédito extra de VA/VR no fim do ano (VA natal / 13º VR).', 'R$ por colaborador, uma vez no ano, no mês definido na premissa.'],
  vt: ['Vale mobilidade (antigo vale-transporte).', 'R$ por colaborador por mês ou o valor do colaborador na planilha da base, com o reajuste de benefícios.'],
  aux_creche: ['Auxílio-creche para filhos em idade de creche.', 'R$ por colaborador que recebe (indicados na planilha da base ou em "quem recebe"), com o reajuste de benefícios.'],
  educacional: ['Auxílio para estudos (graduação, pós, idiomas…).', 'R$ por colaborador que recebe ou total da filial, conforme a premissa.'],
  material_escolar: ['Auxílio para material escolar dos filhos.', 'R$ por colaborador ou total da filial, nos meses definidos (normalmente início de semestre).'],
  aux_oculos: ['Auxílio para compra de óculos.', 'Valor do ano dividido em 12 meses, por colaborador ou total da filial.'],
  oftalmo: ['Consultas e exames oftalmológicos.', 'R$ por colaborador ou total da filial, conforme a premissa.'],
  assist_medica: ['Plano de saúde.', 'R$ por colaborador (titular e dependentes, conforme o valor lançado) ou o valor do colaborador na planilha da base, com o reajuste de benefícios.'],
  coparticipacao: ['Parte das despesas médicas do convênio paga pela empresa.', 'R$ por colaborador ou total da filial, conforme a premissa.'],
  assist_odonto: ['Plano odontológico.', 'R$ por colaborador ou o valor do colaborador na planilha da base, com o reajuste de benefícios.'],
  farmacia: ['Convênio farmácia (medicamentos).', 'R$ por colaborador ou total da filial, conforme a premissa.'],
  seguro_vida: ['Seguro de vida em grupo.', 'R$ por colaborador ou % sobre o salário, conforme a premissa.'],
  previdencia: ['Previdência privada: contribuição da empresa.', '% sobre o salário ou R$ por colaborador participante.'],
  aux_dependente: ['Auxílio a dependente com deficiência.', 'R$ por colaborador que recebe.'],
  aux_matrimonio: ['Auxílio pago no casamento do colaborador.', 'Total da filial ou R$ por colaborador nos meses definidos (com base no realizado).'],
  aux_nascituro: ['Auxílio pago no nascimento de filho.', 'Total da filial ou R$ por colaborador nos meses definidos (com base no realizado).'],
  refeitorio: ['Refeitório / alimentação no local de trabalho.', 'Total da filial no mês, dividido entre os colaboradores ativos.'],
  fretado: ['Transporte fretado da filial.', 'Total da filial no mês, dividido entre os colaboradores ativos; lançado no centro de custo de mobilidade.'],
  fretado_overall: ['Transporte fretado de uso compartilhado (overall).', 'Total da filial no mês, dividido entre os colaboradores ativos; lançado no centro de custo de mobilidade.'],
  cesta_natalina: ['Cesta de Natal.', 'R$ por colaborador, uma vez no ano (normalmente dezembro).'],
  saude_ocupacional: ['Exames periódicos, admissionais e demissionais (saúde ocupacional).', 'R$ por colaborador ou total da filial, conforme a premissa.'],
  endomarketing: ['Ações de endomarketing e comunicação interna.', 'R$ por colaborador por mês ou valores diferentes por mês; ações pontuais entram por Outros lançamentos.'],
  treinamento: ['Cursos e treinamentos.', 'Total da filial no ano, dividido em 12 meses entre os colaboradores ativos.'],
  viagens: ['Diárias e viagens.', 'Total da filial no ano, dividido em 12 meses entre os colaboradores ativos.'],
  confraternizacoes: ['Confraternizações.', 'R$ por colaborador, uma vez no ano (normalmente dezembro).'],
  servicos: ['Serviços de terceiros e consultorias ligadas a pessoal.', 'Total da filial conforme a premissa (pacote TERCEIROS no relatório contábil).'],
  outras: ['Outras despesas lançadas à parte (consultorias, sistemas…).', 'Somente por Outros lançamentos: valor, mês e conta contábil informados no próprio lançamento.'],
};

/** Conta contábil do item: a escolhida em "Relatório contábil" ou a sugerida. */
function contaContabilDe(rid) {
  const m = E.dados.contasItens || {};
  if (m[rid] === '-') return '';
  return m[rid] || (typeof CONTA_SUGERIDA !== 'undefined' ? CONTA_SUGERIDA[rid] : '') || '';
}

/** Linhas da memória de cálculo no escopo do topo (todas as contas, ou as do filtro de conta). */
function linhasMemoria() {
  const ks = contaNoFiltro();
  const a1 = totalDe(E.bruto.res);
  const a0 = E.bruto.resAnt ? totalDe(E.bruto.resAnt) : null;
  const fils = filiaisVisiveis();
  return GRUPOS.map(g => ({
    g,
    contas: RUBRICAS.map((r, k) => ({ r, k })).filter(({ r, k }) => r.grupo === g.id && (!ks || ks.includes(k))).map(({ r, k }) => ({
      r, k, conta: contaContabilDe(r.id), oque: MEMORIA_CONTA[r.id]?.[0] || '', como: MEMORIA_CONTA[r.id]?.[1] || '',
      regra: regraDaRubrica(r.id, fils), v1: somaRub(a1, k), v0: a0 && !FORA_CMP.has(r.id) ? somaRub(a0, k) : null,
    })),
  })).filter(x => x.contas.length);
}

/** Regras gerais do orçamento (abertura da memória). */
function regrasGeraisMemoria() {
  const ano = E.dados.config.ano, ant = anoAnt();
  return [
    `${ano} é calculado colaborador a colaborador (base + vagas previstas), mês a mês.`,
    'A regra de cada conta vem da regra geral, que a regional herda e a filial herda; a filial pode ter regra própria e o colaborador pode ter valor personalizado (ou o valor da planilha da base), que vale sobre a regra.',
    'Vagas entram a partir do mês de abertura, com o salário previsto; desligamentos previstos saem no mês de saída.',
    'Dissídio do ano anterior: aplicado o ano todo quando a base ainda não tem o reajuste. Dissídio do orçamento: a partir da data-base de cada filial. O reajuste de benefícios segue a mesma lógica.',
    'Outros lançamentos (valores pontuais por filial, regional ou centro de custo) somam à conta escolhida no mês lançado.',
    E.bruto.resAnt ? `${ant}: salário pago em cada mês (histórico da folha) com as mesmas regras${notaProjecao() ? ` · ${notaProjecao()}` : ''}${notaRealizadoAnt() ? ` · ${notaRealizadoAnt()}` : ''}. O comparativo deixa de fora as ${FORA_CMP_TXT}.` : '',
  ].filter(Boolean);
}

function renderMemoria() {
  const el = painel('memoria');
  const ano = E.dados.config.ano, ant = anoAnt();
  const temAnt = Boolean(E.bruto.resAnt);
  const escopo = [escopoFiltro(E.eu.admin ? 'Todas as regionais' : E.eu.regionais.join(' · ')), ccFiltrado(), nomeContaFiltro()].filter(Boolean).join(' · ');
  const grupos = linhasMemoria();
  const fils = filiaisVisiveis();
  const reaj = new Map();
  fils.forEach(f => {
    const cfg = filiaisComRascunho()[f];
    const t = `Dissídio: ${textoReajuste(cfg, 'dissidio')} · Benefícios: ${textoReajuste(cfg, 'reaj_benef')}`;
    if (!reaj.has(t)) reaj.set(t, []);
    reaj.get(t).push(f);
  });
  const val = v => (v == null ? '<span class="zero">fora do comparativo</span>' : Math.abs(v) >= 0.5 ? brl0.format(v) : '–');
  el.innerHTML = `
    <div class="painel-topo"><div><small>MEMÓRIA DE CÁLCULO · ${esc(ano)}</small><h1>${esc(escopo)}</h1></div>
      <div class="painel-acoes"><button class="btn btn-marinho" id="mem-excel">⬇ Excel</button><button class="btn btn-claro" id="mem-imprimir">🖨 Imprimir / PDF</button></div></div>
    <section class="cartao mem-gerais"><h3>Regras gerais</h3><ul>${regrasGeraisMemoria().map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <h4>Reajustes nas filiais do filtro</h4>
      <ul>${[...reaj].map(([t, fs]) => `<li>${esc(t)} <small>· ${fs.length > 6 ? `${fs.length} filiais` : esc(fs.join(', '))}</small></li>`).join('')}</ul></section>
    ${grupos.map(({ g, contas }) => {
      const t1 = contas.reduce((s, c) => s + c.v1, 0), t0 = contas.reduce((s, c) => s + (c.v0 || 0), 0);
      return `<section class="cartao mem-grupo" style="--c:${g.cor}">
        <h3><i class="bola" style="background:${g.cor}"></i>${esc(g.nome)} <small>· ${esc(ano)}: ${brl0.format(t1)}${temAnt ? ` · ${ant}: ${brl0.format(t0)}` : ''}</small></h3>
        <p class="mem-intro">${esc(MEMORIA_GRUPO[g.id])}</p>
        <div class="tabela-wrap"><table class="tabela mem-tabela"><thead><tr><th style="width:17%">Conta</th><th style="width:30%">O que é e como calculamos</th><th>Premissa aplicada (filtro do topo)</th>${temAnt ? `<th class="n">${ant}</th>` : ''}<th class="n">${esc(ano)}</th>${temAnt ? '<th class="n">Δ</th>' : ''}</tr></thead>
          <tbody>${contas.map(c => `<tr class="${Math.abs(c.v1) < 0.5 && !c.v0 ? 'mem-zero' : ''}">
            <td><b>${esc(c.r.nome)}</b>${c.conta ? `<span class="sub conta">${esc(c.conta)}</span>` : ''}</td>
            <td><b>${esc(c.oque)}</b><br>${esc(c.como)}</td>
            <td class="mem-regra">${esc(c.regra || '—')}</td>
            ${temAnt ? `<td class="n">${val(c.v0)}</td>` : ''}<td class="n"><b>${val(c.v1)}</b></td>
            ${temAnt ? `<td class="n ${c.v0 == null ? '' : clsDelta(c.v1 - c.v0)}">${c.v0 == null ? '' : Math.abs(c.v1 - c.v0) >= 0.5 ? `${deltaFmt(c.v1 - c.v0)}<span class="sub">${c.v0 ? deltaPct(c.v1 - c.v0, c.v0) : 'novo'}</span>` : '–'}</td>` : ''}</tr>`).join('')}</tbody></table></div></section>`;
    }).join('')}`;
  $('#mem-imprimir', el).addEventListener('click', () => window.print());
  $('#mem-excel', el).addEventListener('click', () => {
    if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo.', 'erro');
    const r2 = v => (v == null ? '' : Math.round(v * 100) / 100);
    const aoa = [[`Memória de cálculo · Orçamento de Pessoal ${ano} · ${escopo}`], [], ['Regras gerais'], ...regrasGeraisMemoria().map(t => ['', t]),
      ['Reajustes'], ...[...reaj].map(([t, fs]) => ['', `${t} — ${fs.join(', ')}`]), [],
      ['Grupo', 'Conta', 'Conta contábil', 'O que é', 'Como calculamos', 'Premissa aplicada', ...(temAnt ? [String(ant)] : []), String(ano), ...(temAnt ? ['Δ R$', 'Δ %'] : [])]];
    grupos.forEach(({ g, contas }) => contas.forEach(c => aoa.push([g.nome, c.r.nome, c.conta, c.oque, c.como, c.regra,
      ...(temAnt ? [c.v0 == null ? 'fora do comparativo' : r2(c.v0)] : []), r2(c.v1),
      ...(temAnt ? [c.v0 == null ? '' : r2(c.v1 - c.v0), c.v0 ? Math.round(((c.v1 - c.v0) / c.v0) * 1000) / 10 : ''] : [])])));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 22 }, { wch: 28 }, { wch: 40 }, { wch: 45 }, { wch: 70 }, { wch: 70 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 8 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Memória de cálculo');
    XLSX.writeFile(wb, `Memoria-de-calculo-${ano}-${escopo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').slice(0, 50)}.xlsx`);
  });
}
