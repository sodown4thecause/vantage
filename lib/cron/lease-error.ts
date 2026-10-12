/** Thrown when another scan already holds this workspace's lease. Kept dependency-free so callers can import it without the lease's database client. */
export class ScanLeaseBusyError extends Error {
  constructor() {
    super("Workspace scan already running.");
    this.name = "ScanLeaseBusyError";
  }
}
