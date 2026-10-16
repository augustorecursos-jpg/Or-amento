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
- **Simulação mês a mês** – tabela Jan–Dez por rubrica, filial, centro de custo ou colaborador (R$ ou R$ mil). Na visão
  por colaborador, clique na pessoa para abrir o que está orçado para ela (salário, adicionais, provisões, encargos,
  PPR, convênio, VA…), mês a mês e no ano. Inclui o
  **simulador de dissídio**: altere o % e o mês da data-base de cada filial e o custo muda na hora; nada é salvo até
  clicar em *Aplicar ao orçamento*. Exporta Excel com resumo mensal, por filial, por centro de custo e por colaborador
  (formato próximo da planilha BZO).
- **Premissas e regras** – para cada filial e cada item: **Tem? (Sim/Não)**, **como é calculado** (% sobre base,
  R$ por colaborador, R$ total da filial rateado, nº de salários) e **valor**. O botão ⚙ guarda os detalhes
  (periodicidade — todo mês, uma vez no ano, anual ÷ 12 —, base do %, teto e rateio por headcount ou salário) e 👥
  define *quem recebe* (centros de custo / níveis de cargo). Herança em três níveis: **regra geral → regional → filial**.
  Mostra o custo anual de cada item antes de salvar e a **distribuição por centro de custo e colaborador** (🔍).
  Filtros de **regional** e **filial** em listas suspensas. Na filial: dissídio e reajuste de benefícios com mês de
  início. Copiar regras de uma filial para outras e dissídio em lote.
  - **Horas extras, treinamento e viagens**: lance o **custo total do ano** da filial; a ferramenta divide por 12 e faz a
    média por colaborador (só entre quem recebe). Dá para trocar para total por mês no ⚙.
  - **PPR = salário × target**: ex.: R$ 13.780 × 2 = R$ 27.560 no ano. Se a filial tem dissídio, usa o **novo salário**
    (ex.: 13.780 × 1,05 × 2); no ⚙ dá para ignorar o dissídio. O valor do ano é lançado no mês escolhido ou
    diluído em 12 meses, e a conta aparece no detalhe do colaborador na Simulação.
  - **PPR**: em “Como é calculado”, a opção **Nº de salários por nível do cargo** abre a tabela de target por nível, que
    aceita **colar do Excel** (NÍVEL CARGO · TARGET). Cada regra (geral, regional ou filial) tem a sua. A regra da
    **Holding** (matriz) já vem cadastrada: Supervisores 2, Administrativo 1, Coordenação 3, Gerentes 5, Diretores 10,
    Operação – Produção 1, Operação – Nível Superior 1, Engenheiros 2, Especialistas 2, Gerentes Executivo 5. As demais
    filiais seguem 2,4 salários (editável).
- **Quadro de todas as filiais** – grade filial × item com o que cada filial tem. **Exporta para Excel**, você preenche
  (`30%`, `1480`, `8000 total`, `2,4 sal`, `Não`, vazio = herda) e **importa de volta**; valores iguais à regra da
  regional/geral não viram exceção.
- **Base de colaboradores** – só os dados até o **salário** (sem dissídio), no **modelo Excel de 12 colunas** que a
  própria tela baixa: matrícula, funcionário, regional, filial, situação, função, cargo, cód. e nome do centro de custo,
  salário, mês início e mês fim. Benefícios, adicionais, encargos e provisões **não** vêm da planilha. Modo *substituir as
  regionais do arquivo* ou *adicionar*. **Vagas** (situação “Nova Vaga” + mês de admissão) e **desligamentos previstos**.
  - **Condições próprias por colaborador** (ex.: sucedidos da empresa anterior): no cadastro do colaborador, valores
    próprios de qualquer benefício (R$ por mês, %, nº de salários ou “não recebe”), no lugar da regra da filial. Também
    pela aba opcional *Condições próprias* do modelo (MATRÍCULA · ITEM · VALOR). Reimportar a base mantém essas condições
    pela matrícula.
- **Relatório contábil** – arquivo no formato da contabilidade: *Pacote · Centro de Custo · Conta Contábil · Terceiro ·
  Jan/AA … Dez/AA*. Importe a planilha com as abas *Conta contabil* e *Centro de Custo Contabil*; cada item do orçamento
  (salário, férias, 13º, FGTS, PPR, plano de saúde, creche…) é ligado a uma conta contábil (sugestão inicial pelo nome,
  editável) e cada CÓD. C. CUSTO da base ao centro de custo contábil de mesmo código (automático, com ajuste manual e
  “N/A Centro de Custo” para o que não bater). Respeita os filtros de regional e filial.
- **Pedidos de ajuste** – caixa de entrada com status (aberta, em análise, ajustada, recusada), resposta ao coordenador
  e botão **Abrir item**, que leva direto ao colaborador ou à premissa da filial.
- **Acessos dos coordenadores** – login, senha e regionais de cada coordenador.
- **Histórico** – registro de todas as alterações e backup.

**Coordenador** (só as regionais liberadas, sem alterar valores)
- Painel e simulação da regional.
- **Conferência** – cards por filial; premissas aplicadas e lista de colaboradores/vagas com custo mensal e anual.
  Botão **💬** em cada linha para pedir ajuste (salário, centro de custo, desligamento, transferência…), pedido de vaga,
  pedido geral e **Marcar como conferida**.
- **Meus pedidos** – status e resposta do admin.

## Rubricas (todas as que aparecem nas planilhas das regionais)

| Grupo | Rubricas |
|---|---|
| Remuneração | Salário, Periculosidade, Insalubridade, Penosidade, Adicionais de turno, Horas extras |
| Provisões | Férias (1/3), 13º salário, Rescisão |
| Encargos | FGTS, FGTS férias, FGTS 13º, INSS, INSS férias, INSS 13º |
| Benefícios | PPR, VA/VR, VA natal / 13º VR, Vale-transporte, Auxílio-creche, Auxílio educacional, Material escolar, Auxílio óculos, Oftalmo, Assistência médica, Coparticipação convênio médico, Assistência odontológica, Farmácia, Seguro de vida, Refeitório, Fretado, Fretado (overall), Cesta natalina |
| Demais | Saúde ocupacional, Endomarketing, Treinamento, Viagens, Confraternizações |

Padrões do sistema (iguais às fórmulas da planilha BZO e ajustáveis): periculosidade 30% do salário; férias
(1/3) = remuneração ÷ 36; 13º = salário ÷ 12; FGTS 8% (sobre salário, férias e 13º); PPR 2,4 salários/ano.
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
