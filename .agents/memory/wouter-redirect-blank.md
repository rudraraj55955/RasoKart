---
name: Wouter Redirect blank screen
description: Why <Redirect> causes blank screen and how to fix it with AuthRedirect spinner pattern.
---

# Wouter `<Redirect>` blank screen

## The rule
Never use wouter's `<Redirect>` component inside auth guards (ProtectedRoute). Replace it with a component that shows a visible spinner while navigating.

## Why
Wouter's `<Redirect>` implementation:
```tsx
export const Redirect = ({ to }) => {
  const [, navigate] = useLocation();
  useLayoutEffect(() => { navigate(to); }, []);
  return null;  // ← blank for 1 frame
};
```

`useLayoutEffect` fires after React commits but the navigation it triggers is asynchronous (setState on wouter's location atom). The sequence:
1. Render → `null` committed to DOM
2. `useLayoutEffect` fires → `navigate(to)` → schedules React re-render
3. **Browser may paint the null state here** (blank flash)
4. React re-renders with new location → correct route renders
5. Browser paints correct content

In production (large JS bundles, slower devices), step 3 is visible as a blank screen.

## How to apply
Use an `AuthRedirect` component that returns a spinner and navigates via `useEffect`:

```tsx
function AuthRedirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation(to, { replace: true } as any);
  }, [to]);
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Spinner className="w-8 h-8 text-primary" />
    </div>
  );
}
```

The spinner is visible during the navigation frame. The user never sees blank.

## Related: DashboardLayout null guard
`DashboardLayout` had `if (!publicMode && !user) return null;` — same blank screen risk if hit unexpectedly. Changed to return the Spinner screen instead.

## Related: clear-cache.html token preservation
The original clear-cache.html preserved the auth token across cache clears. This meant admins who cleared cache still had their admin token → visited merchant routes → hit wrong-role redirect → blank frame. Fixed by wiping all localStorage without preservation.
