export const noise: { pattern: RegExp; why: string }[];

export function listen(
  cdp: {
    on(event: string, handler: (params: any) => void): unknown;
    send(method: string): Promise<unknown>;
  },
  report: (problem: string) => void,
): Promise<void>;
