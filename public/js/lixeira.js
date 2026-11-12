// Base de colaboradores: revisão dos duplicados (escolher qual registro fica) e lixeira (restaurar ou excluir de vez).
/* global E, RUBRICAS, MESES, esc, brl, num0, api, toast, abrirModal, carregar, renderBase, $, $$, dataBr */

const CAMPOS_DUP = [
  ['matricula', 'Matrícula'], ['nome', 'Nome'], ['filial', 'Filial'], ['situacao', 'Situação'], ['funcao', 'Função'], ['cargo', 'Nível do cargo'],
  ['cc_cod', 'Cód. CC'], ['cc_nome', 'Centro de custo'], ['salario', 'Salário'], ['periodo', 'Período'], ['sexo', 'Sexo'], ['gestor', 'Gestor'],
  ['promo', 'Promoção projetada'], ['excecoes', 'Valores próprios'], ['atualizado_em', 'Atualizado em'],
];
const chaveDup = c => `${c.matricula}|${String(c.nome).trim().toUpperCase()}|${c.filial}`;
function valorDup(c, k) {
  if (k === 'salario') return brl.format(Number(c.salario) || 0);
  if (k === 'periodo') return Number(c.mes_inicio) > 1 || Number(c.mes_fim) < 12 ? `${MESES[(c.mes_inicio || 1) - 1]}–${MESES[(c.mes_fim || 12) - 1]}` : 'Ano todo';
  if (k === 'promo') return Number(c.promo_mes) ? `${brl.format(c.promo_salario)} a partir de ${MESES[c.promo_mes - 1]}${c.promo_cargo ? ` · ${c.promo_cargo}` : ''}` : '—';
  if (k === 'excecoes') {
    const ex = c.excecoes && typeof c.excecoes === 'object' ? c.excecoes : (() => { try { return JSON.parse(c.excecoes || '{}'); } catch { return {}; } })();
    const t = Object.entries(ex).map(([rid, e]) => `${RUBRICAS.find(r => r.id === rid)?.nome || rid}: ${e.metodo === 'nao' ? 'não recebe' : e.valor ?? ''}`);
    return t.length ? t.join(' · ') : '—';
  }
  if (k === 'atualizado_em') return c.atualizado_em ? dataBr(c.atualizado_em) : '';
  return String(c[k] ?? '') || '—';
}

/** Revisão dos duplicados: cada colaborador repetido com os registros lado a lado; escolhe qual fica. */
function revisarDuplicados() {
  const grupos = new Map();
  E.dados.colaboradores.filter(c => !c.vaga).forEach(c => { const k = chaveDup(c); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(c); });
  const lista = [...grupos.values()].filter(g => g.length > 1).map(g => g.sort((a, b) => b.id - a.id))
    .sort((a, b) => a[0].filial.localeCompare(b[0].filial) || a[0].nome.localeCompare(b[0].nome));
  const difs = g => CAMPOS_DUP.filter(([k]) => k !== 'atualizado_em' && new Set(g.map(c => valorDup(c, k))).size > 1).map(([k]) => k);
  const grupoHtml = (g, gi) => {
    const d = difs(g);
    return `<div class="dup-grupo${d.length ? ' com-dif' : ''}" data-g="${gi}">
      <div class="dup-cab"><b>${esc(g[0].nome)}</b> <small>${esc(g[0].matricula || '')} · ${esc(g[0].filial)} · ${g.length} registros${d.length ? ` · <span class="dup-dif-txt">diferem em: ${esc(d.map(k => CAMPOS_DUP.find(x => x[0] === k)[1]).join(', '))}</span>` : ' · idênticos'}</small></div>
      <div class="tabela-wrap"><table class="tabela dup-tabela"><thead><tr><th></th>${g.map((c, i) => `<th><label class="check"><input type="radio" name="dup-${gi}" value="${c.id}" ${i === 0 ? 'checked' : ''}> manter este${i === 0 ? ' <small>(mais recente)</small>' : ''}</label></th>`).join('')}</tr></thead>
        <tbody>${CAMPOS_DUP.map(([k, rot]) => `<tr class="${d.includes(k) ? 'dif' : ''}"><td>${rot}</td>${g.map(c => `<td>${esc(valorDup(c, k))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <label class="check dup-todos"><input type="radio" name="dup-${gi}" value="todos"> manter todos (não são duplicados)</label>
    </div>`;
  };
  const d = abrirModal({
    titulo: 'Revisar duplicados', sup: 'BASE DE COLABORADORES', extra: true,
    corpo: `<p style="margin:0">${num0.format(lista.length)} colaborador(es) aparecem mais de uma vez (mesma matrícula, nome e filial). Em cada um, escolha o registro que <b>fica</b> — os outros vão para a <b>lixeira</b> e podem ser restaurados depois. As linhas em laranja mostram o que é diferente.</p>
      <div class="ferramentas"><label class="check"><input type="checkbox" id="dup-so-dif"> só os que têm diferença (${lista.filter(g => difs(g).length).length})</label>
        <span class="direita"><button class="btn btn-claro btn-sm" id="dup-recentes">Marcar o mais recente em todos</button></span></div>
      <div id="dup-lista">${lista.map(grupoHtml).join('')}</div>`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="dup-ok">Mover os não marcados para a lixeira</button>',
  });
  $('#dup-so-dif', d).addEventListener('change', e => $$('.dup-grupo', d).forEach(x => { x.hidden = e.target.checked && !x.classList.contains('com-dif'); }));
  $('#dup-recentes', d).addEventListener('click', () => $$('.dup-grupo', d).forEach(x => { $('input[type=radio]', x).checked = true; }));
  $('#dup-ok', d).addEventListener('click', async () => {
    const ids = [];
    lista.forEach((g, gi) => {
      const v = $(`input[name="dup-${gi}"]:checked`, d)?.value;
      if (!v || v === 'todos') return;
      g.filter(c => String(c.id) !== v).forEach(c => ids.push(c.id));
    });
    if (!ids.length) return toast('Nada para mover: todos marcados como "manter todos".', 'erro');
    if (!confirm(`Mover ${ids.length} registro(s) para a lixeira?`)) return;
    try {
      const r = await api('/api/colaboradores/remover-duplicados', { method: 'POST', body: { ids } });
      d.close();
      await carregar();
      renderBase();
      toast(`${r.removidos} registro(s) movido(s) para a lixeira.`);
    } catch (e) { toast(e.message, 'erro'); }
  });
}

/** Lixeira: o que saiu da base, com restaurar e excluir definitivamente. */
async function abrirLixeira() {
  const itens = await api('/api/lixeira');
  const naBase = new Set(E.dados.colaboradores.map(chaveDup));
  const motivos = [...new Set(itens.map(i => i.motivo))];
  const d = abrirModal({
    titulo: 'Lixeira', sup: 'BASE DE COLABORADORES', extra: true,
    corpo: `<p style="margin:0">Colaboradores excluídos da base nos últimos 90 dias. <b>Restaurar</b> devolve o registro à base como estava (com os valores próprios); <b>excluir definitivamente</b> apaga da lixeira. O que ficar aqui não entra no orçamento.</p>
      <div class="ferramentas"><input class="campo" id="lix-busca" placeholder="Buscar nome, matrícula, filial…" style="min-width:240px">
        <select class="campo" id="lix-motivo" style="width:auto"><option value="">Todos os motivos</option>${motivos.map(m => `<option>${esc(m)}</option>`).join('')}</select>
        <span class="direita"><small id="lix-cont"></small></span></div>
      <div class="tabela-wrap" style="max-height:440px"><table class="tabela"><thead><tr><th><input type="checkbox" id="lix-todos" title="Marcar os visíveis"></th><th>Colaborador</th><th>Filial</th><th>Função</th><th class="n">Salário</th><th>Motivo</th><th>Quando</th><th></th></tr></thead>
        <tbody>${itens.map(i => { const c = i.dados || {}; const dup = naBase.has(chaveDup(c)); return `<tr data-lix="${i.id}" data-busca="${esc(`${c.nome} ${c.matricula} ${c.filial} ${c.funcao}`.toLowerCase())}" data-motivo="${esc(i.motivo)}">
          <td><input type="checkbox" data-sel="${i.id}"></td><td>${esc(c.nome || '')}<span class="sub">${esc(c.matricula || '')}${c.vaga ? ' · vaga' : ''}</span></td><td>${esc(c.filial || '')}</td><td>${esc(c.funcao || '')}</td>
          <td class="n">${brl.format(Number(c.salario) || 0)}</td><td>${esc(i.motivo)}</td><td>${dataBr(i.quando)}</td>
          <td>${dup ? '<span class="etiqueta pend" title="Já existe um registro com a mesma matrícula, nome e filial na base: restaurar cria um duplicado">já está na base</span>' : ''}</td></tr>`; }).join('') || '<tr><td colspan="8" class="vazio">A lixeira está vazia.</td></tr>'}</tbody></table></div>`,
    rodape: '<button class="btn btn-claro" data-fechar>Fechar</button><button class="btn btn-perigo" id="lix-excluir">Excluir definitivamente</button><button class="btn btn-laranja" id="lix-restaurar">Restaurar marcados</button>',
  });
  const visiveis = () => $$('tr[data-lix]', d).filter(tr => !tr.hidden);
  const filtrar = () => {
    const b = $('#lix-busca', d).value.trim().toLowerCase(), m = $('#lix-motivo', d).value;
    $$('tr[data-lix]', d).forEach(tr => { tr.hidden = (b && !tr.dataset.busca.includes(b)) || (m && tr.dataset.motivo !== m); });
    $('#lix-cont', d).textContent = `${visiveis().length} de ${itens.length}`;
  };
  filtrar();
  $('#lix-busca', d).addEventListener('input', filtrar);
  $('#lix-motivo', d).addEventListener('change', filtrar);
  $('#lix-todos', d).addEventListener('change', e => visiveis().forEach(tr => { $('[data-sel]', tr).checked = e.target.checked; }));
  const marcados = () => $$('[data-sel]', d).filter(x => x.checked && !x.closest('tr').hidden).map(x => Number(x.dataset.sel));
  const acao = async (url, txt, pergunta) => {
    const ids = marcados();
    if (!ids.length) return toast('Marque pelo menos um registro.', 'erro');
    if (!confirm(pergunta(ids.length))) return;
    try {
      await api(url, { method: 'POST', body: { ids } });
      d.close();
      await carregar();
      renderBase();
      toast(txt(ids.length));
    } catch (e) { toast(e.message, 'erro'); }
  };
  $('#lix-restaurar', d).addEventListener('click', () => {
    const dup = marcados().filter(id => $(`tr[data-lix="${id}"] .etiqueta`, d)).length;
    acao('/api/lixeira/restaurar', n => `${n} registro(s) restaurado(s).`,
      n => `Restaurar ${n} registro(s) para a base?${dup ? `\n\nAtenção: ${dup} já tem(têm) registro igual na base e vai(vão) ficar duplicado(s).` : ''}`);
  });
  $('#lix-excluir', d).addEventListener('click', () => acao('/api/lixeira/excluir', n => `${n} registro(s) excluído(s) definitivamente.`,
    n => `Excluir ${n} registro(s) definitivamente? Não dá para desfazer.`));
}
