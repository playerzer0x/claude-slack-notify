import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Request, Response, NextFunction } from 'express';

const SIGNING_SECRET_PATH = join(homedir(), '.claude', 'slack-signing-secret');

function getSigningSecret(): string | null {
  if (!existsSync(SIGNING_SECRET_PATH)) {
    return null;
  }
  return readFileSync(SIGNING_SECRET_PATH, 'utf-8').trim();
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

  // Check timestamp to prevent replay attacks (5 minute window)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp, 10)) > 300) {
    res.status(401).send('Request timestamp too old');
    return;
  }

  // Compute expected signature
  const rawBody = (req as Request & { rawBody?: string }).rawBody || '';
  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const mySignature =
    'v0=' + createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');

  // Compare signatures
  if (mySignature !== signature) {
    console.error('Slack signature mismatch');
    res.status(401).send('Invalid signature');
    return;
  }

  next();
}
