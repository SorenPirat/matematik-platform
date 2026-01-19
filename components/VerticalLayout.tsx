
"use client";

type Props = {
  operands: number[];
  operator: string;
};

function fmtParts(n: number) {
  const s = String(n);
  if (!s.includes(".")) return { int: s, dec: "" };
  const [int, dec] = s.split(".");
  return { int, dec };
}

export default function VerticalLayout({ operands, operator }: Props) {
  // Split operander
  const parts = operands.map((n) => fmtParts(n));

  // Find max længder (for justering)
  const maxInt = Math.max(...parts.map((p) => p.int.length));
  const maxDec = Math.max(...parts.map((p) => p.dec.length));

  // Formatér hvert tal så de står korrekt i kolonner
  const rows = parts.map((p) => {
    const intPad = p.int.padStart(maxInt, " ");
    const decPad = p.dec.padEnd(maxDec, " ");
    return decPad.length > 0 ? `${intPad},${decPad}` : intPad;
  });

  return (
    <div className="font-mono text-3xl leading-tight">
      <div className="whitespace-pre text-right">
        {rows[0]}
        <br />
        {operator} {rows[1]}
        <br />
        {"".padStart(maxInt + (maxDec > 0 ? maxDec + 1 : 0), "—")}
      </div>
    </div>
  );
}
