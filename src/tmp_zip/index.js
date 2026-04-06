require('dotenv/config');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const commands = require('./commands');

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN is required.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});
client.commands = new Collection();

for (const command of commands) {
  client.commands.set(command.data.name, command);
}

const painelCommand = commands.find((command) => command.menuId === 'painel-menu');
const estoqueCommand = commands.find((command) => command.menuId === 'estoque-menu');
const cupomCommand = commands.find((command) => command.data.name === 'cupom');

client.once(Events.ClientReady, () => {
  console.log(`Bot pronto: ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Erro executando ${interaction.commandName}:`, error);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'Ocorreu um erro ao executar o comando.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'Ocorreu um erro ao executar o comando.', ephemeral: true });
      }
    }
    return;
  }

  if (!painelCommand) return;

  if (interaction.isStringSelectMenu()) {
    try {
      if (painelCommand && interaction.customId === painelCommand.menuId) {
        await painelCommand.handleSelect(interaction);
        return;
      }

      if (painelCommand && painelCommand.sqlTableMenuId && interaction.customId === painelCommand.sqlTableMenuId) {
        await painelCommand.handleSqlTableSelect(interaction);
        return;
      }

      if (painelCommand && interaction.customId === painelCommand.panel2MenuId) {
        await painelCommand.handlePanel2Menu(interaction);
        return;
      }

      if (cupomCommand && interaction.customId === cupomCommand.selectId) {
        await cupomCommand.handleSelect(interaction);
        return;
      }

      if (estoqueCommand && interaction.customId === estoqueCommand.menuId) {
        await estoqueCommand.handleMenuSelect(interaction);
        return;
      }
    } catch (error) {
      console.error('Erro ao processar o menu do painel/estoque:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Não foi possível processar a seleção.', ephemeral: true });
      }
    }
  }

    if (interaction.isButton()) {
      if (interaction.customId === painelCommand.buyButtonId) {
        try {
          await painelCommand.handleBuyButton(interaction);
        } catch (error) {
          console.error('Erro ao processar o botão Comprar:', error);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Não foi possível criar o canal de compra.', ephemeral: true });
          }
        }
        return;
      }

      if (painelCommand.panel1FieldButtons.includes(interaction.customId)) {
        try {
          await painelCommand.handleFieldButton(interaction);
        } catch (error) {
          console.error('Erro ao processar o botão do Painel 1:', error);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Não foi possível processar o botão do painel 1.', ephemeral: true });
          }
        }
        return;
      }

      if (painelCommand.publishedButtonIds?.includes(interaction.customId)) {
        try {
          await painelCommand.handlePublishedButton(interaction);
        } catch (error) {
          console.error('Erro ao processar botão publicado:', error);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Não foi possível processar o botão.', ephemeral: true });
          }
        }
        return;
      }

      if (cupomCommand && cupomCommand.buttonIds?.includes(interaction.customId)) {
        try {
          await cupomCommand.handleButton(interaction);
        } catch (error) {
          console.error('Erro ao processar botão do Cupom:', error);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Não foi possível processar o botão.', ephemeral: true });
          }
        }
        return;
      }

      if (estoqueCommand && estoqueCommand.buttonIds?.includes(interaction.customId)) {
        try {
          await estoqueCommand.handleButton(interaction);
        } catch (error) {
          console.error('Erro ao processar botão do Estoque:', error);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Não foi possível processar o botão.', ephemeral: true });
          }
        }
        return;
      }
    }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('painel1-modal-')) {
      try {
        await painelCommand.handleModalSubmit(interaction);
      } catch (error) {
        console.error('Erro ao processar modal do Painel 1:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Não foi possível processar o formulário.', ephemeral: true });
        }
      }
      return;
    }

    if (cupomCommand && cupomCommand.modalIds?.includes(interaction.customId)) {
      try {
        await cupomCommand.handleModalSubmit(interaction);
      } catch (error) {
        console.error('Erro ao processar modal do Cupom:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Não foi possível processar o formulário.', ephemeral: true });
        }
      }
      return;
    }

    if (estoqueCommand && estoqueCommand.modalIds?.includes(interaction.customId)) {
      try {
        await estoqueCommand.handleModalSubmit(interaction);
      } catch (error) {
        console.error('Erro ao processar modal do Estoque:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Não foi possível processar o formulário.', ephemeral: true });
        }
      }
    }
  }
});

client.login(token);
