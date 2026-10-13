import { randomUUID } from "node:crypto";

import { buildAuditEvent, type AuditSink } from "../core/audit";
import { deploymentEnvironment } from "../core/environment";
import type { DeploymentEnvironment, ServiceCategory } from "../core/types";

// Credential versions and controlled rotation (ADR-0010).
//
// Secret VALUES live only in a SecretStore (a managed secrets service in
// production; an in-memory store in tests). The application keeps metadata:
// version, status, dates, a reference to the stored secret. Nothing in this
// file ever returns a secret value to a caller that renders UI.

export interface SecretStore {
  /** Stores a secret and returns an opaque reference. */
  put(value: string): Promise<string>;
  get(reference: string): Promise<string>;
  destroy(reference: string): Promise<void>;
}

/** Tests and local development only. */
export function inMemorySecretStore(
  environment: DeploymentEnvironment = deploymentEnvironment(),
): SecretStore {
  if (environment === "production")
    throw new Error("The in-memory secret store cannot be used in production");
  const values = new Map<string, string>();
  return {
    async put(value) {
      const reference = `mem:${randomUUID()}`;
      values.set(reference, value);
      return reference;
    },
    async get(reference) {
      const value = values.get(reference);
      if (value === undefined) throw new Error("Unknown secret reference");
      return value;
    },
    async destroy(reference) {
      values.delete(reference);
    },
  };
}

export type CredentialStatus =
  "registered" | "validated" | "active" | "superseded" | "revoked" | "failed";

/** What Platform Admin may see. No secret values, no references. */
export interface CredentialMetadata {
  id: string;
  providerId: string;
  category: ServiceCategory;
  environment: DeploymentEnvironment;
  version: number;
  status: CredentialStatus;
  createdAt: Date;
  validatedAt: Date | null;
  activatedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
}

interface CredentialRecord extends CredentialMetadata {
  secretRef: string;
}

export type Validator = (secret: string) => Promise<boolean>;

export class CredentialRotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialRotationError";
  }
}

/**
 * Rotation for one provider in one environment:
 * register → validate → activate → (monitor) → revoke previous.
 * Until the previous credential is revoked, `rollback()` restores it.
 */
export class CredentialSet {
  private readonly records: CredentialRecord[] = [];

  constructor(
    private readonly scope: {
      providerId: string;
      category: ServiceCategory;
      environment: DeploymentEnvironment;
    },
    private readonly store: SecretStore,
    private readonly audit: AuditSink,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): CredentialMetadata[] {
    return this.records.map(({ secretRef: _ref, ...meta }) => ({ ...meta }));
  }

  get active(): CredentialMetadata | null {
    return this.list().find((c) => c.status === "active") ?? null;
  }

  /** Secret value for server-side provider calls only. */
  async activeSecret(): Promise<string> {
    const record = this.records.find((c) => c.status === "active");
    if (!record) throw new CredentialRotationError("No active credential");
    return this.store.get(record.secretRef);
  }

  async register(
    secret: string,
    actorUserId: string,
    expiresAt: Date | null = null,
  ): Promise<CredentialMetadata> {
    if (!secret || secret.length < 8)
      throw new CredentialRotationError("Credential is too short");
    const record: CredentialRecord = {
      id: randomUUID(),
      ...this.scope,
      version: this.records.length + 1,
      status: "registered",
      createdAt: this.now(),
      validatedAt: null,
      activatedAt: null,
      revokedAt: null,
      expiresAt,
      secretRef: await this.store.put(secret),
    };
    this.records.push(record);
    await this.emit("credential.registered", actorUserId, record.version);
    return this.meta(record);
  }

  async validate(
    id: string,
    validator: Validator,
    actorUserId: string,
  ): Promise<boolean> {
    const record = this.require(id, ["registered"]);
    let ok = false;
    try {
      ok = await validator(await this.store.get(record.secretRef));
    } catch {
      ok = false;
    }
    if (ok) {
      record.status = "validated";
      record.validatedAt = this.now();
      await this.emit("credential.validated", actorUserId, record.version);
    } else {
      record.status = "failed";
      await this.emit(
        "credential.rotation_failed",
        actorUserId,
        record.version,
        "validation_failed",
      );
    }
    return ok;
  }

  /** Makes a validated credential active; the old one is kept as "superseded". */
  async activate(id: string, actorUserId: string): Promise<void> {
    const record = this.require(id, ["validated"]);
    for (const other of this.records)
      if (other.status === "active") other.status = "superseded";
    record.status = "active";
    record.activatedAt = this.now();
    await this.emit("credential.activated", actorUserId, record.version);
  }

  /** Restores the most recent superseded credential if the new one misbehaves. */
  async rollback(actorUserId: string): Promise<CredentialMetadata> {
    const current = this.records.find((c) => c.status === "active");
    const previous = [...this.records]
      .reverse()
      .find((c) => c.status === "superseded");
    if (!current || !previous)
      throw new CredentialRotationError("Nothing to roll back to");
    current.status = "failed";
    previous.status = "active";
    previous.activatedAt = this.now();
    await this.emit(
      "credential.rotation_rolled_back",
      actorUserId,
      previous.version,
    );
    return this.meta(previous);
  }

  /** Revokes a non-active credential and destroys its stored secret. */
  async revoke(id: string, actorUserId: string): Promise<void> {
    const record = this.require(id, [
      "superseded",
      "failed",
      "registered",
      "validated",
    ]);
    record.status = "revoked";
    record.revokedAt = this.now();
    await this.store.destroy(record.secretRef);
    await this.emit("credential.revoked", actorUserId, record.version);
  }

  private require(id: string, allowed: CredentialStatus[]): CredentialRecord {
    const record = this.records.find((c) => c.id === id);
    if (!record) throw new CredentialRotationError("Unknown credential");
    if (!allowed.includes(record.status))
      throw new CredentialRotationError(
        `Credential v${record.version} is ${record.status}`,
      );
    return record;
  }

  private meta({
    secretRef: _ref,
    ...meta
  }: CredentialRecord): CredentialMetadata {
    return { ...meta };
  }

  private async emit(
    action: Parameters<typeof buildAuditEvent>[0]["action"],
    actorUserId: string,
    version: number,
    reason?: string,
  ) {
    await this.audit(
      buildAuditEvent(
        {
          action,
          actorUserId,
          category: this.scope.category,
          providerId: this.scope.providerId,
          environment: this.scope.environment,
          detail: reason ? { version, reason } : { version },
        },
        this.now(),
      ),
    );
  }
}
