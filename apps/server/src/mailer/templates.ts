export interface MailTemplate {
  subject: string;
  text: string;
}

export interface InviteTemplateInput {
  inviter: string;
  link: string;
  expires: string;
  name?: string;
  trip?: string;
}

export function forgotPassword(link: string): MailTemplate {
  return {
    subject: 'Reset your Drunkify password',
    text: `Hi,\n\nSomeone asked to reset the password for this Drunkify account. If that was you, set a new one here:\n\n${link}\n\nThis link works once and lasts 24 hours. If it wasn't you, ignore this email.`,
  };
}

export function invite(input: InviteTemplateInput): MailTemplate {
  const greeting = input.name ? `Hi, ${input.name},` : 'Hi,';
  const trip = input.trip ? ` — join them on ${input.trip}` : '';

  return {
    subject: `${input.inviter} invited you to Drunkify`,
    text: `${greeting}\n\n${input.inviter} invited you to Drunkify${trip}.\n\n${input.link}\n\nWorks once. Expires ${input.expires}.`,
  };
}

export const forgotPasswordTemplate = forgotPassword;
export const inviteTemplate = invite;
export const templates = { forgotPassword, invite };
