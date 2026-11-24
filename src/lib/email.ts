import nodemailer from 'nodemailer';
import { config } from '../config';

const transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
});

// ---- shared primitives ----

const LOGO = `
<table border="0" cellpadding="0" cellspacing="0" role="presentation">
  <tr>
    <td style="vertical-align:middle;">
      <svg width="44" height="44" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <rect width="64" height="64" rx="14" fill="#2B2420"/>
        <path d="M32 32 C 22 22, 14 30, 20 38 C 24 42, 32 46, 32 46 C 32 46, 40 42, 44 38 C 50 30, 42 22, 32 32 Z" fill="#F6B89A"/>
      </svg>
    </td>
    <td style="vertical-align:middle;padding-left:12px;">
      <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#2B2420;letter-spacing:-0.5px;">WishSync<span style="color:#E89671;">.</span></span>
    </td>
  </tr>
</table>`;

function btn(href: string, label: string, bg = '#F6B89A', color = '#2B2420') {
  return `
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0;">
  <tr>
    <td style="border-radius:999px;background:${bg};">
      <a href="${href}"
         style="display:inline-block;padding:14px 30px;color:${color};font-size:15px;font-weight:700;text-decoration:none;font-family:Arial,Helvetica,sans-serif;border-radius:999px;letter-spacing:-0.2px;">
        ${label}
      </a>
    </td>
  </tr>
</table>`;
}

function pill(text: string, bg = '#F6E2A8') {
  return `<span style="display:inline-block;padding:3px 12px;background:${bg};border-radius:999px;font-size:12px;font-weight:700;color:#2B2420;font-family:Arial,Helvetica,sans-serif;letter-spacing:0.02em;">${text}</span>`;
}

function wrap(accentColor: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <title>WishSync</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
    img{border:0;height:auto;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
    @media only screen and (max-width:620px){
      .outer{padding:0!important;}
      .card{border-radius:0!important;}
      .pad{padding:24px 20px!important;}
      .fpad{padding:18px 20px 24px!important;}
      .hpad{padding:24px 20px 20px!important;}
      h2.title{font-size:24px!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#FBF5EC;">
<table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#FBF5EC;">
  <tr>
    <td align="center" class="outer" style="padding:48px 16px;">

      <table border="0" cellpadding="0" cellspacing="0" width="560" class="card"
             style="max-width:560px;width:100%;background:#FFFDF8;border-radius:24px;overflow:hidden;
                    box-shadow:0 8px 40px rgba(43,36,32,0.10);">

        <!-- accent bar -->
        <tr>
          <td style="background:${accentColor};height:5px;font-size:0;line-height:0;">&nbsp;</td>
        </tr>

        <!-- header: logo -->
        <tr>
          <td class="hpad" style="padding:28px 40px 22px;">
            ${LOGO}
          </td>
        </tr>

        <!-- hairline -->
        <tr>
          <td style="padding:0 40px;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%">
              <tr><td style="border-top:1px dashed #E8DCC8;font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>

        <!-- body -->
        <tr>
          <td class="pad" style="padding:32px 40px;">
            ${content}
          </td>
        </tr>

        <!-- footer -->
        <tr>
          <td class="fpad" style="padding:18px 40px 28px;border-top:1px dashed #E8DCC8;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center">
                  <p style="margin:0 0 5px;font-size:10px;color:#8B7F74;font-weight:700;
                             letter-spacing:0.14em;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">
                    GIFTING &middot; TOGETHER
                  </p>
                  <p style="margin:0;font-size:12px;color:#8B7F74;font-family:Arial,Helvetica,sans-serif;">
                    WishSync &middot;
                    <a href="${config.frontendUrl}" style="color:#8B7F74;text-decoration:none;">
                      ${config.frontendUrl.replace(/^https?:\/\//, '')}
                    </a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ---- email senders ----

export async function sendWelcome(to: string, name: string) {
  await transport.sendMail({
    from: config.smtp.from,
    to,
    subject: `Welcome to WishSync, ${name} 🎁`,
    html: wrap('#F6B89A', `
      <h2 class="title" style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:30px;color:#2B2420;font-weight:normal;line-height:1.2;">
        Hey ${name}, welcome!
      </h2>
      <p style="margin:0 0 20px;font-size:15px;color:#5A4F47;line-height:1.65;font-family:Arial,Helvetica,sans-serif;">
        Your WishSync account is ready. Build your wishlist, invite your partner or friends, and never give a bad gift again.
      </p>

      <!-- feature list -->
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
        ${[
          ['🎁', 'Add wishes', 'with images, prices, and store links'],
          ['🤫', 'Reserve secretly', 'your partner never sees who picked what'],
          ['👥', 'Invite your circle', 'couples, friend groups, all in one place'],
        ].map(([icon, bold, rest]) => `
        <tr>
          <td style="padding:7px 0;vertical-align:top;width:28px;font-size:20px;line-height:1;">${icon}</td>
          <td style="padding:7px 0 7px 10px;font-size:14px;color:#5A4F47;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
            <strong style="color:#2B2420;">${bold}</strong> — ${rest}
          </td>
        </tr>`).join('')}
      </table>

      ${btn(config.frontendUrl, 'Open WishSync →')}

      <p style="margin:20px 0 0;font-size:13px;color:#8B7F74;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
        Start by adding a wish or inviting someone from the Groups tab.
      </p>
    `),
  });
}

export async function sendInvite(to: string, inviterName: string, circleName: string, inviteUrl: string) {
  await transport.sendMail({
    from: config.smtp.from,
    to,
    subject: `${inviterName} invited you to sync gift lists 🎁`,
    html: wrap('#F2C2C9', `
      <!-- eyebrow pill -->
      <p style="margin:0 0 16px;">${pill('You\'ve been invited', '#F2C2C9')}</p>

      <h2 class="title" style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:30px;color:#2B2420;font-weight:normal;line-height:1.2;">
        ${inviterName} wants to<br/>sync wishlists with you.
      </h2>
      <p style="margin:0 0 24px;font-size:15px;color:#5A4F47;line-height:1.65;font-family:Arial,Helvetica,sans-serif;">
        You've been invited to join <strong style="color:#2B2420;">&ldquo;${circleName}&rdquo;</strong> on WishSync —
        where you share wishlists, reserve gifts secretly, and actually nail every occasion.
      </p>

      <!-- what you'll get -->
      <table border="0" cellpadding="0" cellspacing="0" width="100%"
             style="background:#FBF5EC;border-radius:14px;margin-bottom:28px;">
        <tr>
          <td style="padding:20px 24px;">
            <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#8B7F74;letter-spacing:0.1em;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">
              What happens next
            </p>
            ${[
              'Create a free account (takes 30 seconds)',
              `Join &ldquo;${circleName}&rdquo; automatically`,
              'See each other\'s wishlists and reserve gifts in secret',
            ].map((step, i) => `
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:8px;">
              <tr>
                <td style="vertical-align:top;width:24px;font-size:14px;color:#E89671;font-weight:700;font-family:Arial,Helvetica,sans-serif;padding-top:1px;">${i + 1}.</td>
                <td style="vertical-align:top;font-size:14px;color:#5A4F47;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">${step}</td>
              </tr>
            </table>`).join('')}
          </td>
        </tr>
      </table>

      ${btn(inviteUrl, 'Accept invite →', '#2B2420', '#F6B89A')}

      <p style="margin:20px 0 0;font-size:12px;color:#8B7F74;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
        This link expires in 7 days. If you didn't expect this, you can safely ignore it.
      </p>
    `),
  });
}

export async function sendReservationConfirm(to: string, reserverName: string, wishTitle: string, ownerName: string) {
  await transport.sendMail({
    from: config.smtp.from,
    to,
    subject: `Gift locked in — "${wishTitle}" 🤫`,
    html: wrap('#BED6B0', `
      <!-- eyebrow pill -->
      <p style="margin:0 0 16px;">${pill('Secret reservation', '#BED6B0')}</p>

      <h2 class="title" style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:30px;color:#2B2420;font-weight:normal;line-height:1.2;">
        You've got this one, ${reserverName}.
      </h2>
      <p style="margin:0 0 24px;font-size:15px;color:#5A4F47;line-height:1.65;font-family:Arial,Helvetica,sans-serif;">
        You've secretly reserved <strong style="color:#2B2420;">&ldquo;${wishTitle}&rdquo;</strong>
        from ${ownerName}'s wishlist. ${ownerName} won't see a thing — only you know.
      </p>

      <!-- reserved item card -->
      <table border="0" cellpadding="0" cellspacing="0" width="100%"
             style="background:#FBF5EC;border-radius:14px;border-left:4px solid #BED6B0;margin-bottom:28px;">
        <tr>
          <td style="padding:18px 22px;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#8B7F74;letter-spacing:0.1em;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">Reserved gift</p>
            <p style="margin:0;font-size:16px;font-weight:700;color:#2B2420;font-family:Arial,Helvetica,sans-serif;">${wishTitle}</p>
            <p style="margin:4px 0 0;font-size:13px;color:#5A4F47;font-family:Arial,Helvetica,sans-serif;">from ${ownerName}'s list &middot; reserved by you</p>
          </td>
        </tr>
      </table>

      ${btn(config.frontendUrl, `View ${ownerName}'s list →`)}

      <p style="margin:20px 0 0;font-size:13px;color:#8B7F74;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
        Changed your mind? You can release the reservation anytime from the app.
      </p>
    `),
  });
}

export async function sendNewWishNotification(to: string[], fromName: string, wishTitle: string, circleName: string) {
  if (to.length === 0) return;
  await transport.sendMail({
    from: config.smtp.from,
    to: to.join(','),
    subject: `${fromName} just added a wish ✨`,
    html: wrap('#F6E2A8', `
      <!-- eyebrow pill -->
      <p style="margin:0 0 16px;">${pill(`New wish in ${circleName}`, '#F6E2A8')}</p>

      <h2 class="title" style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:30px;color:#2B2420;font-weight:normal;line-height:1.2;">
        ${fromName} added something new.
      </h2>
      <p style="margin:0 0 24px;font-size:15px;color:#5A4F47;line-height:1.65;font-family:Arial,Helvetica,sans-serif;">
        A new wish just appeared on ${fromName}'s list in
        <strong style="color:#2B2420;">${circleName}</strong>.
        Be the first to reserve it before someone else does.
      </p>

      <!-- wish card -->
      <table border="0" cellpadding="0" cellspacing="0" width="100%"
             style="background:#FBF5EC;border-radius:14px;border-left:4px solid #E89671;margin-bottom:28px;">
        <tr>
          <td style="padding:18px 22px;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#8B7F74;letter-spacing:0.1em;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">New wish</p>
            <p style="margin:0;font-size:16px;font-weight:700;color:#2B2420;font-family:Arial,Helvetica,sans-serif;">${wishTitle}</p>
            <p style="margin:4px 0 0;font-size:13px;color:#5A4F47;font-family:Arial,Helvetica,sans-serif;">added by ${fromName}</p>
          </td>
        </tr>
      </table>

      ${btn(config.frontendUrl, `See ${fromName}'s list →`)}

      <p style="margin:20px 0 0;font-size:13px;color:#8B7F74;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
        To stop getting these, turn off &ldquo;Someone added to their list&rdquo; in Profile &rarr; Notifications.
      </p>
    `),
  });
}

export async function sendOccasionReminder(to: string[], occasionTitle: string, occasionDate: string, daysAway: number) {
  if (to.length === 0) return;
  const urgency = daysAway <= 3 ? 'Very soon' : 'Coming up';
  const urgencyColor = daysAway <= 3 ? '#F6B89A' : '#F6E2A8';
  await transport.sendMail({
    from: config.smtp.from,
    to: to.join(','),
    subject: `${occasionTitle} is ${daysAway === 1 ? 'tomorrow' : `in ${daysAway} days`} 🎂`,
    html: wrap(urgencyColor, `
      <p style="margin:0 0 16px;">${pill(urgency, urgencyColor)}</p>

      <h2 class="title" style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:30px;color:#2B2420;font-weight:normal;line-height:1.2;">
        ${occasionTitle}<br/>is just around the corner.
      </h2>
      <p style="margin:0 0 24px;font-size:15px;color:#5A4F47;line-height:1.65;font-family:Arial,Helvetica,sans-serif;">
        You have <strong style="color:#2B2420;">${daysAway} day${daysAway !== 1 ? 's' : ''}</strong> to get something sorted.
        Head to the wishlist and grab what hasn't been claimed yet.
      </p>

      <table border="0" cellpadding="0" cellspacing="0" width="100%"
             style="background:#FBF5EC;border-radius:14px;border-left:4px solid ${urgencyColor};margin-bottom:28px;">
        <tr>
          <td style="padding:18px 22px;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#8B7F74;letter-spacing:0.1em;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">Upcoming occasion</p>
            <p style="margin:0;font-size:18px;font-weight:700;color:#2B2420;font-family:Arial,Helvetica,sans-serif;">${occasionTitle}</p>
            <p style="margin:4px 0 0;font-size:13px;color:#5A4F47;font-family:Arial,Helvetica,sans-serif;">${occasionDate} &middot; ${daysAway} day${daysAway !== 1 ? 's' : ''} away</p>
          </td>
        </tr>
      </table>

      ${btn(config.frontendUrl, 'Plan the gift now →')}

      <p style="margin:20px 0 0;font-size:13px;color:#8B7F74;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
        To stop getting these, turn off &ldquo;Birthdays approaching&rdquo; in Profile &rarr; Notifications.
      </p>
    `),
  });
}

export async function sendPasswordReset(to: string, name: string, resetUrl: string) {
  await transport.sendMail({
    from: config.smtp.from,
    to,
    subject: 'Reset your WishSync password',
    html: wrap('#F2C2C9', `
      <h2 class="title" style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:30px;color:#2B2420;font-weight:normal;line-height:1.2;">
        Reset your password
      </h2>
      <p style="margin:0 0 24px;font-size:15px;color:#5A4F47;line-height:1.65;font-family:Arial,Helvetica,sans-serif;">
        Hey ${name}, we got a request to reset the password on your WishSync account. Click below to choose a new one.
      </p>

      ${btn(resetUrl, 'Reset password →')}

      <p style="margin:20px 0 0;font-size:13px;color:#8B7F74;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
        This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password won't change.
      </p>
    `),
  });
}

export async function sendReactionNotification(to: string, reactorName: string, wishTitle: string, reactionType: string) {
  const emoji = reactionType === 'heart' ? '♥' : reactionType === 'eyes' ? '👀' : '🎁';
  const label = reactionType === 'heart' ? 'loves it' : reactionType === 'eyes' ? 'is eyeing it' : 'wants to gift it';
  await transport.sendMail({
    from: config.smtp.from,
    to,
    subject: `${reactorName} reacted to "${wishTitle}"`,
    html: wrap('#F6E2A8', `
      <h2 class="title" style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:30px;color:#2B2420;font-weight:normal;line-height:1.2;">
        Someone noticed.
      </h2>
      <p style="margin:0 0 24px;font-size:15px;color:#5A4F47;line-height:1.65;font-family:Arial,Helvetica,sans-serif;">
        <strong style="color:#2B2420;">${reactorName}</strong> reacted to one of your wishes — looks like ${label}.
      </p>
      <table border="0" cellpadding="0" cellspacing="0" width="100%"
             style="background:#FBF5EC;border-radius:14px;border-left:4px solid #F6E2A8;margin-bottom:28px;">
        <tr>
          <td style="padding:18px 22px;">
            <p style="margin:0 0 4px;font-size:28px;">${emoji}</p>
            <p style="margin:0;font-size:16px;font-weight:700;color:#2B2420;font-family:Arial,Helvetica,sans-serif;">${wishTitle}</p>
            <p style="margin:4px 0 0;font-size:13px;color:#5A4F47;font-family:Arial,Helvetica,sans-serif;">reacted by ${reactorName}</p>
          </td>
        </tr>
      </table>
      ${btn(config.frontendUrl, 'See your wishlist →')}
      <p style="margin:20px 0 0;font-size:13px;color:#8B7F74;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
        To stop getting these, turn off &ldquo;Reactions to my wishes&rdquo; in Profile &rarr; Notifications.
      </p>
    `),
  });
}
