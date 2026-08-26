import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSetting } from "./db";

const execFileP = promisify(execFile);

export function getWhisperModelPath(): string {
  return (
    getSetting("whisper_model_path") ||
    process.env.WHISPER_MODEL_PATH ||
    "/Users/hubert/Library/Application Support/Hermes Control/Models/Whisper/ggml-large-v3.bin"
  );
}
export function getWhisperBin(): string {
  return getSetting("whisper_bin") || process.env.WHISPER_BIN || "whisper-cli";
}
export function whisperAvailable(): boolean {
  return fs.existsSync(getWhisperModelPath());
}

/**
 * Transkrypcja audio (webm/ogg/mp3/wav) w pełni lokalnie:
 * ffmpeg → 16 kHz mono WAV → whisper-cli (whisper.cpp, model ggml-large-v3) → tekst (pl).
 */
export async function transcribeAudio(buffer: Buffer, ext: string): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kc-wsp-"));
  const input = path.join(tmpDir, "audio" + (ext && ext.length <= 5 ? "." + ext : ".webm"));
  const wav = path.join(tmpDir, "out.wav");
  fs.writeFileSync(input, buffer);
  try {
    await execFileP("ffmpeg", ["-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], { timeout: 60_000 });
    const model = getWhisperModelPath();
    const bin = getWhisperBin();
    await execFileP(bin, ["-m", model, "-f", wav, "-l", "pl", "-otxt", "-np", "-t", "4"], { timeout: 240_000 });
    const txtFile = wav + ".txt";
    if (!fs.existsSync(txtFile)) return "";
    return fs.readFileSync(txtFile, "utf8").trim();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
