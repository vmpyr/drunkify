import { describe, expect, it, vi } from 'vitest';

import { InMemoryRateLimiter } from '../auth/rateLimiter.js';
import { loadConfig } from '../config.js';
import {
  createDynamicTransportFactory,
  createMailer,
  forgotPassword,
  invite,
  type SmtpMessage,
  type SmtpTransportOptions,
} from '../mailer/index.js';

describe('mailer templates', () => {
  it('renders the exact forgot-password template', () => {
    expect(forgotPassword('https://drunkify.test/r/reset-token')).toEqual({
      subject: 'Reset your Drunkify password',
      text: "Hi,\n\nSomeone asked to reset the password for this Drunkify account. If that was you, set a new one here:\n\nhttps://drunkify.test/r/reset-token\n\nThis link works once and lasts 24 hours. If it wasn't you, ignore this email.",
    });
  });

  it('renders invite variants exactly', () => {
    expect(
      invite({
        inviter: 'Yash',
        name: 'Alex',
        trip: 'Berlin',
        link: 'https://drunkify.test/i/invite-token',
        expires: '2 October 2026',
      }),
    ).toEqual({
      subject: 'Yash invited you to Drunkify',
      text: 'Hi, Alex,\n\nYash invited you to Drunkify — join them on Berlin.\n\nhttps://drunkify.test/i/invite-token\n\nWorks once. Expires 2 October 2026.',
    });

    expect(
      invite({
        inviter: 'Yash',
        link: 'https://drunkify.test/i/invite-token',
        expires: '2 October 2026',
      }).text,
    ).toBe(
      'Hi,\n\nYash invited you to Drunkify.\n\nhttps://drunkify.test/i/invite-token\n\nWorks once. Expires 2 October 2026.',
    );
  });
});

describe('mailer transports', () => {
  it('logs a fully indented plaintext message in log mode', async () => {
    const output: string[] = [];
    const mailer = createMailer(loadConfig({ NODE_ENV: 'test', MAILER: 'log' }), {
      log: (message) => output.push(message),
    });

    await mailer.send({ to: 'alex@example.com', ...forgotPassword('https://example.test/r/t') });

    expect(output).toEqual([
      `[MAIL] to=alex@example.com subject="Reset your Drunkify password"\n  Hi,\n  \n  Someone asked to reset the password for this Drunkify account. If that was you, set a new one here:\n  \n  https://example.test/r/t\n  \n  This link works once and lasts 24 hours. If it wasn't you, ignore this email.`,
    ]);
  });

  it('builds and reuses an injected SMTP transport', async () => {
    const optionsSeen: SmtpTransportOptions[] = [];
    const messages: SmtpMessage[] = [];
    const config = loadConfig({
      NODE_ENV: 'test',
      MAILER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'mailer',
      SMTP_PASS: 'secret',
      MAIL_FROM: 'Drunkify <noreply@example.com>',
    });
    const mailer = createMailer(config, {
      transportFactory: (options) => {
        optionsSeen.push(options);
        return {
          sendMail(message) {
            messages.push(message);
          },
        };
      },
    });

    await mailer.send({
      to: 'alex@example.com',
      subject: 'One',
      text: 'Plain',
      html: '<p>HTML</p>',
    });
    await mailer.send({ to: 'sam@example.com', subject: 'Two', text: 'Second' });

    expect(optionsSeen).toEqual([
      {
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        auth: { user: 'mailer', pass: 'secret' },
      },
    ]);
    expect(messages).toEqual([
      {
        from: 'Drunkify <noreply@example.com>',
        to: 'alex@example.com',
        subject: 'One',
        text: 'Plain',
        html: '<p>HTML</p>',
      },
      {
        from: 'Drunkify <noreply@example.com>',
        to: 'sam@example.com',
        subject: 'Two',
        text: 'Second',
      },
    ]);
  });

  it('can adapt a dynamically loaded nodemailer module', async () => {
    const createTransport = vi.fn(() => ({ sendMail: vi.fn() }));
    const factory = createDynamicTransportFactory(() =>
      Promise.resolve({ default: { createTransport } }),
    );
    const options = { host: 'smtp.example.com', port: 587, secure: false };

    await factory(options);

    expect(createTransport).toHaveBeenCalledWith(options);
  });
});

describe('in-memory rate limiter', () => {
  it('allows five attempts per independent key and returns retryAfter seconds', () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter({ now: () => now });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.check('forgot:email:alex@example.com')).toEqual({
        allowed: true,
        retryAfter: 0,
      });
    }
    expect(limiter.check('forgot:email:alex@example.com')).toEqual({
      allowed: false,
      retryAfter: 900,
    });
    expect(limiter.check('forgot:ip:127.0.0.1')).toEqual({ allowed: true, retryAfter: 0 });

    now = 15 * 60 * 1000;
    expect(limiter.check('forgot:email:alex@example.com')).toEqual({
      allowed: true,
      retryAfter: 0,
    });
  });

  it('uses a true sliding window and rounds retryAfter up', () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter({ limit: 2, windowMs: 10_000, now: () => now });

    limiter.check('signin:ip:127.0.0.1');
    now = 4_500;
    limiter.check('signin:ip:127.0.0.1');
    now = 9_001;
    expect(limiter.check('signin:ip:127.0.0.1')).toEqual({
      allowed: false,
      retryAfter: 1,
    });

    now = 10_000;
    expect(limiter.check('signin:ip:127.0.0.1')).toEqual({ allowed: true, retryAfter: 0 });
    now = 10_001;
    expect(limiter.check('signin:ip:127.0.0.1')).toEqual({
      allowed: false,
      retryAfter: 5,
    });
  });
});
