// AUSSIM (AUtonomy Site SIMulator) © 2026 Lokanath.
// Clerk authentication — email/password + Google OAuth.
import Clerk from '@clerk/clerk-js';

const KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export function initAuth() {
  const overlay = document.getElementById('auth-overlay');
  if (!overlay) return;

  // No key = dev mode bypass
  if (!KEY) {
    overlay.remove();
    return;
  }

  const clerk = new Clerk(KEY);

  clerk.load({
    appearance: {
      layout: { socialButtonsVariant: 'blockButton', socialButtonsPlacement: 'top' },
      variables: {
        colorBackground:         '#0d1117',
        colorText:               '#d7dee8',
        colorTextSecondary:      '#7c8a9c',
        colorPrimary:            '#ffcc00',
        colorInputBackground:    '#12161c',
        colorInputText:          '#d7dee8',
        colorNeutral:            '#232b36',
        borderRadius:            '6px',
        fontFamily:              '"Segoe UI", system-ui, sans-serif',
        fontSize:                '14px',
      },
      elements: {
        card: {
          background:  'rgba(18,22,28,0.96)',
          border:      '1px solid rgba(255,204,0,0.18)',
          boxShadow:   '0 12px 48px rgba(0,0,0,0.7)',
          borderRadius: '10px',
        },
        headerTitle:          { color: '#fff', fontWeight: '700' },
        headerSubtitle:       { color: '#7c8a9c' },
        formButtonPrimary:    { background: 'linear-gradient(180deg,#ffd83d,#f0b400)', color: '#14100a', fontWeight: '700' },
        socialButtonsBlockButton:     { borderColor: 'rgba(255,204,0,0.25)', color: '#d7dee8' },
        socialButtonsBlockButtonText: { color: '#d7dee8' },
        formFieldInput:       { background: '#12161c', borderColor: '#232b36', color: '#d7dee8' },
        footerActionLink:     { color: '#ffcc00' },
        identityPreviewText:  { color: '#d7dee8' },
        identityPreviewEditButtonIcon: { color: '#ffcc00' },
      },
    },
  }).then(() => {
    if (clerk.user) {
      _clearOverlay(overlay, clerk.user);
      return;
    }
    clerk.mountSignIn(document.getElementById('clerk-mount'), {
      afterSignInUrl: window.location.href,
      afterSignUpUrl: window.location.href,
    });
    clerk.addListener(({ user }) => {
      if (user) _clearOverlay(overlay, user);
    });
  }).catch(err => {
    console.error('[AUSSIM] Clerk init error:', err);
    overlay.remove();
  });
}

function _clearOverlay(overlay, user) {
  overlay.remove();
  const badge = document.getElementById('auth-user-badge');
  if (badge) {
    badge.textContent = user.primaryEmailAddress?.emailAddress ?? user.id;
    badge.style.display = 'block';
  }
}
