import 'dotenv/config';
import { getRPSChoices } from './game.js';
import { capitalize, InstallGlobalCommands } from './utils.js';

// Get the game choices from game.js
function createCommandChoices() {
  const choices = getRPSChoices();
  const commandChoices = [];

  for (let choice of choices) {
    commandChoices.push({
      name: capitalize(choice),
      value: choice.toLowerCase(),
    });
  }

  return commandChoices;
}

// Simple test command
const TEST_COMMAND = {
  name: 'test',
  description: 'Basic command',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const SUGGEST_COMMAND = {
  name: 'suggest',
  description: 'Suggest a Spotify song',
  options: [
    {
      type: 3, // STRING
      name: 'link',
      description: 'The Spotify link',
      required: true,
    },
    {
      type: 3,
      name: 'timestamp',
      description: 'Timestamp of the song (e.g. 1:23)',
      required: true,
    },
    {
      type: 3,
      name: 'note',
      description: 'Any notes about the suggestion',
      required: false,
    },
  ],
  type: 1,
};

const ALL_COMMANDS = [TEST_COMMAND, SUGGEST_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
