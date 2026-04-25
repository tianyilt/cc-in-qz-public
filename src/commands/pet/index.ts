import type { Command } from '../../commands.js'

const pet = {
  type: 'local-jsx',
  name: 'pet',
  description: 'Show Clawd as a standalone animated pet',
  immediate: true,
  load: () => import('./pet.js'),
} satisfies Command

export default pet
