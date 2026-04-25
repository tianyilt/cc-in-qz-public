export type ComputerUseInputAPI = {
  moveMouse(x: number, y: number, smooth?: boolean): Promise<void>
  mouseLocation(): Promise<{ x: number; y: number }>
  key(key: string, action?: 'press' | 'release' | 'click'): Promise<void>
  keys(keys: string[]): Promise<void>
  leftClick(): Promise<void>
  rightClick(): Promise<void>
  doubleClick(): Promise<void>
  middleClick(): Promise<void>
  dragMouse(x: number, y: number): Promise<void>
  scroll(x: number, y: number): Promise<void>
  type(text: string): Promise<void>
}

export type ComputerUseInput =
  | ({ isSupported: false } & Partial<ComputerUseInputAPI>)
  | ({ isSupported: true } & ComputerUseInputAPI)

const unsupported: ComputerUseInput = {
  isSupported: false,
}

export default unsupported
