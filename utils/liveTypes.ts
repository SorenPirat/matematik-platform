export type LiveEvent =
  | {
      type: "task";
      equation: string;
      operation: string;
      ts: number;
    }
  | {
      type: "action";
      action: "check" | "reveal";
      ts: number;
    }
  | {
      type: "presence";
      state: "open" | "hidden" | "closed";
      track?: string;
      ts: number;
    }
  | {
      type: "input";
      value: string;
      ts: number;
    }
  | {
      type: "canvas-stroke";
      tool: "pen" | "eraser";
      from: { x: number; y: number };
      to: { x: number; y: number };
      ts: number;
    }
  | {
      type: "canvas-clear";
      ts: number;
    }
  | {
      type: "canvas-snapshot";
      dataUrl: string;
      ts: number;
    }
  | {
      type: "kick";
      ts: number;
      reason?: string;
    }
  | {
      type: "result";
      attempts: number;
      correct: number;
      streak?: number;
      ts: number;
    };
