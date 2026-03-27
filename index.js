const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let onlinePlayers = [];

app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "API MTA funcionando no Render",
    count: onlinePlayers.length,
    players: onlinePlayers
  });
});

app.get("/mta/players", (req, res) => {
  res.json({
    count: onlinePlayers.length,
    players: onlinePlayers
  });
});

app.post("/mta/players", (req, res) => {
  const { players } = req.body;

  if (!Array.isArray(players)) {
    return res.status(400).json({
      error: "Envie no formato: { \"players\": [\"Nome1\", \"Nome2\"] }"
    });
  }

  onlinePlayers = players;

  console.log("Players atualizados:", onlinePlayers);

  res.json({
    success: true,
    count: onlinePlayers.length,
    players: onlinePlayers
  });
});

app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
