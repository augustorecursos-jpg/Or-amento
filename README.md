# Orçamento de Pessoal · Âmbar Energia

Ferramenta para montar o orçamento de pessoal por filial: o admin sobe a base (até a coluna **salário**), define
**premissas e regras** por filial, simula o **dissídio mês a mês** e libera o acesso dos **coordenadores regionais**
para conferir e pedir ajustes, que chegam ao admin numa caixa de pedidos.

Mesma identidade visual das outras ferramentas da Âmbar (azul-marinho `#0e3b5c`, laranja `#ec6b24`, lateral com onda).

## Como rodar

Requisito: **Node.js 22.5+** (usa o SQLite nativo do Node, sem banco externo).

```bash
npm install
npm run seed      # opcional: dados fictícios de demonstração + coordenador coord.norte / norte123
npm start         # http://localhost:3000  (usuário: admin · senha: ambar-orcamento)
npm test          # testes do motor de cálculo
```

| Variável | Para quê | Padrão |
|---|---|---|
| `ADMIN_PASSWORD` | Senha do usuário `admin` | `ambar-orcamento` (**troque antes de publicar**) |
| `PORT` | Porta HTTP | `3000` |
| `DATA_DIR` | Pasta do banco (`orcamento.db`) | `./data` |
| `SESSION_SECRET` | Chave dos cookies de sessão | gerada e salva em `data/` |
| `NODE_ENV=production` | Cookies só via HTTPS e senha obrigatória | – |

## Publicação no Render

O `render.yaml` já descreve o serviço (Node + disco persistente de 1 GB para o banco):

1. render.com → **New → Blueprint** → escolha este repositório.
2. Informe o valor de `ADMIN_PASSWORD` quando o Render pedir.
3. Após o deploy, o link `https://….onrender.com` é o endereço que os coordenadores usam.

Custo aproximado: plano Starter (US$ 7/mês) + disco (US$ 0,25/mês). O Render faz snapshot diário do disco e a tela
**Histórico** tem o botão **Backup do banco**. Sem disco (plano free) os dados se perdem a cada deploy.

> O repositório é público: **não** suba as planilhas reais (o `.gitignore` já ignora `*.xlsx`). A base é carregada
> pela própria ferramenta e fica só no disco do servidor.

## Telas

**Admin**
- **Painel** – feito para apresentação: custo anual com a evolução mês a mês, indicadores (headcount, custo médio por
  colaborador, impacto do dissídio, encargos + benefícios), custo mês a mês por grupo, rosca de composição, **ponte do
  salário ao custo total**, cards por regional → filial → centro de custo (clique para descer) e conferência das filiais.
  **Modo apresentação**: tela cheia sem menus; as setas ← → passam pelas regionais.
  **Visão Headcount** (botão 👥 no topo do Painel): cadeiras no orçamento (colaboradores + vagas), ocupadas, vagas previstas,
  desligamentos previstos, HC janeiro → dezembro, headcount mês a mês (ocupadas × vagas) e a tabela de **cadeiras por
  regional, filial, centro de custo, gestor, nível do cargo ou função**, com o custo separado em **ocupadas** e **vagas**,
  custo no ano e custo médio por mês. Clique na linha para abrir a quebra por função, nível do cargo, centro de custo ou
  gestor e a lista das cadeiras (colaborador/vaga, função, CC, gestor, período, salário, custo). O Excel traz o resumo e a
  aba *Cadeiras* (uma linha por colaborador ou vaga).
  O gestor vem da coluna opcional **GESTOR** da base.
- **Filtros do topo** – regional, estado, filial e **centro de custo**, valendo para painel, simulação, base, conferência e
  relatório contábil.
- **Simulação mês a mês** – tabela Jan–Dez por rubrica, filial, centro de custo ou colaborador (R$ ou R$ mil). Nas visões
  por filial e por centro de custo, clique na linha (ou em *Abrir contas de todos*) para ver as **contas lançadas por grupo**;
  o Excel traz a aba *Contas por filial e CC*. Na visão
  por colaborador, clique na pessoa para abrir o que está orçado para ela (salário, adicionais, provisões, encargos,
  PPR, convênio, VA…), mês a mês e no ano. Inclui o
  **simulador de dissídio**: altere o % e o mês da data-base de cada filial e o custo muda na hora; nada é salvo até
  clicar em *Aplicar ao orçamento*. Exporta Excel com resumo mensal, por filial, por centro de custo e por colaborador
  (formato próximo da planilha BZO).
- **Premissas e regras** – para cada filial e cada item: **Tem? (Sim/Não)**, **como é calculado** (% sobre base,
  R$ por colaborador, R$ total da filial rateado, nº de salários) e **valor**. O botão ⚙ guarda os detalhes
  (periodicidade — todo mês, uma vez no ano, anual ÷ 12 —, base do %, teto e rateio por headcount ou salário) e 👥
  define *quem recebe* (centros de custo / níveis de cargo / funções). Herança em três níveis: **regra geral → regional → filial**.
  Mostra o custo anual de cada item antes de salvar e a **distribuição por centro de custo e colaborador** (🔍).
  Filtros de **regional** e **filial** em listas suspensas. Na filial: dissídio e reajuste de benefícios com mês de
  início. Copiar regras de uma filial para outras e dissídio em lote.
  - **Valor diferente em cada mês** (no ⚙ do item): 12 valores, Jan a Dez, em R$ por colaborador ou total da filial —
    ex.: ações de endomarketing. Aceita colar a linha do Excel.
  - **Público por sexo**: coluna opcional **SEXO** (F/M) na base; o item pode valer só para mulheres ou só para homens
    (👥 Quem recebe) e, nos valores por mês, cada mês tem o seu público — ex.: outubro rosa só mulheres, novembro azul só
    homens. No total da filial, o valor é dividido só entre o público do mês. Quem está sem sexo na base não entra.
  - **Por função** (👥 Quem recebe): marque funções da base (coluna FUNÇÃO, ex.: *Jovem Aprendiz*) para o item valer só
    para elas e/ou informe um **valor diferente por função** — ex.: VA de R$ 1.480 para todos e R$ 600 para o aprendiz.
    Vale para %, R$ por colaborador e nº de salários. O valor por função fica na regra em que foi lançado: uma filial com
    VA próprio precisa do valor do aprendiz na regra dela.
  - **Aplicar a forma de pagamento às regras próprias**: na Regra geral (ou numa regional), o ⚙ permite levar a
    periodicidade/mês para as regionais e filiais que têm regra própria, mantendo os valores de cada uma — ex.: PPR inteiro
    em fevereiro em todas as unidades, cada uma com o seu target.
  - **Total da filial vale para todos**: quando um item está como *Total da filial*, os valores daquele item que vieram da
    planilha da base ficam de fora (ex.: rescisão anual da filial); ajustes feitos à mão no cadastro continuam valendo. Ao
    escolher *Total da filial*, o período passa a *total do ano ÷ 12* (dá para trocar no ⚙).
  - **Horas extras, treinamento e viagens**: lance o **custo total do ano** da filial; a ferramenta divide por 12 e faz a
    média por colaborador (só entre quem recebe). Dá para trocar para total por mês no ⚙. Numa regra da regional (ou
    geral), o ⚙ tem **“De quem é este total”**: *de cada filial* (cada filial tem o valor) ou *da regional toda* (um total
    único dividido entre os colaboradores de todas as filiais que seguem a regra — as que têm regra própria ficam fora).
  - **Promoções e méritos** (grupo Remuneração): budget de aumentos — *% sobre o salário* com **“A partir de”** no ⚙ (ex.: 2%
    a partir de abril) ou *Total da filial* (valor do ano ÷ 12). Entra na base de férias, 13º, FGTS e INSS; conta sugerida
    218 - Salários e ordenados (pacote PESSOAL).
  - **PPR = salário × target**: ex.: R$ 13.780 × 2 = R$ 27.560 no ano. Se a filial tem dissídio, usa o **novo salário**
    (ex.: 13.780 × 1,05 × 2); no ⚙ dá para ignorar o dissídio. O valor do ano é lançado no mês escolhido ou
    diluído em 12 meses, e a conta aparece no detalhe do colaborador na Simulação.
  - **PPR**: em “Como é calculado”, a opção **Nº de salários por nível do cargo** abre a tabela de target por nível, que
    aceita **colar do Excel** (NÍVEL CARGO · TARGET). Cada regra (geral, regional ou filial) tem a sua. A regra da
    **Holding** (matriz) já vem cadastrada: Supervisores 2, Administrativo 1, Coordenação 3, Gerentes 5, Diretores 10,
    Operação – Produção 1, Operação – Nível Superior 1, Engenheiros 2, Especialistas 2, Gerentes Executivo 5. As demais
    filiais seguem 2,4 salários (editável).
- **Estado (UF)** – filtro de estado junto de regional e filial em todas as telas (topo, premissas e quadro). O estado é
  sugerido pelo nome da unidade quando ele indica a cidade (Cuiabá → MT, Candiota → RS, UTEs de Manaus → AM…); as demais
  (PCHs, Holding, Fluxus…) ficam “a definir” e são ajustadas em **Premissas → 🗺 Estado de cada filial**.
- **Modelo para preenchimento** (no quadro de filiais): Excel com uma linha por filial e item, já preenchido com o que está
  na ferramenta, colunas amarelas com **listas de seleção** (Tem?, Como é calculado, Quando é pago, Mês) e os 12 meses
  para valores que variam. Respeita os filtros de regional/estado — dá para gerar um arquivo por regional, enviar para
  preenchimento e carregar de volta em **⬆ Importar quadro**; só o que mudou é aplicado.
- **Quadro de todas as filiais** – grade filial × item com o que cada filial tem. **Exporta para Excel**, você preenche
  (`30%`, `1480`, `8000 total`, `2,4 sal`, `Não`, vazio = herda) e **importa de volta**; valores iguais à regra da
  regional/geral não viram exceção.
- **Base de colaboradores** – dados até o **salário** (sem dissídio), no **modelo Excel** que a própria tela baixa:
  matrícula, funcionário, sexo, regional, filial, situação, função, cargo, cód. e nome do centro de custo, gestor, salário, mês
  início e mês fim — mais as colunas opcionais de valores por colaborador (abaixo). Modo *substituir as
  regionais do arquivo* ou *adicionar*. Padrão: **Substituir toda a base** (a base fica só com o que está nos arquivos).
  Painel com o total por regional, aviso de **colaboradores duplicados** (mesma matrícula + nome + filial; a mesma
  matrícula pode existir em empresas diferentes) com **Remover duplicados**, e **Apagar toda a base**. **Vagas** (situação “Nova Vaga” + mês de admissão) e **desligamentos previstos**.
  - **Valores por colaborador vindos da base**: colunas opcionais com o valor de cada pessoa — periculosidade,
    insalubridade, penosidade, adicionais de turno, adicional noturno, rescisão e benefícios (VA, 13º VR, VT, creche,
    educacional, material escolar, óculos (valor do ano ÷ 12), oftalmo, assistência médica, coparticipação, odonto, farmácia, seguro, previdência privada,
    auxílio dependente portadores, refeitório, fretado). **0 = não recebe**, **vazio = segue a regra da filial**. Na importação, a prévia mostra os itens encontrados e
    dá para desmarcar algum. Remuneração e rescisão entram sem dissídio e sobem com o dissídio da filial (quando a planilha
    traz a remuneração calculada sobre o salário com dissídio, a ferramenta detecta pela periculosidade e tira o dissídio);
    benefícios seguem a periodicidade do item nas premissas e recebem o reajuste de benefícios. **Horas extras, PPR, cesta
    natalina e o grupo Demais** continuam pelas premissas (HE = total do ano de cada filial, a coluna da planilha é ignorada); férias, 13º e encargos são calculados sobre os valores. Ajustes feitos à mão
    no cadastro valem por cima da planilha e são mantidos ao reimportar.
  - **Condições próprias por colaborador** (ex.: sucedidos da empresa anterior): no cadastro do colaborador, valores
    próprios de qualquer benefício (R$ por mês, %, nº de salários ou “não recebe”), no lugar da regra da filial. Também
    pela aba opcional *Condições próprias* do modelo (MATRÍCULA · ITEM · VALOR). Reimportar a base mantém essas condições
    pela matrícula.
- **Outros lançamentos** – custos que não são de um colaborador (consultorias, Gupy, uma rescisão prevista num centro de
  custo em um mês…): descrição, regional (ou **Todas as regionais · Brasil**), filial — sem filial, o valor pode ser
  **dividido entre as filiais pelo headcount** de cada mês (calculado no servidor com a base inteira) ou ficar como valor
  único da regional/empresa —, centro de custo (da base ou da lista contábil, ex.:
  25506), item da ferramenta (Rescisão, Treinamento, Viagens…) ou **Outra conta** com a conta contábil escolhida, pacote e o
  valor de cada mês (preenchimento rápido: só num mês, todos os meses ou total do ano ÷ 12; aceita colar a linha do Excel).
  Entram no Painel, na Simulação (📌 lançamento) e no Relatório contábil com a conta e o centro de custo escolhidos; não
  contam no headcount. Excel de modelo/exportação e importação (adicionar ou substituir).
- **Relatório contábil** – arquivo no formato da contabilidade: *Pacote · Centro de Custo · Conta Contábil · Terceiro ·
  Jan/AA … Dez/AA*, com as colunas **Regional** e **Filial** na frente para conferência (desmarque “colunas de regional e
  filial” para gerar somado, no formato original da contabilidade). Importe a planilha com as abas *Conta contabil* e *Centro de Custo Contabil*; cada item do orçamento
  (salário, férias, 13º, FGTS, PPR, plano de saúde, creche…) é ligado a uma conta contábil (sugestão inicial pelo nome,
  editável) e cada CÓD. C. CUSTO da base ao centro de custo contábil de mesmo código (automático, com ajuste manual e
  “N/A Centro de Custo” para o que não bater). Respeita os filtros de regional e filial.
  Quatro pacotes: **PESSOAL** (salário, adicionais, horas extras, rescisão, FGTS, INSS, PPR), **BENEFÍCIOS** (VA/VR, VT,
  saúde, creche, seguro, cesta, fretado, treinamento, endomarketing…), **PROVISÕES TRABALHISTAS** (férias, 13º e FGTS/INSS
  sobre eles) e **TERCEIROS** (Serviços / Terceiros) — o pacote de cada item pode ser trocado na tela. Cada item pode ter um **centro de custo fixo**: Fretado e
  Fretado (overall) vão para **25506 - Transporte Contratado/Mobilidade** (conta 67975 - Transporte contratado/próprio); o VT
  (236 - Vale Transporte) e os demais usam o centro de custo de cada colaborador.
- **Formato EPM** (no Relatório contábil) – prévia e download no layout do EPM: *Código Empresa · Centro_Custo (CC_número) ·
  Conta Contábil (DRE_número)* e Jan…Dez, com o cabeçalho FY27 / mês / Budget_2027 / Trabalho. Importe a planilha do EPM
  (abas *Empresa* e *Centro de Custo*): cada filial é ligada à empresa pelo nome (ajustável), com um código padrão
  (EMP_ANT_Input) para as que não baterem ou, se preferir, para todas. CC sem número na base sai como CC_NA; avisa os CCs
  que não estão na lista do EPM.
- **Pedidos de ajuste** – caixa de entrada com status (aberta, em análise, ajustada, recusada), resposta ao coordenador
  e botão **Abrir item**, que leva direto ao colaborador ou à premissa da filial.
- **Acessos dos coordenadores** – login, senha e regionais de cada coordenador.
- **Histórico** – registro de todas as alterações e backup.

**Guia do coordenador** (`public/guia/guia-do-coordenador.pdf`): link “Primeira vez aqui?” na tela de acesso e item
“Guia do coordenador” no menu lateral, como na Trilha.

**Dois dissídios por filial**: o do **ano anterior** (ex.: data-base 2026), que o salário da base ainda não tem — vale
desde janeiro ou do mês escolhido — e o do **ano do orçamento** (data-base 2027), aplicado por cima no mês da data-base.
Ex.: base 10.000, 2026 5% e 2027 4,5% em agosto → jan–jul 10.500, ago–dez 10.972,50. PPR usa o salário com os dois.
Simulador, premissas da filial, dissídio em lote e os Excel de premissas têm os dois; o Painel mostra o impacto de cada um.

**Filtros do topo com vários itens**: regional, estado, filial, centro de custo e conta são listas com caixinhas (busca,
marcar todos, limpar; vale ao clicar em Aplicar ou fora da lista, Esc cancela). Nada marcado = todos.
**Filtro de conta** (ao lado do centro de custo): grupos inteiros (caixinha do grupo) e/ou contas soltas (Salário,
Horas extras, Adicional noturno…). Vale para Painel, Headcount (custos), Comparativo, Simulação,
Base, Conferência e Relatório contábil (com aviso de que o relatório sai só com a conta filtrada). Premissas sempre
mostram todas as contas.

**Comparativo com o ano anterior (ex.: 2026 × 2027)**
- Em **Base de colaboradores › Histórico do ano anterior**: modelo em Excel (matrícula, funcionário, regional, filial,
  função, cargo, CC e o salário pago em JAN…DEZ). A importação substitui o histórico; a regional é completada pela filial.
  Aceita também **uma linha por colaborador por mês** (colunas Mês/Ano — ex.: "mar./2026" — e Salário; Gp. Cargo vira o
  nível). A pessoa é matrícula + nome + filial (a mesma matrícula existe em empresas diferentes) e o nome da filial é
  ligado ao da ferramenta ("NORTE FLUMINENSE" → "UTE NORTE FLUMINENSE"). Sem centro de custo na planilha, quem ainda está
  na base usa o CC da base.
- Ano que ainda não fechou: os meses depois do último mês da planilha são **projetados** com o salário desse mês de quem
  estava ativo nele (ex.: nov–dez = salário de outubro). Os meses projetados aparecem com * nas telas e no Excel;
  importar de novo com a folha real substitui a projeção.
- O ano anterior é calculado com o salário de cada mês + as **mesmas premissas** do orçamento, **sem dissídio** e **sem
  reajuste de benefícios**. Quem ainda está na base (mesma matrícula) herda os valores próprios da planilha.
  Outros lançamentos só entram no ano do orçamento. O comparativo vai até os encargos: **remuneração, provisões,
  encargos e benefícios**; o grupo Demais (treinamento, viagens, serviços…) fica fora.
- **Painel**: botão “Só 2027 | 2026 × 2027” (a visão atual continua sendo a padrão). No comparativo: KPIs, custo mês a
  mês nos dois anos com Δ R$ e Δ %, ponte de variação por conta, variação por grupo, ranking de aumento por conta
  (clique abre as filiais) e tabela por regional/filial/CC.
- **Headcount**: evolução mês a mês dos dois anos e colunas HC dez/26, Δ HC e minigráfico de 24 meses em “Cadeiras por”
  (filial, função, CC, gestor…).
- **Simulação**: mesmo botão; cada mês mostra o orçado com o realizado abaixo, totais dos dois anos, Δ R$ e Δ %, opção
  “Só Δ”. Quem só existe no ano anterior aparece marcado “só em 2026”. O Excel ganha as abas de comparativo.
- **Legenda das premissas** (Painel, recolhível): a regra de cada conta com custo no filtro, “varia por filial” quando
  as filiais têm regras diferentes e quantos colaboradores usam valor próprio. A mesma regra aparece ao passar o mouse
  nas contas da Simulação.

**Somente visualização** (ex.: gerente) — criado em Acessos dos coordenadores com o perfil “Somente visualização”:
Painel e Simulação das regionais liberadas (ou “Todas as regionais”, inclusive as que entrarem depois), sem
Conferência e sem pedidos de ajuste (o servidor também bloqueia).

**Coordenador** (só as regionais liberadas, sem alterar valores)
- Painel e simulação da regional.
- **Conferência** – cards por filial; premissas aplicadas e a tabela de colaboradores/vagas com **uma coluna por item**
  (salário, periculosidade, HE, férias, 13º, FGTS, PPR, VA, VT, creche, saúde…), por mês ou no ano, com download em Excel.
  Botão **💬** em cada linha para pedir ajuste (salário, centro de custo, desligamento, transferência…), pedido de vaga,
  pedido geral e **Marcar como conferida**.
- **Meus pedidos** – status e resposta do admin.

## Rubricas (todas as que aparecem nas planilhas das regionais)

| Grupo | Rubricas |
|---|---|
| Remuneração | Salário, Periculosidade, Insalubridade, Penosidade, Adicionais de turno, Adicional noturno, Horas extras, Promoções e méritos |
| Provisões | Férias (1/3), 13º salário, Rescisão |
| Encargos | FGTS, FGTS férias, FGTS 13º, INSS, INSS férias, INSS 13º |
| Benefícios | PPR, VA/VR, VA natal / 13º VR, Vale-transporte, Auxílio-creche, Auxílio educacional (ou educação), Material escolar, Auxílio óculos, Oftalmo, Assistência médica, Coparticipação convênio médico, Assistência odontológica, Farmácia, Seguro de vida, Previdência privada, Auxílio dependente portadores, Refeitório, Fretado, Fretado (overall), Cesta natalina |
| Demais | Saúde ocupacional, Endomarketing, Treinamento, Viagens, Confraternizações, Serviços / Terceiros |

Padrões do sistema (regra do ADM de pessoal, ajustáveis em Premissas): periculosidade 30% do salário. Férias, 13º,
FGTS e INSS sobre **salário + adicionais (periculosidade, insalubridade, penosidade, turno/noturno) + horas extras**: férias
+ 1/3 = base ÷ 12 + (base ÷ 12) ÷ 3 (= base ÷ 9); 13º = base ÷ 12; FGTS 8% (e 8% sobre férias e 13º); **INSS 29%** (e 29% sobre férias). PPR 2,4 salários/ano.
**Remuneração em 12 meses** (pedido da gerência): salário, adicionais e horas extras entram cheios nos 12 meses, além da
provisão de férias + 1/3 (base ÷ 9), do 13º (base ÷ 12) e dos encargos (FGTS e INSS sobre a remuneração do mês; FGTS
férias e **INSS férias 29%** sobre a provisão). O motor também aceita 11 meses (`MESES_SALARIO` em `public/js/motor.js`):
aí a remuneração entra em 11/12 e o mês de férias fica só na provisão.
O salário importado é **sem dissídio**: o reajuste entra a partir do mês da data-base de cada filial.

## Estrutura

```
server.js            API (admin e coordenadores) + arquivos estáticos
db.js                esquema SQLite
public/js/motor.js   motor de cálculo (o mesmo arquivo roda no navegador e no servidor)
public/js/app.js     telas
scripts/seed-demo.js dados de demonstração (fictícios)
test/                testes do motor
```
