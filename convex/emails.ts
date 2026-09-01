// Transactional email for the value engine: consumer confirmations and team
// alerts. Uses the Viktor Spaces send-email API (same transport as auth OTP),
// but with fully custom HTML/text bodies.
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

declare const process: { env: Record<string, string | undefined> };

export const TEAM_EMAIL = "Hello@calebault.com";
const BRAND = "Caleb Ault Real Estate";

function wrapHtml(heading: string, bodyHtml: string): string {
  return `
  <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; padding: 32px 20px; color: #1a1a1a;">
    <p style="font-size: 12px; letter-spacing: 3px; text-transform: uppercase; color: #666; margin: 0 0 24px;">CALEB AULT</p>
    <h2 style="font-size: 22px; margin: 0 0 16px; color: #1a1a1a;">${heading}</h2>
    <div style="font-family: -apple-system, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: #444;">
      ${bodyHtml}
    </div>
    <hr style="border: none; border-top: 1px solid #eee; margin: 28px 0;" />
    <p style="font-size: 11px; color: #999; text-align: center; font-family: -apple-system, Helvetica, sans-serif;">
      ${BRAND} · Miami &amp; South Florida · <a href="https://calebault.com/real-estate" style="color: #999;">calebault.com</a>
    </p>
  </div>`;
}

export function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export const sendTransactionalEmail = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    heading: v.string(),
    bodyHtml: v.string(),
    bodyText: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiUrl = process.env.VIKTOR_SPACES_API_URL;
    const projectName = process.env.VIKTOR_SPACES_PROJECT_NAME;
    const projectSecret = process.env.VIKTOR_SPACES_PROJECT_SECRET;
    if (!apiUrl || !projectName || !projectSecret) {
      return { ok: false, error: "email env not configured" };
    }
    const payload = (emailType: string) => ({
      project_name: projectName,
      project_secret: projectSecret,
      to_email: args.to,
      subject: `${args.subject} - ${BRAND}`,
      html_content: wrapHtml(args.heading, args.bodyHtml),
      text_content: `${args.heading}\n\n${args.bodyText}\n\n---\n${BRAND} · calebault.com`,
      email_type: emailType,
    });
    for (const emailType of ["transactional", "otp"]) {
      try {
        const res = await fetch(`${apiUrl}/api/viktor-spaces/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload(emailType)),
        });
        if (!res.ok) continue;
        const result = (await res.json()) as { success: boolean; error?: string };
        if (result.success) return { ok: true };
      } catch {
        // try next type
      }
    }
    return { ok: false, error: "send failed" };
  },
});

// ---- Templates ----

export function leadConsumerEmail(args: {
  name: string;
  address: string;
  readout: any;
}): { subject: string; heading: string; bodyHtml: string; bodyText: string } {
  const r = args.readout ?? {};
  const rows: string[] = [];
  if (typeof r.instantOffer === "number")
    rows.push(`<tr><td style="padding:6px 12px 6px 0;color:#666;">Instant cash offer</td><td style="padding:6px 0;font-weight:bold;">${money(r.instantOffer)}</td></tr>`);
  if (typeof r.retailEstimate === "number")
    rows.push(`<tr><td style="padding:6px 12px 6px 0;color:#666;">Estimated market value</td><td style="padding:6px 0;font-weight:bold;">${money(r.retailEstimate)}</td></tr>`);
  if (typeof r.netAfterCosts === "number")
    rows.push(`<tr><td style="padding:6px 12px 6px 0;color:#666;">Est. net if listed</td><td style="padding:6px 0;font-weight:bold;">${money(r.netAfterCosts)}</td></tr>`);
  const table = rows.length
    ? `<table style="border-collapse:collapse;margin:16px 0;">${rows.join("")}</table>
       <p style="font-size:12px;color:#888;">Estimate based on public records and recent comparable sales. Not an appraisal.</p>`
    : "";
  const textRows = rows.length
    ? `\n\nInstant cash offer: ${typeof r.instantOffer === "number" ? money(r.instantOffer) : "-"}\nEstimated market value: ${typeof r.retailEstimate === "number" ? money(r.retailEstimate) : "-"}\nEst. net if listed: ${typeof r.netAfterCosts === "number" ? money(r.netAfterCosts) : "-"}\n(Estimate, not an appraisal.)`
    : "";
  return {
    subject: `Your property value for ${args.address}`,
    heading: `Thanks${args.name ? `, ${args.name.split(" ")[0]}` : ""} — here's your readout`,
    bodyHtml: `<p>Property: <strong>${args.address}</strong></p>${table}
      <p>I'll review this personally and reach out shortly. Want to talk now? Book 15 minutes:
      <a href="https://calebault.com/schedule">calebault.com/schedule</a></p>`,
    bodyText: `Property: ${args.address}${textRows}\n\nI'll review this personally and reach out shortly. Book 15 minutes: https://calebault.com/schedule`,
  };
}

export function leadTeamEmail(args: {
  name: string;
  email: string;
  phone: string;
  address: string;
  intent: string;
  readout: any;
  sessionId?: string;
}): { subject: string; heading: string; bodyHtml: string; bodyText: string } {
  const r = args.readout ?? {};
  return {
    subject: `New value lead: ${args.address}`,
    heading: "New value-engine lead",
    bodyHtml: `<table style="border-collapse:collapse;">
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Name</td><td>${args.name}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Email</td><td>${args.email}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Phone</td><td>${args.phone}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Address</td><td>${args.address}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Intent</td><td>${args.intent}</td></tr>
      ${typeof r.instantOffer === "number" ? `<tr><td style="padding:4px 12px 4px 0;color:#666;">Instant offer shown</td><td>${money(r.instantOffer)}</td></tr>` : ""}
      ${typeof r.retailEstimate === "number" ? `<tr><td style="padding:4px 12px 4px 0;color:#666;">Retail estimate</td><td>${money(r.retailEstimate)}</td></tr>` : ""}
      ${args.sessionId ? `<tr><td style="padding:4px 12px 4px 0;color:#666;">Session</td><td>${args.sessionId}</td></tr>` : ""}
    </table>`,
    bodyText: `Name: ${args.name}\nEmail: ${args.email}\nPhone: ${args.phone}\nAddress: ${args.address}\nIntent: ${args.intent}\nInstant offer shown: ${typeof r.instantOffer === "number" ? money(r.instantOffer) : "-"}\nRetail estimate: ${typeof r.retailEstimate === "number" ? money(r.retailEstimate) : "-"}`,
  };
}

export function offerConsumerEmail(args: {
  name: string;
  address: string;
  price: number;
  deposit: number;
  closingDays: number;
  offerUrl: string;
}): { subject: string; heading: string; bodyHtml: string; bodyText: string } {
  return {
    subject: `Your signed offer for ${args.address}`,
    heading: "Your offer is in — copy enclosed",
    bodyHtml: `<p>Thanks${args.name ? `, ${args.name.split(" ")[0]}` : ""}. Here's a copy of the offer terms you signed:</p>
      <table style="border-collapse:collapse;margin:12px 0;">
        <tr><td style="padding:4px 12px 4px 0;color:#666;">Property</td><td>${args.address}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;">Offer price</td><td><strong>${money(args.price)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;">Deposit</td><td>${money(args.deposit)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;">Closing</td><td>${args.closingDays} days</td></tr>
      </table>
      <p>View your copy: <a href="${args.offerUrl}">${args.offerUrl}</a></p>
      <p>This is a non-binding letter of intent. Our team reviews every signed offer and will reach out to draft the formal contract.</p>`,
    bodyText: `Offer terms you signed:\nProperty: ${args.address}\nOffer price: ${money(args.price)}\nDeposit: ${money(args.deposit)}\nClosing: ${args.closingDays} days\n\nYour copy: ${args.offerUrl}\n\nNon-binding letter of intent. Our team reviews every signed offer and will reach out to draft the formal contract.`,
  };
}

export function offerTeamEmail(args: {
  name: string;
  email: string;
  phone: string;
  address: string;
  price: number;
  deposit: number;
  inspectionDays: number;
  dueDiligenceDays: number;
  closingDays: number;
  contingencies: string[];
  countyOwner?: string;
}): { subject: string; heading: string; bodyHtml: string; bodyText: string } {
  return {
    subject: `SIGNED LOI: ${args.address} — ${money(args.price)}`,
    heading: "Signed instant-offer LOI",
    bodyHtml: `<table style="border-collapse:collapse;">
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Seller</td><td>${args.name} (${args.email}, ${args.phone})</td></tr>
      ${args.countyOwner ? `<tr><td style="padding:4px 12px 4px 0;color:#666;">County owner</td><td>${args.countyOwner}</td></tr>` : ""}
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Address</td><td>${args.address}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Price</td><td><strong>${money(args.price)}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Deposit</td><td>${money(args.deposit)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Inspection / DD / Close</td><td>${args.inspectionDays}d / ${args.dueDiligenceDays}d / ${args.closingDays}d</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Contingencies</td><td>${args.contingencies.join(", ") || "none"}</td></tr>
    </table>`,
    bodyText: `Seller: ${args.name} (${args.email}, ${args.phone})\n${args.countyOwner ? `County owner: ${args.countyOwner}\n` : ""}Address: ${args.address}\nPrice: ${money(args.price)}\nDeposit: ${money(args.deposit)}\nInspection/DD/Close: ${args.inspectionDays}d/${args.dueDiligenceDays}d/${args.closingDays}d\nContingencies: ${args.contingencies.join(", ") || "none"}`,
  };
}
