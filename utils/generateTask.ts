
export type Operation = "addition" | "subtraction" | "multiplication" | "division";
export type DigitsSel = 1 | 2 | 3 | "mix";
export type DecimalsSel = 0 | 1 | 2 | "mix";
export type BorrowMode = "with" | "without" | "mixed"; // kun relevant for subtraction

type GenerateOptions = {
  operation: Operation;
  digitsSel?: DigitsSel;     // 1, 2, 3 eller "mix" (A/B kan få forskellige)
  decimalsSel?: DecimalsSel; // 0, 1, 2 eller "mix" (A/B kan få forskellige)
  borrowMode?: BorrowMode;   // "with", "without", "mixed" (kun minus)
};

export function generateTask(opts: Operation | GenerateOptions = "addition") {
  const { operation, digitsSel, decimalsSel, borrowMode } = normalizeOptions(opts);

  // Vælg cifre for A/B (1-3 eller "mix")
  let digitsA: 1 | 2 | 3, digitsB: 1 | 2 | 3;
  if (digitsSel === "mix") {
    digitsA = randInt(1, 3) as 1 | 2 | 3;
    digitsB = randInt(1, 3) as 1 | 2 | 3;
  } else {
    digitsA = digitsSel;
    digitsB = digitsSel;
  }

  // Vælg decimaler for A/B (0-2 eller "mix")
  let decA: 0 | 1 | 2, decB: 0 | 1 | 2;
  if (decimalsSel === "mix") {
    decA = randInt(0, 2) as 0 | 1 | 2;
    decB = randInt(0, 2) as 0 | 1 | 2;
  } else {
    decA = decimalsSel;
    decB = decimalsSel;
  }

  // Lav skalerede heltal (så vi kan tjekke lån-søjler og undgå negative resultater)
  const Aint0 = randomScaled(decA, minIntByDigits(digitsA), maxIntByDigits(digitsA));
  const Bint0 = randomScaled(decB, minIntByDigits(digitsB), maxIntByDigits(digitsB));
  const maxDec = Math.max(decA, decB);
  let { Aint, Bint } = { Aint: Aint0, Bint: Bint0 };

  // Hjælpere til "lån" på fælles skala (samme antal decimaler)
  const places = Math.max(digitsA, digitsB) + maxDec;

  function toCommonScale(a: number, aDec: number, b: number, bDec: number) {
    const scaleA = pow10(maxDec - aDec);
    const scaleB = pow10(maxDec - bDec);
    return { AScaled: a * scaleA, BScaled: b * scaleB };
  }
  function digitAt(n: number, k: number) {
    return Math.floor(n / pow10(k)) % 10;
  }
  function hasBorrow(AScaled: number, BScaled: number) {
    for (let k = 0; k < places; k++) {
      if (digitAt(AScaled, k) < digitAt(BScaled, k)) return true;
    }
    return false;
  }
  function canSubtractNoBorrow(AScaled: number, BScaled: number) {
    for (let k = 0; k < places; k++) {
      if (digitAt(AScaled, k) < digitAt(BScaled, k)) return false;
    }
    return true;
  }

  // Særligt for subtraction:
  //  - sikr A >= B (aldrig negativt resultat)
  //  - respekter "borrowMode": med/uden lån/mixed (som i din HTML-generator) [1](https://nsv365-my.sharepoint.com/personal/soer8210_naestved-cds_dk/Documents/Microsoft%20Copilot%20Chat-filer/minusmatematik.html)
  if (operation === "subtraction") {
    let tries = 0;
    while (tries++ < 10000) {
      let a = Aint, b = Bint, aDec = decA, bDec = decB, aDig = digitsA, bDig = digitsB;

      // Sørg for ikke-negativt resultat ved evt. at bytte A/B (matcher din løsning) [1](https://nsv365-my.sharepoint.com/personal/soer8210_naestved-cds_dk/Documents/Microsoft%20Copilot%20Chat-filer/minusmatematik.html)
      let { AScaled, BScaled } = toCommonScale(a, aDec, b, bDec);
      if (AScaled < BScaled) {
        [a, b] = [b, a];
        [aDec, bDec] = [bDec, aDec];
        [aDig, bDig] = [bDig, aDig];
        ({ AScaled, BScaled } = toCommonScale(a, aDec, b, bDec));
      }

      if (borrowMode === "with" && hasBorrow(AScaled, BScaled)) {
        Aint = a; Bint = b; decA = aDec; decB = bDec; digitsA = aDig; digitsB = bDig;
        break;
      }
      if (borrowMode === "without" && canSubtractNoBorrow(AScaled, BScaled)) {
        Aint = a; Bint = b; decA = aDec; decB = bDec; digitsA = aDig; digitsB = bDig;
        break;
      }
      if (borrowMode === "mixed") {
        Aint = a; Bint = b; decA = aDec; decB = bDec; digitsA = aDig; digitsB = bDig;
        break;
      }

      // Hvis krav ikke opfyldt, træk nye tal og prøv igen
      // (kan udvides senere til at variere a/b i løkken)
      const AintNew = randomScaled(decA, minIntByDigits(digitsA), maxIntByDigits(digitsA));
      const BintNew = randomScaled(decB, minIntByDigits(digitsB), maxIntByDigits(digitsB));
      Aint = AintNew; Bint = BintNew;
    }
  }

  // Særligt for division:
  //  - sørg for at dividenden (A) altid er størst
  if (operation === "division") {
    let a = Aint, b = Bint, aDec = decA, bDec = decB, aDig = digitsA, bDig = digitsB;
    if (a < b) {
      [a, b] = [b, a];
      [aDec, bDec] = [bDec, aDec];
      [aDig, bDig] = [bDig, aDig];
    }
    Aint = a; Bint = b; decA = aDec; decB = bDec; digitsA = aDig; digitsB = bDig;
  }

  // Konverter til rigtige decimaltal
  const A = Aint / pow10(decA);
  const B = Bint / pow10(decB);


  return {
    operation,
    layout: "vertical" as const,
    problem: {
      operands: [A, B],
      operator: opSymbol(operation),
    },
  };

}

/* ---------- Hjælpefunktioner ---------- */
function pow10(n: number) { return Math.pow(10, n); }
function randInt(a: number, b: number) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function minIntByDigits(d: 1 | 2 | 3) { return d === 1 ? 1 : d === 2 ? 10 : 100; }
function maxIntByDigits(d: 1 | 2 | 3) { return d === 1 ? 9 : d === 2 ? 99 : 999; }

function randomScaled(decimals: 0 | 1 | 2, minInt: number, maxInt: number) {
  const scale = pow10(decimals);
  const intPart = randInt(minInt, maxInt);
  const fracPart = decimals > 0 ? randInt(0, scale - 1) : 0;
  return intPart * scale + fracPart; // returnerer "heltal på skala"
}

function opSymbol(op: Operation) {
  if (op === "addition") return "+";
  if (op === "subtraction") return "-";
  if (op === "multiplication") return "×";
  return "÷";
}

function normalizeOptions(opOrOpts: Operation | GenerateOptions): Required<GenerateOptions> {
  if (typeof opOrOpts === "string") {
    return { operation: opOrOpts, digitsSel: "mix", decimalsSel: "mix", borrowMode: "mixed" };
  }
  return {
    operation: opOrOpts.operation,
    digitsSel: opOrOpts.digitsSel ?? "mix",
    decimalsSel: opOrOpts.decimalsSel ?? "mix",
    borrowMode: opOrOpts.borrowMode ?? "mixed",
  };
}
