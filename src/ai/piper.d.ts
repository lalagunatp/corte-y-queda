/** Módulo de Emscripten de piper-phonemize (espeak-ng); el paquete no trae tipos. */
declare module "@diffusionstudio/piper-wasm/build/piper_phonemize.js" {
  interface PiperPhonemizeOptions {
    wasmBinary: ArrayBuffer;
    /** Devuelve el paquete de datos ya descargado en lugar de pedirlo por red. */
    getPreloadedPackage(name: string, size: number): ArrayBuffer;
    locateFile(name: string): string;
    print(line: string): void;
    printErr(line: string): void;
  }
  export default function createPiperPhonemize(options: PiperPhonemizeOptions): Promise<{ callMain(args: string[]): void }>;
}
