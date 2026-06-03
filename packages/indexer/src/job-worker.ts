import { PrismaClient } from "@prisma/client";
import type { ChainConfig } from "./chain-config.js";

// Job worker polls for pending jobs and dispatches them to the analyzer.
// Runs alongside the indexer in the same process.
export class JobWorker {
  private running = false;

  constructor(
    private readonly configs: ChainConfig[],
    private readonly prisma: PrismaClient
  ) {}

  async start(): Promise<void> {
    this.running = true;
    console.log("[JobWorker] Started");
    while (this.running) {
      await this.tick();
      await sleep(5000);
    }
  }

  stop(): void {
    this.running = false;
  }

  private async tick(): Promise<void> {
    const jobs = await this.prisma.indexerJob.findMany({
      where: { status: "PENDING" },
      take: 10,
      orderBy: { createdAt: "asc" },
      include: { hook: true },
    });

    for (const job of jobs) {
      await this.prisma.indexerJob.update({
        where: { id: job.id },
        data: { status: "RUNNING", startedAt: new Date() },
      });

      try {
        await this.processJob(job);

        await this.prisma.indexerJob.update({
          where: { id: job.id },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[JobWorker] Job ${job.id} (${job.jobType}) failed:`, msg);

        await this.prisma.indexerJob.update({
          where: { id: job.id },
          data: { status: "FAILED", errorMessage: msg },
        });
      }
    }
  }

  private async processJob(job: {
    id: string;
    jobType: string;
    chainId: number;
    hook?: { address: string } | null;
  }): Promise<void> {
    if (!job.hook) return;

    const config = this.configs.find((c) => c.chain.id === job.chainId);
    if (!config) {
      throw new Error(`No chain config for chainId ${job.chainId}`);
    }

    // Dynamically import analyzer to avoid circular dep
    const { HookAnalyzer } = await import("@hookscope/analyzer");
    const analyzer = new HookAnalyzer(config.client, config.chain.id, this.prisma);

    switch (job.jobType) {
      case "ANALYZE":
        await analyzer.analyze(job.hook.address as `0x${string}`, config.explorerApiKey);
        break;
      case "SECURITY_SCAN":
        await analyzer.securityScan(job.hook.address as `0x${string}`);
        break;
      case "ANALYTICS":
        await analyzer.refreshAnalytics(job.hook.address as `0x${string}`);
        break;
      default:
        console.warn(`[JobWorker] Unknown job type: ${job.jobType}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
