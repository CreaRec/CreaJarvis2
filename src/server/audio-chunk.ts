/** Split base64 audio into WS-friendly chunks (length multiple of 4). */
export function chunkBase64Audio(audio: string, chunkSize = 4096): string[] {
  const size = Math.max(4, chunkSize - (chunkSize % 4));
  if (audio.length <= size) return [audio];
  const out: string[] = [];
  for (let i = 0; i < audio.length; i += size) {
    out.push(audio.slice(i, i + size));
  }
  return out;
}
