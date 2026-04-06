const path = require('node:path');
const fs = require('node:fs');

const commands = [];
const commandsPath = path.join(__dirname);
for (const file of fs.readdirSync(commandsPath)) {
  if (!file.endsWith('.js')) continue;
  const command = require(path.join(commandsPath, file));
  if (command && command.data && command.execute) {
    commands.push(command);
  }
}

module.exports = commands;
