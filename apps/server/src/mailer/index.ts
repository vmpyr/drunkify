import type { Config } from '../config.js';

export {
  forgotPassword,
  forgotPasswordTemplate,
  invite,
  inviteTemplate,
  templates,
} from './templates.js';
export type { InviteTemplateInput, MailTemplate } from './templates.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  auth?: {
    user?: string;
    pass?: string;
  };
}

export interface SmtpMessage extends MailMessage {
  from: string;
}

export interface SmtpTransport {
  sendMail(message: SmtpMessage): unknown;
}

export type SmtpTransportFactory = (
  options: SmtpTransportOptions,
) => SmtpTransport | Promise<SmtpTransport>;

export interface NodemailerLike {
  createTransport(options: SmtpTransportOptions): SmtpTransport;
}

export interface CreateMailerOptions {
  transportFactory?: SmtpTransportFactory;
  log?: (message: string) => void;
}

export function createMailer(config: Config, options: CreateMailerOptions = {}): Mailer {
  if (config.MAILER === 'log') {
    return createLogMailer(options.log);
  }
  if (!options.transportFactory) {
    throw new Error('SMTP mailer requires a transport factory');
  }
  return createSmtpMailer(config, options.transportFactory);
}

export function createLogMailer(log: (message: string) => void = console.log): Mailer {
  return {
    send(message) {
      // Intentional redaction exception: MAILER=log is the documented recovery path and
      // therefore includes reset/invite links contained in the plaintext body.
      log(formatLogMessage(message));
      return Promise.resolve();
    },
  };
}

export function formatLogMessage(message: MailMessage): string {
  const indentedBody = message.text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return `[MAIL] to=${message.to} subject=${JSON.stringify(message.subject)}\n${indentedBody}`;
}

export function createSmtpMailer(config: Config, transportFactory: SmtpTransportFactory): Mailer {
  if (!config.SMTP_HOST) {
    throw new Error('SMTP_HOST is required for the SMTP mailer');
  }

  const transportOptions: SmtpTransportOptions = {
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    ...(config.SMTP_USER || config.SMTP_PASS
      ? {
          auth: {
            ...(config.SMTP_USER ? { user: config.SMTP_USER } : {}),
            ...(config.SMTP_PASS ? { pass: config.SMTP_PASS } : {}),
          },
        }
      : {}),
  };
  let transport: Promise<SmtpTransport> | undefined;

  return {
    async send(message) {
      transport ??= Promise.resolve(transportFactory(transportOptions));
      const smtpMessage: SmtpMessage = {
        from: config.MAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
      };
      await (await transport).sendMail(smtpMessage);
    },
  };
}

export function createDynamicTransportFactory(
  loadNodemailer: () => Promise<NodemailerLike | { default: NodemailerLike }>,
): SmtpTransportFactory {
  return async (options) => {
    const loaded = await loadNodemailer();
    const nodemailer = 'default' in loaded ? loaded.default : loaded;
    return nodemailer.createTransport(options);
  };
}
