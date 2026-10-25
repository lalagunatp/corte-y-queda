import type { SubtitleLine } from "./types";

/** Formato de tiempo SRT: HH:MM:SS,mmm. */
export function srtTime(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function toSrt(lines: SubtitleLine[]): string {
  return lines.map((l, i) => `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.end)}\n${l.text.trim()}\n`).join("\n");
}

const TIME = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

function parseTime(s: string): number | null {
  const m = TIME.exec(s);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
}

/**
 * Lee SRT y WebVTT. Los bloques sin tiempos válidos se descartan y se cuentan, para avisar
 * en lugar de importar líneas con tiempos inventados.
 */
export function parseSubtitles(text: string): { lines: SubtitleLine[]; skipped: number } {
  const blocks = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const lines: SubtitleLine[] = [];
  let skipped = 0;
  for (const block of blocks) {
    const rows = block.split("\n").filter((r) => r.trim() !== "");
    const timing = rows.findIndex((r) => r.includes("-->"));
    if (timing < 0) {
      if (rows.length && !/^WEBVTT|^NOTE|^STYLE/.test(rows[0])) skipped++;
      continue;
    }
    const [a, b] = rows[timing].split("-->");
    const start = parseTime(a);
    const end = parseTime(b);
    const body = rows
      .slice(timing + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (start == null || end == null || end <= start || !body) {
      skipped++;
      continue;
    }
    lines.push({ start, end, text: body });
  }
  return { lines: lines.sort((x, y) => x.start - y.start), skipped };
}

/** Texto editable mm:ss.d para los campos de tiempo; acepta también segundos sueltos. */
export function formatEditable(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

export function parseEditable(v: string): number | null {
  const trimmed = v.trim().replace(",", ".");
  const parts = trimmed.split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || isNaN(Number(p)))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}
