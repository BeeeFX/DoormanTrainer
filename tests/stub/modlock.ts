// Stand-in for the Modlock host, enough for the pure-logic modules under test.
export interface Vector {
  x: number
  y: number
  z: number
}

const files: Record<string, string> = {}
export function readFile(path: string): string | undefined {
  return files[path]
}
export function writeFile(path: string, text: string): boolean {
  files[path] = text
  return true
}

function distance(a: Vector, b: Vector): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}
function flatDistance(a: Vector, b: Vector): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
export const vector = { distance, flatDistance }

// Used by build.ts; the tests only call its pure helpers.
export function after(_seconds: number, _fn: () => void): void {}
export function item(name: string): { name: string } | undefined {
  return { name }
}
export type Player = unknown

// Used by walker.ts (imported through levels.ts); values only need to exist.
export const Buttons = { attack: 1n, jump: 2n, crouch: 4n, dash: 8n, use: 16n, reload: 32n, ability1: 64n, ability2: 128n, ability3: 256n }
export type DriveCommand = unknown
export type Angles = { pitch: number; yaw: number; roll: number }
export const Layers = { solid: 1n }
export function trace(_o: unknown): undefined {
  return undefined
}
export type Pawn = unknown
