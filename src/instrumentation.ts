export async function register() {
  // Node runtime only — the edge runtime has no timers/db access for jobs
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundJobs } = await import("@/server/jobs/boot");
    startBackgroundJobs();
  }
}
