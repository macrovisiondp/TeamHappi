// Versioned, non-secret provider configuration. Every change creates a new
// version; activating or rolling back only moves a pointer, so the previous
// valid configuration is always one step away. Secrets are never part of a
// configuration version, only references to credential versions.

export interface ConfigVersion<C> {
  version: number;
  config: C;
  validatedAt: Date | null;
  createdBy: string;
  createdAt: Date;
}

export class ConfigHistory<C> {
  private readonly versions: ConfigVersion<C>[] = [];
  private activeVersion: number | null = null;

  constructor(private readonly now: () => Date = () => new Date()) {}

  get active(): ConfigVersion<C> | null {
    return this.versions.find((v) => v.version === this.activeVersion) ?? null;
  }

  get all(): readonly ConfigVersion<C>[] {
    return this.versions;
  }

  propose(config: C, createdBy: string): ConfigVersion<C> {
    const entry: ConfigVersion<C> = {
      version: this.versions.length + 1,
      config: structuredClone(config),
      validatedAt: null,
      createdBy,
      createdAt: this.now(),
    };
    this.versions.push(entry);
    return entry;
  }

  markValidated(version: number): void {
    this.require(version).validatedAt = this.now();
  }

  /** Only a validated version can become active. */
  activate(version: number): void {
    const entry = this.require(version);
    if (!entry.validatedAt)
      throw new Error(`Configuration v${version} has not been validated`);
    this.activeVersion = version;
  }

  /** Re-activates the newest validated version older than the active one. */
  rollback(): ConfigVersion<C> {
    const current = this.activeVersion ?? Infinity;
    const previous = [...this.versions]
      .reverse()
      .find((v) => v.version < current && v.validatedAt);
    if (!previous) throw new Error("No earlier validated configuration");
    this.activeVersion = previous.version;
    return previous;
  }

  private require(version: number): ConfigVersion<C> {
    const entry = this.versions.find((v) => v.version === version);
    if (!entry) throw new Error(`Unknown configuration v${version}`);
    return entry;
  }
}
