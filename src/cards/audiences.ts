export interface Audience {
  readonly id: string;
  readonly who: string;
  readonly job: string;
  readonly language: string;
  readonly ignores: string;
  readonly successRung: string;
}

const FIELDS: Record<string, keyof Audience> = {
  who: "who", job: "job", language: "language", ignores: "ignores", success_rung: "successRung",
};

export function parseAudiences(markdown: string): Audience[] {
  const out: Audience[] = [];
  let current: Partial<Audience> & { id?: string } = {};

  for (const line of markdown.split("\n")) {
    const heading = /^##\s+([a-z0-9-]+)\s*$/.exec(line.trim());
    if (heading) {
      if (current.id) out.push(current as Audience);
      current = { id: heading[1] as string, who: "", job: "", language: "", ignores: "", successRung: "" };
      continue;
    }
    const field = /^-\s+\*\*([a-z_]+):\*\*\s*(.+)$/.exec(line.trim());
    if (field && current.id) {
      const key = FIELDS[field[1] as string];
      if (key) current = { ...current, [key]: (field[2] as string).trim() };
    }
  }
  if (current.id) out.push(current as Audience);
  return out;
}
