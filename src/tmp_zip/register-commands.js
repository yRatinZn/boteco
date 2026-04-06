require('dotenv/config');
const { REST, Routes } = require('discord.js');
const commands = require('./commands');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error('DISCORD_TOKEN, DISCORD_CLIENT_ID and DISCORD_GUILD_ID must be set in the environment.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Registrando comandos slash no servidor de teste...');
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands.map((command) => command.data.toJSON())
    });
    console.log('Comandos registrados.');
  } catch (error) {
    console.error('Erro ao registrar comandos:', error);
  }
})();
