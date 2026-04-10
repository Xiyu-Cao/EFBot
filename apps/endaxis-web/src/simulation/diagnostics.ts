/**
 * Diagnostic messages collected during compilation and simulation.
 *
 * These replace silent skips / swallowed errors with structured,
 * inspectable records so that consumers (UI, tests, CI) can decide
 * how to surface them.
 */

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  /** Optional: the action / effect / entity that caused it */
  context?: {
    actionId?: string;
    effectType?: string;
    actorId?: string;
    [key: string]: unknown;
  };
}

export class DiagnosticCollector {
  private items: Diagnostic[] = [];

  add(diagnostic: Diagnostic) {
    this.items.push(diagnostic);
  }

  warn(code: string, message: string, context?: Diagnostic["context"]) {
    this.add({ severity: "warning", code, message, context });
  }

  error(code: string, message: string, context?: Diagnostic["context"]) {
    this.add({ severity: "error", code, message, context });
  }

  info(code: string, message: string, context?: Diagnostic["context"]) {
    this.add({ severity: "info", code, message, context });
  }

  getAll(): readonly Diagnostic[] {
    return this.items;
  }

  hasErrors(): boolean {
    return this.items.some((d) => d.severity === "error");
  }

  hasWarnings(): boolean {
    return this.items.some(
      (d) => d.severity === "warning" || d.severity === "error",
    );
  }

  clear() {
    this.items = [];
  }
}
