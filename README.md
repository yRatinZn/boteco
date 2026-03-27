# Render Bot MTA API

Arquivos mínimos para subir no Render.

## Como usar

1. Extraia os arquivos
2. Envie para um repositório no GitHub
3. No Render, crie um **Web Service**
4. Selecione esse repositório
5. O Render vai detectar automaticamente:
   - Start Command: `npm start`

## Endpoint de teste

### GET /
Retorna status da API.

### GET /mta/players
Retorna players salvos.

### POST /mta/players
Envie JSON assim:

```json
{
  "players": ["Victor", "Pablo", "Lucas"]
}
```

## Instalar localmente

```bash
npm install
npm start
```
