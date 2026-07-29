// AUSSIM (AUtonomy Site SIMulator) © 2026 Lokanath.
// Clerk vanilla-JS auth — script-tag pattern (UMD bundle, not bundled by Vite).
// When loaded with data-clerk-publishable-key, window.Clerk is a ready instance.

const KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Decode the frontend-API host from the publishable key's base64 segment.
function _clerkUrl(key) {
  try {
    const b64 = key.split('_')[2].replace(/-/g, '+').replace(/_/g, '/');
    const api = atob(b64).replace(/\$$/, '');
    return `https://${api}/npm/@clerk/clerk-js@latest/dist/clerk.browser.js`;
  } catch {
    return null;
  }
}

// Inject Clerk's browser bundle as a plain <script> tag.
// Setting data-clerk-publishable-key causes Clerk to auto-instantiate
// itself as window.Clerk (an instance, not a class).
function _loadClerkScript(src, key) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.setAttribute('data-clerk-publishable-key', key);
    s.onload  = resolve;
    s.onerror = () => reject(new Error('Clerk script failed to load — check your publishable key and allowed origins in the Clerk dashboard.'));
    document.head.appendChild(s);
  });
}

const CLERK_APPEARANCE = {
  layout: { socialButtonsVariant: 'blockButton', socialButtonsPlacement: 'top' },
  variables: {
    colorBackground:      '#0d1117',
    colorText:            '#d7dee8',
    colorTextSecondary:   '#7c8a9c',
    colorPrimary:         '#ffcc00',
    colorInputBackground: '#12161c',
    colorInputText:       '#d7dee8',
    colorNeutral:         '#232b36',
    borderRadius:         '6px',
    fontFamily:           '"Segoe UI", system-ui, sans-serif',
    fontSize:             '14px',
  },
  elements: {
    card: {
      background:   'rgba(18,22,28,0.96)',
      border:       '1px solid rgba(255,204,0,0.18)',
      boxShadow:    '0 12px 48px rgba(0,0,0,0.7)',
      borderRadius: '10px',
    },
    headerTitle:                   { color: '#fff', fontWeight: '700' },
    headerSubtitle:                { color: '#7c8a9c' },
    formButtonPrimary:             { background: 'linear-gradient(180deg,#ffd83d,#f0b400)', color: '#14100a', fontWeight: '700' },
    socialButtonsBlockButton:      { borderColor: 'rgba(255,204,0,0.25)', color: '#d7dee8' },
    socialButtonsBlockButtonText:  { color: '#d7dee8' },
    formFieldInput:                { background: '#12161c', borderColor: '#232b36', color: '#d7dee8' },
    footerActionLink:              { color: '#ffcc00' },
    identityPreviewText:           { color: '#d7dee8' },
    identityPreviewEditButtonIcon: { color: '#ffcc00' },
  },
};

export async function initAuth() {
  const overlay = document.getElementById('auth-overlay');
  if (!overlay) return;

  if (!KEY) {
    _showConfigError(overlay, 'VITE_CLERK_PUBLISHABLE_KEY is missing.<br>Add it as a GitHub Actions secret and redeploy.');
    return;
  }

  const scriptUrl = _clerkUrl(KEY);
  if (!scriptUrl) {
    _showConfigError(overlay, 'Could not parse Clerk publishable key.');
    return;
  }

  try {
    // Load Clerk — after this, window.Clerk is a pre-instantiated Clerk object.
    await _loadClerkScript(scriptUrl, KEY);

    const clerk = window.Clerk;
    if (!clerk) throw new Error('window.Clerk not found after script load.');

    await clerk.load({ appearance: CLERK_APPEARANCE });

    if (clerk.user) {
      _clearOverlay(overlay, clerk.user);
      return;
    }

    clerk.mountSignIn(document.getElementById('clerk-mount'), {
      appearance:     CLERK_APPEARANCE,
      afterSignInUrl: window.location.href,
      afterSignUpUrl: window.location.href,
    });

    clerk.addListener(({ user }) => {
      if (user) _clearOverlay(overlay, user);
    });

  } catch (err) {
    console.error('[AUSSIM] Clerk error:', err);
    _showConfigError(overlay, err.message);
  }
}

function _clearOverlay(overlay, user) {
  overlay.classList.add('auth-fade-out');
  setTimeout(() => overlay.remove(), 400);
  const badge = document.getElementById('auth-user-badge');
  if (badge) {
    badge.textContent = user.primaryEmailAddress?.emailAddress ?? user.id;
    badge.style.display = 'block';
  }
}

function _showConfigError(overlay, detail) {
  const mount = document.getElementById('clerk-mount');
  if (mount) {
    mount.innerHTML = `
      <div style="
        background:rgba(255,93,93,0.1);border:1px solid #ff5d5d;
        border-radius:8px;padding:18px 20px;text-align:center;color:#ff5d5d;
        font-size:13px;line-height:1.6;
      ">
        <div style="font-size:1.4rem;margin-bottom:8px;">⚠️</div>
        <strong>Authentication not configured</strong><br>
        <span style="color:#7c8a9c;font-size:12px;">${detail}</span>
      </div>`;
  }
}
