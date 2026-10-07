# Hospedagem PoliticData no Render

Este pacote contem `render.yaml` (Blueprint) para serviço pago Starter e disco persistente de 1 GB. A cobrança e as condições devem ser verificadas antes da criação. **Não use o plano gratuito para dados reais**, pois o filesystem é efêmero.

1. Coloque os arquivos no GitHub privado (a pasta politicdata e render.yaml devem ficar na raiz do repositório).
2. No Render, selecione New > Blueprint e conecte o repositório.
3. Configure POLITICDATA_PASSWORD com senha forte; nunca suba segredos no Git.
4. Revise custo e região, crie e aguarde a URL onrender.com.
5. Verifique autenticação, persistência e controles de segurança com dados fictícios antes de inserir dados pessoais.

**Atenção:** O app conserva sessões apenas na memória do processo, possui usuário administrador único e SQLite. Isto não é arquitetura adequada para produção com dados pessoais. Exige autenticação mais robusta, auditoria, política de backup, TLS, gerenciamento de sessões e avaliação LGPD antes de uso real.
