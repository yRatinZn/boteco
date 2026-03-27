const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// rota principal só pra teste
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "Webhook do bot de vendas funcionando"
  });
});

// webhook do Mercado Pago
app.post("/webhook", (req, res) => {
  console.log("Webhook recebido do Mercado Pago:");
  console.log(req.body);

  // aqui depois você pode tratar o pagamento
  // exemplo: verificar se foi aprovado
  // e mandar cargo no Discord, enviar mensagem, etc

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
