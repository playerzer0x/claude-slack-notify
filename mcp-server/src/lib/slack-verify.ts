import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';

const SIGNING_SECRET_PATH = join(homedir(), '.claude', 'slack-signing-secret');
const REPLAY_WINDOW_SECONDS = 300; // 5 minutes

function getSigningSecret(): string | null {
  if (!existsSync(SIGNING_SECRET_PATH)) {
    return null;
  }
  return readFileSync(SIGNING_SECRET_PATH, 'utf-8').trim();
}

function computeSignature(secret: string, timestamp: string, body: string): string {
  const baseString = `v0:${timestamp}:${body}`;
  const hash = createHmac('sha256', secret).update(baseString).digest('hex');
  return `v0=${hash}`;
}

export function verifySlackSignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const signingSecret = getSigningSecret();

  // If no signing secret configured, skip verification (development mode)
  if (!signingSecret) {
    console.warn('Slack signing secret not configured, skipping verification');
    next();
    return;
  }

  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const signature = req.headers['x-slack-signature'] as string;

  if (!timestamp || !signature) {
    res.status(401).send('Missing Slack headers');
    return;
  }

  // Check timestamp to prevent replay attacks
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp, 10)) > REPLAY_WINDOW_SECONDS) {
    res.status(401).send('Request timestamp too old');
    return;
  }

  // Compute and compare signatures
  const rawBody = (req as Request & { rawBody?: string }).rawBody || '';
  const expectedSignature = computeSignature(signingSecret, timestamp, rawBody);

  if (expectedSignature !== signature) {
    console.error('Slack signature mismatch');
    res.status(401).send('Invalid signature');
    return;
  }

  next();
}
