# Play dos Amigos

App de gerenciamento de torneios de Beach Tennis: cadastro de atletas, sorteio de
chaves (duplas fixas ou rotativo), lançamento de resultados, classificação e
fase eliminatória (mata-mata).

## Rodar localmente

```bash
npm install
npm run dev
```

Abra o endereço mostrado no terminal (normalmente http://localhost:5173).

## Publicar no Vercel

### Opção 1 — pelo site (mais fácil, sem usar terminal)

1. Suba esta pasta para um repositório no GitHub (crie um repositório vazio e
   envie estes arquivos, ou use "Import" arrastando a pasta se o Vercel
   oferecer essa opção).
2. Acesse https://vercel.com e faça login (dá para usar a conta do GitHub).
3. Clique em **Add New → Project** e selecione o repositório.
4. O Vercel detecta automaticamente que é um projeto **Vite** — não precisa
   mudar nenhuma configuração (Build Command: `npm run build`,
   Output Directory: `dist`).
5. Clique em **Deploy**. Em cerca de 1 minuto você recebe uma URL pública
   (algo como `arena-beach-tennis.vercel.app`).

### Opção 2 — pelo terminal (Vercel CLI)

```bash
npm install -g vercel
vercel login
vercel --prod
```

Siga as perguntas do assistente (aceite os valores padrão). Ao final ele
imprime a URL pública do app.

## Observações

- Os dados (atletas, chaves, resultados) ficam salvos no navegador de quem
  está usando o app (`localStorage`), então cada pessoa que acessa o link vê
  o próprio torneio, e os dados não são compartilhados entre dispositivos.
- Se quiser que vários organizadores editem o **mesmo** torneio ao mesmo
  tempo, é necessário trocar `src/storage.js` por uma solução de banco de
  dados compartilhado (ex.: Supabase, Firebase, ou uma API própria).
