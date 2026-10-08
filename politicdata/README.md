# PoliticData — primeira versão executável

Aplicativo local com Python 3.10+, SQLite e interface web em HTML/CSS/JavaScript, sem dependências Python externas.

## Executar

1. Descompacte o arquivo e abra um terminal na pasta `politicdata`.
2. Execute `python app.py` (ou `py app.py` no Windows).
3. O terminal exibirá **usuário admin e senha inicial gerada automaticamente** na primeira execução. Guarde a senha.
4. Acesse `http://127.0.0.1:8765` no navegador.

Para configurar a senha antes do primeiro uso (PowerShell):

```powershell
$env:POLITICDATA_ADMIN="admin"
$env:POLITICDATA_PASSWORD="uma-senha-longa-e-exclusiva"
py app.py
```

Se a execução inicial já criou o banco, essas variáveis **não alteram** a senha existente.

## O que funciona

- Login com hash PBKDF2 e sessão com proteção CSRF.
- Cadastro de lideranças com dados administrativos mínimos.
- Diário de atas/reuniões e alerta de intervalo desde o último encontro.
- Demandas com estados: aberta, em andamento, atendida ou recusada, resolução e custo.
- Livro de registros financeiros com referências a comprovantes.
- Importação de CSV com resultados eleitorais históricos agregados por município/zona/seção.
- Dashboard, filtros estatísticos e mapa proporcional de intensidade com coordenadas do CSV.

## Dados eleitorais

A fonte pública pode ser obtida em https://dadosabertos.tse.jus.br/ . É necessário **adaptar** os arquivos brutos do TSE ao modelo da tela Importar. Campos obrigatórios: `election_year,round,office,municipality,zone,section,candidate,votes,source`. O mapa exige `latitude,longitude` válidos; o TSE não necessariamente oferece coordenadas ou bairro associados a cada resultado.

Não inclua intenções de voto individuais, votos “garantidos”, perfis políticos pessoais ou relações entre benefícios e voto. Valores financeiros devem corresponder a operações lícitas, justificadas e documentadas. Não vincule o atendimento de demandas ao apoio político.

## Limitações de produção

**Protótipo local / uso restrito. NÃO exponha diretamente à internet.** Esta versão tem um único usuário administrador, sem multi-tenant, perfis, proteção de sessão em armazenamento persistente, upload de documentos, backups automáticos ou política completa de retenção. A sessão fica apenas em memória; reiniciar encerra logins. Não há integrações automáticas de TSE nem geocodificação. As coordenadas de escolas/localidades devem vir de fonte válida.

Para produção: HTTPS e proxy seguro, usuários e RBAC, logs imutáveis, backup criptografado, criptografia e controle de acesso, gestão de consentimentos/bases legais, validação de qualidade dos dados, auditoria e revisão jurídica conforme LGPD e legislação eleitoral. Não use o protótipo para hospedar dados pessoais sensíveis antes disso.

## Arquivos

- `app.py`: servidor, API e SQLite.
- `index.html`: tela principal.
- `app.js`: formulários, navegação, dashboard, filtros e mapa.
- `style.css`: interface responsiva.
- `tests.py`: testes básicos.

## Atualização 1.1 — alertas
- O dashboard possui central de alertas: reuniões inexistentes ou com mais de 30 dias, demandas abertas com prazo vencido, despesas pendentes de conferência ou sem comprovante.
- No cadastro de demandas pode ser informado prazo de atendimento.
- Na tabela de despesas é possível marcar conferência como pendente, conferido ou reprovado.
- O banco SQLite existente é atualizado automaticamente ao iniciar o aplicativo, preservando seus registros.
- Alertas são calculados ao carregar o dashboard; esta versão não envia notificações por email ou fora do aplicativo.
- Este aplicativo não estima preferências eleitorais individuais, votos garantidos ou relações de benefício por voto.


## Atualização 1.2
- Cadastro de lideranças com apelido e atuação administrativa.
- Importação em massa de CSV de lideranças pelo menu Importar dados, aceitando cabeçalhos em português e separadores vírgula/ponto e vírgula.
- Tela Distribuição por bairro com contagens administrativas e gráficos.
- Filtro de seção no painel de estatísticas e mapa de resultados oficiais.
- Mapa inicia centralizado em São Luís (-2.53, -44.30) e ajusta enquadramento aos dados georreferenciados importados.
- Importação de planilhas de eleitores identificáveis e votos pessoais não é permitida. Não há geocodificação automática.
- Excel XLSX: no Excel, use Arquivo > Salvar Como > CSV UTF-8 e mantenha somente colunas administrativas necessárias.
- A distribuição administrativa por bairro não é somada aos resultados eleitorais nem usada para inferir apoio.

## Atualização 1.3 — diretório Eleitorado
- O cadastro e a correção de eleitorado passam a ter CPF e nome da mãe, além dos campos existentes (nome completo, telefone/WhatsApp, endereço completo, bairro, zona e seção eleitoral, escolaridade, liderança vinculada e observações).
- A importação de planilhas do Eleitorado aceita as colunas CPF e Nome da mãe, e a tabela do diretório exibe as duas colunas, com busca por CPF.
- A importação de lideranças continua recusando CPF e nome da mãe.
- CPF e nome da mãe são dados pessoais: trate-os como confidenciais, mantenha backup privado e avalie as bases legais da LGPD antes de uso real.
