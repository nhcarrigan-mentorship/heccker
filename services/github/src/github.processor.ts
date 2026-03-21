import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Octokit } from 'octokit';
import Redis from 'ioredis';

@Processor('github')
export class GitHubProcessor extends WorkerHost {
  private readonly logger = new Logger(GitHubProcessor.name);
  private octokit: Octokit;
  private redis: Redis;

  constructor() {
    super();
    this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
  }

  private emitEvent(sessionId: string, event: any) {
    this.redis.publish('activity_events', JSON.stringify({ sessionId, event }));
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { session_id, payload, task_type } = job.data;
    this.logger.log(`Processing GitHub task: ${task_type}`);

    this.emitEvent(session_id, {
      agent_name: 'github',
      type: 'update',
      content: `GitHub Agent engaged. Targeting repo: ${payload.repo || 'N/A'}`,
      timestamp: new Date().toISOString()
    });

    try {
      if (!process.env.GITHUB_TOKEN) {
        throw new Error("GITHUB_TOKEN missing in .env. GitHub Agent restricted.");
      }

      const [owner, repo] = payload.repo?.split('/') || [];
      if (!owner || !repo) throw new Error("Invalid repo format. Use 'owner/repo'.");

      let resultText = "";

      if (task_type === 'monitor_repo') {
        const { data: commits } = await this.octokit.rest.repos.listCommits({ owner, repo, per_page: 5 });
        resultText = commits.map((c: any) => `[${c.sha.substring(0, 7)}] ${c.commit.author?.name}: ${c.commit.message}`).join('\n');
      } 
      else if (task_type === 'check_pr') {
        const { data: prs } = await this.octokit.rest.pulls.list({ owner, repo, state: 'open' });
        resultText = prs.map((p: any) => `#${p.number} ${p.title} (by ${p.user?.login})`).join('\n') || "No open pull requests.";
      }
      else if (task_type === 'check_ci') {
        const { data: runs } = await this.octokit.rest.actions.listWorkflowRunsForRepo({ owner, repo, per_page: 5 });
        resultText = runs.workflow_runs.map((r: any) => `[${r.status}/${r.conclusion}] ${r.name} - ${r.head_branch}`).join('\n');
      }

      this.emitEvent(session_id, {
        agent_name: 'github',
        type: 'final',
        content: `GitHub Analysis Complete:\n${resultText.substring(0, 200)}...`,
        timestamp: new Date().toISOString()
      });

      return { success: true, result: resultText };

    } catch (e: any) {
      this.logger.error(e.message);
      this.emitEvent(session_id, {
        agent_name: 'github',
        type: 'error',
        content: `GitHub Error: ${e.message}`,
        timestamp: new Date().toISOString()
      });
      throw e;
    }
  }
}
