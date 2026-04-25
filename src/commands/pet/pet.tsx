import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { ToolUseContext } from '../../Tool.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { AnimatedClawd } from '../../components/LogoV2/AnimatedClawd.js'

export async function call(
  _onDone: LocalJSXCommandOnDone,
  _context: ToolUseContext & LocalJSXCommandContext,
  _args: string,
): Promise<React.ReactNode> {
  return (
    <Box flexDirection="column" paddingLeft={2} gap={1}>
      <Text bold={true}>Clawd</Text>
      <Text dimColor={true}>Clawd animates on its own. Click it for a bigger move.</Text>
      <AnimatedClawd />
    </Box>
  )
}
