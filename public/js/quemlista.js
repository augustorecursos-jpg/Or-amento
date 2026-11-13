// "Quem recebe" por lista: Excel com as matrículas de quem recebe o item. Fora da lista → não recebe; na lista e sem
// valor na ferramenta → segue a regra da filial (ex.: penosidade 7,5%); na lista e com valor → mantém.
/* global E, RUBRICAS, IDX, MESES, Motor, XLSX, esc, brl, num0, api, toast, abrirModal, carregar, renderAba, $, $$, normCab, metodoProprio, fmtN */

/** Lê a planilha: matrícula (CHAPA/MATRÍCULA ou 1ª coluna), nome e se recebeu no último mês com valor da lista. */
function lerListaQuem(wb) {
  for (const aba of wb.SheetNames) {
    const l = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null });
    const h = l.findIndex(r => r && r.some(x => /CHAPA|MATRIC/.test(normCab(x))));
    if (h < 0) continue;
    const cab = l[h].map(normCab);
    const iMat = cab.findIndex(x => /CHAPA|MATRIC/.test(x));
    const iNome = cab.findIndex(x => /FUNCIONARIO|COLABORADOR|NOME/.test(x));
    // colunas de mês (1…12 no cabeçalho): a última com algum valor é o "último mês" da lista
    const meses = cab.map((x, i) => (/^(1[0-2]|[1-9])$/.test(x) ? i : -1)).filter(i => i >= 0);
    const linhas = l.slice(h + 1).filter(r => r && r[iMat] != null && String(r[iMat]).trim() && !/TOTAL/.test(normCab(r[iMat])));
    const ultimo = [...meses].reverse().find(i => linhas.some(r => Number(r[i]) > 0));
    return linhas.map(r => ({ mat: String(r[iMat]).trim(), nome: iNome >= 0 ? String(r[iNome] ?? '').trim() : '', semUltimo: ultimo != null && !(Number(r[ultimo]) > 0) }));
  }
  return null;
}

async function importarListaQuem(arquivo, rub, atual, colabs) {
  if (!window.XLSX) return toast('Carregando o leitor de Excel… tente de novo.', 'erro');
  const lista = lerListaQuem(XLSX.read(await arquivo.arrayBuffer(), { type: 'array' }));
  if (!lista?.length) return toast('Não achei a coluna de matrícula (CHAPA ou MATRÍCULA) na planilha.', 'erro');
  const k = IDX[rub];
  const r = RUBRICAS[k];
  const res = E.bruto.res;
  const idx = new Map(res.colaboradores.map((c, i) => [c.id, i]));
  const ano = c => { const i = idx.get(c.id); let s = 0; if (i != null) for (let m = 0; m < 12; m++) s += res.valor(i, k, m); return s; };
  const semZeros = m => m.replace(/^0+/, '');
  const naLista = new Map(lista.map(x => [semZeros(x.mat), x]));
  const achados = new Set();
  const regraTemValor = Boolean(atual) && atual.metodo !== 'nao' && Number(atual.valor) > 0;
  const regraTxt = regraTemValor ? `${fmtN(Number(atual.valor))}${{ pct: '%', fixo: ' R$', multiplo: ' salário(s)' }[metodoProprio(atual)] || ''}` : '';
  const linhas = colabs.map(c => {
    const x = !c.vaga && c.matricula ? naLista.get(semZeros(String(c.matricula).trim())) : null;
    if (x) achados.add(semZeros(x.mat));
    return { c, x, v: ano(c) };
  });
  const naoAchados = lista.filter(x => !achados.has(semZeros(x.mat)));
  const d = abrirModal({
    titulo: `Importar lista: ${r.nome}`, sup: 'QUEM RECEBE', largo: true,
    corpo: `<p style="margin:0"><b>${num0.format(lista.length)}</b> matrícula(s) na lista · <b>${num0.format(achados.size)}</b> encontrada(s) entre os ${num0.format(colabs.length)} do escopo.
        Regra do escopo: <b>${regraTemValor ? esc(regraTxt) : 'sem valor'}</b>${regraTemValor ? '' : ' — quem estiver na lista e zerado não terá de onde pegar o valor; ajuste a regra antes'}.</p>
      <div class="lista-quem-opcoes">
        <label class="check"><input type="checkbox" id="lq-vagas" checked> Vagas seguem a regra (desmarque para zerar as vagas)</label>
        <label class="check"><input type="checkbox" id="lq-ultimo"> Quem está na lista mas não recebeu no último mês dela fica como <b>não recebe</b></label>
        <label class="check"><input type="checkbox" id="lq-todos-regra"> Todos da lista seguem a regra (inclusive quem já tem valor)</label>
      </div>
      <div id="lq-resumo"></div>
      ${naoAchados.length ? `<p style="margin:.3rem 0 0"><small><b>${naoAchados.length} da lista não estão na base</b> (ignorados): ${esc(naoAchados.map(x => `${x.mat}${x.nome ? ` ${x.nome}` : ''}`).join(' · '))}</small></p>` : ''}
      <div class="tabela-wrap" style="max-height:380px"><table class="tabela"><thead><tr><th>Colaborador</th><th>Na lista?</th><th class="n">Hoje (ano)</th><th>Vai ficar</th></tr></thead><tbody id="lq-linhas"></tbody></table></div>`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="lq-ok">Aplicar</button>',
  });
  let plano = [];
  const montar = () => {
    const vagasRegra = $('#lq-vagas', d).checked, ultimoNao = $('#lq-ultimo', d).checked, todosRegra = $('#lq-todos-regra', d).checked;
    plano = linhas.map(l => {
      const { c, x, v } = l;
      const e = c.excecoes?.[rub];
      const recebe = c.vaga ? vagasRegra : Boolean(x) && !(ultimoNao && x.semUltimo);
      let acao = 'mantém', item = null;
      if (!recebe) {
        // grava "não recebe" (protege de mudanças futuras na regra), a não ser que já esteja assim
        if (e?.metodo === 'nao' && !(v > 0.005)) acao = 'mantém (já não recebe)';
        else { acao = 'não recebe'; item = { id: c.id, excecao: { metodo: 'nao', valor: 0 } }; }
      } else if (v <= 0.005 || (todosRegra && e)) {
        // segue a regra: tira o valor próprio; se a regra não alcança a pessoa (quem recebe por CC/cargo), grava a regra nela
        const alcanca = regraTemValor && Motor.elegivel(atual, c);
        acao = regraTemValor ? `regra (${regraTxt})` : 'sem regra para aplicar';
        item = regraTemValor ? { id: c.id, excecao: alcanca ? null : { metodo: metodoProprio(atual), valor: Number(atual.valor) } } : null;
        if (alcanca && !e) { acao = `mantém (já segue a regra)`; item = null; }
      }
      return { ...l, acao, item };
    });
    const cont = t => plano.filter(p => p.acao.startsWith(t)).length;
    $('#lq-resumo', d).innerHTML = `<div class="chips" style="margin:.4rem 0"><span class="chip">🚫 ficam sem: <b>${cont('não recebe')}</b></span><span class="chip">✅ passam a seguir a regra: <b>${cont('regra')}</b></span><span class="chip">= mantêm: <b>${cont('mantém')}</b></span>${cont('sem regra') ? `<span class="chip">⚠ sem regra: <b>${cont('sem regra')}</b></span>` : ''}</div>`;
    const ordem = p => (p.item ? 0 : 1);
    $('#lq-linhas', d).innerHTML = [...plano].sort((a, b) => ordem(a) - ordem(b) || a.c.nome.localeCompare(b.c.nome)).map(p => `<tr${p.item ? '' : ' class="mem-zero"'}>
      <td>${esc(p.c.nome)}<span class="sub">${esc(p.c.matricula || '')}${p.c.vaga ? ' · vaga' : ''} · ${esc(p.c.funcao || '')}</span></td>
      <td>${p.c.vaga ? '—' : p.x ? `sim${p.x.semUltimo ? ' <small>(sem valor no último mês)</small>' : ''}` : 'não'}</td>
      <td class="n">${p.v > 0.005 ? brl.format(p.v) : '–'}</td><td><b>${esc(p.acao)}</b></td></tr>`).join('');
  };
  montar();
  $$('#lq-vagas, #lq-ultimo, #lq-todos-regra', d).forEach(x => x.addEventListener('change', montar));
  $('#lq-ok', d).addEventListener('click', async () => {
    const itens = plano.map(p => p.item).filter(Boolean);
    if (!itens.length) return toast('Nada para mudar.', 'erro');
    if (!confirm(`Gravar ${itens.length} alteração(ões) em ${r.nome}?`)) return;
    try {
      const rr = await api('/api/colaboradores/excecoes', { method: 'PUT', body: { rubrica: rub, itens } });
      d.close();
      await carregar();
      renderAba();
      toast(`${r.nome}: ${rr.atualizados} colaborador(es) atualizado(s) pela lista.`);
    } catch (e) { toast(e.message, 'erro'); }
  });
}
