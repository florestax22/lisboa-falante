# Lisboa Falante — versão web pública 15.4

Aplicação web acessível para orientação falada, percursos e pesquisa de serviços próximos no distrito de Lisboa.

## Publicação HTTPS

O projeto inclui um fluxo GitHub Actions em `.github/workflows/publicar-pages.yml`.
Ele publica automaticamente no GitHub Pages sempre que existe uma alteração no ramo `main`.

## Configuração necessária

Crie no repositório um secret chamado exatamente:

`GOOGLE_MAPS_API_KEY`

Depois, em **Settings > Pages**, escolha **GitHub Actions** como origem da publicação.

## Segurança da chave

A chave não deve ser gravada em `config.js` dentro do repositório. O fluxo de publicação cria esse ficheiro durante o GitHub Actions.

Como o Google Maps funciona no navegador, a chave publicada pode ser consultada tecnicamente. Restrinja-a na Google Cloud ao endereço HTTPS do projeto e apenas às APIs necessárias.

## Teste local

1. Copie `config.example.js` para `config.js`.
2. Coloque nesse ficheiro uma chave de teste devidamente restringida.
3. Abra o site através de um servidor local; não abra apenas o ficheiro `index.html` diretamente.
