# Global DJ Connect — Email Integration Snippets

All emails go through `/.netlify/functions/send-email`.
Add your Resend API key to Netlify: Site Settings → Environment Variables → `RESEND_API_KEY`

---

## SHARED HELPER (add once near top of each file's <script>)

```js
async function sendEmail(payload) {
  try {
    await fetch('/.netlify/functions/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.warn('Email send failed (non-blocking):', e.message);
  }
}
```

---

## 1. forgot-password.html — Replace the console.log block

FIND this block (around line 285):
```js
console.log('📧 PASSWORD RESET EMAIL (configure email service to send):', resetEmail);
console.log('🔗 Reset Link:', resetLink);
// TODO: Replace with actual email service (SendGrid, Mailgun, etc.)
```

REPLACE WITH:
```js
await sendEmail({
  type: 'password_reset',
  name: data.name,
  email: email,
  resetToken: resetToken
});
```

Also add the sendEmail helper in the <script> block above the event listener.

---

## 2. signup.html — After each successful .insert()

There are 3 form submit handlers (DJ, Host, Venue). After each successful insert,
add the sendEmail call BEFORE the success view lines.

### DJ signup (after line ~697, after the newUser localStorage line):
```js
// after: if (newUser) localStorage.setItem(...)
await sendEmail({
  type: 'welcome',
  name: name,
  email: document.getElementById('dj-email').value.toLowerCase(),
  role: 'dj',
  slug: finalSlug
});
```

### Host signup (after line ~730, after the newHost localStorage line):
```js
// after: if (newHost) localStorage.setItem(...)
await sendEmail({
  type: 'welcome',
  name: name,
  email: email.toLowerCase(),
  role: 'host'
});
```

### Venue signup (after line ~769, after the newVenue localStorage line):
```js
// after: if (newVenue) localStorage.setItem(...)
await sendEmail({
  type: 'welcome',
  name: contactName,
  email: email.toLowerCase(),
  role: 'venue'
});
```

---

## 3. dj-profile.html — When a message is sent to a DJ

Find where a message is inserted into the `messages` table (the contact/booking form submit).
After the successful Supabase insert, look up the recipient's email and fire:

```js
// After message insert succeeds, fetch recipient email
const { data: recipientData } = await db
  .from('users')
  .select('email, name')
  .eq('id', TO_USER_ID)   // replace with actual variable holding recipient's user id
  .single();

if (recipientData) {
  await sendEmail({
    type: 'inbox_notification',
    recipientName: recipientData.name,
    recipientEmail: recipientData.email,
    senderName: senderName,       // whoever filled the form
    senderEmail: senderEmail,     // their email
    subject: subject,             // message subject
    message: messageText          // message body
  });
}
```

---

## 4. claim.html — Replace the fake setTimeout

FIND (around line 166):
```js
// Simulate send — show success
setTimeout(() => {
  document.getElementById('claim-form').style.display = 'none';
  document.getElementById('profile-ref').style.display = 'none';
  alertEl.innerHTML = `...`;
  btn.disabled = false;
  btn.textContent = 'Send Claim Request';

  // Open mailto as a backup so the request also hits your email
  window.location.href = `mailto:admin@globaldjconnect.com?subject=${subject}&body=${body}`;
}, 800);
```

REPLACE WITH:
```js
await sendEmail({
  type: 'claim_request',
  claimantName: yourName,
  claimantEmail: yourEmail,
  bizName: bizName,
  slug: slug,
  verifyMsg: verifyMsg
});

document.getElementById('claim-form').style.display = 'none';
document.getElementById('profile-ref').style.display = 'none';
alertEl.innerHTML = `
  <div class="alert alert-success">
    ✓ Request sent! We'll review your claim and reach out to <strong>${yourEmail}</strong> within 1–2 business days.
  </div>`;
btn.disabled = false;
btn.textContent = 'Send Claim Request';
```

Also make submitClaim() async:
```js
async function submitClaim() {   // <-- add async
```
