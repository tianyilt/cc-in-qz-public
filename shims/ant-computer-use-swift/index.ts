export type ComputerUseAPI = {
  screens?: {
    list(): Promise<unknown[]>
  }
  apps?: {
    listInstalled(): Promise<unknown[]>
    listRunning(): Promise<unknown[]>
  }
}

const stub: ComputerUseAPI = {
  screens: {
    async list() {
      return []
    },
  },
  apps: {
    async listInstalled() {
      return []
    },
    async listRunning() {
      return []
    },
  },
}

export default stub
